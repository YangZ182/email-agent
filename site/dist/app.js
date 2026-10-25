const getElement = (id) => document.getElementById(id);
const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const seeds = [
  [
    "receipt",
    "确认收到材料",
    "陈同学",
    "respond",
    "附件材料已提交，请简短回信确认收到，谢谢。",
    "确认收到材料，谢谢。",
  ],
  [
    "meeting",
    "会议时间确认",
    "项目协作组",
    "respond",
    "希望下周安排一次 30 分钟的项目沟通，请回复您方便的具体时间。",
    "好的，会议时间确认为：{answer}。",
    "您下周哪一天、什么时间方便进行 30 分钟沟通？",
  ],
  [
    "sale",
    "限时促销 · 本周精选",
    "品牌订阅",
    "ignore",
    "本周会员专享折扣已上线，欢迎浏览活动页面。无需回复。",
    "",
  ],
  [
    "course",
    "群发课程推广",
    "课程资讯",
    "ignore",
    "新一期公开课程开始招生，本邮件为订阅推广信息。",
    "",
  ],
  [
    "maintenance",
    "系统维护公告",
    "运维团队",
    "notify",
    "本周六 02:00–04:00 系统维护，期间暂停访问，请知悉，无需回复。",
    "收到系统维护安排，谢谢通知。",
  ],
  [
    "renewal",
    "订阅续费提醒",
    "服务中心",
    "notify",
    "您的订阅将在 10 月 28 日自动续费，请留意账单，无需回复。",
    "已收到续费提醒，我会核对订阅安排。",
  ],
  [
    "progress",
    "项目进度通知",
    "项目负责人",
    "notify",
    "本周开发工作已完成，接口文档已更新；如有反馈可直接回信。",
    "已了解本周进展，谢谢更新，后续我会查看接口文档。",
  ],
  [
    "delivery",
    "交付日期更新",
    "交付协作组",
    "notify",
    "本次交付计划已调整，请留意最新安排。如需确认您的验收时间，请回信。",
    "我的验收时间为：{answer}。请按此时间协调交付，谢谢。",
    "您希望在什么日期、哪个时间段进行验收？",
  ],
];
let mails = [],
  selected = null,
  area = "notify",
  showCompleted = false,
  reading = false,
  epoch = 0,
  preferences = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nodes = [
  ["fetch", "邮箱收取", "fetch_mail", 10, 126, 115],
  ["triage", "三分类路由", "triage_router", 160, 126, 135],
  ["ignored", "标为已读", "mark_as_read → END", 355, 22, 180],
  ["notify", "通知审核", "triage_interrupt_handler", 355, 86, 240],
  ["llm", "回复起草", "llm_call + RAG", 355, 190, 135],
  ["hitl", "人工审核", "interrupt_handler", 535, 190, 150],
  ["send", "批准发送", "send_email_tool", 735, 190, 150],
  ["read", "标为已读", "mark_as_read → END", 930, 190, 170],
  ["question", "补充事实", "Question → llm_call", 535, 290, 180],
];
const edges = [
  ["fetch", "triage", ""],
  ["triage", "ignored", "ignore"],
  ["triage", "notify", "notify"],
  ["triage", "llm", "respond"],
  ["notify", "read", "已知悉"],
  ["notify", "llm", "转为回复"],
  ["llm", "hitl", ""],
  ["hitl", "send", "批准"],
  ["send", "read", ""],
  ["llm", "question", "缺少事实"],
  ["question", "llm", "回答后起草"],
  ["hitl", "read", "放弃回复"],
  ["question", "read", "放弃回复"],
];
function advanceNode(m, id) {
  if (m.path.at(-1) !== id) {
    if (m.path.length) m.edges.add(m.path.at(-1) + ">" + id);
    m.path.push(id);
  }
  m.current = id;
  render();
}
function describeStatus(m) {
  return (
    {
      fetch: "正在读取",
      triage: "正在分类",
      notify: "等待通知处理",
      llm: "正在起草",
      hitl: "等待草稿审核",
      question: "等待补充事实",
      send: "正在发送",
      read: "已完成",
      ignored: "已自动忽略",
    }[m.current] || "等待处理"
  );
}
function renderGraph() {
  const m = mails.find((x) => x.id === selected),
    mobile = matchMedia("(max-width:720px)").matches;
  const pos = new Map(
    nodes.map((n, i) => [
      n[0],
      mobile
        ? [
            n[0],
            n[1],
            n[2],
            {
              fetch: 12,
              triage: 12,
              ignored: 190,
              notify: 190,
              llm: 12,
              hitl: 190,
              send: 190,
              read: 190,
              question: 12,
            }[n[0]],
            {
              fetch: 8,
              triage: 82,
              ignored: 82,
              notify: 156,
              llm: 230,
              hitl: 230,
              send: 304,
              read: 378,
              question: 304,
            }[n[0]],
            150,
          ]
        : n,
    ]),
  );
  const paths = edges
    .map(([a, b, label]) => {
      const A = pos.get(a),
        B = pos.get(b),
        active = m?.edges.has(a + ">" + b);
      let x1 = A[3] + A[5],
        y1 = A[4] + 25,
        x2 = B[3],
        y2 = B[4] + 25;
      if (mobile) {
        x1 = A[3] + A[5] / 2;
        y1 = A[4] + 50;
        x2 = B[3] + B[5] / 2;
        y2 = B[4];
      }
      const routes = {
        "fetch>triage": ["M125 151 H160", 142, 140],
        "triage>ignored": ["M295 151 H315 V47 H355", 332, 37],
        "triage>notify": ["M295 151 H325 V111 H355", 332, 101],
        "triage>llm": ["M295 151 H315 V215 H355", 332, 205],
        "notify>read": ["M595 111 H1015 V190", 820, 101],
        "notify>llm": ["M475 136 V165 H420 V190", 500, 158],
        "llm>hitl": ["M490 215 H535", 512, 205],
        "hitl>send": ["M685 215 H735", 710, 205],
        "send>read": ["M885 215 H930", 907, 205],
        "llm>question": ["M430 240 V315 H535", 475, 305],
        "question>llm": ["M535 330 H400 V240", 462, 350],
        "hitl>read": ["M610 240 V265 H1015 V240", 820, 258],
        "question>read": ["M715 315 H1110 V215 H1100", 820, 305],
      };
      const route = routes[a + ">" + b];
      const d = mobile
        ? `M${x1},${y1} C${x1},${y1 + 20} ${x2},${y2 - 20} ${x2},${y2}`
        : route[0];
      return `<path class="edge ${active ? "visited" : ""}" data-edge="${a}>${b}" d="${d}" marker-end="url(#arrow-${active ? "active" : "idle"})"/>${label && !mobile ? `<text class="edge-label" x="${route[1]}" y="${route[2]}" text-anchor="middle">${label}</text>` : ""}`;
    })
    .join("");
  getElement("graph").innerHTML =
    `<svg viewBox="0 0 ${mobile ? "355 435" : "1120 395"}" role="img" aria-label="邮件执行流程，已经过节点累计点亮"><title>LangGraph 邮件执行路径</title><defs><marker id="arrow-idle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10Z" fill="#bdcce0"/></marker><marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10Z" fill="#2864f5"/></marker></defs>${mobile ? "" : `<g aria-label="Respond Agent 回复子图"><rect x="340" y="179" width="565" height="206" rx="12" fill="#f9fbff" stroke="#cbd9ef" stroke-width="1.5"/><text x="360" y="373" fill="#385f98" font-size="12" font-weight="600">RESPOND AGENT</text><text x="480" y="373" fill="#7c8fab" font-size="10">回复子图 · 推理 / 工具调用 / 人工审核</text></g>`}${paths}${[...pos.values()].map(([id, title, sub, x, y, w]) => `<g class="node ${m?.path.includes(id) ? "visited" : ""} ${m?.current === id ? "current" : ""}" data-node="${id}" transform="translate(${x},${y})"><rect width="${w}" height="50" rx="8"/><text x="${w / 2}" y="20" text-anchor="middle">${title}</text><text class="sub" x="${w / 2}" y="36" text-anchor="middle">${sub}</text></g>`).join("")}</svg>`;
  getElement("graph-status").textContent = m
    ? `${m.subject} · ${describeStatus(m)}`
    : "等待读取邮件";
  getElement("current-detail").textContent = m
    ? `当前节点：${m.current} · ${describeStatus(m)}`
    : "选择邮件，查看独立执行进度";
}
function renderCounts() {
  for (const r of ["notify", "respond"])
    getElement(r + "-count").textContent = mails.filter(
      (m) => m.route === r && !m.done,
    ).length;
  getElement("total").textContent = mails.length;
  getElement("load").disabled = reading;
  getElement("reset").disabled = reading;
  getElement("completed").checked = showCompleted;
  for (const r of ["notify", "respond"])
    getElement(r).classList.toggle("active", r === area);
}
function renderPreferences() {
  const m = mails.find((x) => x.id === selected);
  getElement("rules").innerHTML = preferences
    .map(
      (p, i) =>
        `<article class="rule"><div class="rule-top"><span>PREF-${String(i + 1).padStart(2, "0")}</span><span>${i === 0 ? "TRIAGE" : "RESPONSE"}</span></div><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.body)}</p></article>`,
    )
    .join("");
  getElement("pref-count").textContent = preferences.length + " 条已生效";
  getElement("candidate").innerHTML = m?.candidate
    ? `<div class="candidate"><h3>回复偏好候选</h3><p class="muted">当前版本</p><div class="original">${escapeHtml(preferences[1].body)}</div><p class="muted">候选版本与差异</p><div class="diff">${escapeHtml(preferences[1].body)}\n+ ${escapeHtml(m.candidate)}</div><div class="actions"><button class="primary" data-action="confirm">确认更新</button><button data-action="reject">保留原规则</button></div></div>`
    : "";
}
function render() {
  renderCounts();
  renderGraph();
  renderPreferences();
  const visible = mails.filter(
    (m) => (m.route === area && !m.done) || (showCompleted && m.done),
  );
  getElement("mail-list").innerHTML = visible.length
    ? visible
        .map((m) => {
          const active = m.id === selected;
          return `<article class="mail ${active ? "selected" : ""}"><button class="mail-pick" data-select="${m.id}" aria-expanded="${active}"><span class="meta"><span>${escapeHtml(m.sender)} &lt;sender@example.com&gt;</span><span class="badge ${m.route}">${m.done ? "已完成 · " : ""}${m.route.toUpperCase()}</span></span><span class="subject">${escapeHtml(m.subject)}</span><span class="preview">${escapeHtml(m.body)}</span></button>${active ? `<div class="mail-body"><div class="original">${escapeHtml(m.body)}</div><p class="status" aria-live="polite">● ${describeStatus(m)}</p>${renderReviewControls(m)}</div>` : ""}</article>`;
        })
        .join("")
    : `<div class="empty"><span>✉</span><h3>${mails.length ? "暂无" + (area === "notify" ? "通知" : "待回复") + "邮件" : "收件箱已准备好"}</h3><p>${mails.length ? "处理完成的邮件可通过「显示已完成」查看。" : "点击「读取全部邮件」，观察分类与审核流程。"}</p></div>`;
}
function renderReviewControls(m) {
  if (m.done)
    return `<p class="success">${m.sent ? "回复已发送，发送操作已锁定。" : "邮件处理完成，已标为已读。"}</p>${m.sent ? `<div class="original">${escapeHtml(m.draft)}</div>` : ""}`;
  if (m.busy) return '<p class="muted">正在处理，请稍候…</p>';
  if (m.current === "notify")
    return `<div class="action-box"><h3>通知处理</h3><div class="actions"><button data-action="ack">已知悉</button><button class="primary" data-action="reply">转为回复</button></div></div>`;
  if (m.current === "question")
    return `<div class="action-box"><h3>Agent 问题</h3><p>${escapeHtml(m.question)}</p><label for="answer">补充事实 / 问题答案</label><textarea id="answer" data-field="answer" placeholder="填写您方便的时间">${escapeHtml(m.answer)}</textarea><div class="actions"><button class="primary" data-action="answer">提交答案并重新起草</button><button data-action="abandon">放弃回复</button></div></div>`;
  if (m.current === "hitl")
    return `<div class="action-box"><h3>回复审核</h3><label for="draft">最终回复正文</label><textarea id="draft" data-field="draft">${escapeHtml(m.draft)}</textarea><label for="feedback">本次编辑的偏好说明（可选）</label><textarea id="feedback" data-field="feedback" placeholder="例如：以后保持简短，使用单句确认">${escapeHtml(m.feedback)}</textarea><label><input id="approve" data-field="approved" type="checkbox" ${m.approved ? "checked" : ""}> 我确认最终回复正文</label><div class="actions"><button class="primary" data-action="send" ${m.approved && m.draft.trim() ? "" : "disabled"}>批准发送</button><button data-action="abandon">放弃回复</button></div></div>`;
  return "";
}
async function draftReply(m, token) {
  m.busy = true;
  advanceNode(m, "llm");
  await wait(450);
  if (token !== epoch) return;
  if (m.question && !m.answer.trim()) {
    m.busy = false;
    advanceNode(m, "question");
    return;
  }
  m.draft = m.template.replace("{answer}", m.answer);
  if (
    preferences.some((p) => p.title === "人工确认的回复偏好") &&
    m.id === "receipt"
  )
    m.draft = "确认收到，谢谢。";
  m.originalDraft = m.draft;
  m.approved = false;
  m.busy = false;
  advanceNode(m, "hitl");
}
async function readAllEmails() {
  if (reading) return;
  if (mails.length) {
    getElement("batch").textContent = "全部 8 封邮件已读取";
    return;
  }
  reading = true;
  const token = epoch;
  for (const seed of seeds) {
    if (token !== epoch) return;
    const [id, subject, sender, route, body, template, question = ""] = seed;
    const m = {
      id,
      subject,
      sender,
      route,
      body,
      template,
      question,
      path: [],
      edges: new Set(),
      answer: "",
      draft: "",
      feedback: "",
      approved: false,
      busy: true,
      done: false,
      sent: false,
    };
    mails.push(m);
    selected = m.id;
    if (route !== "ignore") area = route;
    getElement("batch").textContent = `读取与分类 ${mails.length}/8`;
    advanceNode(m, "fetch");
    await wait(220);
    if (token !== epoch) return;
    advanceNode(m, "triage");
    await wait(280);
    if (token !== epoch) return;
    if (route === "ignore") {
      m.done = true;
      m.busy = false;
      advanceNode(m, "ignored");
    } else if (route === "notify") {
      m.busy = false;
      advanceNode(m, "notify");
    } else await draftReply(m, token);
  }
  reading = false;
  area = "notify";
  selected = "maintenance";
  getElement("batch").textContent = "8 封已读取 · 2 封自动忽略";
  render();
}
async function handleAction(name) {
  const m = mails.find((x) => x.id === selected);
  if (!m || m.busy) return;
  const token = epoch;
  if (name === "confirm") {
    preferences.push({ title: "人工确认的回复偏好", body: m.candidate });
    m.candidate = null;
    render();
    return;
  }
  if (name === "reject") {
    m.candidate = null;
    render();
    return;
  }
  if (m.done) return;
  if (name === "reply") {
    m.route = "respond";
    area = "respond";
    await draftReply(m, token);
    return;
  }
  if (name === "answer") {
    if (!m.answer.trim()) {
      getElement("answer").focus();
      return;
    }
    await draftReply(m, token);
    return;
  }
  if (name === "ack" || name === "abandon") {
    m.done = true;
    advanceNode(m, "read");
    return;
  }
  if (name === "send" && m.approved && m.draft.trim()) {
    m.busy = true;
    advanceNode(m, "send");
    await wait(550);
    if (token !== epoch) return;
    m.sent = true;
    m.done = true;
    m.busy = false;
    if (m.draft !== m.originalDraft && m.feedback.trim())
      m.candidate = m.feedback.trim();
    advanceNode(m, "read");
  }
}
function resetExperience() {
  epoch++;
  mails = [];
  selected = null;
  area = "notify";
  showCompleted = false;
  reading = false;
  preferences = [
    {
      title: "重要信息进入通知区",
      body: "系统维护、费用续订与交付更新需要提醒；促销和群发推广可忽略。",
    },
    {
      title: "简洁、专业，不虚构事实",
      body: "回复保持礼貌简短。缺少排期、承诺或事实时，先通过 Question 询问。",
    },
    {
      title: "人工批准后执行",
      body: "草稿经过编辑与确认后发送，偏好候选需要单独确认。",
    },
  ];
  getElement("batch").textContent = "准备就绪";
  render();
}
document.addEventListener("click", (e) => {
  const pick = e.target.closest("[data-select]");
  if (pick) {
    selected = pick.dataset.select;
    render();
    return;
  }
  const a = e.target.closest("[data-action]");
  if (a) handleAction(a.dataset.action);
});
document.addEventListener("input", (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const m = mails.find((x) => x.id === selected);
  if (!m) return;
  m[field] = field === "approved" ? e.target.checked : e.target.value;
  if (field === "approved" || field === "draft") {
    const send = document.querySelector('[data-action="send"]');
    if (send) send.disabled = !m.approved || !m.draft.trim();
  }
});
for (const r of ["notify", "respond"])
  getElement(r).onclick = () => {
    area = r;
    const first = mails.find((m) => m.route === r && !m.done);
    selected = first?.id ?? null;
    render();
  };
getElement("completed").onchange = (e) => {
  showCompleted = e.target.checked;
  render();
};
getElement("load").onclick = readAllEmails;
getElement("reset").onclick = resetExperience;
matchMedia("(max-width:720px)").addEventListener("change", renderGraph);
resetExperience();
