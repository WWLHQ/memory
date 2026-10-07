// 浏览器入口：严格对齐 design/ui/Agent接入页_原型.html（REQ-003 · 接原型）。
// 把原型内联脚本的逻辑（AGENTS/DISCOVERED/GAINS + 交互）用 ES module 重写，
// 卡片/发现/证据渲染走 render.js（renderCard/renderFound/renderGains），
// 结构与样式 class 与原型完全一致，禁止偏离。
// 真实后端（隐藏 #backend，默认 http://localhost:8200）仅作动作镜像：best-effort 调 T13 服务，
// 不改变原型视觉与同步交互行为（无后端时页面与原型完全一致）。
//
// 打开方式（ES module 需 http）：python -m http.server 8123 → http://localhost:8123/src/agentOnboard/app.html
import { AgentOnboardService } from './service.js';
import { AgentOnboardClient } from './client.js';
import { renderCard, renderFound, renderGains } from './render.js';

/* ============ 19.2 接入优先级 + 3 家 Agent 接入数据（与原型一致） ============ */
const AGENTS = [
  { name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', method: 'MCP + Webhook 直连（自有）',
    conn: 99.2, circuit: 'CLOSED', latency: 1.2, fail: 0, recover: 0, tenant: 'ent_001 / team_001',
    tools: { recall: { on: true, topk: 5, scene: 'task_start', mode: '' }, write: { on: true, category: 'work' }, pref: { on: true } },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: true, api: true, recon: '5min' }, key: { mask: '[API_KEY:harness]', last: '32 天前', grace: 24 },
    state: 'connected' },
  { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', method: 'MCP 工具 + 会话日志兜底（第三方样板）',
    conn: 98.1, circuit: 'CLOSED', latency: 1.4, fail: 0, recover: 0, tenant: 'ent_001 / team_001',
    tools: { recall: { on: true, topk: 5, scene: 'default', mode: '' }, write: { on: true, category: 'work' }, pref: { on: true } },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: true, api: true, recon: '5min' }, key: { mask: '[API_KEY:claude]', last: '5 天前', grace: 24 },
    state: 'connected' },
  { name: 'Codex', badge: 'p2', label: '兜底·P2', method: 'MCP（若支持）+ API 拉取兜底',
    conn: 93.5, circuit: 'OPEN', latency: 6.1, fail: 5, recover: 60, tenant: 'ent_001 / team_001',
    tools: { recall: { on: true, topk: 5, scene: 'default', mode: '' }, write: { on: true, category: 'work' }, pref: false },
    iso: { projShare: true, prefCross: true },
    chan: { webhook: false, api: true, recon: '5min' }, key: { mask: '[API_KEY:codex]', last: '92 天前', grace: 24 },
    state: 'degraded' },
];

/* ============ 19.9 一键接入：发现结果（与原型一致） ============ */
const DISCOVERED = [
  { name: 'deepseek harness', badge: 'p0', label: 'MVP·P0', signal: 'MCP 注册表 + 本机进程', bound: true, ok: true },
  { name: 'Claude Code', badge: 'p1', label: 'MVP·P1', signal: 'MCP 注册表 + Webhook 心跳', bound: true, ok: true },
  { name: 'Codex', badge: 'p2', label: '兜底·P2', signal: '本机进程 + API 拉取兜底', bound: true, ok: false },
  { name: 'Cursor', badge: 'p3', label: '扩展·P3', signal: '未发现信号', bound: false, ok: false },
];

/* ============ 效果证据（与原型一致） ============ */
const GAINS = [
  { icon: '🪙', title: 'Token 节省', big: '-58%',
    desc: '本周期 Agent 平均每次召回 <b>payload 780/1500</b>；极简模式短查询仅 <b>≤600t</b>，对比全量召回数千 token。次模式注入 <b>≤200t 占位符</b>而非全文。',
    src: '2.4.1 三档预算 / 2.4.3 占位符注入 / 检索页预算面板' },
  { icon: '⚡', title: '效率提升', big: '-34% 背景交代',
    desc: '跨会话已记住项目技术栈/约束/决策，<b>新会话免重复贴说明</b>；踩坑库自动召回，<b>少犯同类错</b>；决策可追溯，问「为什么」直接给依据。',
    src: '9.1 跨会话 / 9.3 踩坑 / 9.4 决策' },
  { icon: '🔁', title: '跨 Agent 复用', big: '1 次沉淀 · 4 端共享',
    desc: 'Claude Code 记的踩坑，Codex 同 project_id 直接命中——<b>一次沉淀，多处省</b>；个人偏好按 user_id 跨 Agent/项目共享。',
    src: '19.4 project_id 共享域 / user_id 偏好' },
  { icon: '💸', title: '模型成本节省（反代理 19.8）', big: '¥0 · 省 ¥19/月',
    desc: '自动选择<b>先免费、后低价</b>：本周期跨 3 Agent 反代理 480 次（claude-free 免费 312 + gpt4o-mini 低价 168），不额外掏模型钱。低价源单价上限 <b>¥0.02/千</b>（用户设，不可超），成本封顶 ¥3/月。',
    src: '19.8 proxy_select_mode=auto · 免费优先 · proxy_price_cap 用户定' },
];

/* ============ 后端（隐藏，默认本地 T13 服务）；best-effort 镜像 ============ */
let _svc = null;
function getSvc() {
  const url = (document.getElementById('backend')?.value || '').trim();
  if (!_svc) {
    _svc = url
      ? new AgentOnboardService(new AgentOnboardClient(url))
      : new AgentOnboardService();
  }
  return _svc;
}
// 不阻塞原型同步交互：失败仅静默（诊断层会显示异常）
function bg(fn) { try { const r = fn(getSvc()); if (r && typeof r.catch === 'function') r.catch(() => {}); } catch { /* noop */ } }

function toast(m) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = m; t.style.display = 'block';
  clearTimeout(t._x); t._x = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

/* ============ 19.9 一键接入：扫 → 分 → 绑 → 验 ============ */
let discovering = false;
function paintFound() {
  const box = document.getElementById('found');
  if (!box) return;
  const sigs = [...document.querySelectorAll('.sig:checked')].map((x) => x.value);
  // 仅展示与当前勾选信号源相关的发现（原型语义：信号源变化即重绘）
  const list = DISCOVERED.filter((d) => {
    if (sigs.length === 0) return !d.bound; // 无信号源则仅显示待手填
    return true;
  });
  box.innerHTML = renderFound(list);
  box.querySelectorAll('[data-unbind]').forEach((b) => b.addEventListener('click', () => {
    const d = DISCOVERED[+b.dataset.unbind];
    d.bound = false;
    const ag = AGENTS.find((x) => x.name === d.name);
    if (ag) { ag.state = 'onboard'; renderCards(); }
    bg((svc) => svc.revokeBind(d.name));
    toast('已撤销 ' + d.name + ' 的自动绑定（审计 unbound）；恢复需重跑一键接入');
    paintFound();
  }));
}

function discover() {
  if (discovering) return;
  discovering = true;
  const btn = document.getElementById('btnDiscover');
  if (btn) btn.disabled = true;
  const found = document.getElementById('found');
  if (found) found.innerHTML = '';
  const stages = [...document.querySelectorAll('.stage')];
  const labels = ['扫描注册信号中…', '自动打标 P0/P1/P2 中…', '按默认值绑定中…', '测通并写审计中…'];
  stages.forEach((s) => s.classList.remove('done'));
  stages.forEach((s, i) => {
    setTimeout(() => {
      s.classList.add('done');
      const ss = document.getElementById('scanState');
      if (ss) ss.textContent = labels[i];
      if (i === stages.length - 1) {
        DISCOVERED.forEach((d) => {
          const ag = AGENTS.find((x) => x.name === d.name);
          if (ag && d.bound) ag.state = d.ok ? 'connected' : 'degraded';
        });
        paintFound();
        const n = DISCOVERED.filter((d) => d.bound).length;
        const ss2 = document.getElementById('scanState');
        if (ss2) ss2.textContent = '完成 · 发现并绑定 ' + n + ' 个 · 已记审计 auto_bind';
        toast('一键接入完成：自动发现 ' + n + ' 个 Agent 并绑定（审计 auto_bind），立即可用');
        // 同步真实后端（best-effort，不改变视觉）
        bg((svc) => svc.oneClickOnboard(
          DISCOVERED.filter((d) => d.bound).map((d) => ({ name: d.name, priority: d.badge.toUpperCase(), signal: d.signal })),
          detectForm(),
        ));
        discovering = false;
        if (btn) btn.disabled = false;
      }
    }, 430 * (i + 1));
  });
}

/* ============ 渲染卡片 ============ */
function renderCards() {
  const c = document.getElementById('cards');
  if (!c) return;
  c.innerHTML = AGENTS.map((a) => renderCard(a)).join('\n');
  [...c.children].forEach((div, idx) => bindCard(div, idx));
}

// 工具项规范化：原型中 Codex 的 pref 是布尔 false（表示该工具未启用），
// 直接 `.on = ` 会在布尔上建属性抛 TypeError（Cannot create property 'on' on boolean）。
// 这里惰性提升为 { on } 对象，保持原型数据字面不变、视觉不变，仅使写入安全。
function toolRef(tools, key) {
  if (typeof tools[key] !== 'object' || tools[key] === null) tools[key] = { on: false };
  return tools[key];
}

function bindCard(div, idx) {
  const a = AGENTS[idx];
  // 工具开关 → 校验 critical 极简（R3）
  div.querySelectorAll('input[data-tool]').forEach((el) => el.addEventListener('change', () => {
    if (el.dataset.tool === 'recall') {
      const r = toolRef(a.tools, 'recall');
      r.on = el.checked;
      if (r.scene === 'critical' && r.mode === 'minimal') {
        r.mode = ''; toast('critical 禁极简，已回落自动（16.5）');
      }
      updateInject(div);
    }
    if (el.dataset.tool === 'write') toolRef(a.tools, 'write').on = el.checked;
    if (el.dataset.tool === 'pref') toolRef(a.tools, 'pref').on = el.checked;
    checkDualChannel(div);
  }));
  // 隔离开关
  div.querySelectorAll('input[data-iso]').forEach((el) => el.addEventListener('change', () => {
    a.iso[el.dataset.iso] = el.checked;
    toast(el.dataset.iso === 'projShare'
      ? (el.checked ? '已开启 project_id 跨 Agent 共享' : '已关闭：该项目记忆不再跨 Agent 共享')
      : (el.checked ? '个人偏好跨 Agent/项目共享（user_id 级）' : '个人偏好随项目隔离'));
  }));
  // 通道开关 → R4 双通道至少开一
  div.querySelectorAll('input[data-chan]').forEach((el) => el.addEventListener('change', () => {
    a.chan[el.dataset.chan] = el.checked;
    checkDualChannel(div);
  }));
  // 操作
  div.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, idx, div)));
  // rid 跳审计
  div.querySelector('[data-rid]')?.addEventListener('click', () => toast('开审计页（独立窗口）定位 ' + a.name + ' 的 request_id 链路（18.2-E）'));
}

function checkDualChannel(div) {
  const idx = [...document.getElementById('cards').children].indexOf(div);
  const a = AGENTS[idx];
  if (!a.chan.webhook && !a.chan.api) {
    div.querySelector('[data-err]').textContent = 'R4：双通道（Webhook + API 拉取）至少开一，记忆库需可采集（5.1）';
    div.querySelector('[data-err]').classList.add('show');
    div.querySelectorAll('[data-act="save"]').forEach((b) => b.disabled = true);
  } else {
    div.querySelector('[data-err]').classList.remove('show');
    div.querySelectorAll('[data-act="save"]').forEach((b) => b.disabled = false);
  }
}

function act(act, idx, div) {
  const a = AGENTS[idx];
  if (act === 'test') {
    if (a.circuit === 'OPEN') return;
    toast('测试成功：' + a.name + ' → req_test，已记审计（4.3）');
    div.querySelector('[data-inject]').style.display = 'block';
    bg((svc) => svc.testConnect(a.name));
  }
  if (act === 'rotate') {
    a.key.last = '刚轮换';
    div.querySelector('[data-mask]').textContent = a.key.mask + '（新）';
    toast('已轮换，旧 Key ' + a.key.grace + 'h 内有效（4.1）');
    bg((svc) => svc.rotateKey(a.name));
  }
  if (act === 'save') {
    if (a.tools.write.on && !a.iso.projShare) { toast('R2：记忆读写须带 project_id（关闭共享后请确认 project_id 仍可解析）'); return; }
    toast('已保存 ' + a.name + ' 接入配置');
    bg((svc) => svc.configure(toInput(a)));
  }
}

function toInput(a) {
  return {
    agent_name: a.name,
    priority: a.badge.toUpperCase(),
    status: a.state,
    tenantManual: false,
    mcpTools: {
      recall_memory: { project_id: 'p1', scene: a.tools.recall.scene, mode: a.tools.recall.mode || null, top_k: a.tools.recall.topk },
      write_memory: { project_id: 'p1' },
      get_user_preferences: { user_id: 'u1' },
    },
    channels: { webhook: a.chan.webhook, apiPull: a.chan.api },
    circuit: a.circuit,
  };
}

function updateInject(div) {
  div.querySelector('[data-inject]').innerHTML = '注入预览：将注入 <b>5</b> 条记忆到 Agent prompt（payload ≈ 780 tokens）';
}

/* ============ 效果证据 ============ */
function paintGains() {
  const g = document.getElementById('gains');
  if (!g) return;
  g.innerHTML = renderGains(GAINS);
}

/* 19.10/19.11 按端置灰：当前=桌面端（全量可用）。原型在桌面端，故全部可用；切其他端时对应信号源自动置灰。 */
function detectForm() {
  const ua = navigator.userAgent;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';
  if (/Mac/.test(ua)) return 'mac';
  if (/Android|iPhone|iPad|Mobile/.test(ua)) return 'mobile';
  if (/cli|node/i.test(ua)) return 'cli';
  return 'desktop';
}

function applyForm() {
  const FORM = detectForm();
  const disable = { web: ['proc'], mobile: ['proc', 'mcp'], linux: ['hb'], cli: ['hb'] }[FORM] || [];
  const badge = document.getElementById('formBadge');
  const label = {
    desktop: '当前端：桌面（全量发现可用）', web: '当前端：Web（仅注册表+心跳）',
    mobile: '当前端：移动端（仅心跳+手动）', mac: '当前端：macOS（全量发现可用）',
    linux: '当前端：Linux 系统（CLI，系统注册+进程，无 GUI）', cli: '当前端：CLI（注册+进程，命令触发）',
  }[FORM];
  if (badge) badge.textContent = label;
  disable.forEach((v) => {
    const el = document.querySelector('.sig[value="' + v + '"]');
    if (el) { el.checked = false; el.disabled = true; el.parentElement.style.opacity = 0.4; }
  });
}

function boot() {
  const btn = document.getElementById('btnDiscover');
  if (btn) btn.addEventListener('click', discover);
  document.querySelectorAll('.sig').forEach((s) => s.addEventListener('change', () => { if (!discovering) paintFound(); }));
  applyForm();
  renderCards();
  paintGains();
  paintFound();
  window.__painted = true;
  const b = document.getElementById('boot-status');
  if (b) b.textContent = '';
}

boot();
window.__getSvc = getSvc;
