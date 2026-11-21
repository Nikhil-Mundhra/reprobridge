import json

import pytest

from api.db import SEED_OBLIGATIONS
from api.privacy import (
    PrivacyViolationError,
    assert_phi_free,
    build_ai_safe_payload,
    build_obligation_explain_payload,
    deidentify_obligation,
    pseudonymize_patient_id,
    scrub_explanation_for_tts,
    scrub_text_phi,
)


def test_pseudonymize_is_deterministic_and_hides_raw_id():
    token1 = pseudonymize_patient_id("PAT-AE-4092")
    token2 = pseudonymize_patient_id("PAT-AE-4092")
    assert token1 == token2
    assert token1.startswith("ANON-CASE-")
    assert "4092" not in token1
    assert "PAT-AE" not in token1


def test_scrub_text_phi_redacts_uae_identifiers():
    raw = (
        "Patient Amina Al-Mansoori (PAT-AE-4092), Emirates ID 784-1992-1234567-1, "
        "phone +971 50 123 4567, email amina@example.ae."
    )
    scrubbed = scrub_text_phi(raw, extra_forbidden=["Amina", "Al-Mansoori"])
    assert "784-1992-1234567-1" not in scrubbed
    assert "PAT-AE-4092" not in scrubbed
    assert "+971 50 123 4567" not in scrubbed
    assert "amina@example.ae" not in scrubbed
    assert "Amina" not in scrubbed
    assert "Al-Mansoori" not in scrubbed


def test_deidentify_obligation_strips_all_phi_fields():
    safe = deidentify_obligation(SEED_OBLIGATIONS[0])
    assert "patient_name" not in safe
    assert "patient_id" not in safe
    assert "evidence_source" not in safe
    assert "verified_by" not in safe
    assert safe["case_token"].startswith("ANON-CASE-")
    assert safe["rule_version"] == "RB-THYROID-v1.4.0"


def test_build_ai_safe_payload_contains_zero_phi():
    report = build_ai_safe_payload(
        event_type="FHIR_PREGNANCY_CONFIRMED",
        obligations=SEED_OBLIGATIONS,
        reassessed_updates=[],
    )
    serialized = json.dumps(report["payload"])
    assert report["phi_check_passed"] is True
    assert report["payload"]["residency_policy"] == "UAE_PHI_LOCAL_ONLY"
    assert "Amina" not in serialized
    assert "Al-Mansoori" not in serialized
    assert "PAT-AE-4092" not in serialized
    assert "Malaffi" not in serialized


@pytest.mark.parametrize(
    "bad_payload",
    [
        {"patient_name": "Amina"},
        {"note": "Emirates ID 784-1990-7654321-9"},
        {"note": "Contact +971-50-987-6543"},
        {"note": "Email test@clinic.ae"},
        {"note": "Raw ID PAT-AE-4092"},
    ],
)
def test_assert_phi_free_blocks_phi_leaks(bad_payload):
    with pytest.raises(PrivacyViolationError):
        assert_phi_free(bad_payload)


def test_build_obligation_explain_payload_scrubs_phi_and_passes_firewall():
    dirty_obl = {
        **SEED_OBLIGATIONS[0],
        "rationale": (
            "Patient Amina Al-Mansoori (PAT-AE-4092), EID 784-1992-1234567-1, "
            "phone +971 50 123 4567, email amina@example.ae showed TSH 4.8 mIU/L."
        ),
    }
    report = build_obligation_explain_payload(dirty_obl)
    assert report["phi_check_passed"] is True
    assert_phi_free(report["payload"])

    serialized = json.dumps(report["payload"])
    for leaked in (
        "Amina",
        "Al-Mansoori",
        "PAT-AE-4092",
        "784-1992-1234567-1",
        "amina@example.ae",
        "+971 50 123 4567",
    ):
        assert leaked not in serialized
    assert "4.8 mIU/L" in serialized


def test_scrub_explanation_for_tts_redacts_phi_before_audio_egress():
    raw_text = (
        "Amina Al-Mansoori (PAT-AE-4092), EID 784-1992-1234567-1, "
        "shows elevated TSH 4.8 mIU/L."
    )
    scrubbed = scrub_explanation_for_tts(raw_text, SEED_OBLIGATIONS[0])
    for leaked in ("Amina", "Al-Mansoori", "PAT-AE-4092", "784-1992-1234567-1"):
        assert leaked not in scrubbed
    assert "4.8 mIU/L" in scrubbed
