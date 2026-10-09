# 多邮箱智能助手 (QQ 邮箱 & Google 邮箱) MVP

本项目基于 Agent from Scratch 与 LangGraph 架构，实现对 **QQ 邮箱 (`user@qq.com`)** 与 **Google 邮箱 (`zheyang3858@gmail.com`)** 的统一接入。系统提供双邮箱未读邮件批量拉取、基于用户偏好的智能路由分流（Triage）、Qwen 大模型回复子图推理、人机协同（HITL）审核中断关卡、LangGraph Store 记忆持久化以及发信安全审计保护。

---

## 一、系统架构与模块组织

项目严格遵循模块化高内聚设计，架构、工具、数据与视图分层清晰：

```
/
├── server.ts                       # Express 后端服务：代理 Gemini/Qwen 推理、模拟 SQLite 审计与 Store 状态
├── src/
│   ├── types/
│   │   └── index.ts                # 统一 TypeScript 类型契约（邮件、步骤、任务、记忆、日志等）
│   ├── core/
│   │   └── dataset.ts              # 30 封合成基准测试数据集 (evaluation/dataset.py) 与初始状态
│   ├── tools/
│   │   └── mailboxAdapters.ts      # 双邮箱连接工具：Gmail API (OAuth2) 与 QQ 邮箱 IMAP/SMTP 适配器
│   └── components/
│       ├── Navbar.tsx              # 顶部导航栏：双邮箱状态显示、Google 登录与统一未读同步按钮
│       ├── Sidebar.tsx             # 侧边栏：邮箱连接状态确认、离线模式切换与记忆重置
│       ├── MailboxView.tsx         # 统一收件箱管理：邮件筛选、详情查看与 LLM 用例生成
│       ├── AgentWorkflowView.tsx   # LangGraph 流程图与实时终端执行日志流
│       ├── AgentInboxView.tsx      # 人机协同（HITL）审核界面 (支持批准/编辑/问询回答/忽略)
│       ├── StoreViewer.tsx         # LangGraph Store 偏好记忆审查与动态注入
│       ├── EvaluationView.tsx      # 30 封基准评测报告与混淆矩阵 (Confusion Matrix)
│       ├── SendLogView.tsx         # .qq-send-log.sqlite3 尝试记录审计与防重发拦截
│       └── EmailGeneratorModal.tsx # LLM 测试邮件生成弹窗 (支持中文/英文/多种预设场景)
```

---

## 二、关键数据结构与核心变量

### 1. 统一邮件对象 `EmailItem` (`src/types/index.ts`)
统一封装 QQ 邮箱与 Google 邮箱接收的未读邮件，消除底层协议差异：

```typescript
export interface EmailItem {
  id: string;               // 唯一邮件 ID (如 "gm-01", "eval-ign-zh-01")
  uid: number;              // IMAP 或映射的数字 UID，用于状态机与线程隔离
  mailbox: 'qq' | 'gmail';  // 邮件来源邮箱：QQ 邮箱 或 Google 邮箱 (zheyang3858@gmail.com)
  subject: string;          // 邮件标题
  from: string;             // 发件人邮箱地址
  to: string;               // 接收邮箱 (user@qq.com 或 zheyang3858@gmail.com)
  date: string;             // 收发时间
  body: string;             // 邮件文本正文
  category: 'ignore' | 'notify' | 'respond'; // 分类判定
  language: 'zh' | 'en';    // 语言语种
  scenario: string;         // 测试场景描述 (如 "会议排期邀约缺少日历")
  expectedTool: 'send_email_tool' | 'Question' | 'none'; // 预期工具调用
  reason?: string;          // 分类与工具调用的判定依据
  status: 'unread' | 'seen' | 'processing' | 'paused';  // 状态流转
  gmailMessageId?: string;  // Gmail API 对应的消息 ID (用于修改标签或回复)
  source?: 'benchmark' | 'llm' | 'live'; // 数据来源 (基准集、LLM合成或真实拉取)
}
```

### 2. HITL 待审核任务 `HITLTask` (`src/types/index.ts`)
当工作流触发人工介入关卡时，保存在检查点中的上下文：

```typescript
export interface HITLTask {
  active: boolean;          // 是否处于暂停等待审核状态
  emailId: string;
  emailUid: number;
  mailbox: 'qq' | 'gmail';  // 来源邮箱
  subject: string;
  from: string;
  type: 'approve_send' | 'notify_review' | 'answer_question'; // 审核类型
  proposedBody: string;     // Qwen 起草的回复正文 (send_email_tool 提案)
  questionText?: string;    // Qwen 向用户发起的问询文本 (Question 提案)
  reasoning: string;        // Agent 推理依据
  tool: 'send_email_tool' | 'Question' | 'none';
  actualRecipient: string;  // 安全发信沙箱收件人 (固定为 2942397812@qq.com)
}
```

### 3. LangGraph Store 偏好记忆 `MemoryStore` (`src/types/index.ts`)
用于在执行节点外层持久化用户习惯，支持跨会话线程（Thread）动态更新：

```typescript
export interface MemoryStore {
  response_preferences: string[]; // 回复偏好 (如 "使用单句确认，不加问候语或落款")
  triage_preferences: string[];   // 分流偏好 (控制分类到 ignore, notify 还是 respond)
  history: Array<{                // 演进审计日志
    timestamp: string;
    action: string;
    field: 'response_preferences' | 'triage_preferences';
    diff: string;
  }>;
}
```

### 4. 发送审计记录 `SendAuditRecord` (`src/types/index.ts`)
对应本地 `.qq-send-log.sqlite3` 数据库的表结构，确保发信动作有据可查：

```typescript
export interface SendAuditRecord {
  id: string;
  uid: number;              // 关联的邮件 UID
  mailbox: 'qq' | 'gmail';
  originalRecipient: string;// 原发件人 (展示用)
  actualRecipient: string;  // 实际 SMTP 投递收件人 (严格固定为 2942397812@qq.com)
  subject: string;
  body: string;             // 实际发出的最终正文
  status: 'sent' | 'blocked_duplicate' | 'failed';
  timestamp: string;
  hash: string;             // SHA-256 完整性校验哈希
}
```

### 5. 安全发信常量与沙箱配置 (`server.ts` & `src/tools/mailboxAdapters.ts`)
- `FIXED_TEST_RECIPIENT = '2942397812@qq.com'`: 测试期间严格固定的实际发信收件人。即便前端草稿展示原发件人，发送时绝不泄露给外部真实收件人。
- `GOOGLE_USER_EMAIL = 'zheyang3858@gmail.com'`: Google 邮箱目标账号。
- `GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify']`: 严格最小权限范围，支持读取未读邮件、修改标签（移除 `UNREAD` 标记已读）以及发送回复。

---

## 三、核心功能与处理逻辑

### 1. 双邮箱连接与未读同步
- **QQ 邮箱连接**：基于 IMAP 协议（端口 993）读取未读邮件，发送时经 SMTP 端口 465 投递。
- **Google 邮箱连接**：通过 Firebase Auth 弹出式 Google 账号授权，以最小权限 `gmail.modify` 获取 Access Token。Token 仅留存于客户端内存（遵从零持久化安全规范），通过 REST API 交互：
  - `fetchLiveGmailUnread()`: 请求 `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread`。
  - `markGmailRead()`: 触发 `users.me.messages.modify`，将 `removeLabelIds` 设为 `['UNREAD']`。
  - `sendGmailMessage()`: 使用 Base64 编码的 RFC 2822 标准格式发信。
- **一键同步双邮箱**：顶部操作栏提供「同步双邮箱未读」，合并两处邮件队列，按统一流程串行处理。

### 2. 统一 LangGraph 处理流程
两家邮箱的邮件进入完全一致的状态机图：

```
[双邮箱未读邮件] (QQ IMAP / Gmail API)
       │
       ▼
 [1. Ingest 节点] ──> 检查 SQLite 重复发信历史 (防重复拦截)
       │
       ▼
 [2. Triage 分流] ──> 读取 Store 中的 triage_preferences
       │
 ┌─────┴───────────────────┬──────────────────────┐
 │                         │                      │
 ▼                         ▼                      ▼
[ignore 路径]             [notify 路径]          [respond 路径]
 │                         │                      │
 │                         ▼                      ▼
 │                   [HITL 审核关卡]        [Qwen 回复子图]
 │                   (用户知晓/转回复)             │
 │                                        ┌───────┴────────┐
 │                                        ▼                ▼
 │                                [缺少日程/事实]   [事实完备单句]
 │                                调用 Question     调用 send_email_tool
 │                                        │                │
 │                                        └───────┬────────┘
 │                                                ▼
 │                                          [HITL 检查点暂停]
 │                                          (Agent Inbox 审核)
 │                                                │
 │                                      ┌─────────┴─────────┐
 │                                      ▼                   ▼
 │                                   [编辑 Edit]        [批准 Accept]
 │                                      │                   │
 │                                      ▼                   ▼
 │                            [更新 response_preferences]   │
 │                                      │                   │
 └──────────────────────────────────────┴─────────┬─────────┘
                                                  ▼
                                       [3. 发信并写入 SQLite]
                                       (固定至 2942397812@qq.com)
                                                  │
                                                  ▼
                                       [4. 标记对应邮箱已读]
                                       QQ 打上 \Seen / Gmail 移除 UNREAD
                                                  │
                                                  ▼
                                               [结束 Done]
```

### 3. 人机协同（HITL）与 Agent Inbox 交互
流程在关键时刻自动中断（Checkpoint Interrupt），提供 4 种确定性决策：
- **`accept` (批准)**：原样批准发送，调用对应发信接口，记录发信日志至 SQLite 并标记已读。
- **`edit` (编辑)**：允许修改回复文本。**编辑后的表达将自动沉淀并固化至 Store 的 `response_preferences`**，后续同类邮件将自动模仿该写作偏好。
- **`respond` (反馈/解答)**：当 Qwen 调用 `Question` 询问用户时间安排时，用户在界面输入可用时间窗口，回复子图恢复执行并继续起草。
- **`ignore` (忽略)**：舍弃当前草稿或通知，流程安全结束并标记已读。

---

## 四、真实环境验收基线（2026-10-02 记录）

在真实 QQ 邮件 UID 2585 的验收过程中：
1. 邮件经 Qwen 分类后在 `send_email_tool` 前暂停，邮件保持未读，SQLite 中无预先尝试记录。
2. 用户在 Agent Inbox 中将回复编辑为 `Received.` 并批准发送。
3. 测试邮箱收到且仅收到一封匹配回复（UID 2587）。原邮件 UID 2585 被打上 `\Seen` 标记，SQLite 记录状态更新为 `sent`。
4. Store 持久化了偏好：`"使用单句确认，不加问候语或落款"`。
5. 后续独立测试线程（UID 2588）在无需人工干预的情况下，直接生成了符合偏好的 `Received.` 草稿。

---

## 五、启动与运行方式

项目采用 Vite + Express 全栈架构，开发与生产服务均绑定在 3000 端口：

```bash
# 启动开发服务器 (挂载 Express 路由与 Vite 中间件)
npm run dev

# 语法检查与 TypeScript 类型校验
npm run lint

# 生产环境静态打包
npm run build
```

访问 `http://localhost:3000` 即可进入交互控制台，实现双邮箱连接确认、未读邮件同步、实时流程追踪与基准指标评测。
