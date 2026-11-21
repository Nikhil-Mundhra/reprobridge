"""UAE Data Residency & PHI De-Identification Firewall.

Strictly separates PHI stored in Neon Postgres from de-identified clinical
context permitted to cross external AI boundaries (e.g., OpenRouter).
"""

from __future__ import annotations

import hashlib
import json
import re
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
    "RB-PREECLAMPSIA-v1.3.0": "preeclampsia_aspirin_prophylaxis_window",
    "RB-HPV-v1.1.0": "hpv_series_postpartum_completion",
}


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


def deidentify_obligation(obligation: dict[str, Any]) -> dict[str, Any]:
    """Strip all PHI from a single obligation record for safe MCP / AI consumption."""
    rule_version = str(obligation.get("rule_version", "UNKNOWN"))
    patient_id = str(obligation.get("patient_id", "UNKNOWN"))
    return {
        "obligation_id": obligation.get("id"),
        "case_token": pseudonymize_patient_id(patient_id),
        "life_stage": obligation.get("life_stage"),
        "clinical_category": _CLINICAL_CATEGORIES.get(
            rule_version, "preventive_reproductive_followup"
        ),
        "rule_version": rule_version,
        "priority": obligation.get("priority"),
        "status": obligation.get("status"),
        "owner_specialty": obligation.get("owner"),
    }


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
                # Also block individual name parts (e.g. "Amina", "Al-Mansoori")
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
        ],
        "phi_check_passed": True,
    }


def _extract_forbidden_tokens(obligation: dict[str, Any]) -> list[str]:
    """Collect identifying strings and sub-tokens from an obligation for strict scrubbing."""
    tokens: list[str] = []
    for field in ("patient_name", "patient_id", "verified_by"):
        val = obligation.get(field)
        if isinstance(val, str) and val.strip():
            tokens.append(val.strip())
            for part in val.replace("(", " ").replace(")", " ").split():
                if len(part) >= 4 and part.lower() not in {"synthetic", "ob-gyn"}:
                    tokens.append(part)
    return tokens


def build_obligation_explain_payload(obligation: dict[str, Any]) -> dict[str, Any]:
    """Construct a zero-PHI single-obligation payload for assistive clinician/patient explanation."""
    forbidden_tokens = _extract_forbidden_tokens(obligation)
    deid = deidentify_obligation(obligation)
    explained_obl = {
        **deid,
        "finding_title": scrub_text_phi(str(obligation.get("title", "")), forbidden_tokens),
        "clinical_rationale": scrub_text_phi(
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
