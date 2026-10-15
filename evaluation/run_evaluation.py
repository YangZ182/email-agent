"""Evaluate the existing QQ/Qwen graph without touching a mailbox."""

import argparse
from collections import Counter
from contextlib import ExitStack
from datetime import datetime
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import Mock, patch
from uuid import uuid4
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "src"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")
os.environ["LANGSMITH_TRACING"] = "false"
os.environ["LANGCHAIN_TRACING_V2"] = "false"

LABELS = ("ignore", "notify", "respond")


def safe_error(error):
    """Remove configured credentials from exception text."""
    text = str(error)
    for key, value in os.environ.items():
        if value and any(word in key.upper() for word in ("KEY", "TOKEN", "AUTH_CODE", "PASSWORD")):
            text = text.replace(value, "[redacted]")
    return text


def summarize(rows):
    matrix = {label: {pred: 0 for pred in (*LABELS, "error")} for label in LABELS}
    for row in rows:
        pred = row["actual_classification"] if not row["error"] else "error"
        matrix[row["expected_classification"]][pred if pred in LABELS else "error"] += 1
    metrics = {}
    for label in LABELS:
        tp = matrix[label][label]
        predicted = sum(matrix[gold][label] for gold in LABELS)
        total = sum(matrix[label].values())
        precision = tp / predicted if predicted else 0.0
        recall = tp / total if total else 0.0
        metrics[label] = {"precision": precision, "recall": recall,
                          "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0}
    correct = sum(matrix[label][label] for label in LABELS)
    respond = [row for row in rows if row["expected_classification"] == "respond"]
    paused = [row for row in rows if row["interrupts"]]
    return {"total": len(rows), "correct": correct,
            "accuracy": correct / len(rows) if rows else None,
            "errors": sum(bool(row["error"]) for row in rows), "confusion_matrix": matrix,
            "per_class": metrics, "macro_f1": sum(m["f1"] for m in metrics.values()) / 3,
            "tool_correct": sum(row["tool_passed"] for row in respond), "tool_total": len(respond),
            "paused_total": len(paused),
            "paused_sends": sum(len(row["operations"]["send"]) for row in paused),
            "paused_reads": sum(len(row["operations"]["mark_as_read"]) for row in paused)}


class RecordingModel:
    def __init__(self, model, records, stage):
        self.model, self.records, self.stage = model, records, stage

    def invoke(self, messages):
        result = self.model.invoke(messages)
        self.records.append({"stage": self.stage, "output": result.model_dump(mode="json")})
        return result


def run_case(case, flow, model):
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.store.memory import InMemoryStore
    from email_assistant.schemas import RouterSchema
    from email_assistant.tools.qq import qq_tools

    outputs, sends, reads = [], [], []
    row = {**case, "actual_classification": None, "model_outputs": outputs,
           "tool_proposals": [], "interrupts": [], "operations": {"send": sends, "mark_as_read": reads},
           "classification_passed": False, "tool_passed": False, "flow_passed": False, "error": None}
    started = time.perf_counter()
    def fake_send(args):
        sends.append(args)
        return "simulated send"
    with ExitStack() as stack:
        from email_assistant import memory
        import chromadb
        isolated = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="evaluation-memory-", dir=ROOT)))
        rag = memory.ChromaRepository(isolated, client=chromadb.EphemeralClient())
        stack.enter_context(patch.object(memory, "ChromaRepository", return_value=rag))
        stack.enter_context(patch.object(flow, "data_root", return_value=isolated))
        stack.enter_context(patch.object(memory, "data_root", return_value=isolated))
        stack.enter_context(patch.object(flow, "get_send_record", return_value=None))
        stack.enter_context(patch.object(memory, "DashScopeEmbedding", side_effect=AssertionError("Baseline embedding forbidden")))
        stack.enter_context(patch.object(flow, "mark_as_read", side_effect=lambda uid: reads.append(uid)))
        stack.enter_context(patch.dict(flow.tools_by_name, {"send_email_tool": Mock(invoke=fake_send)}))
        # Guard the lower-level network constructors as well as the graph entry points.
        stack.enter_context(patch.object(qq_tools.imaplib, "IMAP4_SSL", side_effect=AssertionError("Mailbox access forbidden")))
        stack.enter_context(patch.object(qq_tools.smtplib, "SMTP_SSL", side_effect=AssertionError("SMTP access forbidden")))
        stack.enter_context(patch.object(flow, "llm_router", RecordingModel(model.with_structured_output(RouterSchema), outputs, "triage")))
        stack.enter_context(patch.object(flow, "llm_with_tools", RecordingModel(model.bind_tools(flow.tools, tool_choice="required"), outputs, "response")))
        graph = flow.builder.compile(checkpointer=InMemorySaver(), store=InMemoryStore())
        config = {"configurable": {"thread_id": str(uuid4())}, "recursion_limit": 12}
        try:
            result = graph.invoke({"email_input": case["email_input"]}, config)
            row["actual_classification"] = result.get("classification_decision")
            row["interrupts"] = [item.value for item in result.get("__interrupt__", [])]
        except Exception as exc:
            row["error"] = {"type": type(exc).__name__, "message": safe_error(exc)}
            for output in outputs:
                if output["stage"] == "triage":
                    row["actual_classification"] = output["output"]["classification"]
        for output in outputs:
            if output["stage"] == "response":
                row["tool_proposals"].extend(output["output"].get("tool_calls", []))
    row["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    row["classification_passed"] = not row["error"] and row["actual_classification"] == case["expected_classification"]
    requests = [request for interrupt in row["interrupts"] for request in interrupt]
    actions = [request["action_request"]["action"] for request in requests]
    row["tool_passed"] = bool(row["classification_passed"] and case["expected_tool"] in actions) if case["expected_tool"] else False
    gold = case["expected_classification"]
    if gold == "ignore":
        valid = not requests and reads == [case["email_input"]["id"]] and not sends
    elif gold == "notify":
        valid = actions == ["Email Assistant: notify"] and not sends and not reads
    else:
        valid = row["tool_passed"] and not sends and not reads
        for request in requests:
            if request["action_request"]["action"] == "send_email_tool":
                valid = valid and str(request["action_request"]["args"].get("email_id")) == case["email_input"]["id"]
                valid = valid and qq_tools.TEST_RECIPIENT in request["description"]
    row["flow_passed"] = bool(row["classification_passed"] and valid)
    return row


def run_flow_checks():
    """Reuse pytest tests, retaining a record for every call/collection failure."""
    import pytest
    records = []
    class Reporter:
        def pytest_runtest_logreport(self, report):
            if report.when == "call" or report.failed:
                records.append({"case_id": report.nodeid, "expected": "passed", "actual": report.outcome,
                                "passed": report.passed, "error": safe_error(report.longrepr) if report.failed else None})
        def pytest_collectreport(self, report):
            if report.failed:
                records.append({"case_id": report.nodeid, "expected": "collected", "actual": "error", "passed": False,
                                "error": safe_error(report.longrepr)})
    # A fresh project-local directory avoids ownership conflicts between Windows
    # restricted and normal user tokens in pytest's shared temporary directory.
    with tempfile.TemporaryDirectory(prefix="evaluation-tests-", dir=ROOT) as temp:
        code = pytest.main([str(ROOT / "tests/test_qq_flow.py"), "-q", "-p", "no:langsmith",
                            "-p", "no:cacheprovider", "--basetemp", str(Path(temp) / "pytest")], plugins=[Reporter()])
    if code and not any(not row["passed"] for row in records):
        records.append({"case_id": "pytest_exit", "expected": 0, "actual": int(code), "passed": False, "error": "pytest did not complete"})
    return records


def send_log_snapshot():
    return {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in ROOT.glob(".qq-send-log.sqlite3*")}


def live_model(flow):
    # Construct a new client: copying model fields would retain the original
    # OpenAI client's retry and timeout settings.
    return type(flow.llm)(api_key=flow.llm.openai_api_key, base_url=flow.llm.openai_api_base,
                          model=flow.llm.model_name, temperature=flow.llm.temperature,
                          timeout=60.0, max_retries=0, http_client=flow.dashscope_http_client())


def bad_case_analysis(details):
    rows = details["baseline"]
    failures = [row for row in rows if not row["flow_passed"]]
    lines = ["## Bad case 分析", ""]
    if rows:
        lines += [f"基线失败 {len(failures)}/{len(rows)}。逐样本输入、模型输出和操作记录保留在 `details.json`，此处按错误类型总结。", ""]
    errors = Counter(row["error"]["type"] for row in failures if row["error"])
    for kind, count in errors.items():
        lines += [f"**运行错误：{kind}（{count} 封）**。执行未完成，不能据此判断模型分类能力；先排查该类运行错误。", ""]
    groups = {}
    for row in failures:
        if not row["error"] and not row["classification_passed"]:
            groups.setdefault((row["expected_classification"], row["actual_classification"]), []).append(row)
    for (gold, pred), group in groups.items():
        lines += [f"**标准 {gold} → 预测 {pred}：{len(group)} 封。**",
                  "代表场景：" + "、".join(row["email_input"]["subject"] for row in group[:3]) + "。", ""]
        reasons = "\n".join(output["output"].get("reasoning", "") for row in group
                            for output in row["model_outputs"] if output["stage"] == "triage").lower()
        if gold == "notify" and pred == "ignore" and ("no reply" in reasons or "no response" in reasons or "do not reply" in reasons):
            marked = sum(bool(row["operations"]["mark_as_read"]) for row in group)
            lines += ["模型分类理由反复引用“无须回复”和“自动通知”，并据此判断无需提醒；其中包含监控告警、费用续订、账号安全或截止日期等有用信息。由这些理由推测，模型过度依赖是否要求回信，未充分区分“需要提醒”与“需要回复”。这属于分类边界问题，原因判断仍需对照实验验证。",
                      f"影响：这些邮件未进入通知审核，其中 {marked} 封走到模拟标记已读。`notify` 的召回率因此降低，重要信息可能被漏报。",
                      "后续改进方向：用重要通知与普通推广的对照样本核对重要性判断，重点检查无须回复但应提醒的邮件。", ""]
        elif gold == "respond" and pred == "ignore" and ("malicious" in reasons or "untrusted" in reasons):
            lines += ["模型理由将正文中的越权指令视为忽略整封邮件的依据，合法的收件确认请求也被一并丢弃。这说明当前安全处理可能过于保守；它没有执行恶意指令，但未完成标准标签要求的正常分类。",
                      "影响：邮件在分类阶段就结束，未生成回复提案；这次工具选择失败由上游分类导致，无法据此判断回复模型会选择哪个工具。",
                      "后续改进方向：核对产品规则是否允许保留包含恶意片段的合法请求；若维持当前标准标签，再验证能否忽略越权片段并继续处理合法请求。", ""]
        else:
            lines += ["该组未按标准标签进入预期路径。现有结果确认分类偏差，具体触发因素需结合完整明细中的邮件内容与分类理由核查。", ""]
    remaining = [row for row in failures if not row["error"] and row["classification_passed"]]
    if remaining:
        lines += [f"**分类正确但工具或审核路径不符合预期：{len(remaining)} 封。** 应按明细区分工具选择、邮件 ID 和审核前操作问题，避免将其归因于分类。", ""]
    check_failures = [row for row in details["flow_checks"] + details["feedback_checks"] if not row["passed"]]
    if check_failures:
        lines += [f"确定性检查失败 {len(check_failures)} 项；预期与实际差异记录在完整明细中，需要先定位流程或偏好更新问题。", ""]
    if not failures and not check_failures:
        lines += ["本次已运行项目未发现失败。", ""]
    lines += ["上述改进方向仅供下一轮验证，本轮保留原业务实现、提示词和标准标签。", ""]
    return lines


def render_report(details):
    lines = ["# MVP 评估报告", "", f"运行 ID：`{details['run_id']}`", f"时间：{details['started_at']} → {details['finished_at']}",
             f"模式：{details['mode']}；模型：{details['environment']['model']}", ""]
    if details.get("checks_revalidated_at"):
        lines += [f"确定性检查复验时间：{details['checks_revalidated_at']}（修正 Windows 临时目录权限冲突；模型输出保持原样）。", ""]
    summary = details["summary"]
    if summary is None:
        lines += ["## 模型指标", "", "未运行（offline-only）。", ""]
    else:
        lines += ["## 分类与工具", "", f"分类：{summary['correct']}/{summary['total']}，准确率 {summary['accuracy']:.2%}；运行错误 {summary['errors']}。",
                  f"Macro-F1：{summary['macro_f1']:.3f}；工具选择：{summary['tool_correct']}/{summary['tool_total']}。", "",
                  "混淆矩阵：行是人工标注的实际类别（标准标签），列是模型预测结果；error 表示执行错误。", "",
                  "| 实际类别（标准标签）↓ / 预测结果 → | 预测 ignore | 预测 notify | 预测 respond | 执行 error |", "|---|---:|---:|---:|---:|"]
        for label, values in summary["confusion_matrix"].items():
            lines.append(f"| {label} | " + " | ".join(str(values[p]) for p in (*LABELS, "error")) + " |")
        lines += ["", "| 类别 | Precision | Recall | F1 |", "|---|---:|---:|---:|"]
        for label, metrics in summary["per_class"].items():
            lines.append(f"| {label} | {metrics['precision']:.3f} | {metrics['recall']:.3f} | {metrics['f1']:.3f} |")
        paused_types = Counter(request["action_request"]["action"] for row in details["baseline"]
                               for interrupt in row["interrupts"] for request in interrupt)
        lines += ["", f"等待人工处理的邮件：{summary['paused_total']} 封。这是图执行到人工中断后暂停的邮件数量，每封只计一次，并非运行异常。" if summary["paused_total"] else "等待人工处理的邮件：0 封；审核前操作检查无数据。",
                  f"中断请求类型：通知审核 {paused_types['Email Assistant: notify']} 个、回复草稿审核 {paused_types['send_email_tool']} 个、Question 问询 {paused_types['Question']} 个。",
                  "通知审核等待用户忽略或要求回复；草稿审核等待批准、编辑或反馈；Question 等待用户补充必要信息。评估在首次中断处停止，不自动执行人工操作。",
                  f"仅在上述暂停邮件中，审核前模拟发送 {summary['paused_sends']} 次、模拟已读 {summary['paused_reads']} 次；该统计不包含 ignore 路径的模拟已读操作。",
                  f"基线流程符合预期：{sum(r['flow_passed'] for r in details['baseline'])}/{summary['total']}。", "",
                  "执行错误计入准确率分母和 error 列；零预测类别的 precision 记为 0。工具分母包含全部标准 respond 样本，错分类也计失败。", ""]
    lines += ["## 确定性检查", ""]
    for key, title in (("flow_checks", "流程"), ("feedback_checks", "反馈更新")):
        rows = details[key]
        lines.append(f"- {title}：{sum(row['passed'] for row in rows)}/{len(rows)} 通过。")
    lines += [f"- 原发送日志保持不变：{details['send_log_unchanged']}。", ""]
    lines += bad_case_analysis(details)
    lines += ["", "## 证据边界", "", "固定 30 封合成邮件、每封单次运行；反馈更新与流程检查使用确定性替身。未评估草稿质量、偏好语义质量或反馈后的模型表现，未验收真实 QQ 收发、Inbox UI 与跨服务重启恢复。",
              "两个结果文件每次覆盖。基线输出、人工反馈、preferences 更新值在 details.json 中分组保存。", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline-only", action="store_true")
    args = parser.parse_args()
    if args.offline_only:
        os.environ.setdefault("DASHSCOPE_API_KEY", "offline-placeholder")
    elif not os.getenv("DASHSCOPE_API_KEY") or not os.getenv("DASHSCOPE_BASE_URL") or not os.getenv("QWEN_MODEL"):
        parser.error("请在根目录 .env 配置 DASHSCOPE_API_KEY、DASHSCOPE_BASE_URL、QWEN_MODEL")
    from evaluation.dataset import CASES
    from evaluation.feedback_cases import run_feedback_checks, run_flow_checks as extra_flow_checks
    from email_assistant import email_assistant_hitl as flow
    from email_assistant import prompts
    from email_assistant.tools.default.prompt_templates import QQ_TOOLS_PROMPT

    assert len(CASES) == 30 and len({c["case_id"] for c in CASES}) == 30
    assert Counter(c["expected_classification"] for c in CASES) == {label: 10 for label in LABELS}
    for label in LABELS:
        assert Counter(c["language"] for c in CASES if c["expected_classification"] == label) == {"zh": 5, "en": 5}
    assert Counter(c["expected_tool"] for c in CASES if c["expected_classification"] == "respond") == {"send_email_tool": 6, "Question": 4}
    now = lambda: datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    before = send_log_snapshot()
    details = {"run_id": str(uuid4()), "started_at": now(), "mode": "offline-only" if args.offline_only else "live-model",
               "environment": {"python_executable": sys.executable, "python": sys.version, "model": os.getenv("QWEN_MODEL") or "not configured",
                               "packages": {p: version(p) for p in ("langgraph", "langchain-openai", "pytest")}},
               "dataset_sha256": hashlib.sha256(json.dumps(CASES, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
               "prompts_sha256": hashlib.sha256(Path(prompts.__file__).read_bytes() + QQ_TOOLS_PROMPT.encode()).hexdigest(),
               "baseline": [], "flow_checks": run_flow_checks() + extra_flow_checks(), "feedback_checks": run_feedback_checks()}
    if not args.offline_only:
        model = live_model(flow)
        for index, case in enumerate(CASES, 1):
            row = run_case(case, flow, model)
            details["baseline"].append(row)
            print(f"[{index}/30] {case['case_id']}: {row['actual_classification']} error={bool(row['error'])}", flush=True)
    details["summary"] = summarize(details["baseline"]) if not args.offline_only else None
    details["send_log_unchanged"] = before == send_log_snapshot()
    details["finished_at"] = now()
    details["complete"] = args.offline_only or len(details["baseline"]) == len(CASES)
    out = ROOT / "evaluation/results"
    out.mkdir(parents=True, exist_ok=True)
    (out / "details.json").write_text(json.dumps(details, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "report.md").write_text(render_report(details), encoding="utf-8")
    print(f"Results: {out}")
    return 1 if not details["send_log_unchanged"] or any(not r["passed"] for r in details["flow_checks"] + details["feedback_checks"]) or any(r["error"] for r in details["baseline"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
