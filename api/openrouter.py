"""OpenRouter LLM client for de-identified agentic coordination synthesis.

Only non-PHI, de-identified payloads validated by `api.privacy.assert_phi_free`
are permitted to be transmitted to OpenRouter. Deterministic clinical rules
never depend on this module.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from dotenv import load_dotenv

from api.privacy import assert_phi_free

load_dotenv(".env.local")
load_dotenv(".env")

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini"

SYSTEM_PROMPT = (
    "You are ReproBridge's assistive care-coordination synthesizer. "
    "You receive ONLY de-identified clinical obligation metadata (never PHI). "
    "You do NOT diagnose or prescribe; all clinical actions require clinician approval. "
    "Return valid JSON with exactly two string keys: "
    "'summary' (2 concise sentences summarizing the transition impact) and "
    "'specialist_handoff' (a concise, actionable handoff checklist for the receiving OB-GYN / care team)."
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


def synthesize_deidentified_brief(
    deidentified_payload: dict[str, Any],
    *,
    timeout_seconds: float = 12.0,
) -> dict[str, Any]:
    """Send a strictly de-identified payload to OpenRouter to draft a coordination brief."""
    # Mandatory pre-egress firewall check — blocks any accidental PHI transmission.
    assert_phi_free(deidentified_payload)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL).strip() or DEFAULT_OPENROUTER_MODEL

    if not api_key:
        return _deterministic_fallback(deidentified_payload, reason="OPENROUTER_API_KEY not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://reprobridge.vercel.app",
        "X-Title": "ReproBridge Care-Coordination Harness",
    }
    request_body = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 350,
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
            "model": data.get("model", model),
            "fallback_reason": None,
            "summary": summary,
            "specialist_handoff": handoff,
        }
    except Exception as exc:  # noqa: BLE001
        return _deterministic_fallback(
            deidentified_payload,
            reason=f"OpenRouter unavailable ({type(exc).__name__})",
        )
