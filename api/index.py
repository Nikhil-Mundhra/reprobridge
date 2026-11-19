from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.db import (
    append_audit_event,
    check_database_health,
    list_audit_events,
    list_obligations,
    reset_obligations,
    update_obligation,
)
from api.workflow import transition_workflow

app = FastAPI(
    title="ReproBridge API",
    description="Continuous, Evidence-Verified Reproductive & Preventive Care Coordination",
    version="0.1.0",
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


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "reprobridge-api",
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
    current = list_obligations()
    result = transition_workflow.invoke(
        {
            "event_type": "FHIR_PREGNANCY_CONFIRMED",
            "obligations": current,
            "reassessed_updates": [],
            "trace": [],
            "agent_summary": "",
        }
    )
    for patch in result["reassessed_updates"]:
        obl_id = patch.pop("id")
        updated = update_obligation(obl_id, patch)
        if updated:
            append_audit_event(
                event_type="LIFE_STAGE_TRANSITION",
                actor="LangGraph Orchestrator",
                summary=f"{obl_id} transitioned to {updated['status']} ({updated['priority']}).",
                obligation_id=obl_id,
            )

    return {
        "agent_summary": result["agent_summary"],
        "trace": result["trace"],
        "obligations": list_obligations(),
        "audit_events": list_audit_events(),
    }


@app.post("/api/obligations/{obligation_id}/verify")
def verify_obligation_closure(obligation_id: str, body: VerifyClosureRequest):
    updated = update_obligation(
        obligation_id,
        {
            "status": "VERIFIED_CLOSED",
            "verified_by": body.clinician_name,
            "closure_evidence": body.closure_evidence,
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Clinical obligation not found")
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


@app.post("/api/demo/reset")
def reset_demo():
    return reset_obligations()
