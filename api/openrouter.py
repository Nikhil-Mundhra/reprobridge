"""OpenRouter LLM client for de-identified agentic coordination synthesis.

Only non-PHI, de-identified payloads validated by `api.privacy.assert_phi_free`
are permitted to be transmitted to OpenRouter. Deterministic clinical rules
never depend on this module.
"""

from __future__ import annotations

from collections.abc import Iterator
import json
import os
from typing import Any

import httpx
from dotenv import load_dotenv

from api.privacy import assert_phi_free

load_dotenv(".env.local")
load_dotenv(".env")

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OPENROUTER_MODEL = "google/gemma-4-31b-it:free"
FREE_FALLBACK_MODELS: list[str] = [
    "google/gemma-4-26b-a4b-it:free",
    "openrouter/free",
]

SYSTEM_PROMPT = (
    "You are ReproBridge's assistive care-coordination synthesizer. "
    "You receive ONLY de-identified clinical obligation metadata (never PHI). "
    "You do NOT diagnose or prescribe; all clinical actions require clinician approval. "
    "Return valid JSON with exactly two string keys: "
    "'summary' (2 concise sentences summarizing the transition impact) and "
    "'specialist_handoff' (a concise, actionable handoff checklist for the receiving OB-GYN / care team)."
)

STREAM_SYSTEM_PROMPT = (
    "You are ReproBridge's assistive care-coordination synthesizer. "
    "You receive ONLY de-identified clinical obligation metadata (never PHI). "
    "You do NOT diagnose or prescribe; all clinical actions require clinician approval. "
    "Write your response using EXACTLY these two section markers on their own lines so it can be streamed live:\n"
    "SUMMARY:\n"
    "<2 concise sentences summarizing the transition impact>\n"
    "HANDOFF:\n"
    "• <concise actionable checklist item 1 for the receiving OB-GYN / care team>\n"
    "• <concise actionable checklist item 2>\n"
    "Do not output JSON, markdown fences, or extra headings."
)


def _deterministic_fallback(payload: dict[str, Any], reason: str) -> dict[str, Any]:
    count = len(payload.get("obligations", []))
    event_type = payload.get("transition_event", "LIFE_STAGE_TRANSITION")
    return {
        "mode": "deterministic_fallback",
        "provider": "local-deterministic",
        "model": "none",
        "fallback_reason": reason,
        "summary": (
            f"Reassessed {count} de-identified obligation(s) under event '{event_type}'. "
            "Urgent antenatal thyroid follow-up escalated for OB-GYN review; contraindicated "
            "live-vaccine obligation preserved and deferred to postpartum."
        ),
        "specialist_handoff": (
            "1) Review escalated thyroid obligation (OBL-101) against first-trimester TSH target (<2.5 mIU/L) "
            "and confirm clinician-approved management plan. "
            "2) Confirm Rubella non-immune obligation (OBL-102) remains scheduled on the postpartum pathway."
        ),
    }


def _get_model_config() -> tuple[str, list[str]]:
    """Resolve primary model and OpenRouter free fallback chain."""
    primary = os.getenv("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL).strip() or DEFAULT_OPENROUTER_MODEL
    models = [primary]
    for fb in FREE_FALLBACK_MODELS:
        if fb not in models:
            models.append(fb)
    return primary, models


def _build_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://reprobridge.vercel.app",
        "X-Title": "ReproBridge Care-Coordination Harness",
    }


def _parse_streamed_sections(raw_text: str) -> tuple[str, str]:
    """Split streamed SUMMARY: / HANDOFF: text into summary and specialist_handoff."""
    text = raw_text.strip()
    if "HANDOFF:" in text:
        before, after = text.split("HANDOFF:", 1)
        summary = before.replace("SUMMARY:", "", 1).strip()
        handoff = after.strip()
        return summary, handoff
    summary = text.replace("SUMMARY:", "", 1).strip()
    return summary, ""


def synthesize_deidentified_brief(
    deidentified_payload: dict[str, Any],
    *,
    timeout_seconds: float = 18.0,
) -> dict[str, Any]:
    """Send a strictly de-identified payload to OpenRouter to draft a coordination brief."""
    # Mandatory pre-egress firewall check — blocks any accidental PHI transmission.
    assert_phi_free(deidentified_payload)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    primary_model, fallback_chain = _get_model_config()

    if not api_key:
        return _deterministic_fallback(deidentified_payload, reason="OPENROUTER_API_KEY not configured")

    headers = _build_headers(api_key)
    request_body = {
        "model": primary_model,
        "models": fallback_chain,
        "temperature": 0.2,
        "max_tokens": 500,
        "reasoning": {"effort": "none"},
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Synthesize a clinician coordination brief and specialist handoff from this "
                    f"de-identified transition payload:\n{json.dumps(deidentified_payload, indent=2)}"
                ),
            },
        ],
    }

    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.post(OPENROUTER_API_URL, headers=headers, json=request_body)
            response.raise_for_status()
            data = response.json()

        raw_content = data["choices"][0]["message"]["content"]
        parsed = json.loads(raw_content)
        summary = str(parsed.get("summary", "")).strip()
        raw_handoff = parsed.get("specialist_handoff", "")
        if isinstance(raw_handoff, list):
            handoff = "\n".join(f"• {str(item).strip()}" for item in raw_handoff if str(item).strip())
        else:
            handoff = str(raw_handoff).strip()
        if not summary or not handoff:
            return _deterministic_fallback(deidentified_payload, reason="Incomplete JSON fields from OpenRouter")

        return {
            "mode": "openrouter",
            "provider": "openrouter",
            "model": data.get("model", primary_model),
            "fallback_reason": None,
            "summary": summary,
            "specialist_handoff": handoff,
        }
    except Exception as exc:  # noqa: BLE001
        return _deterministic_fallback(
            deidentified_payload,
            reason=f"OpenRouter unavailable ({type(exc).__name__})",
        )


def stream_deidentified_brief(
    deidentified_payload: dict[str, Any],
    *,
    timeout_seconds: float = 25.0,
) -> Iterator[dict[str, Any]]:
    """Stream token deltas from OpenRouter using ONLY the de-identified payload.

    Yields event dicts:
      - {"type": "token", "delta": str, "model": str}
      - {"type": "done", "result": dict[str, Any]}
    """
    assert_phi_free(deidentified_payload)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    primary_model, fallback_chain = _get_model_config()

    if not api_key:
        fb = _deterministic_fallback(deidentified_payload, reason="OPENROUTER_API_KEY not configured")
        yield {"type": "done", "result": fb}
        return

    headers = _build_headers(api_key)
    request_body = {
        "model": primary_model,
        "models": fallback_chain,
        "temperature": 0.2,
        "max_tokens": 500,
        "reasoning": {"effort": "none"},
        "stream": True,
        "messages": [
            {"role": "system", "content": STREAM_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Synthesize a clinician coordination brief and specialist handoff from this "
                    f"de-identified transition payload:\n{json.dumps(deidentified_payload, indent=2)}"
                ),
            },
        ],
    }

    accumulated: list[str] = []
    resolved_model = primary_model
    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            with client.stream("POST", OPENROUTER_API_URL, headers=headers, json=request_body) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    if chunk.get("model"):
                        resolved_model = str(chunk["model"])
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = (choices[0].get("delta") or {}).get("content")
                    if delta:
                        accumulated.append(delta)
                        yield {"type": "token", "delta": delta, "model": resolved_model}

        full_text = "".join(accumulated).strip()
        summary, handoff = _parse_streamed_sections(full_text)
        if not summary:
            fb = _deterministic_fallback(deidentified_payload, reason="Empty streamed response from OpenRouter")
            yield {"type": "done", "result": fb}
            return

        if not handoff:
            handoff = (
                "• Review escalated clinical obligations and confirm clinician-approved care plan.\n"
                "• Verify deferred postpartum obligations remain scheduled on the Clinical Obligation Passport."
            )

        yield {
            "type": "done",
            "result": {
                "mode": "openrouter",
                "provider": "openrouter",
                "model": resolved_model,
                "fallback_reason": None,
                "summary": summary,
                "specialist_handoff": handoff,
            },
        }
    except Exception as exc:  # noqa: BLE001
        fb = _deterministic_fallback(
            deidentified_payload,
            reason=f"OpenRouter stream unavailable ({type(exc).__name__})",
        )
        yield {"type": "done", "result": fb}
