"""Offline safety checks for the reference-style QQ review flow."""

from types import SimpleNamespace
import sqlite3
from unittest.mock import Mock, patch

import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore
from langgraph.types import Command

from email_assistant import email_assistant_hitl as flow
from email_assistant.tools.qq import qq_tools


EMAIL = {
    "id": "2585",
    "message_id": "<test-message@example.com>",
    "author": "Owner <sender@example.com>",
    "to": "2942397812@qq.com",
    "subject": "Please confirm receipt",
    "email_thread": "Please confirm receipt of the file.",
}
SEND_ARGS = {
    "email_id": "2585",
    "response_text": "Received, thank you.",
    "email_address": "2942397812@qq.com",
    "additional_recipients": None,
}


def _graph(store=None):
    return flow.builder.compile(
        checkpointer=InMemorySaver(),
        store=store or InMemoryStore(),
    )


def _send_call(args=None):
    return AIMessage(
        content="",
        tool_calls=[
            {
                "name": "send_email_tool",
                "args": args or SEND_ARGS,
                "id": "send-1",
            }
        ],
    )


def _done_call():
    return AIMessage(
        content="",
        tool_calls=[{"name": "Done", "args": {"done": True}, "id": "done-1"}],
    )


def test_review_precedes_send_and_read():
    graph = _graph()
    config = {"configurable": {"thread_id": "offline-review-test"}}
    send_tool = Mock(invoke=Mock(return_value=f"Email reply sent successfully to test recipient {qq_tools.TEST_RECIPIENT}"))
    with (
        patch.object(
            flow,
            "llm_router",
            Mock(invoke=Mock(return_value=SimpleNamespace(classification="respond"))),
        ),
        patch.object(
            flow,
            "llm_with_tools",
            Mock(invoke=Mock(side_effect=[_send_call(), _done_call()])),
        ),
        patch.dict(flow.tools_by_name, {"send_email_tool": send_tool}),
        patch.object(flow, "mark_as_read") as read,
    ):
        paused = graph.invoke({"email_input": EMAIL}, config)
        request = paused["__interrupt__"][0].value[0]
        assert request["action_request"]["action"] == "send_email_tool"
        assert qq_tools.TEST_RECIPIENT in request["description"]
        send_tool.invoke.assert_not_called()
        read.assert_not_called()

        finished = graph.invoke(
            Command(resume=[{"type": "accept", "args": {}}]),
            config,
        )
        assert "__interrupt__" not in finished
        send_tool.invoke.assert_called_once_with(SEND_ARGS)
        read.assert_called_once_with("2585")


def test_ignore_marks_read_without_sending():
    graph = _graph()
    send_tool = Mock(invoke=Mock())
    with (
        patch.object(
            flow,
            "llm_router",
            Mock(invoke=Mock(return_value=SimpleNamespace(classification="ignore"))),
        ),
        patch.dict(flow.tools_by_name, {"send_email_tool": send_tool}),
        patch.object(flow, "mark_as_read") as read,
    ):
        graph.invoke(
            {"email_input": EMAIL},
            {"configurable": {"thread_id": "offline-ignore-test"}},
        )
        send_tool.invoke.assert_not_called()
        read.assert_called_once_with("2585")


def test_edit_proposes_preferences_and_sends_once(tmp_path):
    store = InMemoryStore()
    graph = _graph(store)
    config = {"configurable": {"thread_id": "offline-edit-test"}}
    edited = {**SEND_ARGS, "response_text": "Thank you. I confirm receipt."}
    send_tool = Mock(invoke=Mock(return_value=f"Email reply sent successfully to test recipient {qq_tools.TEST_RECIPIENT}"))
    memory_model = Mock(
        invoke=Mock(
            return_value=SimpleNamespace(
                content="Use a more formal acknowledgment."
            )
        )
    )
    with (
        patch.object(
            flow,
            "llm_router",
            Mock(invoke=Mock(return_value=SimpleNamespace(classification="respond"))),
        ),
        patch.object(
            flow,
            "llm_with_tools",
            Mock(invoke=Mock(side_effect=[_send_call(), _done_call()])),
        ),
        patch.object(
            flow,
            "llm",
            memory_model,
        ),
        patch.dict(flow.tools_by_name, {"send_email_tool": send_tool}),
        patch.object(flow, "mark_as_read") as read,
    ):
        graph.invoke({"email_input": EMAIL}, config)
        finished = graph.invoke(
            Command(resume=[{"type": "edit", "args": {"args": edited}}]),
            config,
        )

        from email_assistant.memory import PreferenceRepository
        repository = PreferenceRepository(tmp_path)
        candidate = finished["preference_candidates"][0]
        assert candidate["new"] == "Use a more formal acknowledgment."
        assert repository.read("response") == candidate["old"]
        assert store.get(("email_assistant", "response_preferences"), "user_preferences") is None
        repository.confirm(candidate)
        send_tool.invoke.assert_called_once_with(edited)
        read.assert_called_once_with("2585")
        flow.llm_with_tools.invoke.side_effect = None
        flow.llm_with_tools.invoke.return_value = _send_call()
        flow.llm_call({"messages": [], "email_input": EMAIL}, {})
        prompt = flow.llm_with_tools.invoke.call_args.args[0][0]["content"]
        assert candidate["new"] in prompt


def test_send_failure_keeps_email_unread():
    graph = _graph()
    config = {"configurable": {"thread_id": "offline-send-failure-test"}}
    send_tool = Mock(invoke=Mock(side_effect=RuntimeError("SMTP failed")))
    with (
        patch.object(
            flow,
            "llm_router",
            Mock(invoke=Mock(return_value=SimpleNamespace(classification="respond"))),
        ),
        patch.object(
            flow,
            "llm_with_tools",
            Mock(invoke=Mock(return_value=_send_call())),
        ),
        patch.dict(flow.tools_by_name, {"send_email_tool": send_tool}),
        patch.object(flow, "mark_as_read") as read,
    ):
        graph.invoke({"email_input": EMAIL}, config)
        with pytest.raises(RuntimeError, match="SMTP failed"):
            graph.invoke(
                Command(resume=[{"type": "accept", "args": {}}]),
                config,
            )
        read.assert_not_called()


def test_qq_tool_uses_fixed_recipient_and_blocks_duplicate(tmp_path):
    with (
        patch.object(qq_tools, "SEND_LOG", tmp_path / "send.sqlite3"),
        patch.object(qq_tools, "QQ_EMAIL", "2942397812@qq.com"),
        patch.object(qq_tools, "QQ_EMAIL_AUTH_CODE", "offline-test-code"),
        patch.object(qq_tools, "fetch_email_by_uid", return_value=EMAIL),
        patch.object(qq_tools.smtplib, "SMTP_SSL") as smtp_class,
    ):
        smtp_class.return_value.__enter__.return_value.send_message.return_value = {}
        result = qq_tools.send_email_tool.invoke(SEND_ARGS)
        assert qq_tools.TEST_RECIPIENT in result
        message = smtp_class.return_value.__enter__.return_value.send_message.call_args.args[0]
        assert message["To"] == qq_tools.TEST_RECIPIENT
        assert message["Subject"] == "Re: Please confirm receipt"
        assert SEND_ARGS["response_text"] in message.get_content()

        with pytest.raises(Exception, match="UNIQUE constraint"):
            qq_tools.send_email_tool.invoke(SEND_ARGS)
        assert smtp_class.return_value.__enter__.return_value.send_message.call_count == 1


def test_qq_smtp_failure_retains_attempt_and_blocks_retry(tmp_path):
    send_log = tmp_path / "send.sqlite3"
    with (
        patch.object(qq_tools, "SEND_LOG", send_log),
        patch.object(qq_tools, "QQ_EMAIL", "2942397812@qq.com"),
        patch.object(qq_tools, "QQ_EMAIL_AUTH_CODE", "offline-test-code"),
        patch.object(qq_tools, "fetch_email_by_uid", return_value=EMAIL),
        patch.object(qq_tools.smtplib, "SMTP_SSL") as smtp_class,
    ):
        smtp = smtp_class.return_value.__enter__.return_value
        smtp.send_message.side_effect = RuntimeError("SMTP result unknown")
        with pytest.raises(RuntimeError, match="SMTP result unknown"):
            qq_tools.send_email_tool.invoke(SEND_ARGS)
        with sqlite3.connect(send_log) as db:
            assert db.execute("SELECT status FROM sends WHERE uid = '2585'").fetchone() == ("attempting",)
        with pytest.raises(sqlite3.IntegrityError, match="UNIQUE constraint"):
            qq_tools.send_email_tool.invoke(SEND_ARGS)
        smtp.send_message.assert_called_once()
