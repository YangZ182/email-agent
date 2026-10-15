"""Verify error denominators and mailbox isolation in the evaluation runner."""

from unittest.mock import Mock, patch

from langchain_core.messages import AIMessage
from email_assistant.schemas import RouterSchema

from evaluation.run_evaluation import live_model, run_case, summarize


def test_live_client_has_bounded_timeout_and_no_automatic_retry():
    from email_assistant import email_assistant_hitl as flow

    model = live_model(flow)
    assert model.root_client.max_retries == 0
    assert model.root_client.timeout == 60.0
    assert model.model_name == flow.llm.model_name


def test_error_counts_against_gold_and_tool_denominators():
    rows = [
        {"expected_classification": "respond", "actual_classification": "respond", "error": None,
         "tool_passed": True, "interrupts": [], "operations": {"send": [], "mark_as_read": []}},
        {"expected_classification": "respond", "actual_classification": "respond", "error": {"type": "Timeout"},
         "tool_passed": False, "interrupts": [], "operations": {"send": [], "mark_as_read": []}},
        {"expected_classification": "ignore", "actual_classification": "notify", "error": None,
         "tool_passed": False, "interrupts": [], "operations": {"send": [], "mark_as_read": []}},
    ]
    result = summarize(rows)
    assert result["accuracy"] == 1 / 3
    assert result["errors"] == 1
    assert result["confusion_matrix"]["respond"]["error"] == 1
    assert result["per_class"]["respond"]["recall"] == 0.5
    assert result["tool_correct"] == 1 and result["tool_total"] == 2


def test_baseline_pause_never_calls_mailbox_or_inherits_store():
    from email_assistant import email_assistant_hitl as flow
    from email_assistant.tools.qq import qq_tools

    case = {"case_id": "test", "expected_classification": "respond", "expected_tool": "send_email_tool",
            "email_input": {"id": "synthetic-test", "author": "sender@example.com", "to": "owner@example.com",
                            "subject": "Receipt", "email_thread": "Please confirm receipt."}}
    triage = Mock(invoke=Mock(return_value=RouterSchema(reasoning="reply requested", classification="respond")))
    response = Mock(invoke=Mock(return_value=AIMessage(content="", tool_calls=[{
        "name": "send_email_tool", "id": "test-call", "args": {
            "email_id": "synthetic-test", "email_address": "owner@example.com", "response_text": "Received."
        }}])))
    model = Mock(with_structured_output=Mock(return_value=triage), bind_tools=Mock(return_value=response))
    with patch.object(qq_tools, "fetch_email_by_uid", side_effect=AssertionError("Real fetch")), \
         patch.object(qq_tools, "send_approved_reply", side_effect=AssertionError("Real send")):
        first = run_case(case, flow, model)
        second = run_case(case, flow, model)
    assert first["flow_passed"] and second["flow_passed"]
    assert first["operations"] == {"send": [], "mark_as_read": []}
    # Both calls start from the same defaults rather than a shared accumulated profile.
    assert triage.invoke.call_args_list[0].args[0] == triage.invoke.call_args_list[1].args[0]
