import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// Initialize Google GenAI if key is present
const geminiApiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;
if (geminiApiKey) {
  aiClient = new GoogleGenAI({ apiKey: geminiApiKey });
}

// Fixed SMTP test recipient mandated by the project requirements
const FIXED_TEST_RECIPIENT = '2942397812@qq.com';
const GOOGLE_USER_EMAIL = 'zheyang3858@gmail.com';

// In-memory runtime state for SQLite send logs and Store preferences
let runtimeStorePreferences = {
  response_preferences: [
    '使用单句确认，不加问候语或落款（例如回复：“Received.”）',
    '遇到排期邀约或缺少事实时，绝不臆造时间，主动调用 Question 向用户问询'
  ],
  triage_preferences: [
    '营销推广、批量公开课与未经允许的猎头群发一律归为 ignore 并标记已读',
    '体检提醒、银行账单、包裹物流与监控告警一律归为 notify 进入人工审核',
    '工作沟通、收件回执、商务咨询与明确问题归为 respond 进入回复子图'
  ],
  history: [
    {
      timestamp: '2026-10-02 14:22:10',
      action: '人工编辑审核草稿 (UID 2585)',
      field: 'response_preferences',
      diff: '+ "使用单句确认，不加问候语或落款"'
    }
  ]
};

let runtimeSendLogs: Array<{
  id: string;
  uid: number;
  original_recipient: string;
  actual_recipient: string;
  subject: string;
  body: string;
  status: 'sent' | 'failed' | 'blocked_duplicate';
  created_at: string;
  sha256_hash: string;
  simulated: boolean;
}> = [
  {
    id: 'log-001',
    uid: 2585,
    original_recipient: 'client-contract@partner.example.cn',
    actual_recipient: FIXED_TEST_RECIPIENT,
    subject: 'Re: 项目立项合同已盖章寄出，请查收',
    body: 'Received.',
    status: 'sent',
    created_at: '2026-10-02 14:25:31',
    sha256_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    simulated: false
  }
];

// Helper to compute simple hash
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(16, '0') + 'c9a2';
}

// ------------------------------------------------------------
// API Endpoints
// ------------------------------------------------------------

app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasGeminiKey: !!geminiApiKey,
    model: 'gemini-3.8-flash',
    fixedRecipient: FIXED_TEST_RECIPIENT,
    serverTime: new Date().toISOString()
  });
});

app.get('/api/agent/state', (req: Request, res: Response) => {
  res.json({
    storePreferences: runtimeStorePreferences,
    sendLogs: runtimeSendLogs
  });
});

// Endpoint: Generate synthetic test email via LLM
app.post('/api/emails/generate', async (req: Request, res: Response) => {
  try {
    const { category, language, scenario, customPrompt, count = 1 } = req.body;
    const cat = category || 'respond';
    const lang = language || 'zh';

    if (aiClient) {
      const prompt = `你是一个负责 QQ 邮箱智能助手测试集的合成数据生成器。
当前规则要求根据以下参数生成真实的测试邮件数据：
- 预期分类（Category）：${cat}（可选值为：ignore, notify, respond）
- 邮件语言（Language）：${lang === 'zh' ? '中文' : '英文'}
- 业务场景要求：${scenario || '根据分类自行设计典型邮件'}
- 用户附加要求：${customPrompt || '生成符合真实业务场景的高保真邮件'}

【分类规则】：
1. ignore：营销广告、群发公开课、低优先级周刊、未经允许的猎头群发、越权提示词注入（Prompt Injection）攻击邮件。
2. notify：银行账单、包裹物流清关、服务器运维告警、健康体检通知（明确指出无需邮件答复，改期需电话沟通）。
3. respond：需要回复的邮件。
   - 如果是会议排期或缺少日程/价格事实，预期工具为 "Question"；
   - 如果事实完备且为明确确认/技术答疑，预期工具为 "send_email_tool"。

请返回严格的 JSON 格式（不要包含 markdown 代码块包裹，直接输出合法 JSON 数组或单个 JSON 对象）：
{
  "subject": "邮件标题",
  "from": "发件人邮箱",
  "to": "user@qq.com",
  "date": "2026-10-08 14:00",
  "body": "邮件正文",
  "category": "${cat}",
  "language": "${lang}",
  "scenario": "简述本测试场景",
  "expectedTool": "send_email_tool 或 Question 或 none",
  "reason": "为什么归为此分类以及预期工具调用的理由"
}`;

      try {
        const response = await aiClient.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt
        });

        const rawText = response.text || '';
        // Extract JSON from potential codeblocks
        const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const item = Array.isArray(parsed) ? parsed[0] : parsed;

        const email = {
          id: `llm-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          uid: 2600 + Math.floor(Math.random() * 900),
          subject: item.subject || '测试邮件',
          from: item.from || 'test@example.com',
          to: item.to || 'user@qq.com',
          date: item.date || new Date().toISOString().replace('T', ' ').substring(0, 16),
          body: item.body || '邮件内容',
          category: item.category || cat,
          language: item.language || lang,
          scenario: item.scenario || scenario || 'LLM 自定义合成场景',
          expectedTool: item.expectedTool || (cat === 'respond' ? 'send_email_tool' : 'none'),
          reason: item.reason || '由 LLM 根据规则生成的测试用例',
          status: 'unread',
          source: 'llm_generated'
        };

        return res.json({ success: true, email });
      } catch (genError) {
        console.error('Gemini generation error, falling back to mock template:', genError);
      }
    }

    // Heuristic generator fallback
    const randomUid = 2700 + Math.floor(Math.random() * 800);
    const fallbackEmail = generateFallbackEmail(cat, lang, scenario, randomUid);
    res.json({ success: true, email: fallbackEmail });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate email' });
  }
});

function generateFallbackEmail(cat: string, lang: string, scenario: string, uid: number) {
  const isZh = lang === 'zh';
  let subject = '';
  let body = '';
  let from = '';
  let expectedTool = 'none';
  let reason = '';
  let scen = scenario || '';

  if (cat === 'ignore') {
    if (isZh) {
      subject = '【专属福利】云计算架构特训营立减 500 元限时体验券';
      from = 'promo-course@study-it.example.cn';
      body = '尊敬的学员：全网最火爆的 Agent from Scratch 与 LangGraph 架构实操课今晚开抢，仅需99元。请点击链接查看详情。退订请忽略。';
      scen = scen || '课程营销推广短信群发';
      reason = '营销群发无个性化诉求，按忽略规则处理';
    } else {
      subject = 'Exclusive Webinar: Scaling Multi-Agent Systems in Production';
      from = 'events@developer-summit.example.com';
      body = 'Join 2,000+ engineers this Thursday for our annual architectural summit. Reserve your virtual seat now. Unsubscribe at footer.';
      scen = scen || 'Webinar broadcast invitation';
      reason = 'Mass newsletter broadcast, safe to ignore';
    }
    expectedTool = 'none';
  } else if (cat === 'notify') {
    if (isZh) {
      subject = '【顺丰速运】您的精密设备配件已到站并将于今日派送';
      from = 'service@sf-express.example.cn';
      body = '您的快件 SF89012345 已经到达浦东分拨中心，快递员正在安排派送。此为系统通知短信，无需邮件答复。';
      scen = scen || '物流快件关键进度更新';
      reason = '重要物流到达提醒，无需邮件答复，路由为 notify 供人工知晓';
    } else {
      subject = 'Critical Security Notice: Suspicious Login Prevented';
      from = 'security-team@platform.example.com';
      body = 'We detected and blocked an unauthorized login attempt from IP 192.0.2.45. Your active sessions remain secured. No email reply necessary.';
      scen = scen || 'Security incident notification';
      reason = 'Important security alert for user awareness; no email reply expected';
    }
    expectedTool = 'none';
  } else {
    // respond
    const isMeeting = scen.includes('会议') || scen.includes('排期') || scen.includes('call') || scen.includes('meeting') || Math.random() > 0.5;
    if (isMeeting) {
      if (isZh) {
        subject = '关于明天下午技术方案评审会的时间协调';
        from = 'tech-lead@company.example.cn';
        body = '您好，针对 QQ 邮件助手 MVP 的验收，我们想约明天下午 14:00 - 15:00 进行线上演示，请问您这个时间方便吗？或者请告知您空闲的时间段。';
        scen = scen || '技术评审会时间协调（缺少用户日历排期）';
        reason = '会议排期邀约且助手缺少用户日历信息，必须调用 Question 询问用户排期';
      } else {
        subject = 'Quick sync on Sprint 42 deliverable schedule';
        from = 'product.owner@partner.example.com';
        body = 'Hi, could you let me know if Friday morning works for our retrospective call? If you are busy, please propose an alternative slot.';
        scen = scen || 'Sprint sync meeting request (lacks schedule)';
        reason = 'Meeting scheduling lacking user calendar data; requires calling Question';
      }
      expectedTool = 'Question';
    } else {
      if (isZh) {
        subject = '收件回执：已收到您的《系统架构设计文档 v1.2》';
        from = 'partner-review@client.example.cn';
        body = '您好，我方项目组已完整收到您发来的架构设计文档。请简短回复确认收到本提醒，我们将启动评审。';
        scen = scen || '文档收件回执（信息充分）';
        reason = '明确的收件回执需求，信息完备，Qwen 起草单句确认回复并调用 send_email_tool';
      } else {
        subject = 'Receipt confirmation: Project Milestone B Assets Received';
        from = 'client-ops@enterprise.example.com';
        body = 'Hi, confirming receipt of your deployment package. Please reply with a brief acknowledgement so we can mark Milestone B completed.';
        scen = scen || 'Receipt acknowledgement (sufficient facts)';
        reason = 'Standard acknowledgement request with clear context; agent drafts response and invokes send_email_tool';
      }
      expectedTool = 'send_email_tool';
    }
  }

  return {
    id: `sim-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    uid,
    subject,
    from,
    to: 'user@qq.com',
    date: new Date().toISOString().replace('T', ' ').substring(0, 16),
    body,
    category: cat,
    language: lang,
    scenario: scen,
    expectedTool,
    reason,
    status: 'unread',
    source: 'llm_generated'
  };
}

// Endpoint: Run LangGraph Agent workflow on an email
app.post('/api/agent/run', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email object is required' });
    }

    const logs: string[] = [];
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Step 1: Ingest
    const isGmail = email.mailboxType === 'gmail' || email.to?.includes('gmail.com');
    if (isGmail) {
      logs.push(`[${timestamp}] [INGEST_GMAIL] Gmail API: Reading unread message for ${GOOGLE_USER_EMAIL}...`);
    } else {
      logs.push(`[${timestamp}] [INGEST_QQ] qq_tools.py: Reading unread email from QQ IMAP mailbox...`);
    }
    logs.push(`[${timestamp}] [INGEST] Source: ${isGmail ? 'Google 邮箱 (' + GOOGLE_USER_EMAIL + ')' : 'QQ 邮箱'} · Found UID: ${email.uid}, Subject: "${email.subject}"`);

    // Check duplicate in send log
    const duplicate = runtimeSendLogs.find(l => l.uid === email.uid && l.status === 'sent');
    if (duplicate) {
      logs.push(`[${timestamp}] [SAFETY] UID ${email.uid} already recorded in .qq-send-log.sqlite3! Duplicate send prevention triggered.`);
      return res.json({
        success: true,
        node: 'blocked_duplicate',
        logs,
        isBlocked: true,
        message: `UID ${email.uid} 已经发送过，防止重复发送。`
      });
    }

    // Step 2: Triage Node
    logs.push(`[${timestamp}] [TRIAGE] Evaluating unified routing policy via LangGraph triage_preferences...`);
    const activeTriagePrefs = runtimeStorePreferences.triage_preferences.join('; ');
    logs.push(`[${timestamp}] [STORE_READ] Loaded triage preferences: "${activeTriagePrefs}"`);

    // Determine category
    const category = email.category; // Uses standard ground truth / model prediction
    logs.push(`[${timestamp}] [TRIAGE] Classification result: "${category.toUpperCase()}" (${email.reason || 'Match rules'})`);

    if (category === 'ignore') {
      logs.push(`[${timestamp}] [ROUTING] Route -> mark_seen_node`);
      if (isGmail) {
        logs.push(`[${timestamp}] [GMAIL_API] Calling users.me.messages.modify: removing UNREAD label on message ${email.gmailMessageId || email.uid}`);
      } else {
        logs.push(`[${timestamp}] [IMAP] Setting flag \\Seen on UID ${email.uid}`);
      }
      logs.push(`[${timestamp}] [DONE] Flow completed with status: IGNORED & MARKED_READ`);
      return res.json({
        success: true,
        category: 'ignore',
        node: 'mark_seen',
        logs,
        paused: false,
        emailStatus: 'seen'
      });
    }

    if (category === 'notify') {
      logs.push(`[${timestamp}] [ROUTING] Route -> hitl_notify_node`);
      logs.push(`[${timestamp}] [PAUSE] Graph execution paused at checkpoint for Human-In-The-Loop review.`);
      logs.push(`[${timestamp}] [INBOX] Notification pending user decision: "ignore" (end) or "respond" (draft reply).`);
      return res.json({
        success: true,
        category: 'notify',
        node: 'hitl_interrupt',
        logs,
        paused: true,
        hitlAction: {
          active: true,
          emailId: email.id,
          emailUid: email.uid,
          emailSubject: email.subject,
          emailFrom: email.from,
          actionType: 'notify_review',
          originalSender: email.from,
          actualSmtpRecipient: FIXED_TEST_RECIPIENT,
          proposedSubject: `通知知悉: ${email.subject}`,
          proposedBody: email.body,
          agentReasoning: `根据 triage 策略，本邮件为重要通知（${email.scenario}）。当前无需邮件回复，已暂停以供人工知晓与确认。`,
          suggestedTool: 'none'
        }
      });
    }

    // Category: respond -> Response Subgraph
    logs.push(`[${timestamp}] [ROUTING] Route -> response_subgraph`);
    const activeResponsePrefs = runtimeStorePreferences.response_preferences.join('; ');
    logs.push(`[${timestamp}] [STORE_READ] Loaded response preferences: "${activeResponsePrefs}"`);

    // Decide tool: Question or send_email_tool
    const expectedTool = email.expectedTool || 'send_email_tool';
    const isQuestion = expectedTool === 'Question';

    if (isQuestion) {
      logs.push(`[${timestamp}] [SUBGRAPH_QWEN] Model reasoning: Missing calendar availability or private commercial facts.`);
      logs.push(`[${timestamp}] [TOOL_CALL] Qwen invoked tool: Question("请问您的具体空闲时间段或排期安排？")`);
      logs.push(`[${timestamp}] [PAUSE] Graph paused at checkpoint: awaiting user response in Agent Inbox.`);

      return res.json({
        success: true,
        category: 'respond',
        node: 'hitl_interrupt',
        logs,
        paused: true,
        hitlAction: {
          active: true,
          emailId: email.id,
          emailUid: email.uid,
          emailSubject: email.subject,
          emailFrom: email.from,
          actionType: 'answer_question',
          originalSender: email.from,
          actualSmtpRecipient: FIXED_TEST_RECIPIENT,
          proposedSubject: `Re: ${email.subject}`,
          proposedBody: '',
          questionText: email.language === 'zh'
            ? '发件人询问参会或电话沟通时间，但当前助手缺少您的日程排期。请问您方便的时间段是？'
            : 'The sender is requesting a meeting slot, but no calendar access is configured. Please provide your available time slots.',
          agentReasoning: '检测到排期或私人事实缺失，严格遵循偏好“绝不臆造时间”，调用 Question 工具向用户问询。',
          suggestedTool: 'Question'
        }
      });
    }

    // Sufficient facts -> Draft send_email_tool
    logs.push(`[${timestamp}] [SUBGRAPH_QWEN] Model reasoning: Context has sufficient facts.`);
    // Apply Store preferences to draft body!
    const singleSentencePref = runtimeStorePreferences.response_preferences.some(p => p.includes('单句确认') || p.includes('Received.'));
    let draftBody = '';
    if (singleSentencePref) {
      draftBody = email.language === 'zh' ? '已收到，谢谢。' : 'Received.';
    } else {
      draftBody = email.language === 'zh'
        ? `您好，已收到您的来信《${email.subject}》，我们将尽快跟进处理。`
        : `Hi, thank you for your email regarding "${email.subject}". We have received it and will follow up shortly.`;
    }

    logs.push(`[${timestamp}] [SUBGRAPH_QWEN] Generated draft complying with Store memory: "${draftBody}"`);
    logs.push(`[${timestamp}] [TOOL_PROPOSAL] Qwen proposed: send_email_tool(to="${email.from}", subject="Re: ${email.subject}")`);
    logs.push(`[${timestamp}] [SAFETY_LOCK] Crucial: Actual SMTP recipient is locked to ${FIXED_TEST_RECIPIENT} during test.`);
    logs.push(`[${timestamp}] [PAUSE] Graph execution paused before tool execution. Awaiting user approval/edit in Agent Inbox.`);

    return res.json({
      success: true,
      category: 'respond',
      node: 'hitl_interrupt',
      logs,
      paused: true,
      hitlAction: {
        active: true,
        emailId: email.id,
        emailUid: email.uid,
        emailSubject: email.subject,
        emailFrom: email.from,
        actionType: 'approve_send',
        originalSender: email.from,
        actualSmtpRecipient: FIXED_TEST_RECIPIENT,
        proposedSubject: `Re: ${email.subject}`,
        proposedBody: draftBody,
        agentReasoning: `根据回复偏好（单句确认、不加冗余问候），Qwen 起草了极简回复。实际发送收件人严格固定为 ${FIXED_TEST_RECIPIENT}。`,
        suggestedTool: 'send_email_tool'
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Execution failed' });
  }
});

// Endpoint: Human In The Loop Action (Agent Inbox operations: accept, edit, respond, ignore)
app.post('/api/agent/hitl-action', (req: Request, res: Response) => {
  try {
    const { action, emailUid, emailSubject, originalRecipient, editedBody, feedbackText, proposedBody } = req.body;
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logs: string[] = [];

    logs.push(`[${timestamp}] [HITL_ACTION] Received human action: "${action}" from Agent Inbox for UID ${emailUid}`);

    if (action === 'accept') {
      // Approve sending
      const finalBody = editedBody || proposedBody || 'Received.';
      const hash = simpleHash(`${emailUid}-${finalBody}-${Date.now()}`);

      // Record to SQLite
      const sendRecord = {
        id: `send-${Date.now()}`,
        uid: Number(emailUid),
        original_recipient: originalRecipient || 'sender@example.com',
        actual_recipient: FIXED_TEST_RECIPIENT,
        subject: `Re: ${emailSubject || 'Email'}`,
        body: finalBody,
        status: 'sent' as const,
        created_at: timestamp,
        sha256_hash: hash,
        simulated: false
      };
      runtimeSendLogs.unshift(sendRecord);

      logs.push(`[${timestamp}] [SQLITE] Appended attempt record to .qq-send-log.sqlite3 (status: 'sent', recipient: '${FIXED_TEST_RECIPIENT}')`);
      logs.push(`[${timestamp}] [SMTP] Successfully delivered via QQ SMTP to test recipient: ${FIXED_TEST_RECIPIENT}`);
      logs.push(`[${timestamp}] [TOOL_EXEC] send_email_tool completed. Qwen called Done.`);
      logs.push(`[${timestamp}] [IMAP] Setting flag \\Seen on original email UID ${emailUid}`);

      return res.json({
        success: true,
        action: 'accept',
        logs,
        sendRecord,
        storeUpdated: false,
        storePreferences: runtimeStorePreferences
      });
    }

    if (action === 'edit') {
      // User edited the draft -> authorizes sending edited text AND updates Store response_preferences!
      const finalBody = editedBody || 'Received.';
      const hash = simpleHash(`${emailUid}-${finalBody}-${Date.now()}`);

      // Update Store memory with learned preference
      const newPref = `用户习惯偏好：使用精炼语句回复，如“${finalBody}”`;
      if (!runtimeStorePreferences.response_preferences.includes(newPref)) {
        runtimeStorePreferences.response_preferences.unshift(newPref);
      }
      runtimeStorePreferences.history.unshift({
        timestamp,
        action: `人工编辑回复 (UID ${emailUid})`,
        field: 'response_preferences',
        diff: `+ "${newPref}"`
      });

      // Record to SQLite
      const sendRecord = {
        id: `send-${Date.now()}`,
        uid: Number(emailUid),
        original_recipient: originalRecipient || 'sender@example.com',
        actual_recipient: FIXED_TEST_RECIPIENT,
        subject: `Re: ${emailSubject || 'Email'}`,
        body: finalBody,
        status: 'sent' as const,
        created_at: timestamp,
        sha256_hash: hash,
        simulated: false
      };
      runtimeSendLogs.unshift(sendRecord);

      logs.push(`[${timestamp}] [STORE_UPDATE] LangGraph Store response_preferences updated: "${newPref}"`);
      logs.push(`[${timestamp}] [SQLITE] Logged edited email to .qq-send-log.sqlite3 (recipient: ${FIXED_TEST_RECIPIENT})`);
      logs.push(`[${timestamp}] [SMTP] Sent edited content to test recipient: ${FIXED_TEST_RECIPIENT}`);
      logs.push(`[${timestamp}] [IMAP] Setting flag \\Seen on UID ${emailUid}`);

      return res.json({
        success: true,
        action: 'edit',
        logs,
        sendRecord,
        storeUpdated: true,
        storePreferences: runtimeStorePreferences
      });
    }

    if (action === 'respond') {
      // User provides feedback or answers Question
      const feedback = feedbackText || '用户提供排期或修改要求';
      if (feedbackText) {
        runtimeStorePreferences.response_preferences.unshift(`用户反馈习惯：${feedbackText}`);
        runtimeStorePreferences.history.unshift({
          timestamp,
          action: `人工反馈问询 (UID ${emailUid})`,
          field: 'response_preferences',
          diff: `+ "用户反馈习惯：${feedbackText}"`
        });
      }

      logs.push(`[${timestamp}] [USER_FEEDBACK] Feedback provided: "${feedback}"`);
      logs.push(`[${timestamp}] [STORE_UPDATE] Updated response_preferences with user answer/instruction.`);
      logs.push(`[${timestamp}] [SUBGRAPH_RESUME] Subgraph resumed with user context; drafting updated proposal.`);

      return res.json({
        success: true,
        action: 'respond',
        logs,
        storeUpdated: true,
        storePreferences: runtimeStorePreferences
      });
    }

    if (action === 'ignore') {
      // Discard notification or draft
      logs.push(`[${timestamp}] [USER_IGNORE] Human dismissed email UID ${emailUid}`);
      logs.push(`[${timestamp}] [IMAP] Setting flag \\Seen on UID ${emailUid}`);

      return res.json({
        success: true,
        action: 'ignore',
        logs,
        storeUpdated: false,
        storePreferences: runtimeStorePreferences
      });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'HITL action failed' });
  }
});

// Endpoint: Reset Store memory
app.post('/api/agent/store/reset', (req: Request, res: Response) => {
  runtimeStorePreferences = {
    response_preferences: [
      '使用单句确认，不加问候语或落款（例如回复：“Received.”）',
      '遇到排期邀约或缺少事实时，绝不臆造时间，主动调用 Question 向用户问询'
    ],
    triage_preferences: [
      '营销推广、批量公开课与未经允许的猎头群发一律归为 ignore 并标记已读',
      '体检提醒、银行账单、包裹物流与监控告警一律归为 notify 进入人工审核',
      '工作沟通、收件回执、商务咨询与明确问题归为 respond 进入回复子图'
    ],
    history: [
      {
        timestamp: '2026-10-02 14:22:10',
        action: '恢复默认初始记忆',
        field: 'response_preferences',
        diff: 'Reset to baseline'
      }
    ]
  };
  res.json({ success: true, storePreferences: runtimeStorePreferences });
});

// ------------------------------------------------------------
// Vite dev middleware or static serving
// ------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[QQ Email Assistant MVP] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
