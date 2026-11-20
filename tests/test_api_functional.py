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

    # 5. Clinical safety guard blocks closing OBL-102 during pregnancy
    blocked = client.post(
        "/api/obligations/OBL-102/verify",
        json={
            "clinician_name": "Dr. Layla Al-Hashimi (OB-GYN)",
            "closure_evidence": "Attempted premature closure during pregnancy.",
        },
    )
    assert blocked.status_code == 409
    assert "contraindicated" in blocked.json()["detail"].lower()

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
