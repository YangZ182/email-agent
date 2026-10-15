from typing import Dict, List, Optional

from langchain_core.tools import BaseTool


def get_tools(
    tool_names: Optional[List[str]] = None,
    include_qq: bool = False,
) -> List[BaseTool]:
    """Return the requested email tools."""
    from email_assistant.tools.default.email_tools import (
        Done,
        Question,
        write_email,
    )

    all_tools = {
        "write_email": write_email,
        "Question": Question,
        "Done": Done,
    }

    if include_qq:
        from email_assistant.tools.qq.qq_tools import send_email_tool

        all_tools["send_email_tool"] = send_email_tool

    if tool_names is None:
        return list(all_tools.values())

    return [all_tools[name] for name in tool_names if name in all_tools]


def get_tools_by_name(
    tools: Optional[List[BaseTool]] = None,
) -> Dict[str, BaseTool]:
    """Map tool names to tool objects."""
    if tools is None:
        tools = get_tools()

    return {tool.name: tool for tool in tools}
