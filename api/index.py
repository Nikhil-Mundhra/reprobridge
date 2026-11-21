import json
import os
from collections.abc import Iterator
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.db import (
    PATIENT_COHORT_META,
    append_audit_event,
    check_database_health,
    create_evidence_record,
    create_obligation,
    list_audit_events,
    list_evidence_for_obligation,
    list_obligations,
    list_patient_summaries,
    query_patients,
    reset_obligations,
    update_obligation,
)
from api.mcp_server import call_mcp_tool, handle_mcp_jsonrpc, list_mcp_tools
from api.openrouter import (
    DEFAULT_ELEVENLABS_MODEL_ID,
    DEFAULT_OPENROUTER_MODEL,
    explain_deidentified_obligation,
    stream_deidentified_brief,
    stream_deidentified_explanation,
    synthesize_elevenlabs_audio,
)
from api.privacy import build_obligation_explain_payload, scrub_explanation_for_tts
from api.workflow import (
    TransitionState,
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
    evidence_id: str | None = Field(default=None, max_length=64)


class ExplainAudioRequest(BaseModel):
    text: str = Field(..., min_length=4, max_length=2500)


class ObligationIntakeItem(BaseModel):
    id: str | None = Field(default=None, max_length=64)
    patient_id: str | None = Field(default="PAT-AE-4092", max_length=64)
    patient_name: str | None = Field(default=None, max_length=128)
    life_stage: str | None = Field(default="Preconception", max_length=64)
    title: str = Field(..., min_length=3, max_length=256)
    rationale: str = Field(..., min_length=4, max_length=1500)
    evidence_source: str | None = Field(default="Manual Clinician Intake", max_length=256)
    rule_version: str | None = Field(default="RB-CUSTOM-v1.0.0", max_length=32)
    owner: str | None = Field(default="OB-GYN / Primary Care", max_length=128)
    priority: str | None = Field(default="MEDIUM", max_length=32)
    # Optional linked incoming evidence (e.g. lab result ready for verification)
    incoming_evidence_result: str | None = Field(default=None, max_length=256)
    incoming_evidence_facility: str | None = Field(default=None, max_length=256)


class ObligationImportRequest(BaseModel):
    obligations: list[ObligationIntakeItem] = Field(..., min_length=1, max_length=50)
    source_label: str = Field(default="Table Import", max_length=128)


class EvidenceIntakeRequest(BaseModel):
    fhir_resource_type: str = Field(default="Observation", max_length=64)
    code_display: str = Field(..., min_length=2, max_length=256)
    result_value: str = Field(..., min_length=2, max_length=256)
    reference_range: str | None = Field(default=None, max_length=128)
    source_facility: str = Field(default="Malaffi HIE · Manual Intake", max_length=256)
    accession_id: str | None = Field(default=None, max_length=128)
    clinician_suggestion: str = Field(default="Dr. Layla Al-Hashimi (OB-GYN)", max_length=128)
    summary_note: str | None = Field(default=None, max_length=1000)


def _filter_audit_events(
    obligations: list[dict[str, Any]], patient_id: str
) -> list[dict[str, Any]]:
    obl_ids = None if patient_id == "ALL" else {str(o["id"]) for o in obligations}
    return list_audit_events(obligation_ids=obl_ids)


def _run_transition(event_type: str, patient_id: str = "PAT-AE-4092") -> dict[str, Any]:
    current = list_obligations(patient_id=patient_id)
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

    updated_obls = list_obligations(patient_id=patient_id)
    return {
        "patient_id": patient_id,
        "event_type": event_type,
        "agent_summary": result["agent_summary"],
        "specialist_handoff": result["specialist_handoff"],
        "ai_metadata": result["ai_metadata"],
        "privacy_report": result["privacy_report"],
        "trace": result["trace"],
        "obligations": updated_obls,
        "audit_events": _filter_audit_events(updated_obls, patient_id),
        "patients": list_patient_summaries(),
        "cohort_totals": query_patients(limit=1)["cohort_totals"],
    }


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _stream_transition_events(event_type: str, patient_id: str = "PAT-AE-4092") -> Iterator[str]:
    """Run deterministic steps first (yielding immediately), then stream OpenRouter tokens."""
    current = list_obligations(patient_id=patient_id)
    state: TransitionState = {
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
    for node in (
        detect_open_obligations,
        evaluate_life_stage_transition,
        apply_uae_privacy_firewall,
    ):
        state = {**state, **node(state)}  # LangGraph nodes return partial state dicts

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

    mid_obls = list_obligations(patient_id=patient_id)
    yield _sse(
        "deterministic_complete",
        {
            "patient_id": patient_id,
            "event_type": event_type,
            "obligations": mid_obls,
            "audit_events": _filter_audit_events(mid_obls, patient_id),
            "patients": list_patient_summaries(),
            "cohort_totals": query_patients(limit=1)["cohort_totals"],
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
            "execution": "agentic"
            if synthesis["mode"] == "openrouter"
            else "deterministic_fallback",
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

    final_obls = list_obligations(patient_id=patient_id)
    yield _sse(
        "complete",
        {
            "patient_id": patient_id,
            "event_type": event_type,
            "agent_summary": synthesis["summary"],
            "specialist_handoff": synthesis["specialist_handoff"],
            "ai_metadata": ai_metadata,
            "privacy_report": state["privacy_report"],
            "trace": final_trace,
            "obligations": final_obls,
            "audit_events": _filter_audit_events(final_obls, patient_id),
            "patients": list_patient_summaries(),
            "cohort_totals": query_patients(limit=1)["cohort_totals"],
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
        "audio_provider": {
            "provider": "elevenlabs",
            "configured": bool(os.getenv("ELEVENLABS_API_KEY", "").strip()),
            "model": (
                os.getenv("ELEVENLABS_MODEL_ID", DEFAULT_ELEVENLABS_MODEL_ID).strip()
                or DEFAULT_ELEVENLABS_MODEL_ID
            ),
        },
        "database": check_database_health(),
    }


@app.get("/api/patients")
def get_patients(
    q: str = "",
    stage: str = "ALL",
    triage: str = "ALL",
    sort: str = "urgency",
    limit: int = 20,
    offset: int = 0,
):
    """Search, filter, sort, and paginate patient cohort summaries with global totals."""
    return query_patients(
        q=q,
        stage=stage,
        triage=triage,
        sort=sort,
        limit=max(1, min(limit, 100)),
        offset=max(0, offset),
    )


@app.get("/api/obligations")
def get_obligations(patient_id: str = "PAT-AE-4092"):
    obls = list_obligations(patient_id=patient_id)
    return {
        "patient_id": patient_id,
        "obligations": obls,
        "audit_events": _filter_audit_events(obls, patient_id),
        "patients": list_patient_summaries(),
        "cohort_totals": query_patients(limit=1)["cohort_totals"],
    }


def _next_obligation_id(
    existing: list[dict[str, Any]],
    patient_id: str = "PAT-AE-4092",
    reserved_ids: set[str] | None = None,
) -> str:
    id_base = int(PATIENT_COHORT_META.get(patient_id, {}).get("id_base", 100))
    nums = []
    for item in existing:
        raw = str(item.get("id", ""))
        if raw.startswith("OBL-") and raw[4:].isdigit():
            nums.append(int(raw[4:]))
    candidate = max(nums, default=id_base) + 1
    taken = reserved_ids or {str(item.get("id", "")) for item in existing}
    while f"OBL-{candidate}" in taken:
        candidate += 1
    return f"OBL-{candidate}"


@app.post("/api/obligations/import")
def import_obligations(body: ObligationImportRequest):
    """Ingest one or more clinical obligations from manual input or CSV/TSV table import."""
    target_pid = (body.obligations[0].patient_id or "PAT-AE-4092").strip() or "PAT-AE-4092"
    all_existing = list_obligations(patient_id="ALL")
    current = [o for o in all_existing if o.get("patient_id") == target_pid]
    created: list[dict[str, Any]] = []
    for item in body.obligations:
        pid = (item.patient_id or target_pid).strip() or target_pid
        patient_name = (item.patient_name or "").strip() or str(
            PATIENT_COHORT_META.get(pid, {}).get("patient_name", "Amina Al-Mansoori (Synthetic)")
        )
        same_patient_existing = [o for o in current + created if o.get("patient_id") == pid]
        reserved_ids = {str(o.get("id", "")) for o in all_existing + created}
        obl_id = (item.id or "").strip() or _next_obligation_id(
            same_patient_existing,
            pid,
            reserved_ids=reserved_ids,
        )
        priority = (item.priority or "MEDIUM").strip().upper()
        if priority not in {"URGENT", "HIGH", "MEDIUM"}:
            priority = "MEDIUM"
        rec = create_obligation(
            {
                "id": obl_id,
                "patient_id": pid,
                "patient_name": patient_name,
                "life_stage": item.life_stage,
                "title": item.title.strip(),
                "rationale": item.rationale.strip(),
                "evidence_source": item.evidence_source,
                "rule_version": item.rule_version,
                "owner": item.owner,
                "priority": priority,
            }
        )
        created.append(rec)
        append_audit_event(
            event_type="OBLIGATION_IMPORTED",
            actor=body.source_label,
            summary=f"Ingested {obl_id} ({rec['title']}) at {rec['life_stage']} [{rec['priority']}].",
            obligation_id=obl_id,
        )
        if item.incoming_evidence_result and item.incoming_evidence_result.strip():
            ev_id = f"EVD-{obl_id}-{len(list_evidence_for_obligation(obl_id)) + 1}"
            create_evidence_record(
                {
                    "id": ev_id,
                    "obligation_id": obl_id,
                    "fhir_resource_type": "Observation",
                    "code_display": item.title.strip(),
                    "result_value": item.incoming_evidence_result.strip(),
                    "source_facility": item.incoming_evidence_facility or body.source_label,
                    "summary_note": (
                        f"Verified clinical result: {item.incoming_evidence_result.strip()} "
                        f"({item.incoming_evidence_facility or body.source_label})."
                    ),
                }
            )
    obls_for_pid = list_obligations(patient_id=target_pid)
    return {
        "patient_id": target_pid,
        "imported_count": len(created),
        "obligations": obls_for_pid,
        "audit_events": _filter_audit_events(obls_for_pid, target_pid),
        "patients": list_patient_summaries(),
        "cohort_totals": query_patients(limit=1)["cohort_totals"],
    }


@app.get("/api/obligations/{obligation_id}/evidence")
def get_obligation_evidence(obligation_id: str):
    """Fetch incoming FHIR / HIE evidence records stored in Neon Postgres for an obligation."""
    return {
        "obligation_id": obligation_id,
        "evidence": list_evidence_for_obligation(obligation_id),
    }


@app.post("/api/obligations/{obligation_id}/evidence")
def add_obligation_evidence(obligation_id: str, body: EvidenceIntakeRequest):
    """Attach a new incoming clinical evidence record to an obligation in Neon Postgres."""
    existing = next(
        (o for o in list_obligations(patient_id="ALL") if o["id"] == obligation_id), None
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Clinical obligation not found")
    current_ev = list_evidence_for_obligation(obligation_id)
    ev_id = f"EVD-{obligation_id}-{len(current_ev) + 1}"
    summary_note = (body.summary_note or "").strip() or (
        f"{body.code_display}: {body.result_value} ({body.source_facility})."
    )
    record = create_evidence_record(
        {
            "id": ev_id,
            "obligation_id": obligation_id,
            "fhir_resource_type": body.fhir_resource_type,
            "code_display": body.code_display.strip(),
            "result_value": body.result_value.strip(),
            "reference_range": body.reference_range,
            "source_facility": body.source_facility.strip(),
            "accession_id": body.accession_id,
            "clinician_suggestion": body.clinician_suggestion.strip(),
            "summary_note": summary_note,
        }
    )
    append_audit_event(
        event_type="EVIDENCE_RECORDED",
        actor=body.source_facility.strip(),
        summary=f"Recorded {record['fhir_resource_type']} evidence ({ev_id}) for {obligation_id}: {record['result_value']}",
        obligation_id=obligation_id,
    )
    pid = str(existing.get("patient_id") or "PAT-AE-4092")
    obls = list_obligations(patient_id=pid)
    return {
        "record": record,
        "evidence": list_evidence_for_obligation(obligation_id),
        "audit_events": _filter_audit_events(obls, pid),
    }


@app.post("/api/transitions/pregnancy")
def trigger_pregnancy_transition(patient_id: str = "PAT-AE-4092"):
    return _run_transition("FHIR_PREGNANCY_CONFIRMED", patient_id=patient_id)


@app.post("/api/transitions/pregnancy/stream")
def stream_pregnancy_transition(patient_id: str = "PAT-AE-4092"):
    return StreamingResponse(
        _stream_transition_events("FHIR_PREGNANCY_CONFIRMED", patient_id=patient_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/transitions/postpartum")
def trigger_postpartum_transition(patient_id: str = "PAT-AE-4092"):
    return _run_transition("FHIR_DELIVERY_POSTPARTUM", patient_id=patient_id)


@app.post("/api/transitions/postpartum/stream")
def stream_postpartum_transition(patient_id: str = "PAT-AE-4092"):
    return StreamingResponse(
        _stream_transition_events("FHIR_DELIVERY_POSTPARTUM", patient_id=patient_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/obligations/{obligation_id}/verify")
def verify_obligation_closure(obligation_id: str, body: VerifyClosureRequest):
    existing = next(
        (o for o in list_obligations(patient_id="ALL") if o["id"] == obligation_id), None
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Clinical obligation not found")
    if existing["status"] == "DEFERRED_TO_POSTPARTUM":
        rule_ver = existing.get("rule_version") or "RB-IMMUNE-v1.2.1"
        append_audit_event(
            event_type="CLINICAL_SAFETY_BLOCKED",
            actor=f"SafetyGuard ({rule_ver})",
            summary=(
                f"Blocked premature closure of {obligation_id} requested by {body.clinician_name}: "
                "pregnancy-deferred immunization obligation is contraindicated during pregnancy and remains queued for postpartum."
            ),
            obligation_id=obligation_id,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "Clinical safety guard: pregnancy-deferred immunization obligation is contraindicated during "
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
    evidence_ref = f" [Evidence ID: {body.evidence_id}]" if body.evidence_id else ""
    append_audit_event(
        event_type="EVIDENCE_VERIFIED_CLOSURE",
        actor=body.clinician_name,
        summary=f"Closed {obligation_id} with verified evidence{evidence_ref}: {body.closure_evidence}",
        obligation_id=obligation_id,
    )
    patient_id = str(existing.get("patient_id") or "PAT-AE-4092")
    obls = list_obligations(patient_id=patient_id)
    return {
        "obligation": updated,
        "audit_events": _filter_audit_events(obls, patient_id),
        "patients": list_patient_summaries(),
        "cohort_totals": query_patients(limit=1)["cohort_totals"],
    }


@app.post("/api/obligations/{obligation_id}/explain")
def explain_obligation(obligation_id: str):
    existing = next(
        (o for o in list_obligations(patient_id="ALL") if o["id"] == obligation_id), None
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Clinical obligation not found")

    privacy_report = build_obligation_explain_payload(existing)
    result = explain_deidentified_obligation(privacy_report["payload"])

    append_audit_event(
        event_type="AI_EXPLANATION_GENERATED",
        actor=f"AIExplainer ({result['ai_metadata']['model']})",
        summary=f"Generated de-identified explanation for {obligation_id} (0 PHI transmitted).",
        obligation_id=obligation_id,
    )
    patient_id = str(existing.get("patient_id") or "PAT-AE-4092")
    obls = list_obligations(patient_id=patient_id)
    return {
        "obligation_id": obligation_id,
        "headline": result["headline"],
        "explanation": result["explanation"],
        "key_points": result["key_points"],
        "disclaimer": result["disclaimer"],
        "ai_metadata": result["ai_metadata"],
        "privacy_report": privacy_report,
        "audit_events": _filter_audit_events(obls, patient_id),
    }


def _stream_obligation_explanation(existing: dict[str, Any]) -> Iterator[str]:
    """Verify UAE Privacy Firewall first, then stream OpenRouter explanation tokens."""
    obligation_id = str(existing["id"])
    privacy_report = build_obligation_explain_payload(existing)
    yield _sse(
        "firewall_verified",
        {
            "obligation_id": obligation_id,
            "privacy_report": privacy_report,
        },
    )

    result: dict[str, Any] | None = None
    for chunk in stream_deidentified_explanation(privacy_report["payload"]):
        if chunk["type"] == "token":
            yield _sse("token", {"delta": chunk["delta"], "model": chunk["model"]})
        elif chunk["type"] == "done":
            result = chunk["result"]

    if result is None:
        result = explain_deidentified_obligation(privacy_report["payload"])

    append_audit_event(
        event_type="AI_EXPLANATION_GENERATED",
        actor=f"AIExplainer ({result['ai_metadata']['model']})",
        summary=f"Generated de-identified explanation for {obligation_id} (0 PHI transmitted).",
        obligation_id=obligation_id,
    )
    patient_id = str(existing.get("patient_id") or "PAT-AE-4092")
    obls = list_obligations(patient_id=patient_id)
    yield _sse(
        "complete",
        {
            "obligation_id": obligation_id,
            "headline": result["headline"],
            "explanation": result["explanation"],
            "key_points": result["key_points"],
            "disclaimer": result["disclaimer"],
            "ai_metadata": result["ai_metadata"],
            "privacy_report": privacy_report,
            "audit_events": _filter_audit_events(obls, patient_id),
        },
    )


@app.post("/api/obligations/{obligation_id}/explain/stream")
def stream_explain_obligation(obligation_id: str) -> StreamingResponse:
    existing = next(
        (o for o in list_obligations(patient_id="ALL") if o["id"] == obligation_id), None
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Clinical obligation not found")
    return StreamingResponse(
        _stream_obligation_explanation(existing),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/obligations/{obligation_id}/explain/audio")
def synthesize_explain_obligation_audio(
    obligation_id: str,
    body: ExplainAudioRequest,
) -> Response:
    existing = next(
        (o for o in list_obligations(patient_id="ALL") if o["id"] == obligation_id), None
    )
    if existing is None:
        raise HTTPException(status_code=404, detail="Clinical obligation not found")

    scrubbed_text = scrub_explanation_for_tts(body.text, existing)

    if not os.getenv("ELEVENLABS_API_KEY", "").strip():
        raise HTTPException(
            status_code=503,
            detail=(
                "ELEVENLABS_API_KEY is not configured. Add it to your environment to enable "
                "ElevenLabs neural voice playback."
            ),
        )

    try:
        audio_bytes = synthesize_elevenlabs_audio(scrubbed_text)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"ElevenLabs neural TTS request failed ({type(exc).__name__}).",
        ) from exc

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


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
def reset_demo(patient_id: str = "PAT-AE-4092"):
    return reset_obligations(patient_id=patient_id)
