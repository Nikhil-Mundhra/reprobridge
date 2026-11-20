"""Governed MCP (Model Context Protocol) tool layer for Neon Postgres access.

This module defines the ONLY data-access surface exposed to AI agents:
- Read tools automatically apply the UAE PHI De-Identification Firewall (`api.privacy`),
  so external LLMs never receive raw patient identifiers, names, or HIE notes.
- Write tools are restricted to non-destructive coordination notes (audit log only);
  agents CANNOT mutate clinical truth or close obligations without human sign-off.
"""

from __future__ import annotations

from typing import Any

from api.db import append_audit_event, list_audit_events, list_obligations
from api.privacy import assert_phi_free, deidentify_obligation, scrub_text_phi

RULE_CATALOG: list[dict[str, Any]] = [
    {
        "rule_version": "RB-THYROID-v1.4.0",
        "clinical_category": "subclinical_hypothyroidism_tsh_followup",
        "trigger_event": "FHIR_PREGNANCY_CONFIRMED",
        "deterministic_action": "ESCALATE_TO_URGENT_OB_REVIEW",
        "human_approval_required": True,
        "evidence_basis": "First-trimester TSH target (<2.5 mIU/L) requires clinician evaluation.",
    },
    {
        "rule_version": "RB-IMMUNE-v1.2.1",
        "clinical_category": "rubella_igg_non_immune_vaccination",
        "trigger_event": "FHIR_PREGNANCY_CONFIRMED",
        "deterministic_action": "DEFER_TO_POSTPARTUM_PATHWAY",
        "human_approval_required": True,
        "evidence_basis": "Live MMR vaccine is contraindicated during pregnancy; preserve for postpartum closure.",
    },
]

MCP_TOOLS: list[dict[str, Any]] = [
    {
        "name": "neon_get_deidentified_obligations",
        "description": (
            "Read open or all clinical obligations from Neon Postgres with all UAE PHI "
            "stripped and patient_id replaced by an ephemeral case_token."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "include_closed": {
                    "type": "boolean",
                    "description": "Include VERIFIED_CLOSED obligations (default false).",
                }
            },
        },
        "data_boundary": "UAE_DEIDENTIFIED_ONLY",
        "access_mode": "read",
    },
    {
        "name": "neon_get_rule_catalog",
        "description": "Retrieve version-controlled deterministic clinical transition rules.",
        "inputSchema": {"type": "object", "properties": {}},
        "data_boundary": "PUBLIC_CLINICAL_RULES",
        "access_mode": "read",
    },
    {
        "name": "neon_get_audit_summary",
        "description": "Retrieve de-identified governance event counts from Neon Postgres.",
        "inputSchema": {"type": "object", "properties": {}},
        "data_boundary": "UAE_DEIDENTIFIED_ONLY",
        "access_mode": "read",
    },
    {
        "name": "neon_record_agent_brief",
        "description": (
            "Append an auditable AGENT_BRIEF_GENERATED entry to Neon audit_events. "
            "Cannot close or modify clinical obligation statuses."
        ),
        "inputSchema": {
            "type": "object",
            "required": ["summary"],
            "properties": {
                "summary": {"type": "string", "minLength": 4, "maxLength": 500},
                "model": {"type": "string"},
            },
        },
        "data_boundary": "UAE_AUDIT_APPEND_ONLY",
        "access_mode": "append_audit_only",
    },
]


def list_mcp_tools() -> list[dict[str, Any]]:
    return list(MCP_TOOLS)


def call_mcp_tool(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute a governed Neon MCP tool by name."""
    args = arguments or {}

    if name == "neon_get_deidentified_obligations":
        include_closed = bool(args.get("include_closed", False))
        rows = list_obligations()
        if not include_closed:
            rows = [r for r in rows if r.get("status") != "VERIFIED_CLOSED"]
        safe_rows = [deidentify_obligation(r) for r in rows]
        result = {
            "residency_policy": "UAE_PHI_LOCAL_ONLY",
            "count": len(safe_rows),
            "obligations": safe_rows,
        }
        assert_phi_free(result)
        return result

    if name == "neon_get_rule_catalog":
        return {"rules": RULE_CATALOG}

    if name == "neon_get_audit_summary":
        events = list_audit_events()
        by_type: dict[str, int] = {}
        for ev in events:
            et = str(ev.get("event_type", "UNKNOWN"))
            by_type[et] = by_type.get(et, 0) + 1
        return {
            "total_events": len(events),
            "counts_by_type": by_type,
        }

    if name == "neon_record_agent_brief":
        raw_summary = str(args.get("summary", "")).strip()
        if len(raw_summary) < 4:
            raise ValueError("summary must be at least 4 characters")
        model = str(args.get("model", "openrouter")).strip() or "openrouter"
        safe_summary = scrub_text_phi(raw_summary)
        event = append_audit_event(
            event_type="AGENT_BRIEF_GENERATED",
            actor=f"AgentHarness ({model})",
            summary=safe_summary,
        )
        return {"recorded": True, "audit_event_id": event.get("id")}

    raise KeyError(f"Unknown MCP tool: {name}")


def handle_mcp_jsonrpc(request: dict[str, Any]) -> dict[str, Any]:
    """Minimal JSON-RPC 2.0 dispatcher for MCP `tools/list` and `tools/call`."""
    req_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    try:
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": list_mcp_tools()}}
        if method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments") or {}
            if not isinstance(tool_name, str):
                raise ValueError("params.name must be a string")
            output = call_mcp_tool(tool_name, tool_args)
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [{"type": "json", "json": output}],
                    "isError": False,
                },
            }
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    except KeyError as exc:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32602, "message": str(exc)},
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(exc)},
        }
