"""Tool prompt templates for the email assistant."""

# Standard tool descriptions for insertion into prompts
STANDARD_TOOLS_PROMPT = """
1. triage_email(ignore, notify, respond) - Triage emails into one of three categories
2. write_email(to, subject, content) - Send emails to specified recipients
3. schedule_meeting(attendees, subject, duration_minutes, preferred_day, start_time) - Schedule calendar meetings where preferred_day is a datetime object
4. check_calendar_availability(day) - Check available time slots for a given day
5. Done - E-mail has been sent
"""

# Tool descriptions for HITL workflow
HITL_TOOLS_PROMPT = """
1. write_email(to, subject, content) - Prepare an email reply for human review. This tool does not send email.
2. Question(content) - Ask the mailbox owner for missing information before drafting a reply.
"""

# Tool descriptions for HITL with memory workflow
# Note: Additional memory specific tools could be added here 
HITL_MEMORY_TOOLS_PROMPT = """
1. write_email(to, subject, content) - Send emails to specified recipients
2. schedule_meeting(attendees, subject, duration_minutes, preferred_day, start_time) - Schedule calendar meetings where preferred_day is a datetime object
3. check_calendar_availability(day) - Check available time slots for a given day
4. Question(content) - Ask the user any follow-up questions
5. Done - E-mail has been sent
"""

QQ_TOOLS_PROMPT = """
1. send_email_tool(email_id, response_text, email_address, additional_recipients) - Prepare a reply tied to the current QQ email for human review. It sends only after approval.
2. Question(content) - Ask the mailbox owner for missing information.
3. Done(done) - Indicate that the approved reply has been sent successfully.
"""

# Tool descriptions for agent workflow without triage
AGENT_TOOLS_PROMPT = """
1. write_email(to, subject, content) - Send emails to specified recipients
2. schedule_meeting(attendees, subject, duration_minutes, preferred_day, start_time) - Schedule calendar meetings where preferred_day is a datetime object
3. check_calendar_availability(day) - Check available time slots for a given day
4. Done - E-mail has been sent
"""
