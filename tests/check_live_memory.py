"""Optional synthetic DashScope contract check; never reads or sends real mail."""

import tempfile

from email_assistant import email_assistant_hitl as flow
from email_assistant.memory import ApprovedReplyCase, ChromaRepository, PreferenceRepository, propose_preference, dashscope_http_client


def main():
    model = type(flow.llm)(api_key=flow.llm.openai_api_key, base_url=flow.llm.openai_api_base,
                           model=flow.llm.model_name, temperature=0, timeout=30, max_retries=0,
                           http_client=dashscope_http_client())
    with tempfile.TemporaryDirectory(prefix="synthetic-memory-check-") as temp:
        case = ApprovedReplyCase("合成测试：确认收件", "请确认收到测试报告。", "确认收到，谢谢。")
        with ChromaRepository(temp) as repository:
            repository.write(case)
            repository.write(case)
            assert repository.collection.count() == 1
        with ChromaRepository(temp) as repository:
            found = repository.search("确认收到报告", "报告收到了吗？")
            assert found == [{"subject": case.subject, "body": case.body, "actual_reply": case.actual_reply}]
        preferences = PreferenceRepository(temp)
        old = preferences.read("response")
        candidate = propose_preference(preferences, "response", "用户将确认收件回复编辑为单句并成功发送",
                                       "以后确认收件只用一个句子，不加问候语和落款，保留不虚构事实的约束。", model)
        assert candidate and preferences.read("response") == old
        preferences.confirm(candidate)
        assert PreferenceRepository(temp).read("response") == candidate["new"]
        print("PASS: real DashScope embedding write/search/reopen/dedup; real Qwen candidate and separate atomic confirmation (synthetic data only)")


if __name__ == "__main__":
    main()
