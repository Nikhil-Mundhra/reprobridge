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
    ]
    assert cohort_json["cohort_totals"]["total_patients"] == 3

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
    assert page_resp.json()["total"] == 3
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
