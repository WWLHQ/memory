/**
 * DSH 客户端渲染层（React 组件，不经过 Markdown 渲染器）。
 *
 * 为什么需要它：DSH 的 MarkdownText 把原始 HTML 当文本转义（`case"html": return omitHtml ? null : e.value`），
 * 服务端的 `<details>` 折叠块在会话里只会露出尖括号，所以气泡档在 DSH 上不可用。
 * 这里改走 DSH 官方扩展点，分两处注册：
 *   ① `conversation.chat.turnTail` —— **卡片本体**，挂在每轮对话末尾（用户 2026-11-27 规则：
 *      折叠卡片放对话末尾；形态沿用 2026-11-21 验收版：两行标题、放大 ▸ 箭头、默认收起、
 *      灰色小字「点击查阅详细内容」、展示底部可再收起的四段明细 + 每条命中的反馈按钮）；
 *   ② `tool.call.toolview`（key = mcp__memagent__recall_memory）—— 工具行只保留一行指针，
 *      负责把最近一次召回结果写进会话级 store 并交给末尾卡片；认不出结构化结果时才退回可折叠原文。
 * 两处同属一个插件实例，靠 sessionId 键的轻量 store 传递数据（不读 DOM、不碰其它插件）。
 *
 * 数据来源：工具结果的 content 里那一段 JSON（服务端返回「一行摘要 + JSON + 回显说明」三段拼接，
 * 见 parsePayload 的注释），这里按括号配对截取后解析，不依赖分块顺序。
 */
window.__ModuleLoader__.load({
  id: '@local/memagent-recall-card',
  factory(require) {
    console.info('[memagent-card] bundle script executed');
    const React = require('react');
    const h = React.createElement;

    const C = {
      primary: 'var(--dsw-alias-label-primary, inherit)',
      secondary: 'var(--dsw-alias-label-secondary, #8a8a8a)',
      border: 'var(--dsw-alias-border-neutral, rgba(127,127,127,.28))',
      surface: 'var(--dsw-alias-bg-neutral, rgba(127,127,127,.07))',
      accent: 'var(--dsw-alias-label-link, #3b82f6)',
      ok: 'var(--dsw-alias-label-success, #2f9e44)',
      bad: 'var(--dsw-alias-label-danger, #d9534f)',
    };

    /* ---------------- 数据提取 ---------------- */

    function collectStrings(value, out, depth) {
      if (out.length > 500 || depth > 7) return;
      if (typeof value === 'string') { out.push(value); return; }
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value) collectStrings(item, out, depth + 1);
        return;
      }
      for (const key of Object.keys(value)) collectStrings(value[key], out, depth + 1);
    }

    /**
     * 从 start 处的 `{` 起做括号配对（跳过字符串内容与转义），截出完整 JSON 子串。
     * 不能直接「从第一个 { 解析到结尾」：结果文本的结构是
     *   ① 一行摘要（以 ▶ 开头）② payload JSON ③ 回显说明（「【信息来源边界】…」）
     * 三段拼在同一个字符串里（2026-11-27 用真实会话记录逐字确认），后面那段说明会让
     * JSON.parse 直接抛错，所以必须按括号配对截断，而不是取到结尾。
     */
    function sliceJson(text, start) {
      let depth = 0, inString = false, escaped = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') depth += 1;
        else if (ch === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1); }
      }
      return null; // 没配对完 = 被剪断/不完整，交给上层降级
    }

    /**
     * 从工具调用条目里认出服务端 payload：含 display 与 hits 的那个 JSON 对象。
     *
     * 三个坑都是实机上踩出来的，别再改回去：
     *  ① 结果文本以「一行摘要」开头（首字符是 ▶），不是以 { 开头。旧写法要求
     *     charCodeAt(0) === 123，于是整段被跳过、卡片回落到「原始结果」，看起来像插件没生效。
     *  ② JSON 后面还跟着回显说明，所以要先括号配对截断（见 sliceJson）再解析。
     *  ③ 不同版本把结果放在 block.content / block.result / 条目本身等不同位置，
     *     只扫 content+meta 会漏，所以扫描范围由调用方给（block 认不出再扫整个条目）。
     */
    function parsePayload(source) {
      if (!source) return null;
      const strings = [];
      collectStrings(source, strings, 0);
      for (const raw of strings) {
        if (typeof raw !== 'string') continue;
        let from = 0;
        // 同一段文本里可能有多个 {（JSON 内层、说明文字里的花括号），逐个候选试到配对成功为止。
        for (let tries = 0; tries < 8; tries++) {
          const brace = raw.indexOf('{', from);
          if (brace === -1) break;
          from = brace + 1;
          const json = sliceJson(raw, brace);
          if (!json || json.length < 40) continue;
          try {
            const parsed = JSON.parse(json);
            if (parsed && typeof parsed === 'object' && parsed.display && Array.isArray(parsed.hits)) return parsed;
          } catch { /* 这个 { 不是 payload 起点，继续 */ }
        }
      }
      return null;
    }

    /** 认不出 payload 时，从原文里挑一行当折叠标题（优先 ▶ / 🧠 开头那行） */
    function summaryFromText(text) {
      const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const pick = lines.find((l) => l.startsWith('▶') || l.startsWith('🧠')) || lines[0] || '';
      return stripArrow(clip(pick, 200));
    }

    /** 取纯文本兜底内容（结果不是本工具形状时用）。 */
    function fallbackText(block) {
      const strings = [];
      collectStrings(block && block.content, strings, 0);
      const joined = strings.join('\n').trim();
      return joined.length > 2000 ? joined.slice(0, 2000) + '…' : joined;
    }

    /* ---------------- 小工具 ---------------- */

    const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—');
    const yuan = (value) => (typeof value === 'number' && Number.isFinite(value) ? `¥${Number(value.toFixed(6))}` : null);
    const clip = (text, max) => {
      const one = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
      return one.length > max ? one.slice(0, max) + '…' : one;
    };
    const stripArrow = (line) => String(line || '').replace(/^[▶\s]+/, '').trim();

    /**
     * 把服务端那一行 `▶ ⚙ 模式 ｜ 🎯 命中 … ｜ 📎 背景 … ｜ ⚡ 省 … ｜ 💰 … ｜ 今日 … ｜ 全部 …`
     * 按 2026-11-21 验收的卡片形态拆成两行标题：
     *   第一行 = 模式 ｜ 🎯 命中 ｜ 📎 背景 ｜ ⚡ 省量（省量收在第一行末尾）
     *   第二行 = 💰 金额 ｜ 今日 ｜ 全部
     * 只用 display.line 里已有的字段拆分，不重算任何数字。
     */
    function titleLines(display) {
      const line = stripArrow((display && display.line) || '');
      if (!line) return { first: '🧠 记忆召回', second: '' };
      const parts = line.split('｜').map((s) => s.trim()).filter(Boolean);
      if (parts.length < 5) return { first: line, second: '' };
      return { first: parts.slice(0, 4).join(' ｜ '), second: parts.slice(4).join(' ｜ ') };
    }

    /* ---------------- 会话级 store：工具行写入 → 对话末尾读取 ---------------- */

    // 卡片必须落在对话末尾，但数据是在工具调用那一行解析出来的，两处属于同一插件实例，
    // 所以用 store 传递最近一次召回结果（不读 DOM、不碰其它插件状态）。
    //
    // 为什么有两层：`turnTail` 的 inject(sessionId) 与 `tool.call.toolview` 的 inject 不一定拿到
    // 同一个 sessionId（工具行的 owner 只有 callId/toolName/call），一旦键不同，末尾就永远读不到。
    // 所以除了按 session 的 map，再维护一份「全局最近一次」兜底并共享同一个发布序号。
    const stores = new Map();
    const LAST = { payload: null, callId: null, seq: 0, shownSeq: 0 };
    function storeFor(sessionId) {
      const key = sessionId == null ? '<unknown>' : String(sessionId);
      let store = stores.get(key);
      if (!store) {
        store = { payload: null, callId: null, seq: 0, listeners: new Set() };
        stores.set(key, store);
      }
      return store;
    }
    function publishRecall(store, payload, callId) {
      if (!payload) return;
      LAST.payload = payload;
      LAST.callId = callId || null;
      LAST.seq += 1;
      if (store && store !== LAST) {
        store.payload = payload;
        store.callId = callId || null;
        store.seq = LAST.seq;
      }
      // 通知推迟到微任务：发布可能发生在另一个组件的渲染过程中（见 ToolRow 里的说明），
      // 同步 setState 会触发 React 的跨组件更新告警，推迟一帧没有副作用。
      const fire = () => {
        for (const target of [store, LAST]) {
          if (!target || !target.listeners) continue;
          for (const listener of target.listeners) {
            try { listener(); } catch { /* 订阅者异常不影响发布 */ }
          }
        }
      };
      if (typeof queueMicrotask === 'function') queueMicrotask(fire);
      else setTimeout(fire, 0);
    }
    LAST.listeners = new Set();

    /* ---------------- 视觉原子 ---------------- */

    function Sub({ title, children }) {
      const [open, setOpen] = React.useState(false);
      return h('div', { style: { marginTop: 6 } },
        h('button', {
          type: 'button',
          onClick: () => setOpen((v) => !v),
          style: {
            all: 'unset', cursor: 'pointer', display: 'block', width: '100%',
            fontSize: 12, fontWeight: 600, color: C.primary, padding: '2px 0',
          },
        }, `${open ? '▾' : '▸'} ${title}`),
        open ? h('div', {
          style: { paddingLeft: 12, paddingTop: 2, fontSize: 12, color: C.secondary, lineHeight: 1.55 },
        }, children) : null);
    }

    function Line({ children, style }) {
      return h('div', { style: { margin: '1px 0', ...style } }, children);
    }

    function Section({ title, children }) {
      return h('div', { style: { marginTop: 10 } },
        h('div', { style: { fontSize: 12, fontWeight: 700, color: C.primary, marginBottom: 3 } }, title),
        children);
    }

    /** 渲染错误边界：组件抛错时把原因显示在卡片里，而不是让整条槽位静默消失。 */
    class CardGuard extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      render() {
        if (this.state.error) {
          const msg = String((this.state.error && this.state.error.message) || this.state.error);
          return h('div', { 'data-memagent-card': 'error', style: { fontSize: 12, color: C.bad, whiteSpace: 'pre-wrap' } },
            '🧠 记忆卡片渲染出错：' + msg);
        }
        return this.props.children;
      }
    }

    /* ---------------- 反馈（借鉴 WorkBuddy 卡片的「N 有用 / N 没用」） ---------------- */

    /**
     * 把反馈送进宿主：DSH 的 UI 只能经「会话命令」这条路到达 Host，
     * 由 Host 侧 `/memagent-feedback`（见本包 index.js）真正调用记忆库。
     * 三条入口按可用性依次尝试；都不通就如实说明，绝不假装已记录。
     */
    async function submitFeedback(sessionId, args) {
      const line = `/memagent-feedback ${args}`;
      const ctx = ctxRef;
      const attempts = [];
      try {
        const sessions = ctx && ctx.sessions;
        if (sessions) {
          const get = typeof sessions.get === 'function' ? sessions.get.bind(sessions) : null;
          const session = get ? (get(sessionId) || (typeof sessions.open === 'function' ? sessions.open(sessionId) : null)) : null;
          if (session && typeof session.command === 'function') {
            attempts.push(session.command(line));
          }
        }
        if (!attempts.length && ctx && ctx.remote && ctx.remote.commands && typeof ctx.remote.commands.execute === 'function') {
          attempts.push(ctx.remote.commands.execute(sessionId, line, []));
        }
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      }
      if (!attempts.length) return { ok: false, error: '宿主未暴露命令通道（更新 DSH 后可用）' };
      try {
        const result = await attempts[0];
        if (!result) return { ok: false, error: '宿主未受理该命令' };
        if (result.ok === false) return { ok: false, error: (result.error && (result.error.code || result.error.message)) || '宿主拒绝' };
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      }
    }

    /* ---------------- 工具行：一行指针 ---------------- */

    /** 最近一次发布的数据 id（request_id / callId）：同一份结果只发布一次，避免每次重渲染都推进序号 */
    let lastPublishedId = null;

    /**
     * 兜住渲染期异常：DSH 的监督通道会把抛错的槽位条目整条撤下、静默回落到通用卡，
     * 那样「卡片没出现」就永远查不出原因。这里把异常直接留在工具行本身。
     */
    function ToolRow(props) {
      try {
        return ToolRowInner(props);
      } catch (error) {
        return h('div', {
          'data-memagent-toolrow': 'error',
          style: { fontSize: 12, color: C.bad, whiteSpace: 'pre-wrap' },
        }, `🧠 记忆召回行渲染出错：${String((error && error.message) || error)}`);
      }
    }

    function ToolRowInner(props) {
      // 实机（2026-11-27）摸清的 DSH 工具视图契约，别改回去：
      //  ① props 是一组选择器 hook（useSessions / useRemoteAccess / …），phase 在 props.call.phase；
      //  ② 结果块在 props.block（同时兜底 call.block / result / output）；
      //  ③ useEffect 不保证执行 —— 解析与发布都放在渲染期，按 request_id 幂等去重。
      const call = props.call || null;
      const phase = props.phase || (call && call.phase) || '';
      const block = props.block || (call && call.block) || props.result
        || (call && call.result) || (call && call.output) || null;
      const [open, setOpen] = React.useState(false);
      const store = props.store || storeFor(props.sessionId);

      const payload = parsePayload(block) || parsePayload(props);
      if (payload) {
        const id = payload.request_id || props.callId || (block && block.callId) || 'unknown';
        if (id !== lastPublishedId) {
          lastPublishedId = id;
          publishRecall(store, payload, props.callId || (block && block.callId));
        }
      }

      if (phase !== 'result' && !payload) {
        return h('div', {
          'data-memagent-toolrow': 'pending',
          style: { font: 'inherit', fontSize: 12, color: C.secondary, padding: '2px 0' },
        }, phase === 'preparing' ? '🧠 记忆召回：准备调用…' : '🧠 记忆召回：检索中…');
      }

      const failed = block && block.isError === true;
      const display = payload && payload.display ? payload.display : null;

      // 认得结果 → 工具行只留一行指针，卡片本体在对话末尾（避免同一份数据出现两遍）。
      if (payload) {
        const title = titleLines(display);
        return h('div', {
          'data-memagent-toolrow': 'pointer',
          style: { font: 'inherit', fontSize: 12, color: C.secondary, padding: '2px 0', lineHeight: 1.5 },
        }, h('span', { style: { color: C.primary } }, '🧠 记忆召回'), ' · ', title.first || '已完成',
        h('span', { style: { color: C.secondary } }, '（卡片见本轮末尾）'));
      }

      // 认不出结构化结果（工具报错 / 会话压缩把 JSON 剪断）：这一行自己给一张可折叠的原文卡，
      // 至少不让原文平铺进会话，也避免「看起来插件没生效」的误判。
      const text = fallbackText(block);
      const head = failed ? '🧠 记忆召回失败' : (summaryFromText(text) || '🧠 记忆召回（未识别到结构化结果）');
      return h('div', {
        'data-memagent-toolrow': 'fallback',
        style: { border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, padding: '6px 10px', font: 'inherit' },
      },
      h('button', {
        type: 'button',
        onClick: () => setOpen((v) => !v),
        style: { all: 'unset', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'baseline', width: '100%', fontSize: 12 },
      },
      h('span', { style: { color: C.accent, flex: '0 0 auto', fontSize: 16, fontWeight: 700 } }, open ? '▾' : '▸'),
      h('span', { style: { color: failed ? C.bad : C.primary, flex: '1 1 auto', wordBreak: 'break-word' } }, head),
      h('span', { style: { color: C.secondary, flex: '0 0 auto', fontSize: 11 } }, open ? '收起' : '展开')),
      open ? h('pre', {
        style: {
          margin: '6px 0 0', padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, maxHeight: 260, overflow: 'auto',
        },
      }, text || '（无内容）') : null);
    }

    /* ---------------- 对话末尾：卡片本体 ---------------- */

    function FeedbackButtons({ sessionId, payload, hit, index }) {
      const [state, setState] = React.useState(null); // null | 'sending' | ok 文本 | 错误文本
      const n = index + 1;
      const memId = hit && hit.mem_id;
      const run = async (verdict) => {
        if (state === 'sending') return;
        setState('sending');
        const args = `${n} ${verdict} ${memId || '-'} ${(payload && payload.request_id) || '-'}`;
        const result = await submitFeedback(sessionId, args);
        setState(result.ok ? '已记录' : `未记录：${result.error}`);
      };
      const btn = (label, verdict) => h('button', {
        type: 'button',
        onClick: () => run(verdict),
        disabled: state === 'sending',
        style: {
          all: 'unset', cursor: state === 'sending' ? 'default' : 'pointer', marginLeft: 6,
          padding: '1px 8px', borderRadius: 999, border: `1px solid ${C.border}`,
          fontSize: 11, color: verdict === 'useful' ? C.ok : C.bad,
        },
      }, label);
      return h('span', { style: { marginLeft: 6, whiteSpace: 'nowrap' } },
        typeof state === 'string' && state !== 'sending' && state !== '已记录'
          ? h('span', { style: { fontSize: 11, color: C.bad } }, state)
          : null,
        state === '已记录'
          ? h('span', { style: { fontSize: 11, color: C.ok } }, '已记录 ✓')
          : [btn(`${n} 有用 ↗`, 'useful'), btn(`${n} 没用 ↗`, 'useless')]);
    }

    function CardBody({ payload, sessionId }) {
      const [open, setOpen] = React.useState(false);
      const display = payload.display || {};
      const title = titleLines(display);
      const hits = payload.hits || [];
      const background = (payload.background && payload.background.items) || [];
      const savings = payload.savings || {};
      const budget = payload.budget || {};
      const money = display.money || null;
      const dispatch = payload.dispatch || null;

      const header = h('button', {
        type: 'button',
        onClick: () => setOpen((v) => !v),
        style: {
          all: 'unset', cursor: 'pointer', display: 'block', width: '100%', fontSize: 12, lineHeight: 1.55,
        },
      },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        // 用户 2026-11-21 验收：小箭头放大到清晰可见，取代大黑三角 ▶
        h('span', { style: { color: C.accent, fontSize: 18, fontWeight: 700, lineHeight: 1 } }, open ? '▾' : '▸'),
        h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
          h('div', { style: { color: C.primary, fontWeight: 600, wordBreak: 'break-word' } }, title.first),
          title.second
            ? h('div', { style: { color: C.secondary, wordBreak: 'break-word' } }, title.second,
              h('span', { style: { color: C.secondary, opacity: 0.75, marginLeft: 8, fontSize: 11 } }, '点击查阅详细内容'))
            : null),
        h('span', { style: { color: C.secondary, flex: '0 0 auto', fontSize: 11 } }, open ? '收起' : '展开')),
      );

      if (!open) {
        return h('div', {
          'data-memagent-card': 'collapsed',
          style: { border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface, padding: '6px 10px', font: 'inherit' },
        }, header);
      }

      const summaryLines = [
        `命中：${num(hits.length)} 条（${num(payload.payload_tokens)}t） · 背景 ${num(background.length)} 条（${num(payload.background && payload.background.tokens)}t） · 扫描 ${num(payload.scanned_memories)} 条`,
        `用量：本次注入 ${num(savings.injected_tokens)}t / 全量基线 ${num(savings.corpus_tokens)}t · 预算 ${budget.status || '—'}（软 ${num(budget.soft)} / 警 ${num(budget.warn)} / 硬 ${num(budget.hard)}t）`,
        `省量：${num(savings.saved_tokens)}t${money && yuan(money.this_call && money.this_call.cost_cny) ? ` · 估算 ${yuan(money.this_call.cost_cny)}` : ''}${money && yuan(money.this_call && money.this_call.saved_cny) ? `（省 ${yuan(money.this_call.saved_cny)}）` : ''}`,
        `累计：今日 ${num(money && money.today && money.today.calls)} 次 · 全部 ${num(money && money.all && money.all.calls)} 次`,
      ];

      const citeLines = hits.map((hit, index) => {
        const terms = Array.isArray(hit.matched_terms) && hit.matched_terms.length
          ? ` 🎯 命中「${hit.matched_terms.join('」「')}」`
          : '';
        const score = typeof hit.score === 'number' ? ` · ${hit.score.toFixed(2)}` : '';
        const layer = hit.layer ? `${hit.layer}${hit.decay_class ? '/' + hit.decay_class : ''}` : '';
        return h(Line, { key: 'cite-' + index },
          h('span', { style: { color: C.accent, fontWeight: 600 } }, `[${index + 1}] `),
          clip(hit.content, 110),
          h('span', { style: { color: C.secondary } }, `（${layer}${score}）${terms}`),
          h(FeedbackButtons, { sessionId, payload, hit, index }));
      });

      return h('div', {
        'data-memagent-card': 'expanded',
        style: {
          border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface,
          padding: '6px 10px 10px', font: 'inherit', maxWidth: '100%',
        },
      },
      header,
      h('div', { style: { borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6 } },
        dispatch && dispatch.reason
          ? h('div', { style: { fontSize: 11, color: C.secondary, marginBottom: 4 } }, `⚙ 模式：${payload.mode || 'auto'} · ${dispatch.reason}`)
          : null,
        h(Section, { title: '📊 本次召回统计汇总' },
          summaryLines.map((line, index) => h(Line, { key: 'sum-' + index, style: { margin: '1px 0' } }, line))),
        hits.length
          ? h(Section, { title: `🎯 本次用上的依据 ${hits.length} 条` },
            citeLines,
            // 没有按钮通道的宿主也能反馈：文字回复是最低门槛的入口（与按钮走同一条 feedback 工具）
            h(Line, { key: 'hint', style: { marginTop: 4 } },
              h('span', { style: { fontSize: 11, color: C.secondary } },
                '按钮不可用时，直接回复「1 有用」或「1 没用」也能记录（N = 上面的编号）')))
          : h(Section, { title: '🎯 本次用上的依据' }, h(Line, null, '本次未检索到相关记忆（hits=0），不要编造依据。')),
        h(Sub, { title: `📎 项目背景 ${background.length} 条` },
          background.length
            ? background.map((item, index) => h(Line, { key: 'bg-' + index }, `[${item.category || 'context'}] ${clip(item.content, 90)}`))
            : h(Line, null, '无')),
        h(Sub, { title: `💠 命中记忆 ${hits.length} 条` },
          hits.length
            ? hits.map((hit, index) => h(Line, { key: 'hit-' + index }, `[${index + 1}] ${clip(hit.content, 110)}（相关度 ${typeof hit.score === 'number' ? hit.score.toFixed(2) : '—'}）`))
            : h(Line, null, '无')),
        h(Sub, { title: `⚡ Token 用量（本次注入 ${num(savings.injected_tokens)}t）` },
          h(Line, null, `本次注入：${num(savings.injected_tokens)}t（命中 ${num(savings.payload_tokens)}t + 背景 ${num(savings.background_tokens)}t）`),
          h(Line, null, `全量基线：${num(savings.corpus_tokens)}t`),
          h(Line, null, `预算：${budget.status || '—'}（软 ${num(budget.soft)} / 告警 ${num(budget.warn)} / 硬 ${num(budget.hard)}t）`),
          h(Line, null, `扫描记忆：${num(payload.scanned_memories)} 条`)),
        h(Sub, { title: `💰 省钱与费用（本次省 ${num(savings.saved_tokens)}t）` },
          money
            ? [
              h(Line, { key: 'm1' }, `本次：${yuan(money.this_call && money.this_call.cost_cny) || '—'}（省 ${yuan(money.this_call && money.this_call.saved_cny) || '—'}）`),
              h(Line, { key: 'm2' }, `今日：${num(money.today && money.today.calls)} 次，${yuan(money.today && money.today.cost_cny) || '—'}`),
              h(Line, { key: 'm3' }, `全部：${num(money.all && money.all.calls)} 次，${yuan(money.all && money.all.cost_cny) || '—'}`),
              h(Line, { key: 'm4' }, `单价：¥${money.unit_price_cny_per_mtok}/百万预算单位 t（本地估算，非厂商账单）`),
            ]
            : h(Line, null, '未设置单价（全局参数页），金额不推测。'))));
    }

    /**
     * 对话末尾卡片（`conversation.chat.turnTail`）。
     *
     * 三个曾经把卡片判没的坑，别再改回去（2026-11-27/28 实机逐条验证）：
     *  ① 不能用「挂载时记基线、之后有新发布才渲染」——turnTail 往往在结果到达之后才挂载，
     *     基线会等于当前序号，卡片永远不出现（末尾只有文本摘要）。
     *  ② 不能只认 inject(sessionId) 给的 store —— 工具行的 owner 里没有 session，
     *     两边键可能不同，于是末尾永远读不到；这里同时用全局兜底 LAST。
     *  ③ 不能用 seq/shownSeq 做「是否已展示」去重 —— 发布时已推进序号，末尾再判
     *     seq > shownSeq 必然为 false（实机最后一轮 seq=2 shown=2，rows=2/2ok，卡片被自己判掉）。
     * 现在只有一条约束：只让挂载顺序最新的末尾节点出卡（避免旧轮次各挂一张）；
     * 拿到 payload 就渲染，新召回由工具行按 request_id 去重覆盖 payload。
     */
    const tailState = { maxTurn: -Infinity };
    let tailMountSeq = 0;

    /**
     * `props.turn` 是**对象**不是数字（实机诊断：turn=[object Object]），
     * 这里取出可比较的轮次序号；取不到就退回「挂载顺序」（后挂载的更新）。
     * 千万别再用 `typeof turn === 'number'` 判断——那样所有轮次都会被当成 -1，
     * maxTurn 永远停在第一个挂载的末尾节点上。
     */
    function turnOrderOf(turn) {
      if (typeof turn === 'number' && Number.isFinite(turn)) return turn;
      if (turn && typeof turn === 'object') {
        for (const key of ['number', 'index', 'ordinal', 'seq']) {
          const value = turn[key];
          if (typeof value === 'number' && Number.isFinite(value)) return value;
        }
      }
      return null;
    }

    function TailCard(props) {
      try {
        return TailCardInner(props);
      } catch (error) {
        return h('div', {
          'data-memagent-tail': 'error',
          style: { fontSize: 12, color: C.bad, whiteSpace: 'pre-wrap' },
        }, `🧠 末尾卡片渲染出错：${String((error && error.message) || error)}`);
      }
    }

    function TailCardInner(props) {
      const store = props.store || storeFor(props.sessionId);
      const [, force] = React.useState(0);
      const refresh = React.useCallback(() => force((v) => v + 1), []);

      // 挂载序号只用作兜底排序依据（turn 取不到数字时）
      const mountOrder = React.useMemo(() => { tailMountSeq += 1; return tailMountSeq; }, []);
      const turnOrder = turnOrderOf(props.turn) ?? mountOrder;

      // 两种键都订：按 session 的 store + 全局兜底
      React.useEffect(() => {
        store.listeners.add(refresh);
        LAST.listeners.add(refresh);
        return () => {
          store.listeners.delete(refresh);
          LAST.listeners.delete(refresh);
        };
      }, [store, refresh]);

      if (turnOrder > tailState.maxTurn) tailState.maxTurn = turnOrder;
      // 只让「挂载顺序最新」的那个末尾节点出卡，避免旧轮次末尾各挂一张重复卡片。
      // 注意：不再用 seq/shownSeq 做显示判定 —— 实机最后一轮 seq=2 shown=2，
      // 数据解析与发布都成功（rows=2/2ok），却被 `seq > shownSeq` 判掉，卡片永远出不来。
      // 用户要的是「卡片在对话末尾」：拿到 payload 就渲染；新召回由工具行按 request_id
      // 去重后覆盖 payload，卡片内容随之更新，无需判断是不是「最新一轮的召回」。
      if (turnOrder < tailState.maxTurn) return null;
      const payload = (store && store.payload) || LAST.payload;

      if (!payload) return null; // 没有可展示的召回结果就不出卡（工具行的兜底原文卡已经交代过原因）
      return h(CardGuard, null, h(CardBody, { payload, sessionId: props.sessionId }));
    }

    /* ---------------- 探针（默认关闭） ---------------- */

    const PROBE_ENABLED = false;
    let ctxRef = null;
    let injectCallbackFired = 0;
    let cardRendered = 0;
    function LoadProbe() {
      let spec = '?';
      let entries = '?';
      try {
        if (ctxRef) {
          spec = ctxRef.slots.spec('conversation.chat.turnTail') ? '有' : '无';
          entries = String(ctxRef.slots.entries('conversation.chat.turnTail').length);
        }
      } catch { spec = 'err'; entries = 'err'; }
      return h('div', {
        'data-memagent-probe': 'loaded',
        style: { fontSize: 11, color: C.secondary, padding: '0 4px' },
      }, `🧠 插件 · turnTail 槽${spec} · 回调${injectCallbackFired}次 · 条目${entries} · 卡片渲染${cardRendered}次`);
    }

    // 测试接缝：这个包只能通过 DSH 的 ModuleLoader 在浏览器里加载，vitest/node 无法 import。
    // 把纯函数挂到 globalThis 上，让 tools/__tests__/dshRecallCardParse.test.mjs 跑的就是
    // 真实实现（而不是另抄一份同步走样）。生产环境只是多一个全局属性，无副作用。
    if (typeof globalThis !== 'undefined') {
      globalThis.__memagentRecallCard = { parsePayload, sliceJson, summaryFromText, titleLines, storeFor, publishRecall };
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctxRef = ctx;
        console.info('[memagent-card] plugin applied; slots =', typeof ctx.slots);

        // ① 对话末尾的卡片本体。inject 只为拿到 sessionId（反馈命令要用）；
        //    若该槽不接受 inject，退回无参注册——卡片靠全局兜底照样能渲染，不能因为拿不到 sessionId 就整块消失。
        try {
          ctx.slots.inject('conversation.chat.turnTail', () => {
            injectCallbackFired += 1;
            try {
              return ctx.slots.register({
                name: 'conversation.chat.turnTail',
                id: '@local/memagent-recall-card',
                inject: (sessionId) => ({ sessionId, store: storeFor(sessionId) }),
              }, TailCard);
            } catch (error) {
              console.error('[memagent-card] turnTail register(with inject) failed，退回无参注册', error);
              return ctx.slots.register({
                name: 'conversation.chat.turnTail',
                id: '@local/memagent-recall-card-plain',
              }, TailCard);
            }
          });
        } catch (error) {
          console.error('[memagent-card] turnTail inject failed', error);
        }

        // ② 工具行：一行指针 + 把结果交给末尾卡片
        try {
          for (const key of ['mcp__memagent__recall_memory', 'recall_memory']) {
            ctx.slots.inject('tool.call.toolview', () => {
              injectCallbackFired += 1;
              return ctx.slots.register({
                name: 'tool.call.toolview',
                key,
                inject: (sessionId) => ({ sessionId, store: storeFor(sessionId) }),
              }, ToolRow);
            });
          }
        } catch (error) {
          console.error('[memagent-card] toolview inject failed', error);
        }

        if (PROBE_ENABLED) {
          try {
            ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
              name: 'conversation.composer.dock',
              id: 'memagent-card-probe',
              order: 99,
            }, LoadProbe));
          } catch (error) {
            console.error('[memagent-card] probe registration failed', error);
          }
        }
      },
    };
  },
});
