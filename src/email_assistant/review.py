"""Persistent graph/resume adapter for the single-user review page."""

import hashlib
import imaplib
import json
from pathlib import Path
import sqlite3
from threading import RLock
import uuid

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from email_assistant import email_assistant_hitl as flow
from email_assistant.memory import ApprovedReplyCase, ChromaRepository, DATA_ROOT, PreferenceRepository
from email_assistant.tools.qq import qq_tools


class ReviewService:
    def __init__(self, root=DATA_ROOT):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.root / "review-checkpoints.sqlite3", check_same_thread=False)
        self.saver = SqliteSaver(self.connection)
        self.saver.setup()
        self.connection.execute("CREATE TABLE IF NOT EXISTS review_decisions (key TEXT PRIMARY KEY, decision TEXT NOT NULL)")
        self.connection.commit()
        self.graph = flow.builder.compile(checkpointer=self.saver)
        self.lock = RLock()

    def config(self, thread_id):
        return {"configurable": {"thread_id": thread_id, "memory_root": str(self.root)}}

    def threads(self):
        with self.lock:
            rows = self.connection.execute(
                "SELECT thread_id FROM checkpoints WHERE checkpoint_ns = '' GROUP BY thread_id ORDER BY MAX(checkpoint_id) DESC"
            ).fetchall()
            return [row[0] for row in rows]

    def snapshot(self, thread_id):
        with self.lock:
            root = self.graph.get_state(self.config(thread_id), subgraphs=True)
            active = root
            while True:
                child = next((task.state for task in active.tasks if hasattr(task.state, "values")), None)
                if child is None:
                    break
                active = child
            values = {**root.values, **active.values}
            interrupts = active.interrupts or root.interrupts
            request = interrupts[0].value[0] if interrupts else None
            return root, values, request

    def submit(self, email):
        thread_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"qq:{qq_tools.QQ_EMAIL}:{email['id']}"))
        with self.lock:
            if not self.graph.get_state(self.config(thread_id)).values:
                self.graph.invoke({"email_input": email}, self.config(thread_id))
        return thread_id

    def fetch(self):
        if not qq_tools.QQ_EMAIL or not qq_tools.QQ_EMAIL_AUTH_CODE:
            raise ValueError("请先配置 QQ_EMAIL 和 QQ_EMAIL_AUTH_CODE")
        with imaplib.IMAP4_SSL("imap.qq.com", 993) as mailbox:
            mailbox.login(qq_tools.QQ_EMAIL, qq_tools.QQ_EMAIL_AUTH_CODE)
            status, _ = mailbox.select("INBOX", readonly=True)
            if status != "OK":
                raise RuntimeError("无法打开收件箱")
            emails = qq_tools.fetch_unread_emails(mailbox, limit=None)
        self.continue_legacy_routes()
        result = {"total": len(emails), "completed": 0, "pending": 0, "failed": 0}
        for email in emails:
            try:
                thread = self.submit(email)
                root, _, request = self.snapshot(thread)
                status = "pending" if request else ("failed" if root.next else "completed")
            except Exception:
                # The failed graph checkpoint remains available for explicit retry.
                status = "failed"
            result[status] += 1
        return result

    def continue_legacy_routes(self):
        """Resume checkpoints created when every predicted route required review."""
        for thread in self.threads():
            _, values, request = self.snapshot(thread)
            route = values.get("classification_decision")
            if request and request["action_request"]["action"].startswith("Email Assistant:") and route in {"ignore", "respond"}:
                try:
                    self.resume(thread, {"type": "accept", "args": {}, "route": route})
                except Exception:
                    # Keep this failure in its checkpoint and continue the other mail.
                    continue

    def resume(self, thread_id, decision):
        with self.lock:
            _, _, request = self.snapshot(thread_id)
            if request is None:
                raise ValueError("当前任务没有待审核操作")
            self.graph.invoke(Command(resume=[decision]), self.config(thread_id))

    def retry(self, thread_id):
        with self.lock:
            root, _, request = self.snapshot(thread_id)
            if request or not root.next:
                raise ValueError("当前任务无需重试")
            self.graph.invoke(None, self.config(thread_id))

    @staticmethod
    def candidate_key(thread_id, candidate):
        return hashlib.sha256((thread_id + json.dumps(candidate, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()

    def decision(self, key):
        with self.lock:
            row = self.connection.execute("SELECT decision FROM review_decisions WHERE key=?", (key,)).fetchone()
            return row[0] if row else None

    def save_decision(self, key, decision):
        self.connection.execute("INSERT OR REPLACE INTO review_decisions VALUES (?, ?)", (key, decision))
        self.connection.commit()

    def resolve_candidate(self, thread_id, candidate, accept):
        with self.lock:
            key = self.candidate_key(thread_id, candidate)
            if self.decision(key):
                return
            if accept:
                repository = PreferenceRepository(self.root)
                # File replace may succeed before a crash records the decision.
                if repository.read(candidate["kind"]) != candidate["new"]:
                    repository.confirm(candidate)
            self.save_decision(key, "accepted" if accept else "rejected")

    def retry_case(self, thread_id):
        with self.lock:
            _, values, _ = self.snapshot(thread_id)
            record = qq_tools.get_send_record(values["email_input"]["id"])
            if not record or record["status"] != "sent" or not record.get("actual_reply"):
                raise ValueError("发送审计没有确认成功及最终正文，不能保存案例")
            with ChromaRepository(self.root) as repository:
                repository.write(ApprovedReplyCase(record["subject"], record["body"], record["actual_reply"]))
            self.save_decision("case:" + thread_id, "saved")

    def close(self):
        self.connection.close()
