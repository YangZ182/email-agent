"""Run with: python -m streamlit run src/email_assistant/review_app.py."""

import re
from urllib.parse import urlsplit

import html2text
import streamlit as st

from email_assistant.memory import PreferenceRepository
from email_assistant.review import ReviewService
from email_assistant.tools.qq.qq_tools import TEST_RECIPIENT, get_send_record


@st.cache_resource
def get_service():
    service = ReviewService()
    service.continue_legacy_routes()
    return service


def execute(operation):
    st.session_state.busy = True
    st.session_state.pending_operation = operation
    st.rerun()


def run_pending():
    operation = st.session_state.pop("pending_operation", None)
    if operation is None:
        return
    try:
        with st.spinner("正在处理，请稍候…"):
            result = operation()
        st.session_state.notice = (
            f"本批 {result['total']} 封：完成并标为已读 {result['completed']} 封，"
            f"待人工处理 {result['pending']} 封，失败 {result['failed']} 封。"
            if isinstance(result, dict) else "操作已完成"
        )
        st.session_state.error = None
    except Exception as exc:
        # Never expose credentials through provider/network exception messages.
        st.session_state.error = (str(exc) if isinstance(exc, ValueError) else
                                  f"操作失败（{type(exc).__name__}）。请检查网络和任务状态；发送结果不明确时先核对发送审计。")
    finally:
        st.session_state.busy = False
    st.rerun()


def readable_body(body):
    """Format only the display copy; never load email images or execute HTML."""
    if re.search(r"<(?:html|body|div|p|br|table)\b", body, re.I):
        converter = html2text.HTML2Text()
        converter.body_width = 0
        converter.ignore_images = True
        body = converter.handle(body)
    body = re.sub(r"!\[[^\]]*\](?:\([^\n]*?\)|\[[^\]]*\])?", "", body)
    # Preserve named links, shorten bare tracking URLs to their host name.
    def link(match):
        text = match.group(0)
        if text.startswith("["):
            return text
        try:
            host = urlsplit(text).hostname or "打开链接"
        except ValueError:
            return text
        return f"[链接：{host}](<{text}>)"
    return re.sub(r'\[[^\]]*\]\([^\n]*?\)|https?://[^\s<>\)]+', link, body)


def main():
    st.set_page_config(page_title="邮件人工审核", layout="wide")
    st.title("邮件人工审核")
    st.caption(f"测试模式 · 实际收件人固定为 {TEST_RECIPIENT}")
    for key, value in {"busy": False, "notice": None, "error": None}.items():
        st.session_state.setdefault(key, value)
    service = get_service()
    repository = PreferenceRepository(service.root)
    repository.read("triage")
    repository.read("response")
    if st.session_state.notice:
        st.success(st.session_state.notice)
    if st.session_state.error:
        st.error(st.session_state.error)
    if st.button("读取全部未读邮件", disabled=st.session_state.busy):
        execute(service.fetch)
    threads = service.threads()
    if not threads:
        st.info("暂无任务。读取 QQ 全部未读邮件后开始处理。")
        run_pending()
        return
    snapshots = {thread: service.snapshot(thread) for thread in threads}
    if "next_review_area" in st.session_state:
        st.session_state.review_area = st.session_state.pop("next_review_area")
    area = st.radio("处理区域", ["通知", "待回复"], horizontal=True, key="review_area", disabled=st.session_state.busy)
    show_completed = st.checkbox("显示已完成", key="show_completed", disabled=st.session_state.busy)
    visible = []
    for item, (checkpoint, state, pending) in snapshots.items():
        route = state.get("classification_decision")
        unresolved = any(not service.decision(service.candidate_key(item, candidate)) for candidate in state.get("preference_candidates", []))
        needs_case = state.get("case_saved") is False and not service.decision("case:" + item)
        if route == ("notify" if area == "通知" else "respond") and (checkpoint.next or pending or unresolved or needs_case or show_completed):
            visible.append(item)
    failures = [item for item, (checkpoint, _, pending) in snapshots.items() if checkpoint.next and not pending]
    if failures:
        with st.expander(f"处理异常（{len(failures)}）"):
            for item in failures:
                st.write(snapshots[item][1].get("email_input", {}).get("subject", "分类未完成"))
                if st.button("重试处理", key="retry:" + item, disabled=st.session_state.busy):
                    execute(lambda item=item: service.retry(item))
    st.caption(f"{area} · {len(visible)} 封。自动忽略的邮件不进入列表；待确认偏好和待保存案例会继续保留。")
    if not visible:
        st.info(f"暂无{area}邮件。")
        run_pending()
        return
    threads = visible
    def label(thread):
        _, values, _ = snapshots[thread]
        return f"{values.get('email_input', {}).get('subject', '邮件')} · {thread[:8]}"
    if st.session_state.get("selected_thread") not in threads:
        st.session_state.selected_thread = next((thread for thread in threads if snapshots[thread][2]), threads[0])
    thread = st.selectbox("选择邮件", threads, format_func=label, key="selected_thread", disabled=st.session_state.busy)
    root, values, request = snapshots[thread]
    email = values["email_input"]
    st.subheader(email["subject"] or "（无主题）")
    st.text(f"发件人：{email['author']}")
    with st.container(height=300, border=True):
        st.markdown(readable_body(email["email_thread"]), unsafe_allow_html=False)
    with st.expander("查看原文与分类详情"):
        st.text(email["email_thread"])
        st.write("Agent 预测：", values.get("predicted_classification", "等待分类"))
        st.write("分类理由：", values.get("classification_reason", ""))
        st.caption(f"Thread：{thread}")
    st.caption(f"当前状态：{'等待人工处理' if request else ('执行失败，可恢复' if root.next else '已完成')}")
    for error in dict.fromkeys(values.get("memory_errors", [])):
        st.warning(error)
    record = get_send_record(email["id"])
    sent = bool(values.get("send_succeeded") or record and record["status"] == "sent")
    if sent:
        st.success("该邮件已成功发送，批准发送已锁定。")
        st.text(values.get("sent_reply") or record.get("actual_reply", ""))
    elif record:
        st.warning("此邮件存在发送尝试记录。发送结果需人工核对，系统阻止再次发送。")
    if values.get("case_saved") is False and not service.decision("case:" + thread):
        if st.button("重试保存历史案例", disabled=st.session_state.busy):
            execute(lambda: service.retry_case(thread))

    if request:
        action = request["action_request"]["action"]
        args = request["action_request"]["args"]
        key = f"{thread}:{action}"
        if action.startswith("Email Assistant:"):
            st.subheader("通知处理" if area == "通知" else "回复处理")
            feedback = st.text_area("分类纠正说明（可选）", key=key + ":route_feedback", disabled=st.session_state.busy)
            if area == "通知" and st.button("已知悉", disabled=st.session_state.busy):
                execute(lambda: service.resume(thread, {"type": "accept", "args": {}, "route": "notify"}))
            if st.button("转为回复" if area == "通知" else "开始起草", disabled=st.session_state.busy):
                def start_reply():
                    service.resume(thread, {"type": "accept", "args": {}, "route": "respond", "feedback": feedback})
                    st.session_state.next_review_area = "待回复"
                execute(start_reply)
        elif action == "Question":
            st.subheader("Agent 问题")
            st.text(args.get("content", str(args)))
            answer = st.text_area("补充事实 / 问题答案", key=key + ":answer", disabled=st.session_state.busy)
            feedback = st.text_area("长期回复偏好反馈（可选）", key=key + ":feedback", disabled=st.session_state.busy)
            if st.button("提交答案并重新起草", disabled=st.session_state.busy or not answer.strip()):
                execute(lambda: service.resume(thread, {"type": "response", "args": answer, "feedback": feedback}))
            if st.button("Ignore · 放弃回复", disabled=st.session_state.busy):
                execute(lambda: service.resume(thread, {"type": "ignore", "args": {}}))
        elif action == "send_email_tool":
            st.subheader("回复审核")
            st.text(f"实际发送目标：{TEST_RECIPIENT}（固定测试收件人）")
            draft = st.text_area("最终回复正文", value=args["response_text"], height=200, key=key + ":draft", disabled=st.session_state.busy or sent)
            feedback = st.text_area("本次编辑的偏好说明（可选）", key=key + ":feedback", disabled=st.session_state.busy or sent)
            confirmed = st.checkbox("我确认上述最终正文，并授权向固定测试收件人发送", key=key + ":approve", disabled=st.session_state.busy or sent)
            if st.button("Approve · 批准发送", disabled=st.session_state.busy or sent or bool(record) or not confirmed or not draft.strip()):
                edited = {**args, "response_text": draft}
                execute(lambda: service.resume(thread, {"type": "edit", "args": {"args": edited}, "feedback": feedback}))
            if sent and st.button("恢复已发送任务（继续保存和结束）", disabled=st.session_state.busy):
                execute(lambda: service.resume(thread, {"type": "accept", "args": {}}))
            if st.button("Ignore · 放弃回复", disabled=st.session_state.busy or sent):
                execute(lambda: service.resume(thread, {"type": "ignore", "args": {}}))
    elif root.next:
        if st.button("恢复未完成任务", disabled=st.session_state.busy):
            execute(lambda: service.retry(thread))

    candidates = values.get("preference_candidates", [])
    st.session_state[thread + ":candidates"] = candidates
    for candidate in candidates:
        candidate_key = service.candidate_key(thread, candidate)
        if service.decision(candidate_key):
            continue
        st.subheader("路由偏好候选" if candidate["kind"] == "triage" else "回复偏好候选")
        old, new = st.columns(2)
        old.caption("当前版本")
        old.code(candidate["old"], language="markdown")
        new.caption("候选版本")
        new.code(candidate["new"], language="markdown")
        st.code(candidate["diff"], language="diff")
        if st.button("确认写入偏好文件", key=candidate_key + ":confirm", disabled=st.session_state.busy):
            execute(lambda: service.resolve_candidate(thread, candidate, True))
        if st.button("拒绝候选，保留原文件", key=candidate_key + ":reject", disabled=st.session_state.busy):
            execute(lambda: service.resolve_candidate(thread, candidate, False))
    run_pending()


if __name__ == "__main__":
    main()
