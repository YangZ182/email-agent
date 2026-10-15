import imaplib
import os
import smtplib
import sqlite3
from typing import List, Optional
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import parseaddr
from pathlib import Path
from langchain_core.tools import tool
from pydantic import BaseModel, Field
from email_assistant.utils import parse_email
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[4]
load_dotenv(PROJECT_ROOT / ".env")

QQ_EMAIL = os.getenv("QQ_EMAIL")
QQ_EMAIL_AUTH_CODE = os.getenv("QQ_EMAIL_AUTH_CODE")
SEND_LOG = PROJECT_ROOT / ".qq-send-log.sqlite3"
TEST_RECIPIENT = "2942397812@qq.com"


def get_send_record(uid):
    """Read the audit without creating a database or changing old records."""
    if not SEND_LOG.exists():
        return None
    with sqlite3.connect(f"{SEND_LOG.as_uri()}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        if not db.execute("SELECT name FROM sqlite_master WHERE name='sends'").fetchone():
            return None
        row = db.execute("SELECT * FROM sends WHERE uid = ?", (str(uid),)).fetchone()
        return dict(row) if row else None


class SendEmailInput(BaseModel):
    """Reference-compatible input for one QQ reply."""

    email_id: str = Field(description="QQ IMAP UID for the email being reviewed")
    response_text: str = Field(description="Body of the proposed reply")
    email_address: str = Field(description="Mailbox address that sends the reply")
    additional_recipients: Optional[List[str]] = Field(
        default=None,
        description="Must be empty during the controlled MVP test",
    )


def extract_body(message):
    """Extract plain text when available, otherwise return HTML."""
    parts = list(message.walk())

    for content_type in ("text/plain", "text/html"):
        for part in parts:
            if (
                part.get_content_type() == content_type
                and part.get_content_disposition() != "attachment"
            ):
                return part.get_content()

    return ""


def parse_email_message(raw_email, uid):
    """Convert a raw email into the structure needed by the agent."""
    message = BytesParser(policy=policy.default).parsebytes(raw_email)

    return {
        "id": uid.decode(),
        "message_id": str(message["Message-ID"] or ""),
        "author": str(message["From"] or ""),
        "to": str(message["To"] or ""),
        "subject": str(message["Subject"] or ""),
        "date": str(message["Date"] or ""),
        "email_thread": extract_body(message),
    }


def fetch_unread_emails(mailbox, limit=5):
    """Fetch newest unread emails; limit=None reads all, without marking read."""
    status, data = mailbox.uid("search", None, "UNSEEN")
    if status != "OK":
        raise RuntimeError("Could not search the inbox")

    email_uids = data[0].split()
    selected_uids = (email_uids if limit is None else email_uids[-limit:])[::-1]

    emails = []

    for uid in selected_uids:
        status, data = mailbox.uid(
            "fetch",
            uid,
            "(BODY.PEEK[])",
        )
        if status != "OK":
            raise RuntimeError(f"Could not fetch email UID {uid.decode()}")

        raw_email = next(item[1] for item in data if isinstance(item, tuple))
        emails.append(parse_email_message(raw_email, uid))

    return emails


def fetch_email_by_uid(uid):
    """Fetch one QQ message without changing its unread flag."""
    if not str(uid).isdecimal():
        raise ValueError("Invalid QQ email UID")
    if not QQ_EMAIL or not QQ_EMAIL_AUTH_CODE:
        raise ValueError("Missing QQ mail credentials")

    with imaplib.IMAP4_SSL("imap.qq.com", 993) as mailbox:
        mailbox.login(QQ_EMAIL, QQ_EMAIL_AUTH_CODE)
        status, _ = mailbox.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("Could not open the inbox")
        status, data = mailbox.uid("fetch", str(uid), "(BODY.PEEK[])")
        if status != "OK":
            raise RuntimeError(f"Could not fetch email UID {uid}")
        raw_email = next(item[1] for item in data if isinstance(item, tuple))
        return parse_email_message(raw_email, str(uid).encode())


def send_approved_reply(email_input, draft):
    """Send one approved reply to this mailbox in test mode."""
    if not QQ_EMAIL or not QQ_EMAIL_AUTH_CODE:
        raise ValueError("Missing QQ mail credentials")
    recipient = TEST_RECIPIENT
    original_sender = parseaddr(email_input["author"])[1]
    if parseaddr(draft["to"])[1] != original_sender:
        raise ValueError("Draft recipient differs from the original sender")

    message = EmailMessage()
    message["From"] = QQ_EMAIL
    message["To"] = recipient
    message["Subject"] = draft["subject"]
    if email_input.get("message_id"):
        message["In-Reply-To"] = email_input["message_id"]
        message["References"] = email_input["message_id"]
    message.set_content(draft["content"])

    uid = email_input["id"]
    with sqlite3.connect(SEND_LOG) as db:
        db.execute("CREATE TABLE IF NOT EXISTS sends (uid TEXT PRIMARY KEY, status TEXT NOT NULL)")
        columns = {row[1] for row in db.execute("PRAGMA table_info(sends)")}
        for column in ("subject", "body", "actual_reply"):
            if column not in columns:
                db.execute(f"ALTER TABLE sends ADD COLUMN {column} TEXT")
        db.execute("INSERT INTO sends (uid, status, subject, body, actual_reply) VALUES (?, 'attempting', ?, ?, ?)",
                   (uid, email_input["subject"], email_input["email_thread"], draft["content"]))
        db.commit()

    with smtplib.SMTP_SSL("smtp.qq.com", 465, timeout=20) as smtp:
        smtp.login(QQ_EMAIL, QQ_EMAIL_AUTH_CODE)
        refused = smtp.send_message(message)
        if refused:
            raise RuntimeError("SMTP did not accept the test recipient")

    with sqlite3.connect(SEND_LOG) as db:
        db.execute("UPDATE sends SET status = 'sent' WHERE uid = ?", (uid,))
        db.commit()
    return recipient


@tool(args_schema=SendEmailInput)
def send_email_tool(
    email_id: str,
    response_text: str,
    email_address: str,
    additional_recipients: Optional[List[str]] = None,
) -> str:
    """Send one human-approved QQ reply to the controlled test recipient."""
    if parseaddr(email_address)[1].lower() != (QQ_EMAIL or "").lower():
        raise ValueError("Tool sender differs from QQ_EMAIL")
    if additional_recipients:
        raise ValueError("Additional recipients are disabled during MVP testing")

    email_input = fetch_email_by_uid(email_id)
    subject = email_input["subject"]
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"
    draft = {
        "to": parseaddr(email_input["author"])[1],
        "subject": subject,
        "content": response_text,
    }
    recipient = send_approved_reply(email_input, draft)
    return f"Email reply sent successfully to test recipient {recipient}"


def mark_as_read(uid):
    """Mark one QQ INBOX UID as read after successful processing."""
    if not str(uid).isdecimal():
        raise ValueError("Invalid QQ email UID")
    with imaplib.IMAP4_SSL("imap.qq.com", 993) as mailbox:
        mailbox.login(QQ_EMAIL, QQ_EMAIL_AUTH_CODE)
        status, _ = mailbox.select("INBOX")
        if status != "OK":
            raise RuntimeError("Could not open the inbox for writing")
        status, _ = mailbox.uid("store", uid, "+FLAGS.SILENT", "(\\Seen)")
        if status != "OK":
            raise RuntimeError(f"Could not mark QQ email UID {uid} as read")
        status, data = mailbox.uid("fetch", uid, "(FLAGS)")
        if status != "OK" or not any(b"\\Seen" in item for item in data if isinstance(item, bytes)):
            raise RuntimeError(f"QQ email UID {uid} was not confirmed as read")

def main():
    """Connect to QQ Mail and inspect unread emails."""
    if not QQ_EMAIL or not QQ_EMAIL_AUTH_CODE:
        raise ValueError("Missing QQ_EMAIL or QQ_EMAIL_AUTH_CODE in .env")

    with imaplib.IMAP4_SSL("imap.qq.com", 993) as mailbox:
        mailbox.login(QQ_EMAIL, QQ_EMAIL_AUTH_CODE)

        status, data = mailbox.select("INBOX", readonly=True)
        if status != "OK":
            raise RuntimeError("Could not open the inbox")

        message_count = int(data[0])
        print(f"Connected to QQ Mail: {QQ_EMAIL}")
        print(f"Inbox message count: {message_count}")

        emails = fetch_unread_emails(mailbox)
        if emails:
            author, to, subject, email_thread = parse_email(emails[0])

            print("\nAgent input validation:")
            print(f"Author: {author}")
            print(f"To: {to}")
            print(f"Subject: {subject}")
            print(f"Body length: {len(email_thread)}")

        if not emails:
            print("No unread emails")
            return

        print(f"\nUnread emails selected: {len(emails)}")

        for index, email_data in enumerate(emails, start=1):
            body_preview = " ".join(email_data["email_thread"].split())[:300]

            print(f"\nEmail {index}:")
            print(f"ID: {email_data['id']}")
            print(f"From: {email_data['author']}")
            print(f"To: {email_data['to']}")
            print(f"Subject: {email_data['subject']}")
            print(f"Date: {email_data['date']}")
            print(f"Body preview: {body_preview}")


if __name__ == "__main__":
    main()
