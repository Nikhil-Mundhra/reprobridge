import json
import os
from collections.abc import Iterator
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.db import (
    append_audit_event,
    check_database_health,
    list_audit_events,
    list_obligations,
    reset_obligations,
    update_obligation,
)
from api.mcp_server import call_mcp_tool, handle_mcp_jsonrpc, list_mcp_tools
from api.openrouter import DEFAULT_OPENROUTER_MODEL, stream_deidentified_brief
from api.workflow import (
    apply_uae_privacy_firewall,
    detect_open_obligations,
    evaluate_life_stage_transition,
    transition_workflow,
)

app = FastAPI(
    title="ReproBridge API",
    description="Continuous, Evidence-Verified Reproductive & Preventive Care Coordination",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class VerifyClosureRequest(BaseModel):
    clinician_name: str = Field(..., min_length=2, max_length=128)
    closure_evidence: str = Field(..., min_length=4, max_length=1000)


def _run_transition(event_type: str) -> dict[str, Any]:
    current = list_obligations()
    result = transition_workflow.invoke(
        {
            "event_type": event_type,
            "obligations": current,
            "reassessed_updates": [],
            "privacy_report": {},
            "trace": [],
            "agent_summary": "",
            "specialist_handoff": "",
            "ai_metadata": {},
        }
    )
    for patch in result["reassessed_updates"]:
        patch_copy = dict(patch)
        obl_id = patch_copy.pop("id")
        updated = update_obligation(obl_id, patch_copy)
        if updated:
            append_audit_event(
                event_type="LIFE_STAGE_TRANSITION",
                actor="Deterministic Rule Engine",
                summary=(
                    f"{obl_id} transitioned under {event_type} to "
                    f"{updated['status']} ({updated['priority']})."
                ),
                obligation_id=obl_id,
            )

    # Record the de-identified AI brief via the governed Neon MCP tool layer.
    call_mcp_tool(
        "neon_record_agent_brief",
        {
            "summary": (
                f"De-identified brief generated for {event_type} "
                f"({result['ai_metadata'].get('mode')}, "
                f"case {result['privacy_report']['payload']['case_token']}); zero PHI transmitted."
            ),
            "model": result["ai_metadata"].get("model", "deterministic"),
        },
    )

    return {
        "event_type": event_type,
        "agent_summary": result["agent_summary"],
        "specialist_handoff": result["specialist_handoff"],
        "ai_metadata": result["ai_metadata"],
        "privacy_report": result["privacy_report"],
        "trace": result["trace"],
        "obligations": list_obligations(),
        "audit_events": list_audit_events(),
    }


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _stream_transition_events(event_type: str) -> Iterator[str]:
    """Run deterministic steps first (yielding immediately), then stream OpenRouter tokens."""
    current = list_obligations()
    state: dict[str, Any] = {
        "event_type": event_type,
        "obligations": current,
        "reassessed_updates": [],
        "privacy_report": {},
        "trace": [],
        "agent_summary": "",
        "specialist_handoff": "",
        "ai_metadata": {},
    }

    # Nodes 1-3: Deterministic clinical rules + UAE Privacy Firewall
    state.update(detect_open_obligations(state))  # type: ignore[arg-type]
    state.update(evaluate_life_stage_transition(state))  # type: ignore[arg-type]
    state.update(apply_uae_privacy_firewall(state))  # type: ignore[arg-type]

    # Persist deterministic obligation updates immediately
    for patch in state["reassessed_updates"]:
        patch_copy = dict(patch)
        obl_id = patch_copy.pop("id")
        updated = update_obligation(obl_id, patch_copy)
        if updated:
            append_audit_event(
                event_type="LIFE_STAGE_TRANSITION",
                actor="Deterministic Rule Engine",
                summary=(
                    f"{obl_id} transitioned under {event_type} to "
                    f"{updated['status']} ({updated['priority']})."
                ),
                obligation_id=obl_id,
            )

    yield _sse(
        "deterministic_complete",
        {
            "event_type": event_type,
            "obligations": list_obligations(),
            "audit_events": list_audit_events(),
            "privacy_report": state["privacy_report"],
            "trace": state["trace"],
        },
    )

    # Node 4: Stream de-identified synthesis from OpenRouter (Gemma 4 + free fallbacks)
    synthesis: dict[str, Any] | None = None
    for chunk in stream_deidentified_brief(state["privacy_report"]["payload"]):
        if chunk["type"] == "token":
            yield _sse("token", {"delta": chunk["delta"], "model": chunk["model"]})
        elif chunk["type"] == "done":
            synthesis = chunk["result"]

    if synthesis is None:
        synthesis = {
            "mode": "deterministic_fallback",
            "provider": "local-deterministic",
            "model": "none",
            "fallback_reason": "No synthesis result produced",
            "summary": "Deterministic clinical transition rules applied successfully.",
            "specialist_handoff": "• Review updated obligations on the Clinical Obligation Passport.",
        }

    final_trace = list(state["trace"])
    final_trace.append(
        {
            "node": "synthesize_coordination_brief",
            "execution": "agentic" if synthesis["mode"] == "openrouter" else "deterministic_fallback",
            "phi_exposed": False,
            "detail": (
                "Drafted clinician handoff brief via OpenRouter for OB-GYN sign-off."
                if synthesis["mode"] == "openrouter"
                else "Drafted clinician handoff brief via local deterministic fallback."
            ),
        }
    )

    ai_metadata = {
        "mode": synthesis["mode"],
        "provider": synthesis["provider"],
        "model": synthesis["model"],
        "fallback_reason": synthesis["fallback_reason"],
    }

    call_mcp_tool(
        "neon_record_agent_brief",
        {
            "summary": (
                f"De-identified brief generated for {event_type} "
                f"({ai_metadata['mode']}, "
                f"case {state['privacy_report']['payload']['case_token']}); zero PHI transmitted."
            ),
            "model": ai_metadata.get("model", "deterministic"),
        },
    )

    yield _sse(
        "complete",
        {
            "event_type": event_type,
            "agent_summary": synthesis["summary"],
            "specialist_handoff": synthesis["specialist_handoff"],
            "ai_metadata": ai_metadata,
            "privacy_report": state["privacy_report"],
            "trace": final_trace,
            "obligations": list_obligations(),
            "audit_events": list_audit_events(),
        },
    )


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "reprobridge-api",
        "residency_policy": "UAE_PHI_LOCAL_ONLY",
        "ai_provider": {
            "provider": "openrouter",
            "configured": bool(os.getenv("OPENROUTER_API_KEY", "").strip()),
            "model": os.getenv("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL),
        },
        "database": check_database_health(),
    }


@app.get("/api/obligations")
def get_obligations():
    return {
        "obligations": list_obligations(),
        "audit_events": list_audit_events(),
    }


@app.post("/api/transitions/pregnancy")
def trigger_pregnancy_transition():
    return _run_transition("FHIR_PREGNANCY_CONFIRMED")


@app.post("/api/transitions/pregnancy/stream")
def stream_pregnancy_transition():
    return StreamingResponse(
        _stream_transition_events("FHIR_PREGNANCY_CONFIRMED"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/transitions/postpartum")
def trigger_postpartum_transition():
    return _run_transition("FHIR_DELIVERY_POSTPARTUM")


@app.post("/api/transitions/postpartum/stream")
def stream_postpartum_transition():
    return StreamingResponse(
        _stream_transition_events("FHIR_DELIVERY_POSTPARTUM"),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/obligations/{obligation_id}/verify")
def verify_obligation_closure(obligation_id: str, body: VerifyClosureRequest):
    existing = next((o for o in list_obligations() if o["id"] == obligation_id), None)
    if existing is None:
        raise HTTPException(status_code=404, detail="Clinical obligation not found")
    if existing["status"] == "DEFERRED_TO_POSTPARTUM":
        raise HTTPException(
            status_code=409,
            detail=(
                "Clinical safety guard: live-vaccine obligation is contraindicated during "
                "pregnancy and cannot be closed until the Postpartum transition is triggered."
            ),
        )

    updated = update_obligation(
        obligation_id,
        {
            "status": "VERIFIED_CLOSED",
            "verified_by": body.clinician_name,
            "closure_evidence": body.closure_evidence,
        },
    )
    append_audit_event(
        event_type="EVIDENCE_VERIFIED_CLOSURE",
        actor=body.clinician_name,
        summary=f"Closed {obligation_id} with verified evidence: {body.closure_evidence}",
        obligation_id=obligation_id,
    )
    return {
        "obligation": updated,
        "audit_events": list_audit_events(),
    }


@app.get("/api/mcp/tools")
def get_mcp_tools():
    """List governed Neon Postgres MCP tools exposed to AI agents."""
    return {
        "residency_policy": "UAE_PHI_LOCAL_ONLY",
        "tools": list_mcp_tools(),
    }


@app.post("/api/mcp")
def mcp_jsonrpc(payload: dict[str, Any]):
    """JSON-RPC 2.0 endpoint for governed Neon Postgres MCP tool execution."""
    return handle_mcp_jsonrpc(payload)


@app.post("/api/demo/reset")
def reset_demo():
    return reset_obligations()
