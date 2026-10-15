from typing import Literal
from pydantic import BaseModel
from langchain_core.tools import tool

@tool
def write_email(to: str, subject: str, content: str) -> str:
    """Record an approved email draft without sending it."""
    return f"Email draft approved for {to} with subject '{subject}' and content: {content}"

@tool
def triage_email(category: Literal["ignore", "notify", "respond"]) -> str:
    """Triage an email into one of three categories: ignore, notify, respond."""
    return f"Classification Decision: {category}"

@tool
class Done(BaseModel):
    """The email draft review is complete."""
    done: bool

@tool
class Question(BaseModel):
      """Question to ask user."""
      content: str
