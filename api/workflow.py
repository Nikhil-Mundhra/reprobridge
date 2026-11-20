"""Hybrid LangGraph Care-Resolution Harness.

Explicitly separates:
1. Deterministic clinical logic (gap detection, rule evaluation, state updates)
2. Deterministic UAE Privacy Firewall (PHI stripping & assertion)
3. Agentic synthesis via OpenRouter (de-identified clinician handoff drafting)
"""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from api.openrouter import synthesize_deidentified_brief
from api.privacy import build_ai_safe_payload


class TransitionState(TypedDict):
    event_type: str
    obligations: list[dict[str, Any]]
    reassessed_updates: list[dict[str, Any]]
    privacy_report: dict[str, Any]
    trace: list[dict[str, Any]]
    agent_summary: str
    specialist_handoff: str
    ai_metadata: dict[str, Any]


def detect_open_obligations(state: TransitionState) -> dict[str, Any]:
    """Deterministic step: filter unresolved obligations requiring reassessment."""
    open_items = [o for o in state["obligations"] if o["status"] != "VERIFIED_CLOSED"]
    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "detect_open_obligations",
            "execution": "deterministic",
            "phi_exposed": False,
            "detail": f"Identified {len(open_items)} open obligation(s) from Neon Clinical Obligation Passport.",
        }
    )
    return {"obligations": open_items, "trace": trace}


def evaluate_life_stage_transition(state: TransitionState) -> dict[str, Any]:
    """Deterministic step: apply version-controlled clinical rules (zero LLM involvement)."""
    event_type = state["event_type"]
    updates: list[dict[str, Any]] = []

    if event_type == "FHIR_PREGNANCY_CONFIRMED":
        for item in state["obligations"]:
            if item["id"] == "OBL-101":
                updates.append(
                    {
                        "id": item["id"],
                        "life_stage": "Antenatal (Trimester 1)",
                        "priority": "URGENT",
                        "status": "ESCALATED_FOR_REVIEW",
                        "owner": "Maternal-Fetal Medicine / OB-GYN",
                        "rationale": (
                            "PREGNANCY TRANSITION TRIGGERED: Preconception TSH 4.8 mIU/L exceeds "
                            "first-trimester target (<2.5 mIU/L). Urgent levothyroxine evaluation and "
                            "repeat thyroid panel routed for clinician approval."
                        ),
                    }
                )
            elif item["id"] == "OBL-102":
                updates.append(
                    {
                        "id": item["id"],
                        "life_stage": "Antenatal (Trimester 1)",
                        "priority": "HIGH",
                        "status": "DEFERRED_TO_POSTPARTUM",
                        "owner": "Postpartum Care Pathway",
                        "rationale": (
                            "PREGNANCY TRANSITION TRIGGERED: Live MMR vaccine is contraindicated "
                            "during pregnancy. Obligation preserved on Clinical Obligation Passport "
                            "and auto-scheduled for postpartum closure."
                        ),
                    }
                )
        rule_detail = (
            f"Applied versioned pregnancy rules to {len(updates)} obligation(s): "
            "OBL-101 escalated to URGENT; OBL-102 safely deferred to postpartum."
        )
    elif event_type == "FHIR_DELIVERY_POSTPARTUM":
        for item in state["obligations"]:
            if item["id"] == "OBL-102":
                updates.append(
                    {
                        "id": item["id"],
                        "life_stage": "Postpartum",
                        "priority": "URGENT",
                        "status": "ESCALATED_FOR_REVIEW",
                        "owner": "Postpartum OB-GYN / Immunization Nurse",
                        "rationale": (
                            "POSTPARTUM TRANSITION TRIGGERED: Pregnancy contraindication lifted. "
                            "Deferred Rubella IgG non-immune obligation reactivated for pre-discharge "
                            "MMR vaccination and evidence-verified clinician closure."
                        ),
                    }
                )
            elif item["id"] == "OBL-101":
                updates.append(
                    {
                        "id": item["id"],
                        "life_stage": "Postpartum",
                        "priority": "HIGH",
                        "status": "ESCALATED_FOR_REVIEW",
                        "owner": "Postpartum Endocrinology / OB-GYN",
                        "rationale": (
                            "POSTPARTUM TRANSITION TRIGGERED: Unresolved thyroid obligation carried "
                            "forward for 6-week postpartum TSH reassessment and dose adjustment."
                        ),
                    }
                )
        rule_detail = (
            f"Applied versioned postpartum rules to {len(updates)} obligation(s): "
            "deferred OBL-102 reactivated for pre-discharge MMR vaccination."
        )
    else:
        rule_detail = f"No deterministic transition rule matched event '{event_type}'."

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "evaluate_life_stage_transition",
            "execution": "deterministic",
            "phi_exposed": False,
            "detail": rule_detail,
        }
    )
    return {"reassessed_updates": updates, "trace": trace}


def apply_uae_privacy_firewall(state: TransitionState) -> dict[str, Any]:
    """Deterministic security gate: strip all UAE PHI before any external AI call."""
    privacy_report = build_ai_safe_payload(
        event_type=state["event_type"],
        obligations=state["obligations"],
        reassessed_updates=state["reassessed_updates"],
    )
    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "apply_uae_privacy_firewall",
            "execution": "deterministic",
            "phi_exposed": False,
            "detail": (
                f"Stripped {len(privacy_report['redacted_fields'])} PHI fields; "
                f"pseudonymized case as {privacy_report['payload']['case_token']} "
                "(UAE_PHI_LOCAL_ONLY)."
            ),
        }
    )
    return {"privacy_report": privacy_report, "trace": trace}


def synthesize_coordination_brief(state: TransitionState) -> dict[str, Any]:
    """Agentic step: call OpenRouter with ONLY the de-identified payload."""
    deidentified_payload = state["privacy_report"]["payload"]
    synthesis = synthesize_deidentified_brief(deidentified_payload)

    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "synthesize_coordination_brief",
            "execution": "agentic" if synthesis["mode"] == "openrouter" else "deterministic_fallback",
            "phi_exposed": False,
            "detail": (
                f"Synthesized clinician handoff via {synthesis['provider']} "
                f"(model: {synthesis['model']}) using de-identified payload only."
            ),
        }
    )
    return {
        "agent_summary": synthesis["summary"],
        "specialist_handoff": synthesis["specialist_handoff"],
        "ai_metadata": {
            "mode": synthesis["mode"],
            "provider": synthesis["provider"],
            "model": synthesis["model"],
            "fallback_reason": synthesis["fallback_reason"],
        },
        "trace": trace,
    }


def build_transition_graph():
    graph = StateGraph(TransitionState)
    graph.add_node("detect_open_obligations", detect_open_obligations)
    graph.add_node("evaluate_life_stage_transition", evaluate_life_stage_transition)
    graph.add_node("apply_uae_privacy_firewall", apply_uae_privacy_firewall)
    graph.add_node("synthesize_coordination_brief", synthesize_coordination_brief)

    graph.add_edge(START, "detect_open_obligations")
    graph.add_edge("detect_open_obligations", "evaluate_life_stage_transition")
    graph.add_edge("evaluate_life_stage_transition", "apply_uae_privacy_firewall")
    graph.add_edge("apply_uae_privacy_firewall", "synthesize_coordination_brief")
    graph.add_edge("synthesize_coordination_brief", END)

    return graph.compile()


transition_workflow = build_transition_graph()
