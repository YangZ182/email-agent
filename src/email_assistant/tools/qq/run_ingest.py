import imaplib
import os
import uuid

from langgraph_sdk import get_sync_client

from email_assistant.tools.qq.qq_tools import (
    QQ_EMAIL,
    QQ_EMAIL_AUTH_CODE,
    fetch_unread_emails,
)


def main():
    """Submit one unread QQ email to the local Agent Server."""
    if not QQ_EMAIL or not QQ_EMAIL_AUTH_CODE:
        raise ValueError("Missing QQ_EMAIL or QQ_EMAIL_AUTH_CODE in .env")

    with imaplib.IMAP4_SSL("imap.qq.com", 993) as mailbox:
        mailbox.login(QQ_EMAIL, QQ_EMAIL_AUTH_CODE)
        status, _ = mailbox.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("Could not open the inbox")
        emails = fetch_unread_emails(mailbox, limit=1)

    if not emails:
        print("No unread emails")
        return

    email_input = emails[0]
    client = get_sync_client(url=os.getenv("LANGGRAPH_URL", "http://127.0.0.1:2024"))
    thread_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"qq:{QQ_EMAIL}:{email_input['id']}"))
    client.threads.create(thread_id=thread_id, if_exists="do_nothing")
    existing_runs = client.runs.list(thread_id, limit=1)
    if existing_runs:
        print("Already submitted. Thread:", thread_id, "Status:", existing_runs[0]["status"])
        return

    client.runs.create(
        thread_id,
        "email_assistant_hitl",
        input={"email_input": email_input},
    )
    print("Submitted to Agent Inbox. Thread:", thread_id)


if __name__ == "__main__":
    main()
