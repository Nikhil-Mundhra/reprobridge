"""OpenRouter LLM client for de-identified agentic coordination synthesis.

Only non-PHI, de-identified payloads validated by `api.privacy.assert_phi_free`
are permitted to be transmitted to OpenRouter. Deterministic clinical rules
never depend on this module.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Iterator
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

ELEVENLABS_TTS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v4"

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

EXPLAIN_SYSTEM_PROMPT = (
    "You are ReproBridge's assistive clinical-finding explainer. "
    "You receive ONLY de-identified obligation metadata (never PHI). "
    "You do NOT diagnose or prescribe; all clinical decisions require clinician sign-off. "
    "Write in clear, calm, spoken-friendly prose with no markdown syntax, asterisks, or emojis. "
    "Return valid JSON with exactly three keys: "
    "'headline' (short plain summary under 12 words), "
    "'explanation' (2 to 3 smooth sentences explaining the lab or preventive finding, why the target range matters at this life stage, and the follow-up step), and "
    "'key_points' (array of 2 to 3 concise plain-text takeaway sentences)."
)

EXPLAIN_STREAM_SYSTEM_PROMPT = (
    "You are ReproBridge's assistive clinical-finding explainer. "
    "You receive ONLY de-identified obligation metadata (never PHI). "
    "You do NOT diagnose or prescribe; all clinical decisions require clinician sign-off. "
    "Write in clear, calm, spoken-friendly prose with no markdown fences, asterisks, bolding, or emojis. "
    "Format your response using EXACTLY these three section markers on their own lines so it can stream live:\n"
    "HEADLINE:\n"
    "<short plain summary under 12 words>\n"
    "EXPLANATION:\n"
    "<2 to 3 smooth sentences explaining the finding, why the reference target matters at this life stage, and the follow-up step>\n"
    "KEY_POINTS:\n"
    "• <concise takeaway 1>\n"
    "• <concise takeaway 2>\n"
    "• <concise takeaway 3>"
)

_EXPLAIN_DISCLAIMER = (
    "Assistive de-identified explanation only — does not diagnose or prescribe. "
    "Final verification requires clinician approval."
)


def _deterministic_fallback(payload: dict[str, Any], reason: str) -> dict[str, Any]:
    obligations = payload.get("obligations", [])
    count = len(obligations)
    event_type = payload.get("transition_event", "LIFE_STAGE_TRANSITION")
    obl_ids = {str(o.get("obligation_id", "")) for o in obligations}

    if not obl_ids or obl_ids & {"OBL-101", "OBL-102"}:
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
                "• Review escalated thyroid obligation (OBL-101) against first-trimester TSH target (<2.5 mIU/L) "
                "and confirm clinician-approved management plan.\n"
                "• Confirm Rubella non-immune obligation (OBL-102) remains scheduled on the postpartum pathway."
            ),
        }

    bullets: list[str] = []
    for obl in obligations:
        oid = str(obl.get("obligation_id", "OBL"))
        cat = str(obl.get("clinical_category", "preventive_followup")).replace("_", " ")
        status = str(obl.get("status", "OPEN"))
        priority = str(obl.get("priority", "MEDIUM"))
        owner = str(obl.get("owner_specialty", "OB-GYN"))
        if status == "DEFERRED_TO_POSTPARTUM":
            bullets.append(
                f"• Keep {oid} ({cat}) preserved on the postpartum pathway pending pregnancy completion ({owner})."
            )
        else:
            bullets.append(
                f"• Review {priority} obligation {oid} ({cat}) with {owner} and verify qualifying evidence before closure."
            )

    return {
        "mode": "deterministic_fallback",
        "provider": "local-deterministic",
        "model": "none",
        "fallback_reason": reason,
        "summary": (
            f"Reassessed {count} de-identified obligation(s) under event '{event_type}'. "
            "Time-sensitive antenatal care gaps escalated for specialist review; pregnancy-deferred "
            "immunizations preserved for postpartum closure."
        ),
        "specialist_handoff": "\n".join(bullets)
        or "• Review updated obligations on the Clinical Obligation Passport.",
    }


def _get_model_config() -> tuple[str, list[str]]:
    """Resolve primary model and OpenRouter free fallback chain."""
    primary = (
        os.getenv("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL).strip() or DEFAULT_OPENROUTER_MODEL
    )
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
        return _deterministic_fallback(
            deidentified_payload, reason="OPENROUTER_API_KEY not configured"
        )

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
            handoff = "\n".join(
                f"• {str(item).strip()}" for item in raw_handoff if str(item).strip()
            )
        else:
            handoff = str(raw_handoff).strip()
        if not summary or not handoff:
            return _deterministic_fallback(
                deidentified_payload, reason="Incomplete JSON fields from OpenRouter"
            )

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
        fb = _deterministic_fallback(
            deidentified_payload, reason="OPENROUTER_API_KEY not configured"
        )
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
        with (
            httpx.Client(timeout=timeout_seconds) as client,
            client.stream(
                "POST", OPENROUTER_API_URL, headers=headers, json=request_body
            ) as response,
        ):
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
            fb = _deterministic_fallback(
                deidentified_payload, reason="Empty streamed response from OpenRouter"
            )
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


def _deterministic_explain_fallback(
    deidentified_payload: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    obl = deidentified_payload.get("obligation") or {}
    category = str(obl.get("clinical_category", "preventive_reproductive_followup"))
    life_stage = str(obl.get("life_stage", "Preconception"))
    status = str(obl.get("status", "OPEN"))
    owner = str(obl.get("owner_specialty", "OB-GYN / Primary Care"))
    title = str(obl.get("finding_title", "Clinical Follow-up Finding")).strip()
    rationale = str(obl.get("clinical_rationale", "")).strip()

    category_copy: dict[str, tuple[str, str, list[str]]] = {
        "subclinical_hypothyroidism_tsh_followup": (
            f"Elevated Thyroid-Stimulating Hormone ({life_stage})",
            (
                "Preconception or early-pregnancy TSH levels above target can strain maternal thyroid reserve, "
                "especially because the first-trimester therapeutic window narrows to below 2.5 milli-international units per liter. "
                f"Under {owner} oversight, repeat TSH and free T4 testing confirms whether clinician-approved titration is needed before closure."
            ),
            [
                "Preconception reference is up to 4.0 mIU/L, tightening to 0.1–2.5 mIU/L in Trimester 1.",
                f"Current workflow status is {status} with {owner} coordinating lab verification.",
                "Requires repeat TSH and free T4 lab evidence plus clinician sign-off before closure.",
            ],
        ),
        "live_vaccine_non_immune_deferral": (
            f"Live-Vaccine Immunity Gap ({life_stage})",
            (
                "Non-immune serology leaves the patient vulnerable to preventable infection during pregnancy, "
                "yet live-attenuated vaccines such as MMR or Varicella are strictly contraindicated once pregnant. "
                "ReproBridge keeps this obligation open and automatically defers immunization to the pre-discharge postpartum pathway."
            ),
            [
                "Live-attenuated vaccines cannot be safely administered during pregnancy.",
                f"Obligation remains tracked in {status} state so postpartum immunization is never dropped.",
                "Eligible for clinician-verified closure only after pregnancy completes.",
            ],
        ),
        "gestational_dysglycemia_ogtt_followup": (
            f"Preconception Dysglycemia & Glucose Monitoring ({life_stage})",
            (
                "Borderline fasting glucose or HbA1c before conception raises the likelihood of gestational diabetes "
                "as placental insulin resistance increases. Early oral glucose tolerance testing allows the endocrinology "
                f"and {owner} teams to intervene promptly when thresholds shift."
            ),
            [
                "Standard preconception fasting glucose target is under 100 mg/dL and HbA1c under 5.7%.",
                "Pregnancy tightens fasting glycemic targets below 95 mg/dL to protect fetal growth.",
                "Requires formal OGTT confirmation and clinician-approved management review.",
            ],
        ),
        "preeclampsia_aspirin_prophylaxis_window": (
            f"Preeclampsia Risk & Prophylaxis Timing ({life_stage})",
            (
                "Elevated baseline blood pressure combined with obstetric history indicates a time-sensitive window "
                "for preventive maternal-fetal follow-up. Guidelines emphasize evaluating low-dose aspirin prophylaxis "
                "between 12 and 16 weeks gestation before spiral-artery remodeling completes."
            ),
            [
                "Prophylaxis evaluation window sits between 12 and 16 weeks of pregnancy.",
                "Baseline blood pressure readings are tracked against standard (<120/80) and preeclampsia (>=140/90) cutoffs.",
                f"Coordinated by {owner} pending clinician order verification.",
            ],
        ),
        "hpv_series_postpartum_completion": (
            f"Incomplete HPV Immunization Series ({life_stage})",
            (
                "The HPV 9-valent vaccine series remains incomplete, leaving partial protection until remaining doses "
                "are administered. Routine HPV vaccination is deferred during pregnancy and resumed smoothly in the "
                "postpartum clinic so the multi-dose series finishes safely."
            ),
            [
                "Routine HPV vaccination is postponed during pregnancy without restarting prior doses.",
                f"Current tracking status ({status}) carries remaining dose history into postpartum care.",
                "Closes once remaining series doses are documented and verified.",
            ],
        ),
    }

    if category in category_copy:
        headline, explanation, key_points = category_copy[category]
    else:
        headline = title[:90] or f"Clinical Follow-up Explanation ({life_stage})"
        explanation = (
            (f"{rationale} " if rationale else "")
            + f"ReproBridge keeps this obligation tracked under {life_stage} care with {owner} until qualifying clinical evidence is verified."
        )
        key_points = [
            f"Current life stage: {life_stage} (Status: {status}).",
            f"Care coordination owner: {owner}.",
            "Requires verified clinical evidence and clinician sign-off before closure.",
        ]

    return {
        "headline": headline,
        "explanation": explanation.strip(),
        "key_points": key_points,
        "disclaimer": _EXPLAIN_DISCLAIMER,
        "ai_metadata": {
            "mode": "deterministic_fallback",
            "provider": "local-deterministic",
            "model": "none",
            "fallback_reason": reason,
        },
    }


def explain_deidentified_obligation(
    deidentified_payload: dict[str, Any],
    *,
    timeout_seconds: float = 18.0,
) -> dict[str, Any]:
    """Generate a plain-language, spoken-friendly explanation from a zero-PHI obligation payload."""
    assert_phi_free(deidentified_payload)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    primary_model, fallback_chain = _get_model_config()

    if not api_key:
        return _deterministic_explain_fallback(
            deidentified_payload,
            reason="OPENROUTER_API_KEY not configured",
        )

    headers = _build_headers(api_key)
    request_body = {
        "model": primary_model,
        "models": fallback_chain,
        "temperature": 0.2,
        "max_tokens": 450,
        "reasoning": {"effort": "none"},
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Explain this de-identified clinical obligation clearly for clinicians and patients "
                    f"(0 PHI):\n{json.dumps(deidentified_payload, indent=2)}"
                ),
            },
        ],
    }

    try:
        with httpx.Client(timeout=timeout_seconds) as client:
            response = client.post(OPENROUTER_API_URL, headers=headers, json=request_body)
            response.raise_for_status()
            data = response.json()

        raw_content = str(data["choices"][0]["message"]["content"]).strip()
        if raw_content.startswith("```"):
            raw_content = raw_content.strip("`").removeprefix("json").strip()
        parsed = json.loads(raw_content)
        headline = str(parsed.get("headline", "")).strip()
        explanation = str(parsed.get("explanation", "")).strip()
        raw_points = parsed.get("key_points") or []
        key_points = [str(item).strip() for item in raw_points if str(item).strip()][:4]

        if not headline or not explanation:
            return _deterministic_explain_fallback(
                deidentified_payload,
                reason="Incomplete JSON fields from OpenRouter",
            )

        return {
            "headline": headline,
            "explanation": explanation,
            "key_points": key_points,
            "disclaimer": _EXPLAIN_DISCLAIMER,
            "ai_metadata": {
                "mode": "openrouter",
                "provider": "openrouter",
                "model": str(data.get("model", primary_model)),
                "fallback_reason": None,
            },
        }
    except Exception as exc:  # noqa: BLE001
        return _deterministic_explain_fallback(
            deidentified_payload,
            reason=f"OpenRouter unavailable ({type(exc).__name__})",
        )


def _parse_streamed_explanation(raw_text: str) -> tuple[str, str, list[str]]:
    """Parse HEADLINE: / EXPLANATION: / KEY_POINTS: sections from streamed text."""
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    markers = list(
        re.finditer(r"(?:^|\n)\s*(HEADLINE|EXPLANATION|KEY_POINTS)\s*:\s*", text, flags=re.IGNORECASE)
    )
    sections: dict[str, str] = {}
    for idx, match in enumerate(markers):
        name = match.group(1).upper()
        start = match.end()
        end = markers[idx + 1].start() if idx + 1 < len(markers) else len(text)
        sections[name] = text[start:end].strip()

    headline = " ".join(sections.get("HEADLINE", "").splitlines()).strip()
    explanation = " ".join(sections.get("EXPLANATION", "").splitlines()).strip()
    key_points: list[str] = []
    for line in sections.get("KEY_POINTS", "").splitlines():
        cleaned = re.sub(r"^\s*(?:[•*-]|\d+[.)])\s*", "", line).strip()
        if cleaned:
            key_points.append(cleaned)

    return headline, explanation, key_points[:4]


def stream_deidentified_explanation(
    deidentified_payload: dict[str, Any],
    *,
    timeout_seconds: float = 25.0,
) -> Iterator[dict[str, Any]]:
    """Stream token deltas from OpenRouter for a single de-identified obligation explanation.

    Yields event dicts:
      - {"type": "token", "delta": str, "model": str}
      - {"type": "done", "result": dict[str, Any]}
    """
    assert_phi_free(deidentified_payload)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    primary_model, fallback_chain = _get_model_config()

    if not api_key:
        fb = _deterministic_explain_fallback(
            deidentified_payload,
            reason="OPENROUTER_API_KEY not configured",
        )
        yield {"type": "done", "result": fb}
        return

    headers = _build_headers(api_key)
    request_body = {
        "model": primary_model,
        "models": fallback_chain,
        "temperature": 0.2,
        "max_tokens": 450,
        "reasoning": {"effort": "none"},
        "stream": True,
        "messages": [
            {"role": "system", "content": EXPLAIN_STREAM_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Explain this de-identified clinical obligation clearly for clinicians and patients "
                    f"(0 PHI):\n{json.dumps(deidentified_payload, indent=2)}"
                ),
            },
        ],
    }

    accumulated: list[str] = []
    resolved_model = primary_model
    try:
        with (
            httpx.Client(timeout=timeout_seconds) as client,
            client.stream(
                "POST", OPENROUTER_API_URL, headers=headers, json=request_body
            ) as response,
        ):
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
        headline, explanation, key_points = _parse_streamed_explanation(full_text)
        if not headline or not explanation:
            fb = _deterministic_explain_fallback(
                deidentified_payload,
                reason="Incomplete streamed sections from OpenRouter",
            )
            yield {"type": "done", "result": fb}
            return

        yield {
            "type": "done",
            "result": {
                "headline": headline,
                "explanation": explanation,
                "key_points": key_points,
                "disclaimer": _EXPLAIN_DISCLAIMER,
                "ai_metadata": {
                    "mode": "openrouter",
                    "provider": "openrouter",
                    "model": resolved_model,
                    "fallback_reason": None,
                },
            },
        }
    except Exception as exc:  # noqa: BLE001
        fb = _deterministic_explain_fallback(
            deidentified_payload,
            reason=f"OpenRouter stream unavailable ({type(exc).__name__})",
        )
        yield {"type": "done", "result": fb}


def synthesize_elevenlabs_audio(
    deidentified_text: str,
    *,
    timeout_seconds: float = 25.0,
) -> bytes:
    """Synthesize MP3 neural speech via ElevenLabs from strictly de-identified text."""
    assert_phi_free({"text": deidentified_text})

    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not configured")

    voice_id = (
        os.getenv("ELEVENLABS_VOICE_ID", DEFAULT_ELEVENLABS_VOICE_ID).strip()
        or DEFAULT_ELEVENLABS_VOICE_ID
    )
    model_id = (
        os.getenv("ELEVENLABS_MODEL_ID", DEFAULT_ELEVENLABS_MODEL_ID).strip()
        or DEFAULT_ELEVENLABS_MODEL_ID
    )
    url = ELEVENLABS_TTS_URL_TEMPLATE.format(voice_id=voice_id)
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    payload = {
        "text": deidentified_text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
        },
    }

    with httpx.Client(timeout=timeout_seconds) as client:
        response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        return response.content
