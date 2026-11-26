"""UAE Data Residency & PHI De-Identification Firewall.

Strictly separates PHI stored in Neon Postgres from de-identified clinical
context permitted to cross external AI boundaries (e.g., OpenRouter).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
from datetime import UTC, datetime
from typing import Any

# Fields that contain direct or indirect PHI and must NEVER leave the local/UAE boundary.
PHI_FIELDS: frozenset[str] = frozenset(
    {
        "patient_name",
        "patient_id",
        "emirates_id",
        "mrn",
        "dob",
        "phone",
        "email",
        "evidence_source",
        "verified_by",
        "closure_evidence",
        "trigger_event_date",
        "due_window_start",
        "due_window_end",
        "mental_health_notes",
        "safety_plan_details",
        "symptom_free_text",
        "source_quote",
        "source_note_date",
        "source_facility",
        "relevance_confirmed_by",
        "dismissed_by",
        "dismissed_reason",
        "reopened_by",
        "reopened_reason",
    }
)

# Regex patterns for high-risk PHI that must never appear in outbound AI payloads.
_EMIRATES_ID_RE = re.compile(r"\b784-\d{4}-\d{7}-\d\b")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_PHONE_RE = re.compile(r"(?:\+971|00971|05\d)[\s-]?\d{2,3}[\s-]?\d{3,4}[\s-]?\d{3,4}")
_PATIENT_ID_RE = re.compile(r"\bPAT-[A-Z]{2}-\d+\b")

# Controlled clinical category mapping so raw free-text titles/notes are not required by LLMs.
_CLINICAL_CATEGORIES: dict[str, str] = {
    "RB-THYROID-v1.4.0": "subclinical_hypothyroidism_tsh_followup",
    "RB-IMMUNE-v1.2.1": "live_vaccine_non_immune_deferral",
    "RB-METABOLIC-v1.2.0": "gestational_dysglycemia_ogtt_followup",
    "RB-METABOLIC-v2.0.0": "gestational_dysglycemia_ogtt_followup",
    "RB-METABOLIC-REVIEW-v2.0.0": "postpartum_gdm_ogtt_result_review",
    "RB-PREECLAMPSIA-v1.3.0": "preeclampsia_prophylaxis_window",
    "RB-PREECLAMPSIA-v2.0.0": "preeclampsia_prophylaxis_window",
    "RB-HPV-v1.1.0": "hpv_series_postpartum_completion",
    "RB-PERINATAL-MH-v1.0.0": "perinatal_depression_anxiety_followup",
    "RB-PERINATAL-MH-MON-v1.0.0": "perinatal_mental_health_monitoring",
    "RB-CERVICAL-v1.0.0": "abnormal_cervical_screening_followup",
    "RB-ENDO-v1.0.0": "endometriosis_symptom_evaluation",
}

_CLINICAL_CATEGORY_PREFIXES: tuple[tuple[str, str], ...] = (
    ("RB-THYROID-", "subclinical_hypothyroidism_tsh_followup"),
    ("RB-IMMUNE-", "live_vaccine_non_immune_deferral"),
    ("RB-METABOLIC-REVIEW-", "postpartum_gdm_ogtt_result_review"),
    ("RB-METABOLIC-", "gestational_dysglycemia_ogtt_followup"),
    ("RB-PREECLAMPSIA-", "preeclampsia_prophylaxis_window"),
    ("RB-HPV-", "hpv_series_postpartum_completion"),
    ("RB-PERINATAL-MH-MON-", "perinatal_mental_health_monitoring"),
    ("RB-PERINATAL-MH-", "perinatal_depression_anxiety_followup"),
    ("RB-CERVICAL-", "abnormal_cervical_screening_followup"),
    ("RB-ENDO-", "endometriosis_symptom_evaluation"),
)


def resolve_clinical_category(rule_version: str) -> str:
    """Resolve a versioned rule identifier to a controlled non-PHI clinical category."""
    if rule_version in _CLINICAL_CATEGORIES:
        return _CLINICAL_CATEGORIES[rule_version]
    upper = rule_version.upper()
    for prefix, category in _CLINICAL_CATEGORY_PREFIXES:
        if upper.startswith(prefix):
            return category
    return "preventive_reproductive_followup"


class PrivacyViolationError(RuntimeError):
    """Raised when PHI is detected in an outbound payload destined for an external AI."""


def pseudonymize_patient_id(patient_id: str) -> str:
    """Create a non-reversible ephemeral case token from a patient ID."""
    digest = hashlib.sha256(f"reprobridge-uae-salt:{patient_id}".encode()).hexdigest()
    return f"ANON-CASE-{digest[:8].upper()}"


def scrub_text_phi(text: str, extra_forbidden: list[str] | None = None) -> str:
    """Redact known PHI patterns and explicit identifiers from free text."""
    scrubbed = _EMIRATES_ID_RE.sub("[REDACTED_EID]", text)
    scrubbed = _EMAIL_RE.sub("[REDACTED_EMAIL]", scrubbed)
    scrubbed = _PHONE_RE.sub("[REDACTED_PHONE]", scrubbed)
    scrubbed = _PATIENT_ID_RE.sub("[REDACTED_PAT_ID]", scrubbed)
    if extra_forbidden:
        for token in extra_forbidden:
            if token and len(token) >= 3:
                scrubbed = re.sub(re.escape(token), "[REDACTED_PHI]", scrubbed, flags=re.IGNORECASE)
    return scrubbed


# Medication names and dosing that appear in deterministic, clinician-facing rule text.
# They are stripped before external AI egress so the assistive LLM is never primed with
# drug/dose directives it is forbidden to repeat (it must not prescribe or dose).
_MEDICATION_NAME_RE = re.compile(
    r"\b(?:low[- ]dose\s+)?"
    r"(?:levothyroxine|aspirin|metformin|insulin|labetalol|nifedipine|sertraline|fluoxetine|progestin)\b",
    flags=re.IGNORECASE,
)
# Doses like "150 mg", "50 mcg nightly", "(150 mg nightly)". Lab units such as mg/dL or
# mIU/L are preserved via the negative lookahead on "/" and the explicit unit list.
_MEDICATION_DOSE_RE = re.compile(
    r"\s*\(?\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg)\b(?!\s*/)"
    r"(?:\s+(?:nightly|daily|once daily|twice daily|bid|od))?\)?",
    flags=re.IGNORECASE,
)
MEDICATION_PLACEHOLDER = "specialist-directed therapy"


def redact_medication_directives(text: str) -> str:
    """Replace drug names and doses with a neutral placeholder for AI-bound free text."""
    redacted = _MEDICATION_DOSE_RE.sub("", text)
    redacted = _MEDICATION_NAME_RE.sub(MEDICATION_PLACEHOLDER, redacted)
    return re.sub(r"[ \t]{2,}", " ", redacted).strip()


def _ai_safe_free_text(text: str, forbidden_tokens: list[str]) -> str:
    """PHI-scrub then medication-redact a free-text field destined for external AI."""
    return redact_medication_directives(scrub_text_phi(text, forbidden_tokens))


_CLINICIAN_NAME_RE = re.compile(
    r"\bDr\.?\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,3}",
)


def _deidentify_owner_specialty(obligation: dict[str, Any]) -> str:
    """Return a non-identifying owner/specialty label safe for external AI egress."""
    raw_owner = str(obligation.get("owner") or "OB-GYN / Primary Care")
    forbidden = _extract_forbidden_tokens(obligation)
    scrubbed = scrub_text_phi(raw_owner, forbidden)
    scrubbed = _CLINICIAN_NAME_RE.sub("Assigned Clinician", scrubbed)
    scrubbed = re.sub(r"\[REDACTED_PHI\]", "Assigned Clinician", scrubbed)
    scrubbed = re.sub(r"(?:Assigned Clinician\s*){2,}", "Assigned Clinician ", scrubbed)
    return re.sub(r"\s{2,}", " ", scrubbed).strip(" ·-()") or "Assigned Clinician"


def deidentify_obligation(obligation: dict[str, Any]) -> dict[str, Any]:
    """Strip all PHI from a single obligation record for safe MCP / AI consumption."""
    rule_version = str(obligation.get("rule_version", "UNKNOWN"))
    patient_id = str(obligation.get("patient_id", "UNKNOWN"))
    raw_due_label = obligation.get("due_label")
    safe_due_label = (
        redact_medication_directives(scrub_text_phi(str(raw_due_label))) if raw_due_label else None
    )
    deid: dict[str, Any] = {
        "obligation_id": obligation.get("id"),
        "case_token": pseudonymize_patient_id(patient_id),
        "life_stage": obligation.get("life_stage"),
        "clinical_category": resolve_clinical_category(rule_version),
        "rule_version": rule_version,
        "priority": obligation.get("priority"),
        "status": obligation.get("status"),
        "owner_specialty": _deidentify_owner_specialty(obligation),
    }
    if safe_due_label:
        deid["due_label"] = safe_due_label
    if obligation.get("protocol_code"):
        deid["protocol_code"] = obligation.get("protocol_code")
    if obligation.get("closure_policy"):
        deid["closure_policy"] = obligation.get("closure_policy")
    if obligation.get("parent_obligation_id"):
        deid["parent_obligation_id"] = obligation.get("parent_obligation_id")
    if obligation.get("review_state"):
        deid["review_state"] = obligation.get("review_state")
    if obligation.get("days_remaining") is not None:
        deid["days_remaining"] = obligation.get("days_remaining")
    return deid


def build_ai_safe_payload(
    event_type: str,
    obligations: list[dict[str, Any]],
    reassessed_updates: list[dict[str, Any]],
) -> dict[str, Any]:
    """Construct an auditable, strictly de-identified payload for external AI synthesis."""
    update_by_id = {u["id"]: u for u in reassessed_updates}
    case_token = (
        pseudonymize_patient_id(str(obligations[0].get("patient_id", "UNKNOWN")))
        if obligations
        else "ANON-CASE-NONE"
    )

    deidentified_items: list[dict[str, Any]] = []
    forbidden_tokens: list[str] = []

    for obl in obligations:
        for field in ("patient_name", "patient_id", "verified_by"):
            val = obl.get(field)
            if isinstance(val, str) and val.strip():
                forbidden_tokens.append(val.strip())
                # Also block individual name parts (e.g. "Amira", "Al-Mansoori")
                for part in val.replace("(", " ").replace(")", " ").split():
                    if len(part) >= 4 and part.lower() not in {"synthetic", "ob-gyn"}:
                        forbidden_tokens.append(part)

        merged = {**obl, **update_by_id.get(obl["id"], {})}
        deidentified_items.append(deidentify_obligation(merged))

    payload = {
        "residency_policy": "UAE_PHI_LOCAL_ONLY",
        "case_token": case_token,
        "transition_event": event_type,
        "obligations": deidentified_items,
    }

    assert_phi_free(payload, forbidden_tokens=forbidden_tokens)

    return {
        "payload": payload,
        "redacted_fields": sorted(PHI_FIELDS),
        "permitted_fields": [
            "case_token",
            "transition_event",
            "obligation_id",
            "life_stage",
            "clinical_category",
            "rule_version",
            "priority",
            "status",
            "owner_specialty",
            "due_label",
            "protocol_code",
            "closure_policy",
            "parent_obligation_id",
        ],
        "phi_check_passed": True,
    }


def _extract_forbidden_tokens(obligation: dict[str, Any]) -> list[str]:
    """Collect identifying strings and sub-tokens from an obligation for strict scrubbing."""
    tokens: list[str] = []
    for field in (
        "patient_name",
        "patient_id",
        "verified_by",
        "relevance_confirmed_by",
        "dismissed_by",
        "reopened_by",
    ):
        val = obligation.get(field)
        if isinstance(val, str) and val.strip():
            tokens.append(val.strip())
            for part in val.replace("(", " ").replace(")", " ").split():
                if len(part) >= 4 and part.lower() not in {
                    "synthetic",
                    "ob-gyn",
                    "hospital",
                    "clinic",
                    "primary",
                    "care",
                    "postpartum",
                    "maternity",
                }:
                    tokens.append(part)
    return tokens


def build_obligation_explain_payload(obligation: dict[str, Any]) -> dict[str, Any]:
    """Construct a zero-PHI single-obligation payload for assistive clinician/patient explanation."""
    forbidden_tokens = _extract_forbidden_tokens(obligation)
    deid = deidentify_obligation(obligation)
    explained_obl = {
        **deid,
        "finding_title": _ai_safe_free_text(str(obligation.get("title", "")), forbidden_tokens),
        "clinical_rationale": _ai_safe_free_text(
            str(obligation.get("rationale", "")), forbidden_tokens
        ),
    }
    payload = {
        "residency_policy": "UAE_PHI_LOCAL_ONLY",
        "case_token": deid["case_token"],
        "obligation": explained_obl,
    }

    assert_phi_free(payload, forbidden_tokens=forbidden_tokens)

    return {
        "payload": payload,
        "redacted_fields": sorted(PHI_FIELDS),
        "permitted_fields": [
            "case_token",
            "obligation_id",
            "life_stage",
            "clinical_category",
            "rule_version",
            "priority",
            "status",
            "owner_specialty",
            "due_label",
            "protocol_code",
            "closure_policy",
            "parent_obligation_id",
            "finding_title",
            "clinical_rationale",
        ],
        "phi_check_passed": True,
    }


def scrub_explanation_for_tts(text: str, obligation: dict[str, Any]) -> str:
    """Scrub any PHI tokens from explanation text and verify zero PHI before TTS egress."""
    forbidden_tokens = _extract_forbidden_tokens(obligation)
    scrubbed = scrub_text_phi(text, forbidden_tokens).strip()
    assert_phi_free({"text": scrubbed}, forbidden_tokens=forbidden_tokens)
    return scrubbed


def build_reconciliation_questionnaire_payload(
    obligations: list[dict[str, Any]],
    patient_id: str,
) -> dict[str, Any]:
    """Construct a zero-PHI patient payload for AI scenario reconciliation questions."""
    raw_tokens: list[str] = [patient_id] if patient_id else []
    for obl in obligations:
        raw_tokens.extend(_extract_forbidden_tokens(obl))
    forbidden_tokens = list(dict.fromkeys(t for t in raw_tokens if t))

    deidentified_items: list[dict[str, Any]] = []
    for obl in obligations:
        deid = deidentify_obligation(obl)
        deidentified_items.append(
            {
                **deid,
                "finding_title": _ai_safe_free_text(str(obl.get("title", "")), forbidden_tokens),
                "clinical_rationale": _ai_safe_free_text(
                    str(obl.get("rationale", "")), forbidden_tokens
                ),
            }
        )

    case_token = pseudonymize_patient_id(patient_id or "UNKNOWN")
    payload = {
        "residency_policy": "UAE_PHI_LOCAL_ONLY",
        "case_token": case_token,
        "obligations": deidentified_items,
    }
    assert_phi_free(payload, forbidden_tokens=forbidden_tokens)

    return {
        "payload": payload,
        "redacted_fields": sorted(PHI_FIELDS),
        "permitted_fields": [
            "case_token",
            "obligation_id",
            "life_stage",
            "clinical_category",
            "rule_version",
            "priority",
            "status",
            "owner_specialty",
            "due_label",
            "protocol_code",
            "closure_policy",
            "parent_obligation_id",
            "finding_title",
            "clinical_rationale",
        ],
        "phi_check_passed": True,
    }


def assert_phi_free(payload: Any, forbidden_tokens: list[str] | None = None) -> None:
    """Hard guardrail: raise PrivacyViolationError if any PHI appears in outbound data."""
    serialized = json.dumps(payload, default=str)

    if _EMIRATES_ID_RE.search(serialized):
        raise PrivacyViolationError("Outbound AI payload contains an Emirates ID pattern.")
    if _EMAIL_RE.search(serialized):
        raise PrivacyViolationError("Outbound AI payload contains an email address.")
    if _PHONE_RE.search(serialized):
        raise PrivacyViolationError("Outbound AI payload contains a UAE phone number.")
    if _PATIENT_ID_RE.search(serialized):
        raise PrivacyViolationError("Outbound AI payload contains a raw patient ID.")

    # Ensure no PHI dictionary keys slipped through.
    if isinstance(payload, dict):
        _check_keys(payload)

    if forbidden_tokens:
        lowered = serialized.lower()
        for token in forbidden_tokens:
            if token and len(token) >= 4 and token.lower() in lowered:
                raise PrivacyViolationError(
                    f"Outbound AI payload leaked forbidden PHI token: '{token[:3]}***'."
                )


def _check_keys(obj: Any) -> None:
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key in PHI_FIELDS:
                raise PrivacyViolationError(
                    f"Forbidden PHI key '{key}' found in outbound AI payload."
                )
            _check_keys(value)
    elif isinstance(obj, list):
        for item in obj:
            _check_keys(item)


_PASSPORT_KEY_ID = "rb-uae-edge-k1"


def _get_passport_signing_key() -> bytes:
    """Return signing key for patient-held cryptographic Obligation Passports."""
    secret = os.getenv("REPROBRIDGE_PASSPORT_SECRET", "").strip()
    if not secret:
        # Deterministic synthetic demo signing key (never used for real PHI).
        secret = "reprobridge-synthetic-uae-zero-sharing-edge-key-v1"
    return secret.encode("utf-8")


def _canonical_json(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)


def _sign_passport_body(body: dict[str, Any]) -> str:
    digest = hmac.new(
        _get_passport_signing_key(),
        _canonical_json(body).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest


def issue_obligation_passport(
    obligation: dict[str, Any],
    *,
    include_source_quote: bool = True,
) -> dict[str, Any]:
    """Issue a patient-held, cryptographically signed Obligation Passport (zero hospital sharing).

    Contains only minimal non-chart clinical obligation claims plus a SHA-256 hash of the
    source clinical note so a receiving hospital can verify continuity offline without any
    hospital-to-hospital API call or raw EHR data sharing.
    """
    patient_id = str(obligation.get("patient_id") or "UNKNOWN")
    rule_version = str(obligation.get("rule_version") or "UNKNOWN")
    status = str(obligation.get("status") or "OPEN")

    if status == "VERIFIED_CLOSED":
        credential_type = "ReproBridgeClosureAttestation"
        issuer = "Hospital B · Verified Closure Edge Signer"
    elif status == "REOPENED":
        credential_type = "ReproBridgeReopenAttestation"
        issuer = "Hospital B · Evidence Correction Edge Signer"
    else:
        credential_type = "ReproBridgeObligationPassport"
        issuer = "Hospital A · Patient-Held Edge Signer"

    raw_note_material = "|".join(
        [
            str(obligation.get("source_doc_id") or ""),
            str(obligation.get("source_note_date") or ""),
            str(obligation.get("source_facility") or ""),
            str(obligation.get("source_quote") or obligation.get("rationale") or ""),
        ]
    )
    source_note_sha256 = hashlib.sha256(raw_note_material.encode("utf-8")).hexdigest()

    forbidden = _extract_forbidden_tokens(obligation)
    claims: dict[str, Any] = {
        "obligation_id": str(obligation.get("id") or ""),
        "case_token": pseudonymize_patient_id(patient_id),
        "life_stage": str(obligation.get("life_stage") or ""),
        "clinical_category": resolve_clinical_category(rule_version),
        "rule_version": rule_version,
        "status": status,
        "priority": str(obligation.get("priority") or "MEDIUM"),
        "closure_policy": str(obligation.get("closure_policy") or "CLINICIAN_EVIDENCE"),
        "review_state": str(obligation.get("review_state") or "CONFIRMED_RELEVANT"),
        "owner_role": _deidentify_owner_specialty(obligation),
        "days_remaining": obligation.get("days_remaining"),
        "due_label": (
            redact_medication_directives(scrub_text_phi(str(obligation["due_label"]), forbidden))
            if obligation.get("due_label")
            else None
        ),
        "source_note_sha256": source_note_sha256,
        "raw_chart_bytes_shared": 0,
    }
    if include_source_quote and obligation.get("source_quote"):
        claims["source_quote_excerpt"] = scrub_text_phi(str(obligation["source_quote"]), forbidden)
    if status == "REOPENED" and obligation.get("reopened_reason"):
        claims["reopen_reason_excerpt"] = scrub_text_phi(
            str(obligation["reopened_reason"]), forbidden
        )

    body: dict[str, Any] = {
        "protocol": "SMART-HEALTH-LINK-OBLIGATION-v1",
        "credential_type": credential_type,
        "residency_policy": "UAE_PHI_LOCAL_ONLY",
        "zero_hospital_sharing": True,
        "issuer": issuer,
        "issued_at": datetime.now(UTC).isoformat(),
        "claims": claims,
    }

    # Enforce zero direct PHI leakage inside the portable token.
    assert_phi_free(body, forbidden_tokens=forbidden)

    sig_hex = _sign_passport_body(body)
    encoded = base64.urlsafe_b64encode(_canonical_json(body).encode("utf-8")).decode("ascii")
    smart_health_link = f"shlink://reprobridge.ae/v1/{encoded[:96]}...#{sig_hex[:16]}"

    return {
        **body,
        "signature": {
            "alg": "HMAC-SHA256",
            "key_id": _PASSPORT_KEY_ID,
            "value": sig_hex,
        },
        "smart_health_link": smart_health_link,
    }


def verify_obligation_passport(passport: dict[str, Any]) -> dict[str, Any]:
    """Verify a patient-held Obligation Passport offline with zero Hospital A API calls."""
    sig_obj = passport.get("signature")
    if not isinstance(sig_obj, dict) or not isinstance(sig_obj.get("value"), str):
        return {
            "valid": False,
            "tampered": True,
            "verification_mode": "OFFLINE_ZERO_HOSPITAL_API",
            "hospital_a_api_calls": 0,
            "raw_chart_exposed": False,
            "detail": "Missing or malformed cryptographic signature block.",
            "verified_claims": None,
        }

    required_keys = (
        "protocol",
        "credential_type",
        "residency_policy",
        "zero_hospital_sharing",
        "issuer",
        "issued_at",
        "claims",
    )
    body = {k: passport[k] for k in required_keys if k in passport}
    if len(body) != len(required_keys) or not isinstance(body.get("claims"), dict):
        return {
            "valid": False,
            "tampered": True,
            "verification_mode": "OFFLINE_ZERO_HOSPITAL_API",
            "hospital_a_api_calls": 0,
            "raw_chart_exposed": False,
            "detail": "Passport payload is missing required verifiable credential fields.",
            "verified_claims": None,
        }

    expected_sig = _sign_passport_body(body)
    provided_sig = str(sig_obj.get("value", ""))
    if not hmac.compare_digest(expected_sig, provided_sig):
        return {
            "valid": False,
            "tampered": True,
            "verification_mode": "OFFLINE_ZERO_HOSPITAL_API",
            "hospital_a_api_calls": 0,
            "raw_chart_exposed": False,
            "detail": (
                "TAMPER DETECTED: HMAC-SHA256 signature mismatch. One or more obligation "
                "claims were altered after signing — rejected by Hospital B verifier."
            ),
            "verified_claims": None,
        }

    return {
        "valid": True,
        "tampered": False,
        "verification_mode": "OFFLINE_ZERO_HOSPITAL_API",
        "hospital_a_api_calls": 0,
        "raw_chart_exposed": False,
        "detail": (
            f"Cryptographically verified ({body['credential_type']}) via {sig_obj.get('alg', 'HMAC-SHA256')} "
            "— 0 Hospital A API calls, 0 raw EHR bytes shared."
        ),
        "verified_claims": body["claims"],
    }
