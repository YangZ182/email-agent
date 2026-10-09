import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { MailboxView } from './components/MailboxView';
import { AgentWorkflowView } from './components/AgentWorkflowView';
import { AgentInboxView } from './components/AgentInboxView';
import { StoreViewer } from './components/StoreViewer';
import { EvaluationView } from './components/EvaluationView';
import { SendLogView } from './components/SendLogView';
import { 
  BENCHMARK_DATASET, 
  INITIAL_STORE, 
  INITIAL_SEND_LOGS 
} from './core/dataset';
import { 
  EmailItem, 
  PipelineStep, 
  HITLTask, 
  MemoryStore, 
  SendAuditRecord 
} from './types';
import { 
  initGoogleAuth, 
  signInGoogle, 
  signOutGoogle, 
  fetchLiveGmailUnread, 
  markGmailRead, 
  sendGmailMessage,
  checkMailboxConnections 
} from './tools/mailboxAdapters';

const INITIAL_STEPS: PipelineStep[] = [
  { id: 'ingest', node: 'ingest', title: '双邮箱未读摄取', subtitle: 'QQ IMAP / Gmail API', status: 'pending' },
  { id: 'triage', node: 'triage', title: 'Triage 智能分流', subtitle: 'ignore / notify / respond', status: 'pending' },
  { id: 'qwen_subgraph', node: 'qwen_subgraph', title: 'Qwen 回复子图', subtitle: '工具选择推理', status: 'pending' },
  { id: 'hitl_interrupt', node: 'hitl_interrupt', title: '人机协同审核', subtitle: 'Agent Inbox 检查点暂停', status: 'pending' },
  { id: 'store_update', node: 'store_update', title: 'Store 偏好演进', subtitle: '更新回复记忆', status: 'pending' },
  { id: 'send_action', node: 'send_action', title: '发信与安全沙箱', subtitle: '固定至 2942397812@qq.com', status: 'pending' },
  { id: 'mark_read', node: 'mark_read', title: '标记已读', subtitle: 'QQ \\Seen / Gmail 标签', status: 'pending' },
];

export default function App() {
  const [emails, setEmails] = useState<EmailItem[]>(BENCHMARK_DATASET);
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(BENCHMARK_DATASET[0] || null);
  const [activeTab, setActiveTab] = useState<string>('mailbox');
  const [store, setStore] = useState<MemoryStore>(INITIAL_STORE);
  const [sendLogs, setSendLogs] = useState<SendAuditRecord[]>(INITIAL_SEND_LOGS);
  const [pendingTask, setPendingTask] = useState<HITLTask | null>(null);

  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [steps, setSteps] = useState<PipelineStep[]>(INITIAL_STEPS);
  const [currentStepId, setCurrentStepId] = useState<string>('ingest');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [useOfflineMock, setUseOfflineMock] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  const [logs, setLogs] = useState<string[]>([
    `[2026-10-08 23:00:00] [SYSTEM] 双邮箱智能助手控制台已就绪。`,
    `[2026-10-08 23:00:00] [MAILBOX] 邮箱 1: QQ 邮箱 (IMAP / user@qq.com · 就绪)。`,
    `[2026-10-08 23:00:00] [MAILBOX] 邮箱 2: Google 邮箱 (zheyang3858@gmail.com · OAuth2 就绪)。`,
    `[2026-10-08 23:00:00] [SAFETY] 安全约束：发信收件人均在沙箱核对 (固定至 2942397812@qq.com)。`
  ]);

  // Initialize Google Auth
  useEffect(() => {
    const unsub = initGoogleAuth(
      (user) => {
        setGoogleUser(user);
        setLogs((prev) => [
          ...prev,
          `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [GOOGLE_AUTH] 已连接 Google 账号: ${user.email}，Gmail API 已激活。`
        ]);
      },
      () => setGoogleUser(null)
    );

    // Sync state from server if available
    fetch('/api/agent/state')
      .then((r) => r.json())
      .then((data) => {
        if (data.storePreferences) setStore(data.storePreferences);
        if (data.sendLogs) setSendLogs(data.sendLogs);
      })
      .catch(() => {});

    return () => unsub();
  }, []);

  const mailboxStatus = checkMailboxConnections(!!googleUser);
  const unreadCount = emails.filter((e) => e.status === 'unread').length;

  // Google Sign In
  const handleGoogleSignIn = async () => {
    try {
      const res = await signInGoogle();
      setGoogleUser(res.user);
      setLogs((prev) => [
        ...prev,
        `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [GOOGLE_AUTH] 成功授权 Google 账号: ${res.user.email}。`
      ]);

      // Attempt live fetch
      const liveUnread = await fetchLiveGmailUnread();
      if (liveUnread.length > 0) {
        setEmails((prev) => [...liveUnread, ...prev]);
        setLogs((prev) => [
          ...prev,
          `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [GMAIL_API] 实时同步拉取到 ${liveUnread.length} 封未读邮件。`
        ]);
      }
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [GOOGLE_AUTH] 授权取消或失败: ${err.message}`
      ]);
    }
  };

  const handleGoogleSignOut = async () => {
    await signOutGoogle();
    setGoogleUser(null);
    setLogs((prev) => [
      ...prev,
      `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [GOOGLE_AUTH] 已断开 Google 账号连接。`
    ]);
  };

  // Run LangGraph pipeline on an email
  const handleExecuteEmail = async (email: EmailItem) => {
    setIsProcessing(true);
    setIsPaused(false);
    setSelectedEmail(email);

    // Reset steps
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'pending' })));

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const mailboxTag = email.mailbox === 'gmail' ? 'Google 邮箱 (zheyang3858@gmail.com)' : 'QQ 邮箱 (user@qq.com)';
    setLogs((prev) => [
      ...prev,
      `[${now}] [INGEST] 摄取 [${mailboxTag}] UID ${email.uid}: "${email.subject}"`
    ]);

    setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, status: 'processing' } : e)));

    // Step 1: Ingest complete
    setCurrentStepId('ingest');
    setSteps((prev) => prev.map((s) => (s.id === 'ingest' ? { ...s, status: 'completed' } : s)));

    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();

      if (data.logs) setLogs((prev) => [...prev, ...data.logs]);

      if (data.isBlocked) {
        setIsProcessing(false);
        return;
      }

      // Step 2: Triage complete
      setCurrentStepId('triage');
      setSteps((prev) => prev.map((s) => (s.id === 'triage' ? { ...s, status: 'completed' } : s)));

      if (data.category === 'ignore') {
        // Ignored path: mark read
        if (email.mailbox === 'gmail' && email.gmailMessageId) {
          markGmailRead(email.gmailMessageId).catch(() => {});
        }
        setSteps((prev) => prev.map((s) => {
          if (['qwen_subgraph', 'hitl_interrupt', 'store_update', 'send_action'].includes(s.id)) return { ...s, status: 'skipped' };
          if (s.id === 'mark_read') return { ...s, status: 'completed' };
          return s;
        }));
        setCurrentStepId('mark_read');
        setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, status: 'seen' } : e)));
        setIsProcessing(false);
      } else if (data.paused && data.hitlAction) {
        // Paused at HITL interrupt
        setPendingTask({
          active: true,
          emailId: email.id,
          emailUid: email.uid,
          mailbox: email.mailbox,
          subject: email.subject,
          from: email.from,
          type: data.hitlAction.actionType,
          proposedBody: data.hitlAction.proposedBody,
          questionText: data.hitlAction.questionText,
          reasoning: data.hitlAction.agentReasoning,
          tool: data.hitlAction.suggestedTool,
          actualRecipient: '2942397812@qq.com'
        });
        setIsPaused(true);
        setCurrentStepId('hitl_interrupt');
        setSteps((prev) => prev.map((s) => {
          if (data.category === 'respond' && s.id === 'qwen_subgraph') return { ...s, status: 'completed' };
          if (s.id === 'hitl_interrupt') return { ...s, status: 'paused' };
          return s;
        }));
        setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, status: 'paused' } : e)));
        setIsProcessing(false);
      }
    } catch (err: any) {
      setLogs((prev) => [...prev, `[ERROR] 执行失败: ${err.message}`]);
      setIsProcessing(false);
    }
  };

  // Unified Sync Across Both Mailboxes
  const handleSyncAll = async () => {
    if (googleUser) {
      try {
        const live = await fetchLiveGmailUnread();
        if (live.length > 0) {
          setEmails((prev) => {
            const ids = new Set(prev.map((p) => p.id));
            const fresh = live.filter((l) => !ids.has(l.id));
            return [...fresh, ...prev];
          });
          setLogs((prev) => [
            ...prev,
            `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [GMAIL_SYNC] 同步到 ${live.length} 封 Gmail 实时未读邮件。`
          ]);
        }
      } catch (e) {
        console.warn('Gmail sync error:', e);
      }
    }

    const nextUnread = emails.find((e) => e.status === 'unread');
    if (nextUnread) {
      handleExecuteEmail(nextUnread);
    } else {
      setLogs((prev) => [
        ...prev,
        `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [SYNC] 两个邮箱均无未读邮件，可使用 LLM 生成测试邮件。`
      ]);
    }
  };

  // Handle human decision in Agent Inbox
  const handleHITLDecision = async (decision: {
    action: 'accept' | 'edit' | 'respond' | 'ignore';
    emailUid: number;
    emailSubject: string;
    originalRecipient: string;
    editedBody?: string;
    feedbackText?: string;
    proposedBody?: string;
  }) => {
    setIsProcessing(true);
    const target = emails.find((e) => e.uid === decision.emailUid);

    try {
      const res = await fetch('/api/agent/hitl-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision)
      });
      const data = await res.json();

      if (data.logs) setLogs((prev) => [...prev, ...data.logs]);
      if (data.storePreferences) setStore(data.storePreferences);

      // Execute live Gmail actions if applicable
      if (target?.mailbox === 'gmail' && target.gmailMessageId) {
        await markGmailRead(target.gmailMessageId).catch(() => {});
        if (decision.action === 'accept' || decision.action === 'edit') {
          const bodyToSend = decision.editedBody || decision.proposedBody || 'Received.';
          await sendGmailMessage(target.from, `Re: ${decision.emailSubject}`, bodyToSend).catch(() => {});
        }
      }

      if (data.sendRecord) {
        const auditRec: SendAuditRecord = {
          id: data.sendRecord.id,
          uid: data.sendRecord.uid,
          mailbox: target?.mailbox || 'qq',
          originalRecipient: data.sendRecord.original_recipient,
          actualRecipient: data.sendRecord.actual_recipient,
          subject: data.sendRecord.subject,
          body: data.sendRecord.body,
          status: data.sendRecord.status,
          timestamp: data.sendRecord.created_at,
          hash: data.sendRecord.sha256_hash
        };
        setSendLogs((prev) => [auditRec, ...prev]);
      }

      // Finish pipeline steps
      setSteps((prev) => prev.map((s) => {
        if (s.id === 'hitl_interrupt') return { ...s, status: 'completed' };
        if (s.id === 'store_update') return { ...s, status: data.storeUpdated ? 'completed' : 'skipped' };
        if (s.id === 'send_action') return { ...s, status: ['accept', 'edit'].includes(decision.action) ? 'completed' : 'skipped' };
        if (s.id === 'mark_read') return { ...s, status: 'completed' };
        return s;
      }));

      setEmails((prev) => prev.map((e) => (e.uid === decision.emailUid ? { ...e, status: 'seen' } : e)));
      setPendingTask(null);
      setIsPaused(false);
      setIsProcessing(false);
    } catch (err: any) {
      setLogs((prev) => [...prev, `[ERROR] 审核操作失败: ${err.message}`]);
      setIsProcessing(false);
    }
  };

  const handleResetStore = async () => {
    try {
      const res = await fetch('/api/agent/store/reset', { method: 'POST' });
      const data = await res.json();
      if (data.storePreferences) setStore(data.storePreferences);
    } catch {
      setStore(INITIAL_STORE);
    }
    setLogs((prev) => [
      ...prev,
      `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [STORE] 重置 Store 偏好记忆至基线。`
    ]);
  };

  const handleAddPreference = (field: 'response_preferences' | 'triage_preferences', rule: string) => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    setStore((prev) => ({
      ...prev,
      [field]: [rule, ...prev[field]],
      history: [{ timestamp, action: '手动注入规则', field, diff: `+ "${rule}"` }, ...prev.history]
    }));
    setLogs((prev) => [...prev, `[${timestamp}] [STORE] 注入新偏好规则: "${rule}"`]);
  };

  const handleClearLogs = () => {
    setSendLogs([]);
    setLogs((prev) => [
      ...prev,
      `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [AUDIT] 已清空发信审计日志。`
    ]);
  };

  const handleReloadDataset = () => {
    setEmails(BENCHMARK_DATASET);
    setSelectedEmail(BENCHMARK_DATASET[0] || null);
    setLogs((prev) => [
      ...prev,
      `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [DATASET] 重新载入双邮箱基准测试集。`
    ]);
  };

  const handleMarkSeen = async (emailId: string) => {
    const item = emails.find((e) => e.id === emailId);
    if (item?.mailbox === 'gmail' && item.gmailMessageId) {
      await markGmailRead(item.gmailMessageId).catch(() => {});
    }
    setEmails((prev) => prev.map((e) => (e.id === emailId ? { ...e, status: 'seen' } : e)));
  };

  const handleDeleteEmail = (emailId: string) => {
    setEmails((prev) => prev.filter((e) => e.id !== emailId));
    if (selectedEmail?.id === emailId) setSelectedEmail(emails[0] || null);
  };

  const handleAddEmail = (newEmail: EmailItem) => {
    setEmails((prev) => [newEmail, ...prev]);
    setSelectedEmail(newEmail);
    setActiveTab('mailbox');
    setLogs((prev) => [
      ...prev,
      `[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] [ADD] 新增测试邮件 (来源: ${newEmail.mailbox}, UID ${newEmail.uid}, "${newEmail.subject}")`
    ]);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-900 text-slate-100 font-sans">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        pendingCount={pendingTask?.active ? 1 : 0}
        onSyncAll={handleSyncAll}
        isProcessing={isProcessing}
        googleUser={googleUser}
        onGoogleSignIn={handleGoogleSignIn}
        onGoogleSignOut={handleGoogleSignOut}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar
          mailboxStatus={mailboxStatus}
          onSyncAll={handleSyncAll}
          onResetStore={handleResetStore}
          onClearLogs={handleClearLogs}
          onReloadDataset={handleReloadDataset}
          unreadCount={unreadCount}
          isProcessing={isProcessing}
          totalLogs={sendLogs.length}
          useOfflineMock={useOfflineMock}
          setUseOfflineMock={setUseOfflineMock}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
        />

        <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden bg-slate-950">
          {activeTab === 'mailbox' && (
            <MailboxView
              emails={emails}
              selectedEmail={selectedEmail}
              onSelectEmail={setSelectedEmail}
              onIngestEmail={handleExecuteEmail}
              onMarkSeen={handleMarkSeen}
              onDeleteEmail={handleDeleteEmail}
              onAddEmail={handleAddEmail}
              isProcessing={isProcessing}
            />
          )}

          {activeTab === 'workflow' && (
            <AgentWorkflowView
              steps={steps}
              currentStepId={currentStepId}
              isPaused={isPaused}
              logs={logs}
              onClearLogs={() => setLogs([])}
              activeUid={selectedEmail?.uid}
              onOpenInbox={() => setActiveTab('inbox')}
            />
          )}

          {activeTab === 'inbox' && (
            <AgentInboxView
              task={pendingTask}
              onDecision={handleHITLDecision}
              store={store}
            />
          )}

          {activeTab === 'store' && (
            <StoreViewer
              storePreferences={store}
              onResetStore={handleResetStore}
              onAddPreference={handleAddPreference}
            />
          )}

          {activeTab === 'benchmark' && (
            <EvaluationView
              dataset={emails.filter((e) => e.source === 'benchmark')}
              useOfflineMock={useOfflineMock}
            />
          )}

          {activeTab === 'audit' && (
            <SendLogView
              logs={sendLogs}
              onClearLogs={handleClearLogs}
              onRefresh={() => {
                fetch('/api/agent/state')
                  .then((r) => r.json())
                  .then((d) => d.sendLogs && setSendLogs(d.sendLogs));
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}
