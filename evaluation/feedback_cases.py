"""Isolated deterministic checks of human proposals and explicit file confirmation."""

import tempfile
from types import SimpleNamespace
from unittest.mock import Mock, patch

from langchain_core.messages import AIMessage


EMAIL = {"id": "evaluation-feedback-1", "author": "Sender <sender@example.com>", "to": "Owner <owner@example.com>",
         "subject": "Please confirm receipt", "email_thread": "Please confirm receipt of the attached report."}
SEND_ARGS = {"email_id": EMAIL["id"], "response_text": "Received, thank you.", "email_address": "sender@example.com", "additional_recipients": None}
INITIAL = {"response": "Keep acknowledgments concise.\n", "triage": "IGNORE: promotions\nNOTIFY: reports\nRESPOND: questions\n"}
FEEDBACK_CASES = [
    {"case_id": "feedback_edit_send", "kind": "response", "response": {"type": "edit", "args": {"args": {**SEND_ARGS, "response_text": "Thank you. I confirm receipt of the report."}}}, "updated": "Use formal acknowledgments.\n"},
    {"case_id": "feedback_response_send", "kind": "response", "response": {"type": "response", "args": "Please use a formal acknowledgment."}, "updated": "Use formal acknowledgments.\n"},
    {"case_id": "feedback_ignore_notify", "kind": "triage", "response": {"type": "accept", "args": {}, "route": "ignore", "feedback": "Ignore routine reports."}, "updated": "IGNORE: routine reports\nNOTIFY: important notices\nRESPOND: questions\n"},
    {"case_id": "feedback_response_notify", "kind": "triage", "response": {"type": "response", "args": "Please confirm receipt.", "route": "respond", "feedback": "Respond to report deliveries."}, "updated": "IGNORE: promotions\nNOTIFY: important notices\nRESPOND: report deliveries and questions\n"},
]


def _state(tool="send_email_tool", args=None):
    return {"email_input": dict(EMAIL), "classification_decision": "notify", "messages": [AIMessage(content="", tool_calls=[{
        "name": tool, "args": dict(SEND_ARGS) if args is None else args, "id": "evaluation-call-1"}])]}


def run_feedback_checks():
    from email_assistant import email_assistant_hitl as flow
    from email_assistant.memory import PreferenceRepository
    from email_assistant.tools.qq.qq_tools import TEST_RECIPIENT

    records = []
    for case in FEEDBACK_CASES:
        actual, error = {}, None
        expected = {"candidate_kind": case["kind"], "unchanged_before_confirmation": True,
                    "confirmed_preferences": {**INITIAL, case["kind"]: case["updated"]},
                    "memory_update_calls": 1, "reply_model_calls": 0, "send_calls": int(case["response"]["type"] == "edit")}
        with tempfile.TemporaryDirectory(prefix="feedback-memory-") as temp:
            repo = PreferenceRepository(temp)
            for kind, value in INITIAL.items():
                old = repo.read(kind)
                repo.confirm({"kind": kind, "old": old, "new": value})
            model = Mock(invoke=Mock(return_value=SimpleNamespace(content=case["updated"])))
            send = Mock(invoke=Mock(return_value=f"Email reply sent successfully to test recipient {TEST_RECIPIENT}"))
            reply = Mock(invoke=Mock(side_effect=AssertionError("Reply model must not run")))
            try:
                with patch.object(flow, "interrupt", return_value=[case["response"]]), patch.object(flow, "llm", model), \
                     patch.object(flow, "llm_with_tools", reply), patch.object(flow, "get_send_record", return_value=None), \
                     patch.object(flow, "ChromaRepository"), patch.dict(flow.tools_by_name, {"send_email_tool": send}):
                    handler = flow.triage_interrupt_handler if case["kind"] == "triage" else flow.interrupt_handler
                    command = handler(_state(), {"configurable": {"memory_root": temp}})
                    candidate = command.update["preference_candidates"][0]
                    unchanged = all(repo.read(kind) == value for kind, value in INITIAL.items())
                    repo.confirm(candidate)
                    actual = {"candidate_kind": candidate["kind"], "unchanged_before_confirmation": unchanged,
                              "confirmed_preferences": {kind: repo.read(kind) for kind in INITIAL},
                              "memory_update_calls": model.invoke.call_count, "reply_model_calls": reply.invoke.call_count,
                              "send_calls": send.invoke.call_count}
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
        records.append({"case_id": case["case_id"], "expected": expected, "actual": actual,
                        "passed": error is None and actual == expected, "error": error,
                        "initial_preferences": dict(INITIAL), "human_feedback": case["response"],
                        "updated_preferences": actual.get("confirmed_preferences", {})})
    return records


def run_flow_checks():
    from email_assistant import email_assistant_hitl as flow

    scenarios = [
        ("notify_ignore_route", "notify", {"type": "ignore", "args": {}}, "mark_as_read_node"),
        ("notify_response_route", "notify", {"type": "response", "args": "Confirm receipt."}, "response_agent"),
        ("question_feedback", "Question", {"type": "response", "args": "The deadline is Friday."}, "llm_call"),
        ("invalid_proposed_email_id", "invalid_proposal", {"type": "accept", "args": {}}, "ValueError"),
        ("invalid_edited_email_id", "invalid_edit", {"type": "edit", "args": {"args": {**SEND_ARGS, "email_id": "different-email"}}}, "ValueError"),
    ]
    records = []
    for case_id, kind, response, route in scenarios:
        actual, error = {}, None
        send = Mock(invoke=Mock(side_effect=AssertionError("Send forbidden")))
        reply = Mock(invoke=Mock(side_effect=AssertionError("Reply model must not run")))
        expected = {"route_or_error": route, "send_calls": 0, "read_calls": 0, "reply_model_calls": 0}
        if kind == "Question":
            expected["feedback_in_next_messages"] = True
        with tempfile.TemporaryDirectory(prefix="flow-memory-") as temp:
            try:
                with patch.object(flow, "interrupt", return_value=[response]), \
                     patch.object(flow, "llm", Mock(invoke=Mock(return_value=SimpleNamespace(content="Use concise replies.")))), \
                     patch.object(flow, "llm_with_tools", reply), patch.object(flow, "mark_as_read") as read, \
                     patch.dict(flow.tools_by_name, {"send_email_tool": send}):
                    state = _state("Question", {"content": "When is the deadline?"}) if kind == "Question" else _state()
                    if kind == "invalid_proposal":
                        state = _state(args={**SEND_ARGS, "email_id": "different-email"})
                    try:
                        handler = flow.triage_interrupt_handler if kind == "notify" else flow.interrupt_handler
                        command = handler(state, {"configurable": {"memory_root": temp}})
                        observed = command.goto
                        if kind.startswith("invalid"):
                            raise AssertionError("Mismatched email ID was accepted")
                    except ValueError as exc:
                        if not kind.startswith("invalid") or "Reviewed email ID differs" not in str(exc):
                            raise
                        observed = "ValueError"
                    actual = {"route_or_error": observed, "send_calls": send.invoke.call_count,
                              "read_calls": read.call_count, "reply_model_calls": reply.invoke.call_count}
                    if kind == "Question":
                        actual["feedback_in_next_messages"] = response["args"] in command.update["messages"][0]["content"]
            except Exception as exc:
                error = f"{type(exc).__name__}: {exc}"
        records.append({"case_id": case_id, "expected": expected, "actual": actual,
                        "passed": error is None and actual == expected, "error": error})
    return records
