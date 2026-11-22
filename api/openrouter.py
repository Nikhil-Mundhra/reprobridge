"""OpenRouter LLM client for de-identified agentic coordination synthesis.

Only non-PHI, de-identified payloads validated by `api.privacy.assert_phi_free`
are permitted to be transmitted to OpenRouter. Deterministic clinical rules
never depend on this module.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Iterator
from typing import Any

import httpx
from dotenv import load_dotenv

from api.privacy import assert_phi_free

load_dotenv(".env")
load_dotenv(".env.local")

logger = logging.getLogger(__name__)

# Failures that should degrade to the deterministic fallback rather than surface to callers:
# - httpx.HTTPError: timeouts, connection errors, non-2xx (raise_for_status)
# - ValueError: malformed JSON bodies (json.JSONDecodeError subclasses ValueError)
# - KeyError / IndexError / TypeError / AttributeError: unexpected response shapes
# PrivacyViolationError is deliberately NOT included: it is raised before egress and must propagate.
_RECOVERABLE_OPENROUTER_ERRORS: tuple[type[Exception], ...] = (
    httpx.HTTPError,
    ValueError,
    KeyError,
    IndexError,
    TypeError,
    AttributeError,
)

OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_OPENROUTER_MODEL = "google/gemma-4-31b-it:free"
FREE_FALLBACK_MODELS: list[str] = [
    "google/gemma-4-26b-a4b-it:free",
    "openrouter/free",
]

ELEVENLABS_TTS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"
DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_ELEVENLABS_MODEL_ID = "eleven_v4"

_CLINICAL_SAFETY_RULES = (
    "You do NOT diagnose, prescribe, or recommend initiating or dosing any medication "
    "(say 'evaluate need for specialist management or titration per OB-GYN protocol' instead of naming drug initiation). "
    "Mention ONLY conditions, labs, screenings, and vaccines explicitly present in the input payload—never invent or substitute another vaccine or condition (e.g., do not mention varicella unless varicella is in the payload). "
    "Align all timing strictly with each obligation's deterministic due_label and protocol_code in the payload "
    "(for example: ≤ 72h for first-trimester escalations or SMFM severe postpartum hypertension, ≤ 10 days for remote postpartum BP monitoring, "
    "4–12 weeks postpartum for ADA 2026 75g GDM OGTT or locally adopted delivery-admission protocol, pre-discharge ≤ 48h for deferred postpartum immunizations, "
    "≥ 6 weeks postpartum for deferred cervical re-evaluation, or immediate urgent pathway for documented mental-health safety concerns). "
    "Never suggest closing an obligation from a booked appointment alone, a screening score alone, or a normal pelvic ultrasound in suspected endometriosis. "
    "All clinical actions require clinician sign-off."
)

SYSTEM_PROMPT = (
    "You are ReproBridge's assistive care-coordination synthesizer. "
    "You receive ONLY de-identified clinical obligation metadata (never PHI). "
    f"{_CLINICAL_SAFETY_RULES} "
    "Return valid JSON with exactly two string keys: "
    "'summary' (2 concise sentences summarizing the transition impact) and "
    "'specialist_handoff' (a concise, actionable handoff checklist for the receiving OB-GYN / care team)."
)

STREAM_SYSTEM_PROMPT = (
    "You are ReproBridge's assistive care-coordination synthesizer. "
    "You receive ONLY de-identified clinical obligation metadata (never PHI). "
    f"{_CLINICAL_SAFETY_RULES} "
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
    f"{_CLINICAL_SAFETY_RULES} "
    "Write in clear, calm, spoken-friendly prose with no markdown syntax, asterisks, or emojis. "
    "Return valid JSON with exactly three keys: "
    "'headline' (short plain summary under 12 words), "
    "'explanation' (2 to 3 smooth sentences explaining the lab or preventive finding, why the target range matters at this life stage, and the follow-up step), and "
    "'key_points' (array of 2 to 3 concise plain-text takeaway sentences)."
)

EXPLAIN_STREAM_SYSTEM_PROMPT = (
    "You are ReproBridge's assistive clinical-finding explainer. "
    "You receive ONLY de-identified obligation metadata (never PHI). "
    f"{_CLINICAL_SAFETY_RULES} "
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

QUESTIONNAIRE_SYSTEM_PROMPT = (
    "You are ReproBridge's assistive clinical intake & document reconciliation copilot. "
    "You receive ONLY de-identified obligation metadata (never PHI). "
    f"{_CLINICAL_SAFETY_RULES} "
    "Return valid JSON with two keys: "
    "'context_note' (1 concise sentence flagging any potential mismatch between HIE documents and live patient state) "
    "and 'questions' (an array of exactly 3 objects, each with string keys 'question' and string-array 'options' of 3 choices): "
    "item 1 verifies current pregnancy stage vs HIE data (e.g. data shows 5th week/preconception vs possible 8th week scan); "
    "item 2 verifies current medications and whether they differ from current EMR data; "
    "item 3 asks a scenario-specific document/lab verification question grounded ONLY in the obligations provided."
)

QUESTIONNAIRE_STREAM_SYSTEM_PROMPT = (
    "You are ReproBridge's assistive clinical intake & document reconciliation copilot. "
    "You receive ONLY de-identified obligation metadata (never PHI). "
    f"{_CLINICAL_SAFETY_RULES} "
    "Ask 3 concise verification questions so the clinician confirms whether today's presentation matches the HIE documents on file "
    "(gestational week discrepancy such as 5th week on record vs 8th week on scan, medication differences, and scenario-specific findings). "
    "Respond using EXACTLY these markers on their own lines so they can be streamed live:\n"
    "CONTEXT_NOTE:\n"
    "<1 concise sentence explaining the document-vs-live verification focus>\n"
    "Q1_QUESTION:\n"
    "<question verifying current pregnancy stage vs HIE record>\n"
    "Q1_OPTIONS:\n"
    "<option 1> | <option 2> | <option 3>\n"
    "Q2_QUESTION:\n"
    "<question verifying active medications vs HIE record>\n"
    "Q2_OPTIONS:\n"
    "<option 1> | <option 2> | <option 3>\n"
    "Q3_QUESTION:\n"
    "<scenario-specific verification question referencing only obligations in the payload>\n"
    "Q3_OPTIONS:\n"
    "<option 1> | <option 2> | <option 3>\n"
    "Do not output JSON, markdown fences, bold asterisks, or PHI."
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
        due_label = str(obl.get("due_label") or "").strip()
        due_suffix = f" · Target: {due_label}" if due_label else ""
        if status == "DEFERRED_TO_POSTPARTUM":
            bullets.append(
                f"• Keep {oid} ({cat}) preserved on the postpartum pathway pending pregnancy completion ({owner}{due_suffix})."
            )
        else:
            bullets.append(
                f"• Review {priority} obligation {oid} ({cat}) with {owner}{due_suffix} and verify qualifying evidence before closure."
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


_BRIEF_MARKER_RE = re.compile(
    r"(?:^|\n)[ \t]*[*#_]*[ \t]*(SUMMARY|HANDOFF)[ \t]*[*_]*[ \t]*:[ \t]*[*_]*",
    flags=re.IGNORECASE,
)


def _parse_streamed_sections(raw_text: str) -> tuple[str, str]:
    """Split streamed SUMMARY: / HANDOFF: text into summary and specialist_handoff.

    Tolerates case differences and light markdown decoration (e.g. ``**Handoff:**``).
    Returns an empty handoff string when no HANDOFF marker is present so callers can
    record that the section was substituted rather than model-generated.
    """
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    markers = list(_BRIEF_MARKER_RE.finditer(text))
    if not markers:
        return text, ""

    sections: dict[str, str] = {}
    preamble = text[: markers[0].start()].strip()
    for idx, match in enumerate(markers):
        name = match.group(1).upper()
        end = markers[idx + 1].start() if idx + 1 < len(markers) else len(text)
        sections.setdefault(name, text[match.end() : end].strip())

    summary = sections.get("SUMMARY") or preamble
    return summary, sections.get("HANDOFF", "")


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
    except _RECOVERABLE_OPENROUTER_ERRORS as exc:
        logger.warning(f"OpenRouter call degraded to deterministic fallback: {type(exc).__name__}")
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

        fallback_reason: str | None = None
        if not handoff:
            # Model omitted the HANDOFF section: substitute the payload-specific deterministic
            # checklist and say so, rather than presenting it as model-generated.
            handoff = _deterministic_fallback(deidentified_payload, reason="")["specialist_handoff"]
            fallback_reason = (
                "OpenRouter response missing HANDOFF section; deterministic handoff substituted"
            )

        yield {
            "type": "done",
            "result": {
                "mode": "openrouter",
                "provider": "openrouter",
                "model": resolved_model,
                "fallback_reason": fallback_reason,
                "summary": summary,
                "specialist_handoff": handoff,
            },
        }
    except _RECOVERABLE_OPENROUTER_ERRORS as exc:
        logger.warning(f"OpenRouter call degraded to deterministic fallback: {type(exc).__name__}")
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
            f"GDM & Dysglycemia OGTT Follow-up ({life_stage})",
            (
                "Elevated fasting glucose, HbA1c, or confirmed gestational diabetes carries a high risk of persistent "
                "glucose intolerance after delivery. ADA 2026 recommends a fasting 75-gram oral glucose tolerance test "
                "at 4 to 12 weeks postpartum, or according to the locally adopted delivery-admission protocol. "
                f"Under {owner} coordination, a booked appointment alone leaves the testing obligation open, and result review is tracked separately."
            ),
            [
                "ADA 2026 recommends a 75g OGTT at 4–12 weeks postpartum (or locally adopted delivery-admission protocol).",
                "A booked appointment or lab order does not close the testing obligation; completed test evidence is required.",
                "Completing postpartum OGTT automatically tracks clinician result review as a separate linked obligation.",
            ],
        ),
        "postpartum_gdm_ogtt_result_review": (
            f"Postpartum OGTT Result Review & Long-Term Plan ({life_stage})",
            (
                "Completing the postpartum glucose tolerance test is only the first half of care continuity; results "
                "must be formally reviewed against non-pregnancy criteria and translated into a follow-up plan. "
                f"{owner} signs off on the interpretation and documents ongoing 1 to 3 year diabetes screening."
            ),
            [
                "Tracked separately from test completion so abnormal postpartum OGTT results are never overlooked.",
                "Requires clinician sign-off on non-pregnancy glycemic interpretation and follow-up plan.",
                "History of gestational diabetes warrants lifelong screening every 1 to 3 years.",
            ],
        ),
        "preeclampsia_prophylaxis_window": (
            f"Hypertensive Disorder & Postpartum BP Continuity ({life_stage})",
            (
                "Hypertensive disorders of pregnancy remain a leading cause of postpartum readmission after hospital discharge. "
                "SMFM recommends blood pressure reassessment within 72 hours of discharge for severe hypertension, and randomized "
                "trial evidence shows text-based remote monitoring achieves 92.2 percent 10-day capture compared with 43.7 percent "
                f"for office visits alone. {owner} verifies actual readings and routes severe elevations through the local escalation protocol."
            ),
            [
                "SMFM targets ≤72-hour post-discharge BP check for severe hypertension; remote monitoring boosts 10-day capture to 92.2%.",
                "A scheduled visit alone cannot close this obligation—an actual blood pressure assessment is required.",
                "Qualifying severe readings (≥160/110 mmHg or severe features) escalate immediately to the local urgent protocol.",
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
        "perinatal_depression_anxiety_followup": (
            f"Perinatal Depression & Anxiety Follow-up ({life_stage})",
            (
                "Positive perinatal screening scores highlight elevated risk for depression or anxiety across pregnancy "
                "and postpartum, where care gaps frequently occur between screening and treatment. Per ACOG guidance, "
                "a questionnaire score is a screening signal rather than a diagnosis or closure; it requires clinical "
                f"assessment with {owner}, and any documented safety concern routes immediately through the approved urgent pathway."
            ),
            [
                "Questionnaire scores (EPDS/GAD-7) are screening signals only and cannot close the obligation alone.",
                "Requires documented clinical assessment plus a treatment and longitudinal monitoring plan.",
                "Any documented safety concern triggers deterministic routing to the approved urgent safety pathway.",
            ],
        ),
        "perinatal_mental_health_monitoring": (
            f"Perinatal Mental Health Treatment Monitoring ({life_stage})",
            (
                "Following initial clinical assessment for perinatal depression or anxiety, longitudinal follow-up "
                "ensures symptoms improve and treatment barriers are addressed. "
                f"{owner} tracks repeat screening and care engagement before closing the monitoring cycle."
            ),
            [
                "Linked to the prior clinical assessment to close the perinatal depression treatment cascade.",
                "Tracks follow-up symptom trajectory and engagement with specialist-directed care.",
                "Requires clinician verification of follow-up assessment before closure.",
            ],
        ),
        "abnormal_cervical_screening_followup": (
            f"Abnormal Cervical Screening Reconciliation ({life_stage})",
            (
                "Inadequate follow-up after abnormal cervical screening ranges widely across outpatient clinics, "
                "especially when pregnancy interrupts care. Under Abu Dhabi Department of Health and ASCCP algorithms, "
                "the care team reconciles the original HPV and cytology result, any interim procedures, and current "
                f"pregnancy status so {owner} evaluates invasive risk safely while deferring excisional treatment until postpartum."
            ),
            [
                "Reconciles original pre-pregnancy HPV/cytology results, interim procedures, and current pregnancy status.",
                "Colposcopy triage is safe during pregnancy; endocervical curettage and routine excision are deferred ≥6 weeks postpartum.",
                "Antenatal triage closure automatically preserves a linked postpartum re-evaluation obligation.",
            ],
        ),
        "endometriosis_symptom_evaluation": (
            f"Suspected Endometriosis Evaluation Pathway ({life_stage})",
            (
                "Recurring pelvic pain and severe menstrual symptoms take an average of 4 to 12 years to diagnose "
                "worldwide according to the WHO. NICE guidance emphasizes that a normal physical examination or normal "
                "pelvic ultrasound can coexist with endometriosis, so ReproBridge preserves this referral signal for "
                f"{owner} until specialist evaluation is formally completed."
            ),
            [
                "WHO documents a 4 to 12 year average diagnostic delay driven by dismissed recurring pain signals.",
                "Per NICE NG73, a normal pelvic ultrasound or exam alone CANNOT close this obligation.",
                "Requires documented specialist gynecology review under an approved endometriosis pathway.",
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
    except _RECOVERABLE_OPENROUTER_ERRORS as exc:
        logger.warning(f"OpenRouter call degraded to deterministic fallback: {type(exc).__name__}")
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
        re.finditer(
            r"(?:^|\n)\s*(HEADLINE|EXPLANATION|KEY_POINTS)\s*:\s*", text, flags=re.IGNORECASE
        )
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
    except _RECOVERABLE_OPENROUTER_ERRORS as exc:
        logger.warning(f"OpenRouter call degraded to deterministic fallback: {type(exc).__name__}")
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


def _build_base_reconciliation_questions(
    deidentified_payload: dict[str, Any],
) -> tuple[str, list[dict[str, Any]]]:
    """Build baseline deterministic scenario-specific questions from de-identified obligations."""
    obls = deidentified_payload.get("obligations") or []
    categories = {str(o.get("clinical_category", "")) for o in obls}
    life_stage = str(obls[0].get("life_stage", "Preconception")) if obls else "Preconception"
    is_postpartum = any(str(o.get("life_stage", "")) == "Postpartum" for o in obls)
    is_antenatal = not is_postpartum and any(
        str(o.get("life_stage", "")).startswith("Antenatal") for o in obls
    )

    if is_postpartum:
        q1: dict[str, Any] = {
            "id": "pregnancy_stage",
            "category": "Pregnancy & Delivery Stage",
            "question": (
                "Confirm the patient's current postpartum stage. HIE discharge documents indicate "
                "recent delivery — does this match today's exam?"
            ),
            "data_shows": f"HIE Record: {life_stage} (Post-delivery inpatient summary on file)",
            "options": [
                "Postpartum Day 1–3 (Pre-discharge hospital ward)",
                "Postpartum Week 2–6 (Outpatient follow-up clinic)",
                "Still Antenatal (discharge record entered in error)",
            ],
            "placeholder": "Confirm postpartum day/week or correct gestational stage...",
        }
    elif is_antenatal:
        q1 = {
            "id": "pregnancy_stage",
            "category": "Pregnancy Stage & Dating",
            "question": (
                "What pregnancy stage are we at today? HIE dating notes show 5th week gestation, "
                "which may actually be 8th week on ultrasound."
            ),
            "data_shows": (
                f"HIE Record: {life_stage} · Early HIE booking note states ~5th week gestation"
            ),
            "options": [
                "8th week gestation (Antenatal Trimester 1 updated by scan)",
                "5th week gestation (Matches current HIE record)",
                "12th+ week gestation (Transitioning toward Trimester 2)",
                "Delivered — update to Postpartum care",
            ],
            "placeholder": "e.g., 8th week gestation by CRL ultrasound (data showed 5th week)...",
        }
    else:
        q1 = {
            "id": "pregnancy_stage",
            "category": "Pregnancy Stage & Dating",
            "question": (
                "What pregnancy stage are we at today? The HIE baseline shows Preconception "
                "(with an unconfirmed 5th-week referral note), but today's visit may confirm 8th week gestation."
            ),
            "data_shows": (
                "HIE Record: Preconception baseline · Pending pregnancy confirmation (5th-week referral flag)"
            ),
            "options": [
                "8th week gestation (Confirm pregnancy & activate Antenatal rules)",
                "5th week gestation (Early pregnancy confirmed today)",
                "Still Preconception (Not currently pregnant)",
                "Postpartum / recently delivered",
            ],
            "placeholder": "e.g., 8th week gestation confirmed on today's scan...",
        }

    if "subclinical_hypothyroidism_tsh_followup" in categories:
        q2: dict[str, Any] = {
            "id": "medications",
            "category": "Medication Reconciliation",
            "question": (
                "What medications are we on right now? Is any thyroid therapy or prenatal "
                "supplement different from what the current HIE data shows?"
            ),
            "data_shows": "HIE Medication List: Folic Acid 400 mcg daily · No active thyroid replacement listed",
            "options": [
                "Matches HIE data (Folic Acid 400 mcg daily only)",
                "Started low-dose thyroid regimen at an outside clinic",
                "Prenatal multivitamin + iodine (outside pharmacy fill)",
            ],
            "placeholder": "Specify active medications or differences vs HIE record...",
        }
        q3: dict[str, Any] = {
            "id": "scenario_specific",
            "category": "Thyroid & Rubella Scenario Check",
            "question": (
                "HIE shows TSH 4.8 mIU/L (OBL-101) and Rubella IgG non-immune status (OBL-102). "
                "Were repeat TSH labs drawn or an outside MMR shot documented before today?"
            ),
            "data_shows": "Documents: TSH 4.8 mIU/L (Sep) & Rubella IgG Non-Immune serology",
            "options": [
                "No external repeat TSH or MMR recorded — both gaps remain open",
                "Repeat TSH / Free T4 lab drawn externally this week (awaiting upload)",
                "MMR booster completed prior to conception at outside clinic",
            ],
            "placeholder": "Note external TSH values, dates, or immunization cards...",
        }
        context_note = (
            "Cross-check gestational week (5th-week referral vs 8th-week scan) and confirm whether "
            "outside thyroid labs or medications exist before opening the Antenatal TSH & Rubella obligations."
        )
    elif "gestational_dysglycemia_ogtt_followup" in categories:
        q2 = {
            "id": "medications",
            "category": "Medication Reconciliation",
            "question": (
                "What medications are we on today? Is her glycemic or prenatal regimen different "
                "from what the current clinic record shows?"
            ),
            "data_shows": "HIE Medication List: Prenatal Folic Acid 400 mcg · No Metformin or insulin on file",
            "options": [
                "Matches HIE data (Folic Acid 400 mcg only)",
                "Started Metformin XR at outside endocrinology clinic",
                "Diet & lifestyle nutrition plan only",
            ],
            "placeholder": "Confirm glycemic or prenatal medications vs HIE list...",
        }
        q3 = {
            "id": "scenario_specific",
            "category": "Dysglycemia & VZV Scenario Check",
            "question": (
                "Current data shows Fasting Glucose 112 mg/dL, HbA1c 6.1%, and Varicella IgG non-immune. "
                "Has a fasting OGTT or home glucose log or VZV shot occurred outside this facility?"
            ),
            "data_shows": "Documents: Fasting Glucose 112 mg/dL · HbA1c 6.1% · VZV IgG < 100 mIU/mL",
            "options": [
                "No external OGTT or VZV update — keep both obligations active",
                "7-day fasting glucometer log brought to visit today",
                "100g OGTT completed externally (result pending HIE sync)",
            ],
            "placeholder": "Note glucometer readings, outside OGTT dates, or VZV history...",
        }
        context_note = (
            "Verify exact gestational week and glycemic medications so early OGTT screening and "
            "Varicella contraindication rules align with today's presentation."
        )
    elif {
        "preeclampsia_prophylaxis_window",
        "preeclampsia_aspirin_prophylaxis_window",
    } & categories:
        q2 = {
            "id": "medications",
            "category": "Medication Reconciliation",
            "question": (
                "What medications are we on currently? Are blood pressure agents or low-dose aspirin "
                "different from what the current HIE medication list shows?"
            ),
            "data_shows": "HIE Medication List: Prenatal multivitamin · No antihypertensive or aspirin documented",
            "options": [
                "Matches HIE (no aspirin or BP agent started yet)",
                "Already taking low-dose aspirin daily from outside clinic",
                "Taking antihypertensive regimen prescribed externally",
            ],
            "placeholder": "Confirm aspirin, BP medications, or prenatal vitamins...",
        }
        q3 = {
            "id": "scenario_specific",
            "category": "BP Prophylaxis Window & HPV Check",
            "question": (
                "Documents show baseline BP 134/86 mmHg (12–16w preeclampsia window) and an incomplete HPV series. "
                "Have home BP readings crossed 140/90 mmHg or was an outside HPV dose given?"
            ),
            "data_shows": "Documents: Baseline BP 134/86 mmHg · HPV 9-valent Dose 1 of 3",
            "options": [
                "Home BP stable ~130s/80s; no additional HPV dose given",
                "Home BP spikes >= 140/90 mmHg noted this week",
                "HPV Dose 2 already administered at another facility",
            ],
            "placeholder": "Enter home BP log range or external vaccination dates...",
        }
        context_note = (
            "Confirm gestational week (critical for the 12–16 week preeclampsia window) and home BP readings "
            "before opening the obligation passport."
        )
    elif {
        "perinatal_depression_anxiety_followup",
        "abnormal_cervical_screening_followup",
    } & categories:
        q2 = {
            "id": "medications",
            "category": "Care & Medication Reconciliation",
            "question": (
                "Are any behavioral health therapies, supportive care plans, or outside clinic "
                "prescriptions active today that differ from the HIE record?"
            ),
            "data_shows": "HIE Record: Prenatal folate · Behavioral health & colposcopy follow-ups open",
            "options": [
                "Matches HIE data — no outside behavioral health or procedure updates",
                "Started counseling or specialist therapy at an outside clinic",
                "Outside procedure or medication change needs reconciliation",
            ],
            "placeholder": "Confirm behavioral health support, medications, or outside procedures...",
        }
        q3 = {
            "id": "scenario_specific",
            "category": "Mental Health & Cervical Screening Check",
            "question": (
                "HIE shows an elevated EPDS/GAD-7 screening signal (OBL-401) and pre-pregnancy "
                "HPV16+/HSIL cytology (OBL-402). Are there any acute safety concerns today or "
                "completed colposcopy reports from another facility?"
            ),
            "data_shows": "Documents: EPDS 15 · GAD-7 12 · Pre-pregnancy HPV16+ / HSIL cytology",
            "options": [
                "No safety concern today; clinical assessment and colposcopy triage still needed",
                "Safety concern identified — route immediately to approved urgent pathway",
                "Outside colposcopy report available for reconciliation",
            ],
            "placeholder": "Document safety screen status or prior colposcopy/biopsy dates...",
        }
        context_note = (
            "Verify safety status for the positive perinatal screen and reconcile pre-pregnancy "
            "abnormal HPV/cytology against current pregnancy status before updating obligations."
        )
    elif "endometriosis_symptom_evaluation" in categories:
        q2 = {
            "id": "medications",
            "category": "Symptom Management Reconciliation",
            "question": (
                "What symptom-relief or gynecologic treatments are currently in use, and do they "
                "differ from the clinic record?"
            ),
            "data_shows": "HIE Record: Recurrent pelvic pain visits · Prior normal pelvic ultrasound",
            "options": [
                "Matches HIE data — recurring pelvic pain remains unresolved",
                "Using outside pain management or hormonal therapy with partial relief",
                "Discontinued prior regimen due to side effects or pregnancy planning",
            ],
            "placeholder": "Confirm active symptom management vs HIE record...",
        }
        q3 = {
            "id": "scenario_specific",
            "category": "Endometriosis Referral Signal Check",
            "question": (
                "HIE documents 3 recurring pelvic pain visits and a normal transvaginal ultrasound "
                "(OBL-501). Have symptoms persisted or has a specialist gynecology endometriosis "
                "review been completed?"
            ),
            "data_shows": "Documents: 3 pelvic pain visits · Normal TVUS (does not exclude endometriosis)",
            "options": [
                "Symptoms persist — preserve referral signal for specialist gynecology review",
                "Normal scan noted, no specialist visit yet (keep pathway active per NICE NG73)",
                "Specialist endometriosis clinic review completed externally",
            ],
            "placeholder": "Note functional impact, missed workdays, or specialist MRI/referral status...",
        }
        context_note = (
            "Confirm ongoing symptom impact and specialist review status so a normal pelvic "
            "ultrasound never closes suspected endometriosis evaluation prematurely."
        )
    else:
        q2 = {
            "id": "medications",
            "category": "Medication Reconciliation",
            "question": (
                "What medications are we on today, and is anything different from what the current HIE data shows?"
            ),
            "data_shows": "HIE Medication List: Standard prenatal supplement recorded",
            "options": [
                "Matches current HIE medication list",
                "Additional outside prescription started since last visit",
                "Stopped prior clinic medication",
            ],
            "placeholder": "List current medications or discrepancies...",
        }
        q3 = {
            "id": "scenario_specific",
            "category": "Clinical Document Check",
            "question": (
                f"Do the {len(obls)} imported HIE clinical obligations accurately match today's labs and visit context?"
            ),
            "data_shows": f"Documents: {len(obls)} open obligation record(s) from UAE HIE",
            "options": [
                "Yes — documents match today's scenario",
                "New external lab result available today",
            ],
            "placeholder": "Describe any missing or updated outside records...",
        }
        context_note = "Verify gestational stage, active medications, and HIE document alignment before entering the workbench."

    return context_note, [q1, q2, q3]


def _deterministic_questionnaire_fallback(
    deidentified_payload: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    context_note, questions = _build_base_reconciliation_questions(deidentified_payload)
    return {
        "context_note": context_note,
        "questions": questions,
        "disclaimer": (
            "Assistive scenario reconciliation only — confirms clinician context without PHI egress."
        ),
        "ai_metadata": {
            "mode": "deterministic_fallback",
            "provider": "local-deterministic",
            "model": "none",
            "fallback_reason": reason,
        },
    }


def _parse_streamed_questionnaire(
    raw_text: str,
    base_context_note: str,
    base_questions: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Parse streamed questionnaire markers onto deterministic base metadata."""
    text = raw_text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    markers = list(
        re.finditer(
            r"(?:^|\n)\s*(CONTEXT_NOTE|Q1_QUESTION|Q1_OPTIONS|Q2_QUESTION|Q2_OPTIONS|Q3_QUESTION|Q3_OPTIONS)\s*:\s*",
            text,
            flags=re.IGNORECASE,
        )
    )
    if not markers:
        return base_context_note, base_questions

    sections: dict[str, str] = {}
    for idx, match in enumerate(markers):
        name = match.group(1).upper()
        start = match.end()
        end = markers[idx + 1].start() if idx + 1 < len(markers) else len(text)
        sections[name] = " ".join(text[start:end].splitlines()).strip()

    context_note = sections.get("CONTEXT_NOTE") or base_context_note
    merged: list[dict[str, Any]] = []
    for idx, base in enumerate(base_questions[:3], start=1):
        q_text = sections.get(f"Q{idx}_QUESTION") or base["question"]
        raw_opts = sections.get(f"Q{idx}_OPTIONS", "")
        parsed_opts = [opt.strip() for opt in raw_opts.split("|") if opt.strip()]
        merged.append(
            {
                **base,
                "question": q_text,
                "options": parsed_opts[:4] if len(parsed_opts) >= 2 else base["options"],
            }
        )
    return context_note, merged


def generate_reconciliation_questions(
    deidentified_payload: dict[str, Any],
    *,
    timeout_seconds: float = 18.0,
) -> dict[str, Any]:
    """Generate de-identified scenario-specific reconciliation questions via OpenRouter with fallback."""
    assert_phi_free(deidentified_payload)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    primary_model, fallback_chain = _get_model_config()
    if not api_key:
        return _deterministic_questionnaire_fallback(
            deidentified_payload,
            reason="OPENROUTER_API_KEY not configured",
        )

    base_context_note, base_questions = _build_base_reconciliation_questions(deidentified_payload)
    headers = _build_headers(api_key)
    request_body = {
        "model": primary_model,
        "models": fallback_chain,
        "temperature": 0.2,
        "max_tokens": 550,
        "reasoning": {"effort": "none"},
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": QUESTIONNAIRE_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Generate 3 reconciliation questions for this de-identified case payload (0 PHI):\n"
                    f"{json.dumps(deidentified_payload, indent=2)}"
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
        context_note = str(parsed.get("context_note") or base_context_note).strip()
        raw_qs = parsed.get("questions") or []
        merged: list[dict[str, Any]] = []
        for idx, base in enumerate(base_questions[:3]):
            item = raw_qs[idx] if idx < len(raw_qs) and isinstance(raw_qs[idx], dict) else {}
            q_text = str(item.get("question") or base["question"]).strip()
            raw_opts = item.get("options") or []
            opts = [str(o).strip() for o in raw_opts if str(o).strip()][:4]
            merged.append(
                {
                    **base,
                    "question": q_text,
                    "options": opts if len(opts) >= 2 else base["options"],
                }
            )

        return {
            "context_note": context_note,
            "questions": merged,
            "disclaimer": (
                "Assistive scenario reconciliation only — confirms clinician context without PHI egress."
            ),
            "ai_metadata": {
                "mode": "openrouter",
                "provider": "openrouter",
                "model": str(data.get("model", primary_model)),
                "fallback_reason": None,
            },
        }
    except _RECOVERABLE_OPENROUTER_ERRORS as exc:
        logger.warning(f"OpenRouter call degraded to deterministic fallback: {type(exc).__name__}")
        return _deterministic_questionnaire_fallback(
            deidentified_payload,
            reason=f"OpenRouter unavailable ({type(exc).__name__})",
        )


def stream_reconciliation_questions(
    deidentified_payload: dict[str, Any],
    *,
    timeout_seconds: float = 25.0,
) -> Iterator[dict[str, Any]]:
    """Stream token deltas from OpenRouter for scenario-specific reconciliation questions."""
    assert_phi_free(deidentified_payload)

    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    primary_model, fallback_chain = _get_model_config()
    base_context_note, base_questions = _build_base_reconciliation_questions(deidentified_payload)

    if not api_key:
        fb = _deterministic_questionnaire_fallback(
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
        "max_tokens": 550,
        "reasoning": {"effort": "none"},
        "stream": True,
        "messages": [
            {"role": "system", "content": QUESTIONNAIRE_STREAM_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "Generate 3 reconciliation questions for this de-identified case payload (0 PHI):\n"
                    f"{json.dumps(deidentified_payload, indent=2)}"
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
        context_note, questions = _parse_streamed_questionnaire(
            full_text, base_context_note, base_questions
        )
        yield {
            "type": "done",
            "result": {
                "context_note": context_note,
                "questions": questions,
                "disclaimer": (
                    "Assistive scenario reconciliation only — confirms clinician context without PHI egress."
                ),
                "ai_metadata": {
                    "mode": "openrouter",
                    "provider": "openrouter",
                    "model": resolved_model,
                    "fallback_reason": None,
                },
            },
        }
    except _RECOVERABLE_OPENROUTER_ERRORS as exc:
        logger.warning(f"OpenRouter call degraded to deterministic fallback: {type(exc).__name__}")
        fb = _deterministic_questionnaire_fallback(
            deidentified_payload,
            reason=f"OpenRouter stream unavailable ({type(exc).__name__})",
        )
        yield {"type": "done", "result": fb}
