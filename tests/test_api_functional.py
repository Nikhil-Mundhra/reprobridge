import json

from fastapi.testclient import TestClient

from api.index import app


def test_full_six_step_functional_flow(monkeypatch):
    # Use in-memory store for deterministic isolated functional testing.
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    client = TestClient(app)

    # Reset to clean preconception state
    reset_resp = client.post("/api/demo/reset")
    assert reset_resp.status_code == 200

    # 1. Health check reports UAE residency policy & AI config status
    health = client.get("/api/health")
    assert health.status_code == 200
    hj = health.json()
    assert hj["residency_policy"] == "UAE_PHI_LOCAL_ONLY"
    assert hj["ai_provider"]["provider"] == "openrouter"

    # 2. Initial obligations
    obls = client.get("/api/obligations")
    assert obls.status_code == 200
    assert len(obls.json()["obligations"]) == 2

    # 3. Pregnancy transition runs deterministic rules + UAE privacy firewall + brief synthesis
    trans = client.post("/api/transitions/pregnancy")
    assert trans.status_code == 200
    tj = trans.json()
    assert len(tj["trace"]) == 4
    assert tj["trace"][0]["execution"] == "deterministic"
    assert tj["trace"][1]["execution"] == "deterministic"
    assert tj["trace"][2]["execution"] == "deterministic"
    assert tj["privacy_report"]["phi_check_passed"] is True
    assert "Amina" not in json.dumps(tj["privacy_report"]["payload"])
    assert tj["specialist_handoff"]

    by_id = {o["id"]: o for o in tj["obligations"]}
    assert by_id["OBL-101"]["status"] == "ESCALATED_FOR_REVIEW"
    assert by_id["OBL-101"]["priority"] == "URGENT"
    assert by_id["OBL-102"]["status"] == "DEFERRED_TO_POSTPARTUM"

    # 4. MCP endpoint returns de-identified obligations only
    mcp_tools = client.get("/api/mcp/tools")
    assert mcp_tools.status_code == 200
    assert len(mcp_tools.json()["tools"]) == 4

    mcp_call = client.post(
        "/api/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 99,
            "method": "tools/call",
            "params": {"name": "neon_get_deidentified_obligations", "arguments": {}},
        },
    )
    assert mcp_call.status_code == 200
    mcp_body = mcp_call.json()
    assert mcp_body["result"]["isError"] is False
    assert "PAT-AE-4092" not in json.dumps(mcp_body)

    # 5. Clinical safety guard blocks closing OBL-102 during pregnancy & records audit event
    blocked = client.post(
        "/api/obligations/OBL-102/verify",
        json={
            "clinician_name": "Dr. Layla Al-Hashimi (OB-GYN)",
            "closure_evidence": "Attempted premature closure during pregnancy.",
        },
    )
    assert blocked.status_code == 409
    assert "contraindicated" in blocked.json()["detail"].lower()
    audit_after_block = client.get("/api/obligations").json()["audit_events"]
    assert any(
        ev["event_type"] == "CLINICAL_SAFETY_BLOCKED" and ev["obligation_id"] == "OBL-102"
        for ev in audit_after_block
    )

    # 6. Evidence-verified clinician closure for OBL-101
    verify = client.post(
        "/api/obligations/OBL-101/verify",
        json={
            "clinician_name": "Dr. Layla Al-Hashimi (OB-GYN)",
            "closure_evidence": "Repeat TSH 2.1 mIU/L verified; levothyroxine initiated.",
        },
    )
    assert verify.status_code == 200
    assert verify.json()["obligation"]["status"] == "VERIFIED_CLOSED"

    # 7. Postpartum transition wakes up deferred OBL-102
    postpartum = client.post("/api/transitions/postpartum")
    assert postpartum.status_code == 200
    pp_by_id = {o["id"]: o for o in postpartum.json()["obligations"]}
    assert pp_by_id["OBL-102"]["life_stage"] == "Postpartum"
    assert pp_by_id["OBL-102"]["status"] == "ESCALATED_FOR_REVIEW"
    assert pp_by_id["OBL-102"]["priority"] == "URGENT"

    # 8. Clinician verifies & closes OBL-102 postpartum
    verify_102 = client.post(
        "/api/obligations/OBL-102/verify",
        json={
            "clinician_name": "Dr. Mariam Al-Suwaidi (Postpartum OB-GYN)",
            "closure_evidence": "Postpartum MMR administered prior to discharge.",
        },
    )
    assert verify_102.status_code == 200
    assert verify_102.json()["obligation"]["status"] == "VERIFIED_CLOSED"

    # 9. Streaming SSE transition emits deterministic_complete + complete events with zero PHI
    stream_resp = client.post("/api/transitions/pregnancy/stream")
    assert stream_resp.status_code == 200
    assert "text/event-stream" in stream_resp.headers["content-type"]
    body = stream_resp.text
    assert "event: deterministic_complete" in body
    assert "event: complete" in body

    # 10. Evidence endpoint serves seeded FHIR evidence records from DB
    ev_resp = client.get("/api/obligations/OBL-101/evidence")
    assert ev_resp.status_code == 200
    ev_list = ev_resp.json()["evidence"]
    assert len(ev_list) >= 1
    assert ev_list[0]["id"] == "EVD-TSH-2026-10"

    # 11. Manual / Table import ingests new obligations + linked evidence
    imp_resp = client.post(
        "/api/obligations/import",
        json={
            "source_label": "CSV / Table Import",
            "obligations": [
                {
                    "title": "Gestational Diabetes OGTT Follow-up",
                    "rationale": "Elevated 1-hour glucose challenge; requires 3-hour OGTT.",
                    "priority": "HIGH",
                    "life_stage": "Antenatal (Trimester 1)",
                    "incoming_evidence_result": "3-hour OGTT normal",
                }
            ],
        },
    )
    assert imp_resp.status_code == 200
    assert imp_resp.json()["imported_count"] == 1
    assert any(o["id"] == "OBL-103" for o in imp_resp.json()["obligations"])
    ev_103 = client.get("/api/obligations/OBL-103/evidence")
    assert ev_103.status_code == 200
    assert len(ev_103.json()["evidence"]) == 1

    # 12. Reset restores initial state
    final_reset = client.post("/api/demo/reset")
    assert final_reset.status_code == 200
    assert all(o["status"] == "OPEN" for o in final_reset.json()["obligations"])


def test_multi_patient_cohort_and_transitions(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    client = TestClient(app)
    client.post("/api/demo/reset")

    cohort = client.get("/api/patients")
    assert cohort.status_code == 200
    cohort_json = cohort.json()
    patients = cohort_json["patients"]
    assert [p["patient_id"] for p in patients] == [
        "PAT-AE-4092",
        "PAT-AE-5180",
        "PAT-AE-6304",
        "PAT-AE-7415",
        "PAT-AE-8529",
    ]
    assert cohort_json["cohort_totals"]["total_patients"] == 5

    fatima_initial = client.get("/api/obligations?patient_id=PAT-AE-5180")
    assert fatima_initial.status_code == 200
    assert {o["id"] for o in fatima_initial.json()["obligations"]} == {"OBL-201", "OBL-202"}

    fatima_preg = client.post("/api/transitions/pregnancy?patient_id=PAT-AE-5180")
    assert fatima_preg.status_code == 200
    fp = fatima_preg.json()
    by_id = {o["id"]: o for o in fp["obligations"]}
    assert by_id["OBL-201"]["status"] == "ESCALATED_FOR_REVIEW"
    assert by_id["OBL-201"]["priority"] == "URGENT"
    assert by_id["OBL-202"]["status"] == "DEFERRED_TO_POSTPARTUM"
    payload_str = json.dumps(fp["privacy_report"]["payload"])
    assert "Fatima" not in payload_str
    assert "PAT-AE-5180" not in payload_str

    sara_preg = client.post("/api/transitions/pregnancy?patient_id=PAT-AE-6304")
    assert sara_preg.status_code == 200
    sara_by_id = {o["id"]: o for o in sara_preg.json()["obligations"]}
    assert sara_by_id["OBL-301"]["status"] == "ESCALATED_FOR_REVIEW"
    assert sara_by_id["OBL-301"]["priority"] == "URGENT"
    assert sara_by_id["OBL-302"]["status"] == "DEFERRED_TO_POSTPARTUM"

    # Scalable cohort search, triage filter, pagination, and global cohort totals
    search_resp = client.get("/api/patients?q=Fatima")
    assert search_resp.status_code == 200
    assert [p["patient_id"] for p in search_resp.json()["patients"]] == ["PAT-AE-5180"]

    urgent_resp = client.get("/api/patients?triage=urgent")
    assert urgent_resp.status_code == 200
    urgent_ids = {p["patient_id"] for p in urgent_resp.json()["patients"]}
    assert {"PAT-AE-5180", "PAT-AE-6304"}.issubset(urgent_ids)
    assert urgent_resp.json()["cohort_totals"]["total_urgent"] >= 2

    page_resp = client.get("/api/patients?limit=1&offset=1")
    assert page_resp.status_code == 200
    assert len(page_resp.json()["patients"]) == 1
    assert page_resp.json()["total"] == 5
    assert page_resp.json()["has_more"] is True

    # Rule-version dispatch scales automatically to newly imported patients without hardcoded IDs
    new_patient_import = client.post(
        "/api/obligations/import",
        json={
            "source_label": "Multi-Patient Scalability Test",
            "obligations": [
                {
                    "patient_id": "PAT-AE-7777",
                    "patient_name": "Nadia Al-Kaabi (Synthetic)",
                    "title": "Subclinical Hypothyroidism Follow-up (TSH 5.1 mIU/L)",
                    "rationale": "Elevated TSH requires first-trimester escalation.",
                    "rule_version": "RB-THYROID-v1.4.0",
                    "priority": "HIGH",
                }
            ],
        },
    )
    assert new_patient_import.status_code == 200
    nadia_preg = client.post("/api/transitions/pregnancy?patient_id=PAT-AE-7777")
    assert nadia_preg.status_code == 200
    nadia_obl = nadia_preg.json()["obligations"][0]
    assert nadia_obl["status"] == "ESCALATED_FOR_REVIEW"
    assert nadia_obl["priority"] == "URGENT"

    # Explain endpoint: returns de-identified clinical explanation & appends AI_EXPLANATION_GENERATED audit
    explain_resp = client.post("/api/obligations/OBL-101/explain")
    assert explain_resp.status_code == 200
    ex = explain_resp.json()
    assert ex["obligation_id"] == "OBL-101"
    assert ex["headline"]
    assert ex["explanation"]
    assert isinstance(ex["key_points"], list) and len(ex["key_points"]) >= 2
    assert ex["privacy_report"]["phi_check_passed"] is True
    assert "Amina" not in json.dumps(ex["privacy_report"]["payload"])
    assert any(ev["event_type"] == "AI_EXPLANATION_GENERATED" for ev in ex["audit_events"])

    missing_explain = client.post("/api/obligations/OBL-999/explain")
    assert missing_explain.status_code == 404

    stream_resp = client.post("/api/obligations/OBL-101/explain/stream")
    assert stream_resp.status_code == 200
    assert stream_resp.headers["content-type"].startswith("text/event-stream")
    assert "event: firewall_verified" in stream_resp.text
    assert "event: complete" in stream_resp.text
    assert '"phi_check_passed": true' in stream_resp.text

    missing_stream = client.post("/api/obligations/OBL-999/explain/stream")
    assert missing_stream.status_code == 404

    # ElevenLabs neural TTS endpoint: 404 on unknown ID, 503 when key unset, 200 audio/mpeg when configured
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    missing_audio = client.post(
        "/api/obligations/OBL-999/explain/audio",
        json={"text": "TSH of 4.8 mIU/L requires repeat follow-up."},
    )
    assert missing_audio.status_code == 404

    unconfigured_audio = client.post(
        "/api/obligations/OBL-101/explain/audio",
        json={"text": "TSH of 4.8 mIU/L requires repeat follow-up."},
    )
    assert unconfigured_audio.status_code == 503

    captured_tts: list[str] = []

    def fake_elevenlabs_tts(text: str) -> bytes:
        captured_tts.append(text)
        return b"ID3-FAKE-ELEVENLABS-MP3"

    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-elevenlabs-key")
    monkeypatch.setattr("api.index.synthesize_elevenlabs_audio", fake_elevenlabs_tts)

    audio_resp = client.post(
        "/api/obligations/OBL-101/explain/audio",
        json={"text": "Amina Al-Mansoori (PAT-AE-4092) has elevated TSH 4.8 mIU/L."},
    )
    assert audio_resp.status_code == 200
    assert audio_resp.headers["content-type"].startswith("audio/mpeg")
    assert audio_resp.content == b"ID3-FAKE-ELEVENLABS-MP3"
    assert len(captured_tts) == 1
    assert "Amina" not in captured_tts[0]
    assert "PAT-AE-4092" not in captured_tts[0]
    assert "4.8 mIU/L" in captured_tts[0]

    client.post("/api/demo/reset")


def test_patient_reconciliation_questionnaire_and_submit(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    client = TestClient(app)
    client.post("/api/demo/reset")

    q_resp = client.post("/api/patients/PAT-AE-4092/reconcile-questions")
    assert q_resp.status_code == 200
    q_data = q_resp.json()
    assert q_data["patient_id"] == "PAT-AE-4092"
    assert q_data["privacy_report"]["phi_check_passed"] is True
    assert "Amina" not in json.dumps(q_data["privacy_report"]["payload"])
    assert "PAT-AE-4092" not in json.dumps(q_data["privacy_report"]["payload"])
    assert len(q_data["questions"]) == 3
    assert q_data["questions"][0]["id"] == "pregnancy_stage"
    assert "8th week" in q_data["questions"][0]["question"]
    assert q_data["questions"][1]["id"] == "medications"
    assert q_data["questions"][2]["id"] == "scenario_specific"

    stream_resp = client.post("/api/patients/PAT-AE-4092/reconcile-questions/stream")
    assert stream_resp.status_code == 200
    assert stream_resp.headers["content-type"].startswith("text/event-stream")
    assert "event: firewall_verified" in stream_resp.text
    assert "event: complete" in stream_resp.text
    assert '"phi_check_passed": true' in stream_resp.text

    missing = client.post("/api/patients/PAT-UNKNOWN-999/reconcile-questions")
    assert missing.status_code == 404

    submit_resp = client.post(
        "/api/patients/PAT-AE-4092/reconcile-submit",
        json={
            "pregnancy_stage_answer": "8th week gestation (scan updated from 5th week record)",
            "target_life_stage": "Antenatal (Trimester 1)",
            "medications_answer": "Started levothyroxine 25 mcg externally",
            "scenario_answer": "No external repeat TSH yet — keep OBL-101 urgent",
            "additional_info": "Patient brought ultrasound report confirming 8w2d CRL.",
        },
    )
    assert submit_resp.status_code == 200
    submit_data = submit_resp.json()
    assert submit_data["target_life_stage"] == "Antenatal (Trimester 1)"
    assert submit_data["transition_triggered"] == "FHIR_PREGNANCY_CONFIRMED"
    assert submit_data["transition_result"] is not None

    by_id = {item["id"]: item for item in submit_data["obligations"]}
    assert by_id["OBL-101"]["status"] == "ESCALATED_FOR_REVIEW"
    assert by_id["OBL-101"]["priority"] == "URGENT"
    assert by_id["OBL-102"]["status"] == "DEFERRED_TO_POSTPARTUM"

    event_types = [ev["event_type"] for ev in submit_data["audit_events"]]
    assert "CLINICAL_SCENARIO_RECONCILED" in event_types
    reconcile_ev = next(
        ev
        for ev in submit_data["audit_events"]
        if ev["event_type"] == "CLINICAL_SCENARIO_RECONCILED"
    )
    assert "8th week gestation" in reconcile_ev["summary"]
    assert "levothyroxine 25 mcg" in reconcile_ev["summary"]

    client.post("/api/demo/reset")


def test_five_evidence_clinical_gaps_end_to_end(monkeypatch):
    """End-to-end verification of all 5 evidence-backed reproductive health continuity gaps."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    client = TestClient(app)
    client.post("/api/demo/reset")

    # ── GAP 1: Diabetes testing after gestational diabetes (PAT-AE-5180 / OBL-201) ──
    pp_gdm = client.post(
        "/api/transitions/postpartum?patient_id=PAT-AE-5180",
        json={"delivery_date": "2026-10-01", "discharge_diagnoses": ["GDM_CONFIRMED"]},
    )
    assert pp_gdm.status_code == 200
    gdm_obl = next(o for o in pp_gdm.json()["obligations"] if o["id"] == "OBL-201")
    assert gdm_obl["protocol_code"] == "ADA-2026-OGTT-4-12W"
    assert gdm_obl["due_window_start"] == "2026-10-29"
    assert gdm_obl["due_window_end"] == "2026-12-24"
    assert gdm_obl["closure_policy"] == "COMPLETED_TEST_NOT_BOOKING"

    # Local protocol override supports delivery-admission OGTT window
    pp_admission = client.post(
        "/api/transitions/postpartum?patient_id=PAT-AE-5180",
        json={
            "delivery_date": "2026-10-01",
            "protocol_override": "DELIVERY_ADMISSION_OGTT",
        },
    )
    assert pp_admission.status_code == 200
    adm_obl = next(o for o in pp_admission.json()["obligations"] if o["id"] == "OBL-201")
    assert adm_obl["protocol_code"] == "LOCAL-DELIVERY-ADMISSION-OGTT"
    assert adm_obl["due_window_start"] == "2026-10-01"
    assert adm_obl["due_window_end"] == "2026-10-03"

    # Booked appointment alone leaves testing open (HTTP 409)
    gdm_booked = client.post(
        "/api/obligations/OBL-201/verify",
        json={
            "clinician_name": "Dr. Noura Al-Ketbi (Endocrinology)",
            "closure_evidence": "75g OGTT appointment booked for 6 weeks postpartum.",
        },
    )
    assert gdm_booked.status_code == 409
    assert "booked appointment" in gdm_booked.json()["detail"].lower()

    # Completed 75g OGTT closes OBL-201 AND spawns separate Result Review child obligation
    gdm_done = client.post(
        "/api/obligations/OBL-201/verify",
        json={
            "clinician_name": "Dr. Noura Al-Ketbi (Endocrinology)",
            "closure_evidence": "75g OGTT completed: fasting 91 mg/dL, 2-hour 132 mg/dL (normal).",
        },
    )
    assert gdm_done.status_code == 200
    assert gdm_done.json()["obligation"]["status"] == "VERIFIED_CLOSED"
    child_rev = gdm_done.json()["spawned_obligation"]
    assert child_rev is not None
    assert child_rev["id"] == "OBL-201-REV"
    assert child_rev["parent_obligation_id"] == "OBL-201"
    assert child_rev["closure_policy"] == "RESULT_REVIEW_SIGNOFF"

    # ── GAP 2: Postpartum Blood Pressure follow-up (PAT-AE-6304 / OBL-301) ──
    pp_bp_remote = client.post(
        "/api/transitions/postpartum?patient_id=PAT-AE-6304",
        json={"delivery_date": "2026-10-01", "discharge_diagnoses": ["GESTATIONAL_HYPERTENSION"]},
    )
    assert pp_bp_remote.status_code == 200
    bp_remote = next(o for o in pp_bp_remote.json()["obligations"] if o["id"] == "OBL-301")
    assert bp_remote["protocol_code"] == "POSTPARTUM-BP-10D-REMOTE"
    assert bp_remote["due_window_end"] == "2026-10-11"

    pp_bp_severe = client.post(
        "/api/transitions/postpartum?patient_id=PAT-AE-6304",
        json={
            "delivery_date": "2026-10-01",
            "discharge_diagnoses": ["SEVERE_POSTPARTUM_HYPERTENSION"],
        },
    )
    assert pp_bp_severe.status_code == 200
    bp_severe = next(o for o in pp_bp_severe.json()["obligations"] if o["id"] == "OBL-301")
    assert bp_severe["protocol_code"] == "SMFM-72H-SEVERE-HTN"
    assert bp_severe["due_window_end"] == "2026-10-04"

    # Booking-only visit rejected (HTTP 409)
    bp_booked = client.post(
        "/api/obligations/OBL-301/verify",
        json={
            "clinician_name": "Dr. Layla Al-Hashimi (MFM)",
            "closure_evidence": "Office blood pressure appointment scheduled next Thursday.",
        },
    )
    assert bp_booked.status_code == 409

    # Severe BP reading logged via evidence auto-escalates deterministically
    bp_ev = client.post(
        "/api/obligations/OBL-301/evidence",
        json={
            "fhir_resource_type": "Observation",
            "code_display": "Remote Postpartum Blood Pressure",
            "result_value": "BP 168/112 mmHg with severe headache",
            "source_facility": "Danat Al Emarat Remote BP Program",
        },
    )
    assert bp_ev.status_code == 200
    assert bp_ev.json()["safety_action"]["event_type"] == "CLINICAL_SAFETY_ESCALATED"
    assert (
        bp_ev.json()["obligation"]["owner"] == "Urgent Obstetric / Hypertension Escalation Protocol"
    )

    # Attempting closure with severe unstabilized BP returns 409
    bp_severe_close = client.post(
        "/api/obligations/OBL-301/verify",
        json={
            "clinician_name": "Dr. Layla Al-Hashimi (MFM)",
            "closure_evidence": "Home BP 164/110 mmHg logged via text.",
        },
    )
    assert bp_severe_close.status_code == 409

    # Verified normotensive BP reading closes cleanly
    bp_ok = client.post(
        "/api/obligations/OBL-301/verify",
        json={
            "clinician_name": "Dr. Layla Al-Hashimi (MFM)",
            "closure_evidence": "Remote BP 122/78 mmHg verified after escalation protocol completed; stabilized.",
        },
    )
    assert bp_ok.status_code == 200
    assert bp_ok.json()["obligation"]["status"] == "VERIFIED_CLOSED"

    # ── GAP 3: Perinatal depression & anxiety follow-up (PAT-AE-7415 / OBL-401) ──
    # Questionnaire score alone cannot close (HTTP 409)
    mh_score_only = client.post(
        "/api/obligations/OBL-401/verify",
        json={
            "clinician_name": "Dr. Huda Al-Mheiri (OB-GYN)",
            "closure_evidence": "Repeat EPDS score 14 documented in chart.",
        },
    )
    assert mh_score_only.status_code == 409
    assert "screening signal" in mh_score_only.json()["detail"].lower()

    # Safety concern routes immediately through deterministic urgent pathway
    mh_safety_ev = client.post(
        "/api/obligations/OBL-401/evidence",
        json={
            "fhir_resource_type": "QuestionnaireResponse",
            "code_display": "EPDS Follow-up Safety Screen",
            "result_value": "EPDS Item 10 positive — active self-harm safety concern reported",
            "source_facility": "Tawam OB-GYN Clinic",
        },
    )
    assert mh_safety_ev.status_code == 200
    assert mh_safety_ev.json()["safety_action"]["event_type"] == "CLINICAL_SAFETY_ESCALATED"
    assert (
        mh_safety_ev.json()["obligation"]["owner"]
        == "Approved Urgent Perinatal Safety & Psychiatry Pathway"
    )

    # Verified clinical assessment + safety stabilization closes OBL-401 & spawns monitoring child
    mh_closed = client.post(
        "/api/obligations/OBL-401/verify",
        json={
            "clinician_name": "Dr. Huda Al-Mheiri (Perinatal Psychiatry)",
            "closure_evidence": (
                "Urgent psychiatric evaluation and clinical assessment completed; safety plan "
                "established and 4-week psychotherapy follow-up monitoring plan initiated."
            ),
        },
    )
    assert mh_closed.status_code == 200
    assert mh_closed.json()["obligation"]["status"] == "VERIFIED_CLOSED"
    assert mh_closed.json()["spawned_obligation"]["id"] == "OBL-401-MON"

    # ── GAP 4: Abnormal cervical screening (PAT-AE-7415 / OBL-402) ──
    preg_mariam = client.post("/api/transitions/pregnancy?patient_id=PAT-AE-7415")
    assert preg_mariam.status_code == 200
    cerv_obl = next(o for o in preg_mariam.json()["obligations"] if o["id"] == "OBL-402")
    assert cerv_obl["status"] == "ESCALATED_FOR_REVIEW"
    assert cerv_obl["protocol_code"] == "DOH-AD-CERVICAL-PREG"

    # Contraindicated ECC during pregnancy blocked (HTTP 409)
    cerv_ecc_blocked = client.post(
        "/api/obligations/OBL-402/verify",
        json={
            "clinician_name": "Dr. Aisha Al-Shamsi (OB-GYN)",
            "closure_evidence": "Endocervical curettage performed during Trimester 1.",
        },
    )
    assert cerv_ecc_blocked.status_code == 409
    assert "contraindicated" in cerv_ecc_blocked.json()["detail"].lower()

    # Antenatal colposcopy excluding invasion closes triage & spawns deferred postpartum child
    cerv_triage_ok = client.post(
        "/api/obligations/OBL-402/verify",
        json={
            "clinician_name": "Dr. Aisha Al-Shamsi (OB-GYN)",
            "closure_evidence": (
                "Antenatal colposcopy completed: invasive disease excluded, ECC deferred; "
                "reconciled under Abu Dhabi DoH / ASCCP algorithm."
            ),
        },
    )
    assert cerv_triage_ok.status_code == 200
    cerv_pp_child = cerv_triage_ok.json()["spawned_obligation"]
    assert cerv_pp_child is not None
    assert cerv_pp_child["id"] == "OBL-402-PP"
    assert cerv_pp_child["status"] == "DEFERRED_TO_POSTPARTUM"

    # Postpartum child cannot close during pregnancy, wakes up after delivery
    cerv_premature = client.post(
        "/api/obligations/OBL-402-PP/verify",
        json={
            "clinician_name": "Dr. Aisha Al-Shamsi (OB-GYN)",
            "closure_evidence": "Attempted premature closure during pregnancy.",
        },
    )
    assert cerv_premature.status_code == 409

    pp_mariam = client.post(
        "/api/transitions/postpartum?patient_id=PAT-AE-7415",
        json={"delivery_date": "2026-10-01"},
    )
    assert pp_mariam.status_code == 200
    cerv_pp_active = next(o for o in pp_mariam.json()["obligations"] if o["id"] == "OBL-402-PP")
    assert cerv_pp_active["status"] == "ESCALATED_FOR_REVIEW"
    assert cerv_pp_active["due_window_start"] == "2026-11-12"
    assert cerv_pp_active["due_window_end"] == "2026-12-24"

    # ── GAP 5: Endometriosis evaluation (PAT-AE-8529 / OBL-501) ──
    # Normal pelvic ultrasound logged via evidence preserves referral signal
    endo_ev = client.post(
        "/api/obligations/OBL-501/evidence",
        json={
            "fhir_resource_type": "DiagnosticReport",
            "code_display": "Transvaginal Pelvic Ultrasound",
            "result_value": "Normal pelvic ultrasound; no adnexal masses seen",
            "source_facility": "Yas Island Family Medicine",
        },
    )
    assert endo_ev.status_code == 200
    assert endo_ev.json()["safety_action"]["event_type"] == "CLINICAL_SIGNAL_PRESERVED"

    # Attempting to close OBL-501 with only a normal ultrasound/exam returns 409 (NICE NG73)
    endo_normal_blocked = client.post(
        "/api/obligations/OBL-501/verify",
        json={
            "clinician_name": "Dr. Salma Al-Qubaisi (Primary Care)",
            "closure_evidence": "Normal pelvic ultrasound and normal pelvic examination; reassuring.",
        },
    )
    assert endo_normal_blocked.status_code == 409
    assert "nice ng73" in endo_normal_blocked.json()["detail"].lower()

    # Documented specialist gynecology endometriosis pathway review closes cleanly
    endo_closed = client.post(
        "/api/obligations/OBL-501/verify",
        json={
            "clinician_name": "Dr. Salma Al-Qubaisi (Complex Gynecology)",
            "closure_evidence": (
                "Specialist gynecology endometriosis clinic review completed despite prior normal "
                "ultrasound; approved diagnostic pathway and pelvic MRI ordered."
            ),
        },
    )
    assert endo_closed.status_code == 200
    assert endo_closed.json()["obligation"]["status"] == "VERIFIED_CLOSED"

    client.post("/api/demo/reset")
