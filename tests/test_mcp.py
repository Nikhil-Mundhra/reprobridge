import json

import pytest

from api.mcp_server import call_mcp_tool, handle_mcp_jsonrpc, list_mcp_tools


def test_mcp_tools_list_exposes_only_governed_tools():
    tools = list_mcp_tools()
    names = {t["name"] for t in tools}
    assert names == {
        "neon_get_deidentified_obligations",
        "neon_get_rule_catalog",
        "neon_get_audit_summary",
        "neon_record_agent_brief",
    }
    # Ensure no tool allows raw PHI reads or autonomous obligation closure.
    for tool in tools:
        assert "close" not in tool["name"]
        assert tool["data_boundary"] != "RAW_PHI"


def test_mcp_get_deidentified_obligations_strips_phi(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    res = call_mcp_tool("neon_get_deidentified_obligations", {"include_closed": True})
    serialized = json.dumps(res)
    assert res["residency_policy"] == "UAE_PHI_LOCAL_ONLY"
    assert res["count"] >= 2
    assert "Amina" not in serialized
    assert "PAT-AE-4092" not in serialized
    assert "Malaffi" not in serialized


def test_mcp_jsonrpc_list_and_call(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)

    list_resp = handle_mcp_jsonrpc({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert list_resp["id"] == 1
    assert len(list_resp["result"]["tools"]) == 4

    call_resp = handle_mcp_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "neon_get_rule_catalog", "arguments": {}},
        }
    )
    assert call_resp["result"]["isError"] is False
    rules = call_resp["result"]["content"][0]["json"]["rules"]
    assert len(rules) == 8
    rule_versions = {r["rule_version"] for r in rules}
    assert {
        "RB-THYROID-v1.4.0",
        "RB-IMMUNE-v1.2.1",
        "RB-METABOLIC-v2.0.0",
        "RB-PREECLAMPSIA-v2.0.0",
        "RB-PERINATAL-MH-v1.0.0",
        "RB-CERVICAL-v1.0.0",
        "RB-ENDO-v1.0.0",
    }.issubset(rule_versions)


def test_mcp_unknown_tool_returns_error():
    resp = handle_mcp_jsonrpc(
        {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "neon_dump_raw_phi", "arguments": {}},
        }
    )
    assert "error" in resp
    assert resp["error"]["code"] == -32602


def test_mcp_record_agent_brief_scrubs_accidental_phi(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    res = call_mcp_tool(
        "neon_record_agent_brief",
        {"summary": "Brief for PAT-AE-4092 and 784-1990-1234567-1", "model": "test-model"},
    )
    assert res["recorded"] is True
    with pytest.raises(ValueError):
        call_mcp_tool("neon_record_agent_brief", {"summary": "no"})
