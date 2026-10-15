"""Every offline test gets independent local memory and send-audit paths."""

import pytest


@pytest.fixture(autouse=True)
def isolated_runtime(tmp_path, monkeypatch):
    from email_assistant import email_assistant_hitl as flow
    from email_assistant import memory
    from email_assistant.tools.qq import qq_tools

    root = lambda config=None: (config or {}).get("configurable", {}).get("memory_root", tmp_path)
    monkeypatch.setattr(flow, "data_root", root)
    monkeypatch.setattr(memory, "data_root", root)
    monkeypatch.setattr(qq_tools, "SEND_LOG", tmp_path / "send.sqlite3")
    monkeypatch.setattr(memory, "DashScopeEmbedding", lambda: lambda texts: [[1.0, 0.0, 0.0] for _ in texts])
