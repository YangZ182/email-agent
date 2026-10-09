export type MailboxType = 'qq' | 'gmail';
export type EmailCategory = 'ignore' | 'notify' | 'respond';
export type ToolName = 'send_email_tool' | 'Question' | 'none';

/**
 * 核心邮件数据结构
 */
export interface EmailItem {
  id: string;
  uid: number;
  mailbox: MailboxType;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  category: EmailCategory;
  language: 'zh' | 'en';
  scenario: string;
  expectedTool: ToolName;
  reason?: string;
  status: 'unread' | 'seen' | 'processing' | 'paused';
  gmailMessageId?: string;
  source?: 'benchmark' | 'llm' | 'live';
}

/**
 * 流程节点步骤
 */
export interface PipelineStep {
  id: string;
  node: 'ingest' | 'triage' | 'qwen_subgraph' | 'hitl_interrupt' | 'store_update' | 'send_action' | 'mark_read';
  title: string;
  subtitle: string;
  status: 'pending' | 'running' | 'completed' | 'paused' | 'skipped';
}

/**
 * HITL 待审核任务状态
 */
export interface HITLTask {
  active: boolean;
  emailId: string;
  emailUid: number;
  mailbox: MailboxType;
  subject: string;
  from: string;
  type: 'approve_send' | 'notify_review' | 'answer_question';
  proposedBody: string;
  questionText?: string;
  reasoning: string;
  tool: ToolName;
  actualRecipient: string; // 固定为 2942397812@qq.com
}

/**
 * LangGraph Store 偏好记忆
 */
export interface MemoryStore {
  response_preferences: string[];
  triage_preferences: string[];
  history: Array<{
    timestamp: string;
    action: string;
    field: 'response_preferences' | 'triage_preferences';
    diff: string;
  }>;
}

/**
 * SQLite 发信审计日志 (.qq-send-log.sqlite3)
 */
export interface SendAuditRecord {
  id: string;
  uid: number;
  mailbox: MailboxType;
  originalRecipient: string;
  actualRecipient: string; // 2942397812@qq.com
  subject: string;
  body: string;
  status: 'sent' | 'blocked_duplicate' | 'failed';
  timestamp: string;
  hash: string;
}
