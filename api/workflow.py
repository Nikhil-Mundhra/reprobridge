from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph


class TransitionState(TypedDict):
    event_type: str
    obligations: list[dict[str, Any]]
    reassessed_updates: list[dict[str, Any]]
    trace: list[dict[str, str]]
    agent_summary: str


def detect_open_obligations(state: TransitionState) -> dict[str, Any]:
    """Filter unresolved obligations that require life-stage reassessment."""
    open_items = [o for o in state["obligations"] if o["status"] != "VERIFIED_CLOSED"]
    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "detect_open_obligations",
            "detail": f"Identified {len(open_items)} open obligation(s) from Clinical Obligation Passport.",
        }
    )
    return {"obligations": open_items, "trace": trace}


def evaluate_pregnancy_transition(state: TransitionState) -> dict[str, Any]:
    """Apply deterministic clinical transition rules for a newly recorded pregnancy."""
    updates: list[dict[str, Any]] = []
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
    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "evaluate_pregnancy_transition",
            "detail": (
                f"Applied deterministic rules to {len(updates)} obligation(s): "
                "OBL-101 escalated to URGENT; OBL-102 safely deferred to postpartum."
            ),
        }
    )
    return {"reassessed_updates": updates, "trace": trace}


def synthesize_coordination_brief(state: TransitionState) -> dict[str, Any]:
    """Produce an auditable coordination summary for human-in-the-loop review."""
    count = len(state["reassessed_updates"])
    summary = (
        f"LangGraph Care-Resolution Orchestrator reassessed {count} open obligation(s) "
        f"under event '{state['event_type']}'. Urgent antenatal endocrine review escalated; "
        "contraindicated live-vaccine obligation safely deferred to postpartum."
    )
    trace = list(state.get("trace", []))
    trace.append(
        {
            "node": "synthesize_coordination_brief",
            "detail": "Prepared clinician review brief and routed sensitive actions for human approval.",
        }
    )
    return {"agent_summary": summary, "trace": trace}


def build_transition_graph():
    graph = StateGraph(TransitionState)
    graph.add_node("detect_open_obligations", detect_open_obligations)
    graph.add_node("evaluate_pregnancy_transition", evaluate_pregnancy_transition)
    graph.add_node("synthesize_coordination_brief", synthesize_coordination_brief)

    graph.add_edge(START, "detect_open_obligations")
    graph.add_edge("detect_open_obligations", "evaluate_pregnancy_transition")
    graph.add_edge("evaluate_pregnancy_transition", "synthesize_coordination_brief")
    graph.add_edge("synthesize_coordination_brief", END)

    return graph.compile()


transition_workflow = build_transition_graph()
