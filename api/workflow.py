"""Hybrid LangGraph Care-Resolution Harness.

Explicitly separates:
1. Deterministic clinical logic (gap detection, rule evaluation, closure guards, child chaining)
2. Deterministic UAE Privacy Firewall (PHI stripping & assertion)
3. Agentic synthesis via OpenRouter (de-identified clinician handoff drafting)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from api.openrouter import synthesize_deidentified_brief
from api.privacy import build_ai_safe_payload


class TransitionState(TypedDict):
    event_type: str
    obligations: list[dict[str, Any]]
    reassessed_updates: list[dict[str, Any]]
    privacy_report: dict[str, Any]
    trace: list[dict[str, Any]]
    agent_summary: str
    specialist_handoff: str
    ai_metadata: dict[str, Any]
    event_context: NotRequired[dict[str, Any]]
    spawned_obligations: NotRequired[list[dict[str, Any]]]


@dataclass(slots=True)
class ClosureGuardResult:
    """Outcome of a deterministic closure-policy safety check."""

    allowed: bool
    reason: str | None = None
    escalation_patch: dict[str, Any] | None = None
    audit_event_type: str = "CLINICAL_SAFETY_BLOCKED"


_BP_READING_RE = re.compile(r"\b(\d{2,3})\s*/\s*(\d{2,3})\b")
_BOOKING_ONLY_RE = re.compile(
    r"\b(?:appointment|booked|booking|scheduled|rescheduled|referral\s+sent|"
    r"lab\s+ordered|order\s+placed|pending\s+(?:lab|test|visit|appointment))\b",
    flags=re.IGNORECASE,
)
_COMPLETED_OGTT_RE = re.compile(
    r"\b(?:mg/dl|mmol/l|completed|result|normal|impaired|diabetes|prediabetes|"
    r"fasting\s+\d|2-?h(?:our)?\s+\d|hba1c|within\s+(?:glycemic\s+)?target|verified)\b",
    flags=re.IGNORECASE,
)
_SEVERE_HTN_SYMPTOM_RE = re.compile(
    r"\b(?:severe\s+headache|visual\s+(?:changes|disturbance|blurring)|"
    r"epigastric\s+pain|eclampsia|hypertensive\s+crisis|chest\s+pain|shortness\s+of\s+breath)\b",
    flags=re.IGNORECASE,
)
_HTN_STABILIZED_RE = re.compile(
    r"\b(?:stabilized|resolved|discharged\s+after\s+escalation|emergency\s+evaluation\s+completed|"
    r"escalation\s+protocol\s+completed)\b",
    flags=re.IGNORECASE,
)
_MH_SAFETY_CONCERN_RE = re.compile(
    r"\b(?:suicid\w*|self[- ]harm|harm\s+to\s+(?:self|baby|infant)|"
    r"item\s*10\s*(?:positive|>=?\s*[1-3]|endorsed)|active\s+safety\s+concern|"
    r"safety\s+concern\s+(?:identified|reported|flagged)|crisis\s+risk)\b",
    flags=re.IGNORECASE,
)
_MH_SAFETY_RESOLVED_RE = re.compile(
    r"\b(?:urgent\s+(?:safety\s+)?pathway|psychiatr\w+\s+(?:crisis|urgent|evaluation)|"
    r"crisis\s+(?:evaluation|stabilization)|safety\s+plan\s+(?:completed|verified|established)|"
    r"safety\s+screen\s+negative|no\s+active\s+safety\s+concern)\b",
    flags=re.IGNORECASE,
)
_MH_ASSESSMENT_COMPLETED_RE = re.compile(
    r"\b(?:clinical\s+assessment|psychiatric\s+(?:evaluation|assessment)|psychotherapy|"
    r"cbt|counsel(?:ing|ling)|treatment\s+plan|follow-?up\s+(?:plan|monitoring)|"
    r"monitoring\s+plan|evaluated\s+by|behavioral\s+health\s+(?:consult|assessment))\b",
    flags=re.IGNORECASE,
)
_CERVICAL_PREG_CONTRAINDICATED_RE = re.compile(
    r"\b(?:ecc\s+performed|endocervical\s+curettage\s+performed|underwent\s+ecc|"
    r"leep\s+performed|conization\s+performed|cone\s+biopsy\s+performed|"
    r"excisional\s+treatment\s+performed)\b",
    flags=re.IGNORECASE,
)
_CERVICAL_INVASION_EXCEPTION_RE = re.compile(
    r"\b(?:suspected\s+invasive|invasive\s+cancer\s+suspected|malignancy\s+suspected)\b",
    flags=re.IGNORECASE,
)
_CERVICAL_DISPOSITION_RE = re.compile(
    r"\b(?:colposcopy|cytology\s+reconciled|algorithm|invasive\s+(?:disease|cancer)\s+excluded|"
    r"biopsy|postpartum\s+re-?evaluation|hpv\s+negative|cleared\s+by\s+(?:colposcopy|gynecology))\b",
    flags=re.IGNORECASE,
)
_ENDO_NORMAL_SCAN_RE = re.compile(
    r"\b(?:normal\s+(?:pelvic\s+|transvaginal\s+)?(?:ultrasound|us|tvus|scan|exam|examination)|"
    r"unremarkable\s+(?:pelvic\s+|transvaginal\s+)?(?:ultrasound|tvus|scan|exam)|"
    r"(?:tvus|ultrasound|scan)\s+(?:is\s+|was\s+)?(?:normal|unremarkable|negative)|"
    r"no\s+abnormality\s+(?:seen|detected))\b",
    flags=re.IGNORECASE,
)
_ENDO_SPECIALIST_REVIEW_RE = re.compile(
    r"\b(?:specialist\s+(?:gynecology|endometriosis)|endometriosis\s+clinic|"
    r"approved\s+(?:diagnostic\s+)?pathway|gynecology\s+(?:referral\s+completed|review\s+completed)|"
    r"pelvic\s+mri|laparoscop\w+|accepted\s+by\s+(?:gynecology|endometriosis))\b",
    flags=re.IGNORECASE,
)


def _parse_iso_date(raw: Any) -> date:
    """Parse YYYY-MM-DD date string, defaulting to today UTC."""
    if isinstance(raw, date) and not isinstance(raw, datetime):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            return date.fromisoformat(raw.strip()[:10])
        except ValueError:
            pass
    return datetime.now(UTC).date()


def _iso_plus_days(base: date, days: int) -> str:
    return (base + timedelta(days=days)).isoformat()


def _parse_bp_values(text: str) -> tuple[int, int] | None:
    """Return the highest systolic/diastolic reading found in text, if any."""
    highest: tuple[int, int] | None = None
    for match in _BP_READING_RE.finditer(text):
        sys_val, dia_val = int(match.group(1)), int(match.group(2))
        if (
            60 <= sys_val <= 260
            and 30 <= dia_val <= 180
            and (highest is None or (sys_val, dia_val) > highest)
        ):
            highest = (sys_val, dia_val)
    return highest


def _is_severe_bp_text(text: str) -> bool:
    """Check whether text contains severe-range BP (>=160/110) or severe hypertensive features."""
    bp = _parse_bp_values(text)
    if bp and (bp[0] >= 160 or bp[1] >= 110):
        return True
    return bool(_SEVERE_HTN_SYMPTOM_RE.search(text))


def _has_severe_bp_context(event_context: dict[str, Any], text_ctx: str) -> bool:
    diagnoses = {str(d).upper() for d in (event_context.get("discharge_diagnoses") or [])}
    if diagnoses & {"SEVERE_POSTPARTUM_HYPERTENSION", "SEVERE_HYPERTENSION", "SEVERE_PREECLAMPSIA"}:
        return True
    bp_reading = event_context.get("bp_reading")
    if isinstance(bp_reading, dict):
        sys_val = int(bp_reading.get("systolic") or 0)
        dia_val = int(bp_reading.get("diastolic") or 0)
        if sys_val >= 160 or dia_val >= 110:
            return True
    elif isinstance(bp_reading, str) and _is_severe_bp_text(bp_reading):
        return True
    return _is_severe_bp_text(text_ctx)


def _has_mh_safety_concern(event_context: dict[str, Any], text_ctx: str) -> bool:
    signal = event_context.get("screening_signal")
    if isinstance(signal, dict) and bool(signal.get("safety_concern")):
        return True
    return bool(_MH_SAFETY_CONCERN_RE.search(text_ctx)) and not bool(
        _MH_SAFETY_RESOLVED_RE.search(text_ctx)
    )


def detect_open_obligations(state: TransitionState) -> dict[str, Any]:
    """Deterministic step: filter unresolved obligations requiring reassessment."""
    open_items = [o for o in state["obligations"] if o["status"] != "VERIFIED_CLOSED"]
    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "detect_open_obligations",
            "execution": "deterministic",
            "phi_exposed": False,
            "detail": f"Identified {len(open_items)} open obligation(s) from Neon Clinical Obligation Passport.",
        }
    )
    return {"obligations": open_items, "trace": trace}


def _evaluate_rule_for_obligation(
    event_type: str,
    item: dict[str, Any],
    event_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Dispatch deterministic transition updates by versioned rule prefix instead of obligation ID."""
    ctx = event_context or {}
    obl_id = item["id"]
    rule_ver = str(item.get("rule_version") or "").upper()
    text_ctx = f"{item.get('title', '')} {item.get('rationale', '')}".lower()

    if event_type == "FHIR_PREGNANCY_CONFIRMED":
        if rule_ver.startswith("RB-THYROID-"):
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Maternal-Fetal Medicine / OB-GYN",
                "due_label": "Due ≤ 72h (T1 TSH <2.5 mIU/L)",
                "protocol_code": "ATA-THYROID-T1",
                "rationale": (
                    "PREGNANCY TRANSITION TRIGGERED: Adolescent-onset Hashimoto's hypothyroidism "
                    "(age 16) contributed to prior miscarriage at age 31 when follow-up was lost. "
                    "Now pregnant again at 32 with TSH 4.8 mIU/L exceeding first-trimester target "
                    "(<2.5 mIU/L). Urgent levothyroxine evaluation and repeat thyroid panel routed "
                    "for immediate clinician approval."
                ),
            }
        if rule_ver.startswith("RB-IMMUNE-"):
            is_varicella = "varicella" in text_ctx or "vzv" in text_ctx
            vaccine_rationale = (
                "PREGNANCY TRANSITION TRIGGERED: Live-attenuated Varicella vaccine is "
                "contraindicated during pregnancy. Obligation preserved on Clinical "
                "Obligation Passport and auto-scheduled for postpartum closure."
                if is_varicella
                else "PREGNANCY TRANSITION TRIGGERED: Live MMR vaccine is contraindicated "
                "during pregnancy. Obligation preserved on Clinical Obligation Passport "
                "and auto-scheduled for postpartum closure."
            )
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "HIGH",
                "status": "DEFERRED_TO_POSTPARTUM",
                "owner": "Postpartum Care Pathway",
                "due_label": "Deferred until Postpartum",
                "closure_policy": "DEFERRED_UNTIL_POSTPARTUM",
                "rationale": vaccine_rationale,
            }
        if rule_ver.startswith("RB-METABOLIC-REVIEW-"):
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "HIGH",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Maternal Endocrinology / OB-GYN",
                "due_label": "Clinician OGTT result review required",
                "closure_policy": "RESULT_REVIEW_SIGNOFF",
            }
        if rule_ver.startswith("RB-METABOLIC-"):
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Maternal Endocrinology / OB-GYN",
                "due_label": "Due ≤ 72h (Early 75g OGTT · Booking alone insufficient)",
                "closure_policy": "COMPLETED_TEST_NOT_BOOKING",
                "protocol_code": "ADA-2026-ANTENATAL-GDM",
                "rationale": (
                    "PREGNANCY TRANSITION TRIGGERED: Preconception dysglycemia (FBG 112 mg/dL, "
                    "HbA1c 6.1%) escalates in Trimester 1. Urgent 75g OGTT and medical "
                    "nutrition / glycemic titration routed for clinician approval; a booked "
                    "appointment alone leaves the testing obligation open."
                ),
            }
        if rule_ver.startswith("RB-PREECLAMPSIA-"):
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Maternal-Fetal Medicine / OB-GYN",
                "due_label": "12–16w prophylaxis window · BP tracking",
                "closure_policy": "POSTPARTUM_BP_ASSESSMENT",
                "protocol_code": "ACOG-SMFM-PREECLAMPSIA",
                "rationale": (
                    "PREGNANCY TRANSITION TRIGGERED: Time-sensitive 12–16 week preeclampsia "
                    "prophylaxis window opened. Escalated for urgent low-dose aspirin (150 mg "
                    "nightly) and BP review by MFM / OB-GYN."
                ),
            }
        if rule_ver.startswith("RB-HPV-"):
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "MEDIUM",
                "status": "DEFERRED_TO_POSTPARTUM",
                "owner": "Postpartum Care Pathway",
                "due_label": "Deferred until Postpartum",
                "closure_policy": "DEFERRED_UNTIL_POSTPARTUM",
                "rationale": (
                    "PREGNANCY TRANSITION TRIGGERED: Routine HPV 9-valent vaccine series is "
                    "deferred during pregnancy. Preserved on Clinical Obligation Passport "
                    "and auto-queued for postpartum discharge completion."
                ),
            }
        if rule_ver.startswith("RB-PERINATAL-MH-"):
            urgent_safety = _has_mh_safety_concern(ctx, text_ctx)
            if urgent_safety:
                return {
                    "id": obl_id,
                    "life_stage": "Antenatal (Trimester 1)",
                    "priority": "URGENT",
                    "status": "ESCALATED_FOR_REVIEW",
                    "owner": "Approved Urgent Perinatal Safety & Psychiatry Pathway",
                    "due_label": "IMMEDIATE · Approved Urgent Safety Pathway",
                    "closure_policy": "MENTAL_HEALTH_ASSESSMENT",
                    "protocol_code": "ACOG-PERINATAL-MH-URGENT",
                    "rationale": (
                        "PREGNANCY TRANSITION + URGENT SAFETY SIGNAL: Documented perinatal mental "
                        "health safety concern routed immediately through the approved urgent "
                        "safety pathway (deterministic routing; zero autonomous AI decision). "
                        "Requires urgent clinical safety evaluation and stabilization plan."
                    ),
                }
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Perinatal Behavioral Health / OB-GYN",
                "due_label": "Antenatal clinical assessment required (ACOG)",
                "closure_policy": "MENTAL_HEALTH_ASSESSMENT",
                "protocol_code": "ACOG-PERINATAL-MH",
                "rationale": (
                    "PREGNANCY TRANSITION TRIGGERED: Positive perinatal depression/anxiety screen "
                    "(EPDS/GAD-7) carried into antenatal care per ACOG guidelines. A questionnaire "
                    "score is a screening signal only—requires structured clinical assessment and "
                    "follow-up treatment/monitoring linkage."
                ),
            }
        if rule_ver.startswith("RB-CERVICAL-"):
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Colposcopy Clinic / Gynecologic Oncology",
                "due_label": "Antenatal colposcopy triage · Excisional tx deferred ≥6w postpartum",
                "closure_policy": "CERVICAL_ALGORITHM_RECONCILIATION",
                "protocol_code": "DOH-AD-CERVICAL-PREG",
                "rationale": (
                    "PREGNANCY TRANSITION TRIGGERED (Abu Dhabi DoH / ASCCP Pre-Pregnancy Abnormal "
                    "Result Provision): Reconciled prior abnormal HPV/cytology result with newly "
                    "confirmed pregnancy. Escalated for specialist colposcopy triage to exclude "
                    "invasive disease; endocervical curettage (ECC) is contraindicated and routine "
                    "excisional treatment is deferred to ≥6 weeks postpartum."
                ),
            }
        if rule_ver.startswith("RB-ENDO-"):
            return {
                "id": obl_id,
                "life_stage": "Antenatal (Trimester 1)",
                "priority": "HIGH",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Gynecology / Endometriosis Referral Pathway",
                "due_label": "Preserve referral signal · Specialist review (NICE NG73)",
                "closure_policy": "ENDOMETRIOSIS_PATHWAY_REVIEW",
                "protocol_code": "NICE-NG73-ENDO",
                "rationale": (
                    "PREGNANCY TRANSITION TRIGGERED: Prior recurring pelvic pain / suspected "
                    "endometriosis signal preserved longitudinally (WHO 4–12y diagnostic delay). "
                    "Per NICE NG73, a normal prior ultrasound does not resolve referral criteria; "
                    "keep specialist gynecology evaluation pathway active."
                ),
            }
        return {
            "id": obl_id,
            "life_stage": "Antenatal (Trimester 1)",
            "priority": "HIGH"
            if item.get("priority") == "MEDIUM"
            else item.get("priority", "HIGH"),
            "status": "ESCALATED_FOR_REVIEW",
            "due_label": "Due ≤ 72h",
        }

    # event_type == "FHIR_DELIVERY_POSTPARTUM"
    delivery_date = _parse_iso_date(ctx.get("delivery_date"))
    delivery_iso = delivery_date.isoformat()
    protocol_override = str(ctx.get("protocol_override") or "").upper()

    if rule_ver.startswith("RB-IMMUNE-"):
        is_varicella = "varicella" in text_ctx or "vzv" in text_ctx
        postpartum_rationale = (
            "POSTPARTUM TRANSITION TRIGGERED: Pregnancy contraindication lifted. "
            "Deferred Varicella (VZV) non-immune obligation reactivated for pre-discharge "
            "vaccination and evidence-verified closure."
            if is_varicella
            else "POSTPARTUM TRANSITION TRIGGERED: Pregnancy contraindication lifted. "
            "Deferred Rubella IgG non-immune obligation reactivated for pre-discharge "
            "MMR vaccination and evidence-verified clinician closure."
        )
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "URGENT",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Postpartum OB-GYN / Immunization Nurse",
            "trigger_event_date": delivery_iso,
            "due_window_start": delivery_iso,
            "due_window_end": _iso_plus_days(delivery_date, 2),
            "due_label": "Pre-discharge ≤ 48h",
            "closure_policy": "CLINICIAN_EVIDENCE",
            "rationale": postpartum_rationale,
        }
    if rule_ver.startswith("RB-THYROID-"):
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "HIGH",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Postpartum Endocrinology / OB-GYN",
            "trigger_event_date": delivery_iso,
            "due_window_start": _iso_plus_days(delivery_date, 42),
            "due_window_end": _iso_plus_days(delivery_date, 56),
            "due_label": "6-week postpartum TSH reassessment",
            "closure_policy": "CLINICIAN_EVIDENCE",
            "rationale": (
                "POSTPARTUM TRANSITION TRIGGERED: Unresolved thyroid obligation carried "
                "forward for 6-week postpartum TSH reassessment and dose adjustment."
            ),
        }
    if rule_ver.startswith("RB-METABOLIC-REVIEW-"):
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "HIGH",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Postpartum Endocrinology / Primary Care",
            "trigger_event_date": delivery_iso,
            "due_label": "Clinician OGTT result review & 1–3y plan (ADA 2026)",
            "closure_policy": "RESULT_REVIEW_SIGNOFF",
        }
    if rule_ver.startswith("RB-METABOLIC-"):
        if protocol_override == "DELIVERY_ADMISSION_OGTT":
            window_start = delivery_iso
            window_end = _iso_plus_days(delivery_date, 2)
            due_label = "Delivery-admission 75g OGTT (Local Protocol)"
            protocol_code = "LOCAL-DELIVERY-ADMISSION-OGTT"
            rationale = (
                f"POSTPARTUM TRANSITION TRIGGERED (Delivery {delivery_iso}): Confirmed GDM "
                "tracked under locally adopted delivery-admission OGTT protocol (evidence shows "
                "higher test completion prior to discharge). A booked appointment alone leaves "
                "this testing obligation open; clinician result review is tracked separately."
            )
        else:
            window_start = _iso_plus_days(delivery_date, 28)
            window_end = _iso_plus_days(delivery_date, 84)
            due_label = "4–12 weeks postpartum 75g OGTT (ADA 2026)"
            protocol_code = "ADA-2026-OGTT-4-12W"
            rationale = (
                f"POSTPARTUM TRANSITION TRIGGERED (Delivery {delivery_iso}): Confirmed GDM "
                f"tracked for fasting 75g OGTT during the ADA 2026 4–12 week window "
                f"({window_start} to {window_end}). A booked appointment leaves testing open; "
                "completing the test spawns a separate clinician Result Review obligation."
            )
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "HIGH",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Postpartum Endocrinology / Primary Care",
            "trigger_event_date": delivery_iso,
            "due_window_start": window_start,
            "due_window_end": window_end,
            "due_label": due_label,
            "closure_policy": "COMPLETED_TEST_NOT_BOOKING",
            "protocol_code": protocol_code,
            "rationale": rationale,
        }
    if rule_ver.startswith("RB-HPV-"):
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "URGENT",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Postpartum OB-GYN / Immunization Nurse",
            "trigger_event_date": delivery_iso,
            "due_window_start": delivery_iso,
            "due_window_end": _iso_plus_days(delivery_date, 2),
            "due_label": "Pre-discharge ≤ 48h",
            "closure_policy": "CLINICIAN_EVIDENCE",
            "rationale": (
                "POSTPARTUM TRANSITION TRIGGERED: Pregnancy deferral lifted. Deferred "
                "HPV 9-valent Dose 2 obligation reactivated for pre-discharge administration."
            ),
        }
    if rule_ver.startswith("RB-PREECLAMPSIA-"):
        severe_htn = _has_severe_bp_context(ctx, text_ctx)
        if severe_htn:
            window_end = _iso_plus_days(delivery_date, 3)
            due_label = "≤ 72h post-discharge BP check (SMFM Severe HTN)"
            protocol_code = "SMFM-72H-SEVERE-HTN"
            owner = "Postpartum Hypertension Rapid-Response / OB-GYN"
            rationale = (
                f"POSTPARTUM TRANSITION TRIGGERED (Delivery {delivery_iso}): Severe hypertension "
                f"discharge diagnosis carried into postpartum care. SMFM mandates BP reassessment "
                f"within ≤72h post-discharge (by {window_end}); any severe reading (≥160/110 mmHg "
                "or severe features) routes immediately to the local urgent escalation protocol."
            )
        else:
            window_end = _iso_plus_days(delivery_date, 10)
            due_label = "≤ 10 days postpartum · Remote BP monitoring preferred"
            protocol_code = "POSTPARTUM-BP-10D-REMOTE"
            owner = "Postpartum Cardiology / Remote BP Clinic"
            rationale = (
                f"POSTPARTUM TRANSITION TRIGGERED (Delivery {delivery_iso}): Hypertensive "
                f"discharge diagnosis carried into postpartum care. Tracked for verified BP "
                f"assessment within 10 days (by {window_end}; text-based remote BP achieves "
                "92.2% ascertainment vs 43.7% office-based). Qualifying severe findings route "
                "through the local urgent escalation protocol."
            )
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "URGENT",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": owner,
            "trigger_event_date": delivery_iso,
            "due_window_start": delivery_iso,
            "due_window_end": window_end,
            "due_label": due_label,
            "closure_policy": "POSTPARTUM_BP_ASSESSMENT",
            "protocol_code": protocol_code,
            "rationale": rationale,
        }
    if rule_ver.startswith("RB-PERINATAL-MH-"):
        urgent_safety = _has_mh_safety_concern(ctx, text_ctx)
        if urgent_safety:
            return {
                "id": obl_id,
                "life_stage": "Postpartum",
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Approved Urgent Perinatal Safety & Psychiatry Pathway",
                "trigger_event_date": delivery_iso,
                "due_window_start": delivery_iso,
                "due_window_end": delivery_iso,
                "due_label": "IMMEDIATE · Approved Urgent Safety Pathway",
                "closure_policy": "MENTAL_HEALTH_ASSESSMENT",
                "protocol_code": "ACOG-PERINATAL-MH-URGENT",
                "rationale": (
                    f"POSTPARTUM TRANSITION + URGENT SAFETY SIGNAL (Delivery {delivery_iso}): "
                    "Documented perinatal mental health safety concern routed deterministically "
                    "to the approved urgent safety pathway. Questionnaire scores alone cannot "
                    "close this obligation."
                ),
            }
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "URGENT",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Postpartum Behavioral Health / OB-GYN",
            "trigger_event_date": delivery_iso,
            "due_window_start": delivery_iso,
            "due_window_end": _iso_plus_days(delivery_date, 14),
            "due_label": "≤ 14 days postpartum clinical assessment (ACOG)",
            "closure_policy": "MENTAL_HEALTH_ASSESSMENT",
            "protocol_code": "ACOG-PERINATAL-MH",
            "rationale": (
                f"POSTPARTUM TRANSITION TRIGGERED (Delivery {delivery_iso}): Positive perinatal "
                "depression/anxiety screening signal carried into postpartum care to prevent "
                "treatment-cascade drop-off. Requires clinical assessment and follow-up plan; "
                "any safety concern routes immediately through the approved urgent pathway."
            ),
        }
    if rule_ver.startswith("RB-CERVICAL-"):
        window_start = _iso_plus_days(delivery_date, 42)
        window_end = _iso_plus_days(delivery_date, 84)
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "URGENT",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Postpartum Colposcopy & Gynecology Clinic",
            "trigger_event_date": delivery_iso,
            "due_window_start": window_start,
            "due_window_end": window_end,
            "due_label": "6–12 weeks postpartum colposcopy/cytology (DoH / ASCCP)",
            "closure_policy": "CERVICAL_ALGORITHM_RECONCILIATION",
            "protocol_code": "DOH-AD-CERVICAL-PP",
            "rationale": (
                f"POSTPARTUM TRANSITION TRIGGERED (Delivery {delivery_iso}): Pregnancy deferral "
                f"lifted. Reconciled abnormal cervical screening reactivated for definitive "
                f"postpartum colposcopy/cytology re-evaluation ({window_start} to {window_end}) "
                "under Abu Dhabi DoH / ASCCP guidance."
            ),
        }
    if rule_ver.startswith("RB-ENDO-"):
        window_start = _iso_plus_days(delivery_date, 42)
        window_end = _iso_plus_days(delivery_date, 84)
        return {
            "id": obl_id,
            "life_stage": "Postpartum",
            "priority": "HIGH",
            "status": "ESCALATED_FOR_REVIEW",
            "owner": "Gynecology / Endometriosis Referral Pathway",
            "trigger_event_date": delivery_iso,
            "due_window_start": window_start,
            "due_window_end": window_end,
            "due_label": "Postpartum specialist pathway review (NICE NG73)",
            "closure_policy": "ENDOMETRIOSIS_PATHWAY_REVIEW",
            "protocol_code": "NICE-NG73-ENDO",
            "rationale": (
                f"POSTPARTUM TRANSITION TRIGGERED (Delivery {delivery_iso}): Recurring pelvic "
                "pain / suspected endometriosis referral signal preserved into postpartum care. "
                "Normal prior ultrasound does not close the pathway; requires specialist review."
            ),
        }
    return {
        "id": obl_id,
        "life_stage": "Postpartum",
        "priority": "HIGH",
        "status": "ESCALATED_FOR_REVIEW",
        "trigger_event_date": delivery_iso,
    }


def _build_discharge_diagnosis_spawns(
    event_type: str,
    existing_obligations: list[dict[str, Any]],
    event_context: dict[str, Any],
) -> list[dict[str, Any]]:
    """Create new postpartum obligations when delivery discharge diagnoses lack an open card."""
    if event_type != "FHIR_DELIVERY_POSTPARTUM":
        return []
    diagnoses = {str(d).upper() for d in (event_context.get("discharge_diagnoses") or [])}
    if not diagnoses:
        return []

    sample = existing_obligations[0] if existing_obligations else {}
    patient_id = str(event_context.get("patient_id") or sample.get("patient_id") or "PAT-AE-4092")
    patient_name = str(
        event_context.get("patient_name") or sample.get("patient_name") or f"Patient {patient_id}"
    )
    existing_ids = {str(o["id"]) for o in existing_obligations}
    open_rule_prefixes = {
        str(o.get("rule_version") or "").upper()
        for o in existing_obligations
        if o.get("status") != "VERIFIED_CLOSED"
    }

    delivery_date = _parse_iso_date(event_context.get("delivery_date"))
    delivery_iso = delivery_date.isoformat()
    protocol_override = str(event_context.get("protocol_override") or "").upper()
    spawns: list[dict[str, Any]] = []

    if diagnoses & {"GDM_CONFIRMED", "GESTATIONAL_DIABETES"} and not any(
        r.startswith("RB-METABOLIC-") for r in open_rule_prefixes
    ):
        new_id = f"OBL-GDM-{delivery_iso.replace('-', '')[-4:]}"
        if new_id not in existing_ids:
            is_admission = protocol_override == "DELIVERY_ADMISSION_OGTT"
            win_start = delivery_iso if is_admission else _iso_plus_days(delivery_date, 28)
            win_end = (
                _iso_plus_days(delivery_date, 2)
                if is_admission
                else _iso_plus_days(delivery_date, 84)
            )
            spawns.append(
                {
                    "id": new_id,
                    "patient_id": patient_id,
                    "patient_name": patient_name,
                    "life_stage": "Postpartum",
                    "title": "Postpartum 75g OGTT After Confirmed Gestational Diabetes",
                    "rationale": (
                        f"Delivery discharge diagnosis (GDM confirmed, {delivery_iso}) triggered "
                        f"postpartum 75g OGTT window ({win_start} to {win_end}). A booked "
                        "appointment leaves testing open; result review is tracked separately."
                    ),
                    "evidence_source": f"FHIR Encounter/delivery-discharge-{delivery_iso}",
                    "rule_version": "RB-METABOLIC-v2.0.0",
                    "owner": "Postpartum Endocrinology / Primary Care",
                    "status": "ESCALATED_FOR_REVIEW",
                    "priority": "HIGH",
                    "trigger_event_date": delivery_iso,
                    "due_window_start": win_start,
                    "due_window_end": win_end,
                    "due_label": (
                        "Delivery-admission 75g OGTT (Local Protocol)"
                        if is_admission
                        else "4–12 weeks postpartum 75g OGTT (ADA 2026)"
                    ),
                    "closure_policy": "COMPLETED_TEST_NOT_BOOKING",
                    "protocol_code": (
                        "LOCAL-DELIVERY-ADMISSION-OGTT" if is_admission else "ADA-2026-OGTT-4-12W"
                    ),
                }
            )

    htn_dx = diagnoses & {
        "SEVERE_POSTPARTUM_HYPERTENSION",
        "SEVERE_HYPERTENSION",
        "POSTPARTUM_HYPERTENSION",
        "GESTATIONAL_HYPERTENSION",
        "PREECLAMPSIA",
    }
    if htn_dx and not any(r.startswith("RB-PREECLAMPSIA-") for r in open_rule_prefixes):
        new_id = f"OBL-BP-{delivery_iso.replace('-', '')[-4:]}"
        if new_id not in existing_ids:
            severe = bool(diagnoses & {"SEVERE_POSTPARTUM_HYPERTENSION", "SEVERE_HYPERTENSION"})
            win_end = _iso_plus_days(delivery_date, 3 if severe else 10)
            spawns.append(
                {
                    "id": new_id,
                    "patient_id": patient_id,
                    "patient_name": patient_name,
                    "life_stage": "Postpartum",
                    "title": (
                        "Postpartum Severe Hypertension ≤72h BP Follow-up"
                        if severe
                        else "Postpartum Hypertensive Disorder Remote BP Follow-up"
                    ),
                    "rationale": (
                        f"Carried delivery discharge hypertension diagnosis ({delivery_iso}) into "
                        f"postpartum care. Requires verified BP assessment by {win_end}; severe "
                        "readings (≥160/110 mmHg or symptoms) escalate immediately."
                    ),
                    "evidence_source": f"FHIR Encounter/delivery-discharge-{delivery_iso}",
                    "rule_version": "RB-PREECLAMPSIA-v2.0.0",
                    "owner": (
                        "Postpartum Hypertension Rapid-Response / OB-GYN"
                        if severe
                        else "Postpartum Cardiology / Remote BP Clinic"
                    ),
                    "status": "ESCALATED_FOR_REVIEW",
                    "priority": "URGENT",
                    "trigger_event_date": delivery_iso,
                    "due_window_start": delivery_iso,
                    "due_window_end": win_end,
                    "due_label": (
                        "≤ 72h post-discharge BP check (SMFM Severe HTN)"
                        if severe
                        else "≤ 10 days postpartum · Remote BP monitoring preferred"
                    ),
                    "closure_policy": "POSTPARTUM_BP_ASSESSMENT",
                    "protocol_code": (
                        "SMFM-72H-SEVERE-HTN" if severe else "POSTPARTUM-BP-10D-REMOTE"
                    ),
                }
            )
    return spawns


def evaluate_life_stage_transition(state: TransitionState) -> dict[str, Any]:
    """Deterministic step: apply version-controlled clinical rules (zero LLM involvement)."""
    event_type = state["event_type"]
    event_context = state.get("event_context") or {}
    updates: list[dict[str, Any]] = []
    spawned: list[dict[str, Any]] = []

    if event_type in {"FHIR_PREGNANCY_CONFIRMED", "FHIR_DELIVERY_POSTPARTUM"}:
        for item in state["obligations"]:
            updates.append(_evaluate_rule_for_obligation(event_type, item, event_context))
        spawned = _build_discharge_diagnosis_spawns(event_type, state["obligations"], event_context)

    if event_type == "FHIR_PREGNANCY_CONFIRMED":
        if any(u["id"] == "OBL-101" for u in updates):
            rule_detail = (
                f"Applied versioned pregnancy rules to {len(updates)} obligation(s): "
                "OBL-101 escalated to URGENT; OBL-102 safely deferred to postpartum."
            )
        else:
            escalated = [u["id"] for u in updates if u.get("status") == "ESCALATED_FOR_REVIEW"]
            deferred = [u["id"] for u in updates if u.get("status") == "DEFERRED_TO_POSTPARTUM"]
            parts = []
            if escalated:
                parts.append(f"{', '.join(escalated)} escalated for antenatal review")
            if deferred:
                parts.append(f"{', '.join(deferred)} safely deferred to postpartum")
            summary_tail = "; ".join(parts) if parts else "rules evaluated"
            rule_detail = f"Applied versioned pregnancy rules to {len(updates)} obligation(s): {summary_tail}."
    elif event_type == "FHIR_DELIVERY_POSTPARTUM":
        if any(u["id"] == "OBL-102" for u in updates):
            rule_detail = (
                f"Applied versioned postpartum rules to {len(updates)} obligation(s): "
                "deferred OBL-102 reactivated for pre-discharge MMR vaccination."
            )
        else:
            reactivated = [u["id"] for u in updates if u.get("priority") == "URGENT"]
            spawn_note = (
                f"; created {len(spawned)} discharge-diagnosis obligation(s)" if spawned else ""
            )
            rule_detail = (
                f"Applied versioned postpartum rules to {len(updates)} obligation(s): "
                f"reactivated {', '.join(reactivated) or 'open obligations'} for postpartum closure"
                f"{spawn_note}."
            )
    else:
        rule_detail = f"No deterministic transition rule matched event '{event_type}'."

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "evaluate_life_stage_transition",
            "execution": "deterministic",
            "phi_exposed": False,
            "detail": rule_detail,
        }
    )
    return {
        "reassessed_updates": updates,
        "spawned_obligations": spawned,
        "trace": trace,
    }


def validate_closure_policy(
    obligation: dict[str, Any],
    closure_evidence: str,
) -> ClosureGuardResult:
    """Enforce deterministic per-rule clinical closure guards before allowing VERIFIED_CLOSED."""
    status = str(obligation.get("status") or "")
    rule_ver = str(obligation.get("rule_version") or "").upper()
    policy = str(obligation.get("closure_policy") or "CLINICIAN_EVIDENCE").upper()
    life_stage = str(obligation.get("life_stage") or "")
    text = closure_evidence.strip()

    # 1. Pregnancy-deferred obligations (live vaccines, deferred HPV, deferred postpartum cervical)
    if status == "DEFERRED_TO_POSTPARTUM" or policy == "DEFERRED_UNTIL_POSTPARTUM":
        if rule_ver.startswith("RB-CERVICAL-"):
            return ClosureGuardResult(
                allowed=False,
                reason=(
                    "Clinical safety guard: postpartum cervical re-evaluation is deferred until "
                    "≥6 weeks after delivery and cannot be closed until the Postpartum transition "
                    "is triggered."
                ),
            )
        return ClosureGuardResult(
            allowed=False,
            reason=(
                "Clinical safety guard: pregnancy-deferred immunization obligation is "
                "contraindicated during pregnancy and cannot be closed until the Postpartum "
                "transition is triggered."
            ),
        )

    # 2. Gap 1 — GDM / Dysglycemia: booked appointment alone leaves testing open
    if (
        policy == "COMPLETED_TEST_NOT_BOOKING"
        and _BOOKING_ONLY_RE.search(text)
        and not _COMPLETED_OGTT_RE.search(text)
    ):
        return ClosureGuardResult(
            allowed=False,
            reason=(
                "Clinical safety guard (GDM Postpartum OGTT): A booked appointment or lab "
                "order leaves the testing obligation open. Document a completed 75g OGTT "
                "(or protocol-specified glucose test) result before closing; clinician result "
                "review is tracked separately."
            ),
        )

    # 3. Gap 2 — Postpartum Blood Pressure: severe readings escalate; booking alone cannot close
    if policy == "POSTPARTUM_BP_ASSESSMENT":
        if _is_severe_bp_text(text) and not _HTN_STABILIZED_RE.search(text):
            bp = _parse_bp_values(text)
            bp_desc = f" ({bp[0]}/{bp[1]} mmHg)" if bp else ""
            return ClosureGuardResult(
                allowed=False,
                audit_event_type="CLINICAL_SAFETY_ESCALATED",
                reason=(
                    f"Clinical safety guard (Severe Postpartum Hypertension{bp_desc}): Qualifying "
                    "severe BP (≥160/110 mmHg) or severe hypertensive features cannot be closed "
                    "routinely. Obligation escalated immediately to the local urgent hypertension "
                    "escalation protocol."
                ),
                escalation_patch={
                    "priority": "URGENT",
                    "status": "ESCALATED_FOR_REVIEW",
                    "owner": "Urgent Obstetric / Hypertension Escalation Protocol",
                    "due_label": "IMMEDIATE · Local Severe HTN Protocol",
                    "protocol_code": "SMFM-72H-SEVERE-HTN",
                },
            )
        has_bp_assessment = bool(
            _parse_bp_values(text)
            or re.search(
                r"\b(?:mmhg|normotensive|bp\s+(?:recorded|verified|measured|assessed|stabilized)|"
                r"remote\s+bp|home\s+bp|aspirin|prophylaxis)\b",
                text,
                flags=re.IGNORECASE,
            )
        )
        if _BOOKING_ONLY_RE.search(text) and not has_bp_assessment:
            return ClosureGuardResult(
                allowed=False,
                reason=(
                    "Clinical safety guard (Postpartum BP Follow-up): Scheduling an office visit "
                    "does not satisfy the blood pressure obligation. Document an actual BP "
                    "reading (remote or clinic mmHg) before closing."
                ),
            )

    # 4. Gap 3 — Perinatal Depression & Anxiety: score is only a signal; safety concerns route urgently
    if policy == "MENTAL_HEALTH_ASSESSMENT":
        if _MH_SAFETY_CONCERN_RE.search(text) and not _MH_SAFETY_RESOLVED_RE.search(text):
            return ClosureGuardResult(
                allowed=False,
                audit_event_type="CLINICAL_SAFETY_ESCALATED",
                reason=(
                    "Clinical safety guard (Perinatal Mental Health Safety Concern): Documented "
                    "safety concern routed immediately through the approved urgent perinatal "
                    "safety pathway. Routine closure is blocked until urgent psychiatric safety "
                    "evaluation and stabilization plan are documented."
                ),
                escalation_patch={
                    "priority": "URGENT",
                    "status": "ESCALATED_FOR_REVIEW",
                    "owner": "Approved Urgent Perinatal Safety & Psychiatry Pathway",
                    "due_label": "IMMEDIATE · Approved Urgent Safety Pathway",
                    "protocol_code": "ACOG-PERINATAL-MH-URGENT",
                },
            )
        if not _MH_ASSESSMENT_COMPLETED_RE.search(text):
            return ClosureGuardResult(
                allowed=False,
                reason=(
                    "Clinical safety guard (Perinatal Depression & Anxiety): A questionnaire "
                    "score (EPDS/GAD-7) or booked appointment is a screening signal only and "
                    "cannot close this obligation. Document completed clinical assessment and "
                    "treatment/follow-up monitoring plan."
                ),
            )

    # 5. Gap 4 — Abnormal Cervical Screening: block contraindicated pregnancy ECC/LEEP & bookings
    if policy == "CERVICAL_ALGORITHM_RECONCILIATION":
        if (
            life_stage.startswith("Antenatal")
            and _CERVICAL_PREG_CONTRAINDICATED_RE.search(text)
            and not _CERVICAL_INVASION_EXCEPTION_RE.search(text)
        ):
            return ClosureGuardResult(
                allowed=False,
                reason=(
                    "Clinical safety guard (Abnormal Cervical Screening in Pregnancy): "
                    "Endocervical curettage (ECC) is contraindicated and routine excisional "
                    "procedures (LEEP/conization) are deferred during pregnancy unless invasive "
                    "cancer is suspected under Abu Dhabi DoH / ASCCP guidelines."
                ),
            )
        if _BOOKING_ONLY_RE.search(text) and not _CERVICAL_DISPOSITION_RE.search(text):
            return ClosureGuardResult(
                allowed=False,
                reason=(
                    "Clinical safety guard (Abnormal Cervical Screening): A booked referral "
                    "leaves the abnormal result unresolved. Reconcile prior HPV/cytology, "
                    "interim procedures, and pregnancy status with documented colposcopy or "
                    "local-algorithm disposition."
                ),
            )

    # 6. Gap 5 — Endometriosis Evaluation: normal ultrasound/exam MUST NOT close the signal
    if policy == "ENDOMETRIOSIS_PATHWAY_REVIEW":
        if _ENDO_NORMAL_SCAN_RE.search(text) and not _ENDO_SPECIALIST_REVIEW_RE.search(text):
            return ClosureGuardResult(
                allowed=False,
                reason=(
                    "Clinical safety guard (Endometriosis Evaluation · NICE NG73 / WHO): A normal "
                    "pelvic examination or normal pelvic ultrasound can coexist with suspected "
                    "endometriosis and does NOT resolve referral criteria. Recurring symptom "
                    "signal preserved until specialist gynecology pathway review is documented."
                ),
            )
        if _BOOKING_ONLY_RE.search(text) and not _ENDO_SPECIALIST_REVIEW_RE.search(text):
            return ClosureGuardResult(
                allowed=False,
                reason=(
                    "Clinical safety guard (Endometriosis Evaluation): A pending referral or "
                    "appointment alone does not close the evaluation signal. Document specialist "
                    "gynecology / approved endometriosis pathway review."
                ),
            )

    return ClosureGuardResult(allowed=True)


def evaluate_incoming_evidence_safety(
    obligation: dict[str, Any],
    result_value: str,
    summary_note: str,
) -> dict[str, Any] | None:
    """Deterministically inspect newly recorded evidence for urgent escalation or preserved signals."""
    rule_ver = str(obligation.get("rule_version") or "").upper()
    policy = str(obligation.get("closure_policy") or "").upper()
    combined = f"{result_value} {summary_note}"

    if (
        (rule_ver.startswith("RB-PREECLAMPSIA-") or policy == "POSTPARTUM_BP_ASSESSMENT")
        and _is_severe_bp_text(combined)
        and not _HTN_STABILIZED_RE.search(combined)
    ):
        bp = _parse_bp_values(combined)
        bp_desc = f" ({bp[0]}/{bp[1]} mmHg)" if bp else ""
        return {
            "event_type": "CLINICAL_SAFETY_ESCALATED",
            "actor": f"SafetyGuard ({obligation.get('rule_version')})",
            "summary": (
                f"Incoming severe blood pressure finding{bp_desc} for {obligation['id']} routed "
                "immediately to the local urgent hypertension escalation protocol."
            ),
            "patch": {
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Urgent Obstetric / Hypertension Escalation Protocol",
                "due_label": "IMMEDIATE · Local Severe HTN Protocol",
                "protocol_code": "SMFM-72H-SEVERE-HTN",
            },
        }

    if (
        (rule_ver.startswith("RB-PERINATAL-MH-") or policy == "MENTAL_HEALTH_ASSESSMENT")
        and _MH_SAFETY_CONCERN_RE.search(combined)
        and not _MH_SAFETY_RESOLVED_RE.search(combined)
    ):
        return {
            "event_type": "CLINICAL_SAFETY_ESCALATED",
            "actor": f"SafetyGuard ({obligation.get('rule_version')})",
            "summary": (
                f"Incoming perinatal mental health safety concern for {obligation['id']} routed "
                "deterministically to the approved urgent safety pathway."
            ),
            "patch": {
                "priority": "URGENT",
                "status": "ESCALATED_FOR_REVIEW",
                "owner": "Approved Urgent Perinatal Safety & Psychiatry Pathway",
                "due_label": "IMMEDIATE · Approved Urgent Safety Pathway",
                "protocol_code": "ACOG-PERINATAL-MH-URGENT",
            },
        }

    if (
        (rule_ver.startswith("RB-ENDO-") or policy == "ENDOMETRIOSIS_PATHWAY_REVIEW")
        and _ENDO_NORMAL_SCAN_RE.search(combined)
        and not _ENDO_SPECIALIST_REVIEW_RE.search(combined)
    ):
        return {
            "event_type": "CLINICAL_SIGNAL_PRESERVED",
            "actor": f"SafetyGuard ({obligation.get('rule_version')})",
            "summary": (
                f"Normal ultrasound/examination logged for {obligation['id']}; per NICE NG73, "
                "endometriosis referral signal preserved OPEN pending specialist pathway review."
            ),
            "patch": None,
        }

    return None


def build_followup_child_obligation(
    obligation: dict[str, Any],
    closure_evidence: str,
    existing_ids: set[str],
) -> dict[str, Any] | None:
    """Create a linked downstream obligation when closing a multi-stage care obligation."""
    obl_id = str(obligation["id"])
    rule_ver = str(obligation.get("rule_version") or "").upper()
    policy = str(obligation.get("closure_policy") or "").upper()
    life_stage = str(obligation.get("life_stage") or "")

    # Gap 1: Postpartum GDM test completion spawns a separate Result Review obligation.
    if (
        policy == "COMPLETED_TEST_NOT_BOOKING"
        and rule_ver.startswith("RB-METABOLIC-")
        and life_stage == "Postpartum"
    ):
        child_id = f"{obl_id}-REV"
        if child_id in existing_ids:
            return None
        return {
            "id": child_id,
            "patient_id": obligation["patient_id"],
            "patient_name": obligation["patient_name"],
            "life_stage": "Postpartum",
            "title": f"Postpartum 75g OGTT Result Review & Long-Term Plan ({obl_id})",
            "rationale": (
                f"Linked to completed postpartum glucose test ({obl_id}). Tracks clinician "
                "result interpretation against non-pregnancy diagnostic criteria, prediabetes "
                "or diabetes management linkage, and lifelong 1–3 year screening plan (ADA 2026). "
                f"Recorded test note: {closure_evidence[:220]}"
            ),
            "evidence_source": f"Linked Obligation/{obl_id}",
            "rule_version": "RB-METABOLIC-REVIEW-v2.0.0",
            "owner": "Postpartum Endocrinology / Primary Care",
            "status": "OPEN",
            "priority": "HIGH",
            "parent_obligation_id": obl_id,
            "trigger_event_date": obligation.get("trigger_event_date"),
            "due_window_start": obligation.get("due_window_start"),
            "due_window_end": obligation.get("due_window_end"),
            "due_label": "Clinician result review & 1–3y plan (ADA 2026)",
            "closure_policy": "RESULT_REVIEW_SIGNOFF",
            "protocol_code": "ADA-2026-OGTT-RESULT-REVIEW",
        }

    # Gap 3: Verified clinical assessment for positive MH screen spawns longitudinal monitoring.
    if policy == "MENTAL_HEALTH_ASSESSMENT" and rule_ver.startswith("RB-PERINATAL-MH-"):
        child_id = f"{obl_id}-MON"
        if child_id in existing_ids:
            return None
        return {
            "id": child_id,
            "patient_id": obligation["patient_id"],
            "patient_name": obligation["patient_name"],
            "life_stage": life_stage,
            "title": f"Perinatal Mental Health Follow-up & Treatment Monitoring ({obl_id})",
            "rationale": (
                f"Linked to verified perinatal mental health assessment ({obl_id}). Per ACOG "
                "treatment-cascade standards, tracks symptom trajectory, treatment engagement, "
                "and repeat screening at 4-week follow-up."
            ),
            "evidence_source": f"Linked Obligation/{obl_id}",
            "rule_version": "RB-PERINATAL-MH-MON-v1.0.0",
            "owner": "Perinatal Behavioral Health / OB-GYN",
            "status": "OPEN",
            "priority": "MEDIUM",
            "parent_obligation_id": obl_id,
            "trigger_event_date": obligation.get("trigger_event_date"),
            "due_window_start": None,
            "due_window_end": None,
            "due_label": "4-week treatment & symptom monitoring (ACOG)",
            "closure_policy": "CLINICIAN_EVIDENCE",
            "protocol_code": "ACOG-PERINATAL-MH-MONITORING",
        }

    # Gap 4: Antenatal colposcopy triage ruling out invasion queues ≥6w postpartum re-evaluation.
    if (
        policy == "CERVICAL_ALGORITHM_RECONCILIATION"
        and rule_ver.startswith("RB-CERVICAL-")
        and life_stage.startswith("Antenatal")
    ):
        child_id = f"{obl_id}-PP"
        if child_id in existing_ids:
            return None
        return {
            "id": child_id,
            "patient_id": obligation["patient_id"],
            "patient_name": obligation["patient_name"],
            "life_stage": life_stage,
            "title": f"Postpartum Definitive Cervical Re-Evaluation ({obl_id})",
            "rationale": (
                f"Linked to antenatal colposcopy triage ({obl_id}) that excluded invasive "
                "cancer during pregnancy. Preserved and locked until ≥6 weeks postpartum "
                "for definitive cytology/colposcopy management per Abu Dhabi DoH / ASCCP."
            ),
            "evidence_source": f"Linked Obligation/{obl_id}",
            "rule_version": "RB-CERVICAL-v1.0.0",
            "owner": "Postpartum Colposcopy & Gynecology Clinic",
            "status": "DEFERRED_TO_POSTPARTUM",
            "priority": "HIGH",
            "parent_obligation_id": obl_id,
            "trigger_event_date": obligation.get("trigger_event_date"),
            "due_window_start": None,
            "due_window_end": None,
            "due_label": "≥ 6 weeks postpartum re-evaluation (DoH / ASCCP)",
            "closure_policy": "CERVICAL_ALGORITHM_RECONCILIATION",
            "protocol_code": "DOH-AD-CERVICAL-PP",
        }

    return None


def apply_uae_privacy_firewall(state: TransitionState) -> dict[str, Any]:
    """Deterministic security gate: strip all UAE PHI before any external AI call."""
    all_items = list(state["obligations"]) + list(state.get("spawned_obligations") or [])
    privacy_report = build_ai_safe_payload(
        event_type=state["event_type"],
        obligations=all_items,
        reassessed_updates=state["reassessed_updates"],
    )
    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "apply_uae_privacy_firewall",
            "execution": "deterministic",
            "phi_exposed": False,
            "detail": (
                f"Stripped {len(privacy_report['redacted_fields'])} PHI fields; "
                f"pseudonymized case as {privacy_report['payload']['case_token']} "
                "(UAE_PHI_LOCAL_ONLY)."
            ),
        }
    )
    return {"privacy_report": privacy_report, "trace": trace}


def synthesize_coordination_brief(state: TransitionState) -> dict[str, Any]:
    """Agentic step: call OpenRouter with ONLY the de-identified payload."""
    deidentified_payload = state["privacy_report"]["payload"]
    synthesis = synthesize_deidentified_brief(deidentified_payload)

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "synthesize_coordination_brief",
            "execution": "agentic"
            if synthesis["mode"] == "openrouter"
            else "deterministic_fallback",
            "phi_exposed": False,
            "detail": (
                "Drafted clinician handoff brief via OpenRouter for OB-GYN sign-off."
                if synthesis["mode"] == "openrouter"
                else "Drafted clinician handoff brief via local deterministic fallback."
            ),
        }
    )
    return {
        "agent_summary": synthesis["summary"],
        "specialist_handoff": synthesis["specialist_handoff"],
        "ai_metadata": {
            "mode": synthesis["mode"],
            "provider": synthesis["provider"],
            "model": synthesis["model"],
            "fallback_reason": synthesis["fallback_reason"],
        },
        "trace": trace,
    }


def build_transition_graph():
    graph = StateGraph(TransitionState)  # ty: ignore[invalid-argument-type]  # LangGraph StateLike protocol vs stdlib TypedDict
    graph.add_node("detect_open_obligations", detect_open_obligations)
    graph.add_node("evaluate_life_stage_transition", evaluate_life_stage_transition)
    graph.add_node("apply_uae_privacy_firewall", apply_uae_privacy_firewall)
    graph.add_node("synthesize_coordination_brief", synthesize_coordination_brief)

    graph.add_edge(START, "detect_open_obligations")
    graph.add_edge("detect_open_obligations", "evaluate_life_stage_transition")
    graph.add_edge("evaluate_life_stage_transition", "apply_uae_privacy_firewall")
    graph.add_edge("apply_uae_privacy_firewall", "synthesize_coordination_brief")
    graph.add_edge("synthesize_coordination_brief", END)

    return graph.compile()


transition_workflow = build_transition_graph()
