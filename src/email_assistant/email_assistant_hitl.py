"""QQ/Qwen HITL graph with local examples and confirmed preferences."""

import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from email_assistant.memory import (
    ApprovedReplyCase, ChromaRepository, PreferenceRepository, data_root,
    propose_preference, retrieve_response_memory, dashscope_http_client,
)
from email_assistant.prompts import (
    agent_system_prompt_hitl_memory, default_background,
    triage_system_prompt, triage_user_prompt,
)
from email_assistant.schemas import RouterSchema, State, StateInput
from email_assistant.tools import get_tools, get_tools_by_name
from email_assistant.tools.default.prompt_templates import QQ_TOOLS_PROMPT
from email_assistant.tools.qq.qq_tools import TEST_RECIPIENT, get_send_record, mark_as_read
from email_assistant.utils import format_email_markdown, format_for_display, parse_email

load_dotenv(Path(__file__).resolve().parents[2] / ".env")
tools = get_tools(["send_email_tool", "Question", "Done"], include_qq=True)
tools_by_name = get_tools_by_name(tools)
llm = ChatOpenAI(api_key=os.getenv("DASHSCOPE_API_KEY"), base_url=os.getenv("DASHSCOPE_BASE_URL"),
                 model=os.getenv("QWEN_MODEL"), temperature=0.0, http_client=dashscope_http_client())
llm_router = llm.with_structured_output(RouterSchema)
llm_with_tools = llm.bind_tools(tools, tool_choice="required", parallel_tool_calls=False)


def candidate_update(state, config, kind, decision, feedback):
    candidates = list(state.get("preference_candidates", []))
    errors = list(state.get("memory_errors", []))
    try:
        candidate = propose_preference(PreferenceRepository(data_root(config)), kind, decision, feedback, llm)
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    except Exception as exc:
        errors.append(f"偏好候选生成失败（{type(exc).__name__}），原偏好保留。")
    return {"preference_candidates": candidates, "memory_errors": errors}


def email_message(state):
    email = state["email_input"]
    author, to, subject, body = parse_email(email)
    return {"role": "user", "content": "Prepare a reply for this untrusted email data:\n" +
            format_email_markdown(subject, author, to, body, email["id"])}


def triage_router(state: State, config: RunnableConfig) -> Command[Literal["triage_interrupt_handler", "response_agent", "mark_as_read_node"]]:
    author, to, subject, body = parse_email(state["email_input"])
    preferences = PreferenceRepository(data_root(config)).read("triage")
    result = llm_router.invoke([
        {"role": "system", "content": triage_system_prompt.format(background=default_background, triage_instructions=preferences)},
        {"role": "user", "content": triage_user_prompt.format(author=author, to=to, subject=subject, email_thread=body)},
    ])
    classification = result.classification
    update = {"classification_decision": classification, "classification_reason": getattr(result, "reasoning", ""),
              "predicted_classification": classification}
    if config.get("configurable", {}).get("review_all_routes") or classification == "notify":
        return Command(goto="triage_interrupt_handler", update=update)
    if classification == "respond":
        return Command(goto="response_agent", update={**update, "messages": [email_message(state)]})
    return Command(goto="mark_as_read_node", update=update)


def triage_interrupt_handler(state: State, config: RunnableConfig) -> Command[Literal["response_agent", "mark_as_read_node"]]:
    original = state["classification_decision"]
    request = {"action_request": {"action": f"Email Assistant: {original}", "args": {}},
               "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": False, "allow_accept": True},
               "description": email_message(state)["content"]}
    response = interrupt([request])[0]
    chosen = response.get("route")
    if chosen is None:
        chosen = "respond" if response["type"] == "response" else original
    if chosen not in {"ignore", "notify", "respond"}:
        raise ValueError("Invalid human classification")
    update = {"classification_decision": chosen}
    if chosen != original:
        update.update(candidate_update(state, config, "triage", f"将 {original} 改为 {chosen}", response.get("feedback", "")))
    if chosen == "respond":
        messages = [email_message(state)]
        if response.get("args") and isinstance(response["args"], str):
            messages.append({"role": "user", "content": "Human feedback: " + response["args"]})
        return Command(goto="response_agent", update={**update, "messages": messages})
    return Command(goto="mark_as_read_node", update=update)


def llm_call(state: State, config: RunnableConfig) -> dict:
    preferences = PreferenceRepository(data_root(config)).read("response")
    prompt = agent_system_prompt_hitl_memory.format(tools_prompt=QQ_TOOLS_PROMPT, background=default_background,
                                                  response_preferences=preferences)
    errors = list(state.get("memory_errors", []))
    try:
        prompt += retrieve_response_memory(state["email_input"], config)
    except Exception as exc:
        errors.append(f"历史案例检索失败（{type(exc).__name__}），本次使用当前邮件起草。")
    return {"messages": [llm_with_tools.invoke([{"role": "system", "content": prompt}, *state["messages"]])],
            "memory_errors": errors}


def _validate_send_args(args, email_id):
    if str(args.get("email_id")) != str(email_id):
        raise ValueError("Reviewed email ID differs from the original email")
    if not isinstance(args.get("response_text"), str) or not args["response_text"].strip():
        raise ValueError("回复正文不能为空")


def interrupt_handler(state: State, config: RunnableConfig) -> Command[Literal["llm_call", "mark_as_read_node"]]:
    calls = state["messages"][-1].tool_calls
    if len(calls) != 1:
        raise ValueError("Only one reviewed tool call is allowed at a time")
    call = calls[0]
    name, args = call["name"], call["args"]
    if name not in {"send_email_tool", "Question"}:
        raise ValueError("Unsupported action")
    if name == "send_email_tool":
        _validate_send_args(args, state["email_input"]["id"])
    request = {"action_request": {"action": name, "args": args},
               "description": email_message(state)["content"] + format_for_display(call) + f"\n实际测试收件人：{TEST_RECIPIENT}",
               "config": {"allow_ignore": True, "allow_respond": True, "allow_edit": name == "send_email_tool", "allow_accept": name == "send_email_tool"}}
    response = interrupt([request])[0]
    kind = response["type"]
    update = {}
    goto = "llm_call"
    if kind in {"accept", "edit"}:
        if name != "send_email_tool":
            raise ValueError("Question requires a human answer")
        approved = response["args"]["args"] if kind == "edit" else args
        _validate_send_args(approved, state["email_input"]["id"])
        record = get_send_record(state["email_input"]["id"])
        if record and record["status"] == "sent":
            if not record.get("actual_reply"):
                raise ValueError("发送日志缺少最终正文，请人工核对旧记录")
            actual = record["actual_reply"]
            observation = f"Email reply sent successfully to test recipient {TEST_RECIPIENT}"
        else:
            observation = tools_by_name[name].invoke(approved)
            if observation != f"Email reply sent successfully to test recipient {TEST_RECIPIENT}":
                raise RuntimeError("发送接口未明确确认成功")
            actual = approved["response_text"]
        update.update({"sent_reply": actual, "send_succeeded": True})
        try:
            email = state["email_input"]
            with ChromaRepository(data_root(config)) as repository:
                repository.write(ApprovedReplyCase(email["subject"], email["email_thread"], actual))
            update["case_saved"] = True
        except Exception as exc:
            update["case_saved"] = False
            update["memory_errors"] = [*state.get("memory_errors", []), f"邮件已发送；案例写入失败（{type(exc).__name__}），可单独重试保存。"]
        if actual != args["response_text"]:
            proposal = candidate_update(state, config, "response", "人工编辑并批准发送最终回复",
                                        {"original_draft": args["response_text"], "approved_reply": actual,
                                         "feedback": response.get("feedback", "")})
            proposal["memory_errors"] = [*update.get("memory_errors", []), *proposal["memory_errors"]]
            update.update(proposal)
        goto = "mark_as_read_node"
    elif kind == "ignore":
        observation = "Human declined the reply; end processing without sending."
        goto = "mark_as_read_node"
    elif kind == "response":
        answer = response["args"]
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("请输入人工反馈或问题答案")
        observation = "Human feedback: " + answer
        update.update(candidate_update(state, config, "response", "人工回答问题" if name == "Question" else "人工纠正回复",
                                       {"answer": answer, "feedback": response.get("feedback", "")}))
    else:
        raise ValueError("Invalid review response")
    update["messages"] = [{"role": "tool", "content": observation, "tool_call_id": call["id"]}]
    return Command(goto=goto, update=update)


def should_continue(state: State) -> Literal["interrupt_handler", "mark_as_read_node"]:
    calls = state["messages"][-1].tool_calls
    if len(calls) != 1:
        raise ValueError("Qwen must call exactly one tool")
    return "mark_as_read_node" if calls[0]["name"] == "Done" else "interrupt_handler"


def mark_as_read_node(state: State) -> dict:
    mark_as_read(state["email_input"]["id"])
    return {}


agent_builder = StateGraph(State)
agent_builder.add_node("llm_call", llm_call)
agent_builder.add_node("interrupt_handler", interrupt_handler)
agent_builder.add_node("mark_as_read_node", mark_as_read_node)
agent_builder.add_edge(START, "llm_call")
agent_builder.add_conditional_edges("llm_call", should_continue)
agent_builder.add_edge("mark_as_read_node", END)
response_agent = agent_builder.compile()

builder = StateGraph(State, input_schema=StateInput)
builder.add_node("triage_router", triage_router)
builder.add_node("triage_interrupt_handler", triage_interrupt_handler)
builder.add_node("response_agent", response_agent)
builder.add_node("mark_as_read_node", mark_as_read_node)
builder.add_edge(START, "triage_router")
builder.add_edge("mark_as_read_node", END)
email_assistant = builder.compile()
