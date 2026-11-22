import json

import httpx
import pytest

from api.db import SEED_OBLIGATIONS
from api.openrouter import synthesize_deidentified_brief
from api.privacy import PrivacyViolationError, build_ai_safe_payload
from api.workflow import transition_workflow


def test_openrouter_fallback_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    report = build_ai_safe_payload("FHIR_PREGNANCY_CONFIRMED", SEED_OBLIGATIONS, [])
    result = synthesize_deidentified_brief(report["payload"])
    assert result["mode"] == "deterministic_fallback"
    assert "not configured" in (result["fallback_reason"] or "")
    assert result["summary"]
    assert result["specialist_handoff"]


def test_openrouter_blocks_phi_before_network_call(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")
    with pytest.raises(PrivacyViolationError):
        synthesize_deidentified_brief({"patient_name": "Amira Al-Mansoori"})


def test_openrouter_success_with_mocked_http(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")

    captured: dict = {}

    def fake_post(self, url, *, headers=None, json=None, **kwargs):  # noqa: A002
        captured["url"] = url
        captured["headers"] = headers
        captured["body"] = json
        return httpx.Response(
            status_code=200,
            request=httpx.Request("POST", url),
            json={
                "model": "openai/gpt-4o-mini",
                "choices": [
                    {
                        "message": {
                            "content": '{"summary":"De-identified summary.","specialist_handoff":"Review OBL-101 urgently."}'
                        }
                    }
                ],
            },
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)

    report = build_ai_safe_payload("FHIR_PREGNANCY_CONFIRMED", SEED_OBLIGATIONS, [])
    result = synthesize_deidentified_brief(report["payload"])

    assert result["mode"] == "openrouter"
    assert result["provider"] == "openrouter"
    assert result["model"] == "openai/gpt-4o-mini"
    assert result["summary"] == "De-identified summary."
    assert result["specialist_handoff"] == "Review OBL-101 urgently."
    assert captured["headers"]["Authorization"] == "Bearer sk-or-test-key"
    # Verify outbound HTTP body sent to OpenRouter contains zero PHI.
    outbound_str = json.dumps(captured["body"])
    assert "Amira" not in outbound_str
    assert "PAT-AE-4092" not in outbound_str


def test_deterministic_clinical_rules_succeed_even_when_openrouter_fails(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")

    def failing_post(self, url, **kwargs):
        raise httpx.ConnectTimeout("simulated timeout")

    monkeypatch.setattr(httpx.Client, "post", failing_post)

    out = transition_workflow.invoke(
        {
            "event_type": "FHIR_PREGNANCY_CONFIRMED",
            "obligations": SEED_OBLIGATIONS,
            "reassessed_updates": [],
            "privacy_report": {},
            "trace": [],
            "agent_summary": "",
            "specialist_handoff": "",
            "ai_metadata": {},
        }
    )

    updates = {u["id"]: u for u in out["reassessed_updates"]}
    assert updates["OBL-101"]["priority"] == "URGENT"
    assert updates["OBL-101"]["status"] == "ESCALATED_FOR_REVIEW"
    assert updates["OBL-102"]["status"] == "DEFERRED_TO_POSTPARTUM"
    assert out["ai_metadata"]["mode"] == "deterministic_fallback"
    assert [t["node"] for t in out["trace"]] == [
        "detect_open_obligations",
        "evaluate_life_stage_transition",
        "apply_uae_privacy_firewall",
        "synthesize_coordination_brief",
    ]


def _fake_stream_factory(text_chunks: list[str]):
    import contextlib

    @contextlib.contextmanager
    def fake_stream(self, method, url, *, headers=None, json=None, **kwargs):  # noqa: A002 -- mirrors httpx.Client.stream signature
        body = "".join(
            "data: "
            + __import__("json").dumps(
                {"model": "google/gemma-4-31b-it:free", "choices": [{"delta": {"content": c}}]}
            )
            + "\n\n"
            for c in text_chunks
        )
        body += "data: [DONE]\n\n"
        yield httpx.Response(
            status_code=200, request=httpx.Request(method, url), content=body.encode()
        )

    return fake_stream


def test_stream_brief_flags_substituted_handoff_when_marker_missing(monkeypatch):
    from api.openrouter import stream_deidentified_brief

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")
    monkeypatch.setattr(
        httpx.Client,
        "stream",
        _fake_stream_factory(["SUMMARY:\n", "Thyroid follow-up escalated for OB-GYN review."]),
    )
    report = build_ai_safe_payload("FHIR_PREGNANCY_CONFIRMED", SEED_OBLIGATIONS[:2], [])
    events = list(stream_deidentified_brief(report["payload"]))
    result = events[-1]["result"]

    assert result["mode"] == "openrouter"
    assert result["summary"] == "Thyroid follow-up escalated for OB-GYN review."
    assert "HANDOFF" in (result["fallback_reason"] or "")
    assert "OBL-101" in result["specialist_handoff"]


def test_stream_brief_parses_markdown_decorated_markers(monkeypatch):
    from api.openrouter import stream_deidentified_brief

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")
    monkeypatch.setattr(
        httpx.Client,
        "stream",
        _fake_stream_factory(
            ["**Summary:** Two gaps reassessed.\n", "**Handoff:**\n", "• Review OBL-101."]
        ),
    )
    report = build_ai_safe_payload("FHIR_PREGNANCY_CONFIRMED", SEED_OBLIGATIONS[:2], [])
    result = list(stream_deidentified_brief(report["payload"]))[-1]["result"]

    assert result["fallback_reason"] is None
    assert result["summary"] == "Two gaps reassessed."
    assert result["specialist_handoff"] == "• Review OBL-101."


def test_stream_brief_falls_back_on_transport_error(monkeypatch):
    import contextlib

    from api.openrouter import stream_deidentified_brief

    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-key")

    @contextlib.contextmanager
    def broken_stream(self, method, url, **kwargs):
        raise httpx.ConnectTimeout("timed out")
        yield  # pragma: no cover

    monkeypatch.setattr(httpx.Client, "stream", broken_stream)
    report = build_ai_safe_payload("FHIR_PREGNANCY_CONFIRMED", SEED_OBLIGATIONS[:2], [])
    result = list(stream_deidentified_brief(report["payload"]))[-1]["result"]
    assert result["mode"] == "deterministic_fallback"
    assert "ConnectTimeout" in result["fallback_reason"]
