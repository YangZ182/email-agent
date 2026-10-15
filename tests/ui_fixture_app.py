"""Isolated UI verification: synthetic mail, deterministic models, simulated sending."""

import os
import re
from pathlib import Path
import sqlite3
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import Mock

from langchain_core.messages import AIMessage
import streamlit as st

from email_assistant import email_assistant_hitl as flow
from email_assistant import memory, review_app
from email_assistant.review import ReviewService
from email_assistant.tools.qq import qq_tools


@st.cache_resource
def fixture_service():
    parent = Path(__file__).resolve().parents[1] / ".ui-check-runtime"
    parent.mkdir(exist_ok=True)
    root = Path(os.getenv("EMAIL_UI_CHECK_ROOT") or tempfile.mkdtemp(prefix="ui-", dir=parent))
    qq_tools.QQ_EMAIL = "offline-ui@example.com"
    qq_tools.SEND_LOG = root / "send.sqlite3"
    qq_tools.imaplib.IMAP4_SSL = Mock(side_effect=AssertionError("Real IMAP forbidden in UI fixture"))
    qq_tools.smtplib.SMTP_SSL = Mock(side_effect=AssertionError("Real SMTP forbidden in UI fixture"))
    memory.DashScopeEmbedding = lambda: lambda texts: [[1., 0., 0.] for _ in texts]
    flow.mark_as_read = Mock()

    def triage(messages):
        content = messages[-1]["content"]
        category = "ignore" if "促销广告" in content else ("notify" if "账户续费通知" in content or "系统维护通知" in content else "respond")
        return SimpleNamespace(classification=category, reasoning="合成邮件：确认请求需要回复；续费邮件用于测试人工纠正。")

    def reply(messages):
        answered = any(getattr(message, "type", "") == "tool" for message in messages)
        uid = re.search(r"\*\*ID\*\*: (\d+)", str(messages)).group(1)
        direct = uid != "90001"
        call = {"name": "send_email_tool", "id": "send-1", "args": {
            "email_id": uid, "response_text": "确认收到，谢谢。" if direct else "报告将在周五提交，谢谢。",
            "email_address": qq_tools.QQ_EMAIL, "additional_recipients": None}}
        if not answered and not direct:
            call = {"name": "Question", "id": "q-1", "args": {"content": "请确认报告提交日期。"}}
        return AIMessage(content="", tool_calls=[call])

    def preference(messages):
        kind = "triage" if "triage 偏好" in messages[0]["content"] else "response"
        old = memory.PreferenceRepository(root).read(kind)
        extra = "\nNOTIFY: 提醒我注意账户续费通知。\n" if kind == "triage" else "\n使用单句回复，保持简洁，不虚构事实。\n"
        return SimpleNamespace(content=old + extra)

    def send(args):
        time.sleep(2)  # Verify disabled controls while the simulated send is running.
        with sqlite3.connect(qq_tools.SEND_LOG) as db:
            db.execute("CREATE TABLE IF NOT EXISTS sends (uid TEXT PRIMARY KEY, status TEXT, subject TEXT, body TEXT, actual_reply TEXT)")
            db.execute("INSERT INTO sends VALUES (?, 'attempting', ?, ?, ?)",
                       (args["email_id"], "合成审核邮件", "仅用于界面验收", args["response_text"]))
        if "模拟失败" in args["response_text"]:
            raise RuntimeError("Simulated SMTP failure; no external send")
        with sqlite3.connect(qq_tools.SEND_LOG) as db:
            db.execute("UPDATE sends SET status='sent' WHERE uid=?", (args["email_id"],))
        return f"Email reply sent successfully to test recipient {qq_tools.TEST_RECIPIENT}"

    flow.llm_router = Mock(invoke=triage)
    flow.llm_with_tools = Mock(invoke=reply)
    flow.llm = Mock(invoke=preference)
    flow.tools_by_name["send_email_tool"] = Mock(invoke=send)
    service = ReviewService(root)
    service.fetch = Mock(side_effect=[
        {"total": 6, "completed": 1, "pending": 5, "failed": 0},
        ValueError("合成验收页面已禁用真实邮箱读取"),
    ])
    for uid, subject, body in [("90001", "报告提交日期", "您好，请确认报告将在何时提交。"),
                               ("90002", "确认收件", "请确认收到附件，谢谢。"),
                               ("90003", "账户续费通知", "**服务将在下周续费**，无需回复。\n\n[查看账户](https://example.com/account?tracking=123456789)\n\n" + "续费说明。\n\n" * 30),
                               ("90004", "放弃本次回复", "本邮件用于检查人工放弃回复。"),
                               ("90005", "促销广告", "促销广告自动忽略。"),
                               ("90006", "系统维护通知", "周六系统维护，请知悉。")]:
        service.submit({"id": uid, "author": "测试发件人 <sender@example.com>", "to": qq_tools.QQ_EMAIL,
                        "subject": subject, "email_thread": body})
    return service


review_app.get_service = fixture_service
review_app.main()
