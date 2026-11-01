// 批次11/13：召回洞察（背景/省量/累计金额/提示行/折叠明细）纯函数 + 内核接线测试
import { describe, expect, it } from 'vitest';
import type { AuditRecord, Hit, Memory, RecallResult } from '../types.ts';
import {
  BACKGROUND_MAX_ITEMS, BACKGROUND_MAX_TOKENS, buildRecallCompactMarkdown, buildRecallDetailExpiredPage,
  buildRecallDetailPage, buildRecallHint, buildRecallMarkdown, buildRecallSections, computeRecallSavings,
  corpusTokens, formatCny, htmlEscape, localDayStart, normalizeUnitPrice, rollupRecalls, selectRecallBackground,
} from '../recallInsight.ts';
import { createMemAgent } from '../agent.ts';
import { clientSupportsHtmlDetails, recallDisplayMode } from '../mcpRecall.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function mem(p: Partial<Memory> & { mem_id: string; content: string }): Memory {
  return {
    project_id: 'P1', enterprise_id: 'e1', team_id: 't1', category: 'fact', layer: 'L1',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: 1000,
    ...p,
  };
}

function hit(mem_id: string, content: string): Hit {
  return {
    mem_id, content, layer: 'L1', decay_class: 'hot', pinned: false, locked: false,
    score: 0.9, evidence_ref: `l0:${mem_id}`,
  };
}

function recallResult(p: Partial<RecallResult> = {}): RecallResult {
  const hits = p.hits ?? [hit('m1', 'a'.repeat(100)), hit('m2', 'b'.repeat(100))];
  return {
    hits,
    payload_tokens: 100,
    pipeline_llm_tokens: 0,
    budget: { soft: 1500, warn: 2000, hard: 3000, status: 'ok' },
    mode: 'auto',
    request_id: 'req_test',
    scanned_memories: 20,
    background: {
      items: [
        { mem_id: 'b1', category: 'decision', content: '决策', tokens: 1, pinned: false, created_at: 1, truncated: false },
        { mem_id: 'b2', category: 'pitfall', content: '踩坑', tokens: 1, pinned: false, created_at: 2, truncated: false },
      ],
      tokens: 2, candidates: 18,
    },
    savings: {
      corpus_tokens: 10000, payload_tokens: 100, background_tokens: 2, injected_tokens: 102,
      budget_trimmed_tokens: 0, saved_tokens: 9898,
    },
    ...p,
  };
}

function audit(p: Partial<AuditRecord> & { ts: number; detail: Record<string, unknown> }): AuditRecord {
  return { request_id: `r_${p.ts}`, action: 'recall', ...p };
}

describe('selectRecallBackground（批次11）', () => {
  it('排除已考虑项/合并影子/墓碑；置顶 > 类别 > 最近更新；长文截断且总量受限', () => {
    const mems = [
      mem({ mem_id: 'm_hit', content: '命中内容' }),
      mem({ mem_id: 'm_ctx', category: 'context', content: '上下文', created_at: 3 }),
      mem({ mem_id: 'm_fact', category: 'fact', content: '事实', created_at: 2 }),
      mem({ mem_id: 'm_dec', category: 'decision', content: '决'.repeat(400), created_at: 1 }),
      mem({ mem_id: 'm_pin', category: 'context', content: '置顶', created_at: 0, pinned: true }),
      mem({ mem_id: 'm_merged', content: '影子', merged_into: 'm_dec' }),
      mem({ mem_id: 'm_deleted', content: '墓碑', deleted: true }),
      mem({ mem_id: 'm_empty', content: '   ' }),
    ];
    const bg = selectRecallBackground(mems, new Set(['m_hit']), { maxTokens: 300 });
    expect(bg.candidates).toBe(4); // 只剩 m_ctx/m_fact/m_dec/m_pin
    expect(bg.items[0].mem_id).toBe('m_pin');
    expect(bg.items[1].mem_id).toBe('m_dec');
    expect(bg.items.find((i) => i.mem_id === 'm_dec')!.truncated).toBe(true);
    expect(bg.items.every((i) => i.mem_id !== 'm_hit' && i.mem_id !== 'm_merged' && i.mem_id !== 'm_deleted')).toBe(true);
    expect(bg.tokens).toBeLessThanOrEqual(300);
    expect(bg.items.length).toBeLessThanOrEqual(BACKGROUND_MAX_ITEMS);
  });

  it('minimal 模式不携带背景；maxTokens=0 一条也不进', () => {
    const mems = [mem({ mem_id: 'a', content: '决策一条' })];
    expect(selectRecallBackground(mems, new Set(), { minimal: true })).toEqual({ items: [], tokens: 0, candidates: 0 });
    expect(selectRecallBackground(mems, new Set(), { maxTokens: 0 })).toMatchObject({ items: [], tokens: 0, candidates: 1 });
  });

  it('单条超上限时跳过，但不会把总 token 推过上限', () => {
    const mems = [
      mem({ mem_id: 'big', content: '大'.repeat(1000), category: 'decision' }),
      mem({ mem_id: 'small', content: '小', category: 'fact' }),
    ];
    const bg = selectRecallBackground(mems, new Set(), { maxTokens: 50 });
    expect(bg.items.map((i) => i.mem_id)).toEqual(['small']);
    expect(bg.tokens).toBeLessThanOrEqual(50);
    expect(BACKGROUND_MAX_TOKENS).toBe(300);
  });
});

describe('computeRecallSavings（批次11）', () => {
  it('基线 = 全部可读记忆；注入 = payload + 背景；熔断裁剪单列', () => {
    const memories = [
      mem({ mem_id: 'a', content: 'a'.repeat(100) }),
      mem({ mem_id: 'b', content: 'b'.repeat(200) }),
      mem({ mem_id: 'shadow', content: 'c'.repeat(999), merged_into: 'a' }),
    ];
    const s = computeRecallSavings({
      memories,
      hits: [hit('a', 'a'.repeat(100))],
      background: { items: [], tokens: 10, candidates: 1 },
      preCapTokens: 400,
    });
    expect(s.corpus_tokens).toBe(150); // 100/2 + 200/2
    expect(s.payload_tokens).toBe(50);
    expect(s.injected_tokens).toBe(60);
    expect(s.budget_trimmed_tokens).toBe(350);
    expect(s.saved_tokens).toBe(90);
    expect(corpusTokens(memories)).toBe(150);
  });

  it('注入 > 基线时节省额钳制为 0（不出现负数）', () => {
    const s = computeRecallSavings({
      memories: [mem({ mem_id: 'a', content: 'a' })],
      hits: [hit('a', 'a'.repeat(100))],
      background: { items: [], tokens: 10, candidates: 0 },
      preCapTokens: 50,
    });
    expect(s.saved_tokens).toBe(0);
  });
});

describe('rollupRecalls / 金额（批次11）', () => {
  const now = new Date(2026, 9, 30, 12, 0, 0).getTime();
  const dayStart = localDayStart(now);

  it('今日按本地零点切分；旧审计只计用量不计省量；未来审计不计', () => {
    const r = rollupRecalls([
      audit({ ts: dayStart + 1000, detail: { payload_tokens: 100, injected_tokens: 120, saved_tokens: 880 } }),
      audit({ ts: dayStart - 1000, detail: { payload_tokens: 50, injected_tokens: 60, saved_tokens: 440 } }),
      audit({ ts: dayStart + 2000, detail: { payload_tokens: 30 } }), // 旧账：无 injected/saved
      { ...audit({ ts: dayStart + 3000, detail: {} }), action: 'write' },
      audit({ ts: now + 999999, detail: { payload_tokens: 999 } }),
    ], now);
    expect(r.today_calls).toBe(2);
    expect(r.today_injected_tokens).toBe(150); // 120 + 30（旧账按 payload 下限）
    expect(r.today_saved_tokens).toBe(880);
    expect(r.today_legacy_calls).toBe(1);
    expect(r.all_calls).toBe(3);
    expect(r.all_injected_tokens).toBe(210);
    expect(r.all_saved_tokens).toBe(1320);
    expect(r.all_legacy_calls).toBe(1);
  });

  it('buildRecallHint：配置单价 → 本次/今日/全部金额齐全且可核算', () => {
    const hint = buildRecallHint(recallResult(), rollupRecalls([
      audit({ ts: now, detail: { payload_tokens: 100, injected_tokens: 300, saved_tokens: 2000 } }),
      audit({ ts: now - 500, detail: { payload_tokens: 100, injected_tokens: 600, saved_tokens: 3000 } }),
    ], now), 10);
    expect(hint.line).toContain('命中 2 条');
    expect(hint.line).toContain('📎 背景 2 条');
    expect(hint.line).toContain('本次省 9,898t');
    expect(hint.line).toContain('今日 2 次');
    expect(hint.line).toContain('全部 2 次');
    expect(hint.line).not.toContain('\n');
    expect(hint.money).not.toBeNull();
    // 10 元/百万 token：本次注入 102t → 0.00102 → ¥0.00102（6 位）
    expect(hint.money!.this_call.cost_cny).toBeCloseTo(0.00102, 10);
    expect(hint.money!.today.cost_cny).toBeCloseTo(0.009, 10); // 900t
    expect(hint.money!.today.saved_cny).toBeCloseTo(0.05, 10); // 5000t
    expect(hint.line).toContain('¥0.00102');
  });

  it('未配置单价 → 行内明示、金额为 null（不编造）', () => {
    const hint = buildRecallHint(recallResult(), rollupRecalls([], now), null);
    expect(hint.money).toBeNull();
    expect(hint.line).toContain('未设置单价');
    expect(hint.line).not.toContain('本次 ¥');
  });

  it('零命中 + 证据不足 + 熔断 + 旧账 → 提示行带真实告警', () => {
    const hint = buildRecallHint(recallResult({
      hits: [],
      payload_tokens: 0,
      evidence_thin: true,
      budget: { soft: 1500, warn: 2000, hard: 3000, status: 'fused' },
      background: { items: [], tokens: 0, candidates: 0 },
      savings: {
        corpus_tokens: 5000, payload_tokens: 0, background_tokens: 0, injected_tokens: 0,
        budget_trimmed_tokens: 800, saved_tokens: 5000,
      },
    }), {
      today_calls: 3, today_injected_tokens: 100, today_saved_tokens: 10, today_legacy_calls: 2,
      all_calls: 3, all_injected_tokens: 100, all_saved_tokens: 10, all_legacy_calls: 2,
    }, 1);
    expect(hint.line).toContain('未命中');
    expect(hint.line).toContain('证据不足');
    expect(hint.line).toContain('预算熔断');
    expect(hint.line).toContain('2 次旧记录');
  });

  it('formatCny / normalizeUnitPrice 边界', () => {
    expect(formatCny(0)).toBe('¥0');
    expect(formatCny(1.2)).toBe('¥1.2');
    expect(formatCny(0.01)).toBe('¥0.01');
    expect(formatCny(0.0012)).toBe('¥0.0012');
    expect(formatCny(Number.NaN)).toBe('—');
    expect(normalizeUnitPrice(0)).toBe(0);
    expect(normalizeUnitPrice(2.5)).toBe(2.5);
    expect(normalizeUnitPrice(-1)).toBeNull();
    expect(normalizeUnitPrice(Number.NaN)).toBeNull();
    expect(normalizeUnitPrice('3')).toBeNull();
    expect(normalizeUnitPrice(undefined)).toBeNull();
  });
});

function makeAgent() {
  const storage = new InMemoryStorage();
  const ma = createMemAgent({
    form: 'desktop', account: ACCOUNT, llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
  });
  return { ma, storage };
}

describe('内核 recall 接线（批次11）', () => {
  it('返回背景/省量/扫描数，背景排除命中，payload+背景不超硬熔断，审计可回查', async () => {
    const { ma, storage } = makeAgent();
    const hitMem = await ma._seedMemory({
      content: '数据库连接池超时：把 maxWait 调整到 5000 毫秒并观察慢查询',
      category: 'fact', project_id: 'P1',
    });
    const decision = await ma._seedMemory({
      content: '项目决策：前端统一使用 React 19 与 Vite 构建，不再引入第二套脚手架',
      category: 'decision', project_id: 'P1',
    });
    const pitfall = await ma._seedMemory({
      content: '踩坑：Windows 打包前必须先关闭占用安装包文件的进程，否则 NSIS 会失败',
      category: 'pitfall', project_id: 'P1',
    });

    const r = await ma.recall({ query: '数据库连接池超时 maxWait 慢查询', project_id: 'P1', top_k: 1 });
    expect(r.hits.map((h) => h.mem_id)).toContain(hitMem.mem_id);
    expect(r.scanned_memories).toBe(3);
    expect(r.background.items.length).toBeGreaterThan(0);
    expect(r.background.items.map((i) => i.mem_id)).not.toContain(hitMem.mem_id);
    expect(r.background.items.map((i) => i.mem_id)).toEqual(expect.arrayContaining([decision.mem_id, pitfall.mem_id]));
    expect(r.savings.payload_tokens).toBe(r.payload_tokens);
    expect(r.savings.injected_tokens).toBe(r.payload_tokens + r.background.tokens);
    expect(r.savings.injected_tokens).toBeLessThanOrEqual(3000);
    expect(r.savings.saved_tokens).toBe(Math.max(0, r.savings.corpus_tokens - r.savings.injected_tokens));

    const [a] = await storage.queryAudit({ action: 'recall' });
    expect(a.detail.saved_tokens).toBe(r.savings.saved_tokens);
    expect(a.detail.injected_tokens).toBe(r.savings.injected_tokens);
    expect(a.detail.bg_mems).toEqual(r.background.items.map((i) => i.mem_id));
    expect(a.detail.scanned_memories).toBe(3);
  });

  it('超预算：裁剪量可核算，被裁命中不得借背景回灌', async () => {
    const { ma } = makeAgent();
    for (let i = 0; i < 4; i++) {
      await ma._seedMemory({
        content: `connection pool keyword ${i} ` + 'x'.repeat(1800),
        category: 'fact', project_id: 'P1',
      });
    }
    const r = await ma.recall({ query: 'connection pool keyword', project_id: 'P1', top_k: 5 });
    expect(r.payload_tokens).toBeLessThanOrEqual(3000);
    expect(r.savings.budget_trimmed_tokens).toBeGreaterThan(0);
    expect(r.savings.injected_tokens).toBeLessThanOrEqual(3000);
    // 背景候选池已排除 topK 全部 4 条（含被裁者），因此不可能回灌
    expect(r.background.items).toHaveLength(0);
    expect(r.background.candidates).toBe(0);
  });

  it('空库：零命中零背景，提示行不编造数字', async () => {
    const { ma } = makeAgent();
    const r = await ma.recall({ query: 'anything', project_id: 'P1' });
    expect(r.hits).toHaveLength(0);
    expect(r.scanned_memories).toBe(0);
    expect(r.savings).toMatchObject({ corpus_tokens: 0, injected_tokens: 0, saved_tokens: 0 });
    const hint = buildRecallHint(r, rollupRecalls([], Date.now()), null);
    expect(hint.line).toContain('未命中');
    expect(hint.line).toContain('未设置单价');
  });
});

describe('buildRecallMarkdown（批次13）', () => {
  const none = () => rollupRecalls([], Date.now());

  it('外层 summary = 提示行；内层四段各自可折叠，数字与提示行同源', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallMarkdown(r, hint, null);
    expect(md.match(/<details>/g)).toHaveLength(5); // 外层 1 + 内层 4
    expect(md.match(/<\/details>/g)).toHaveLength(5);
    expect(md).toContain(`<summary>${hint.line}</summary>`);
    expect(md).toContain('📎 项目背景 2 条（2t）');
    expect(md).toContain('- [decision] 决策');
    expect(md).toContain('🧠 命中记忆 2 条（100t）');
    expect(md).toContain('- [L1/hot] ' + 'a'.repeat(100) + '（相关度 0.90）');
    expect(md).toContain('⚡ Token 用量（本次注入 102t）');
    expect(md).toContain('本次注入：102t（命中 100t + 背景 2t）');
    expect(md).toContain('全量基线：10,000t');
    expect(md).toContain('💰 省钱与费用（本次省 9,898t）');
    // 未设单价：折叠明细同样不出现金额，只给 token 与「金额未开」
    expect(md).toContain('金额未开：未设置单价');
    expect(md).not.toContain('花费 ¥');
    expect(md).not.toContain('单价：¥');
  });

  it('设置单价后：四段中省钱段给出本次/今日/全部金额与单价', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), 10);
    const md = buildRecallMarkdown(r, hint, 10);
    expect(md).toContain('本次：花费 ¥0.00102（省 ¥0.099；省 9,898t）');
    expect(md).toContain('今日：0 次，花费 ¥0（省 ¥0）');
    expect(md).toContain('全部：0 次，花费 ¥0（省 ¥0）');
    expect(md).toContain('单价：¥10/百万 token');
  });

  it('记忆内容含尖括号与 & → 转义，不破坏折叠结构', () => {
    const r = recallResult({ hits: [hit('m9', '<script>alert("x")</script> & done')] });
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallMarkdown(r, hint, null);
    expect(md).not.toContain('<script>');
    expect(md).toContain('&lt;script&gt;alert("x")&lt;/script&gt; &amp; done');
    expect(md.match(/<details>/g)).toHaveLength(5);
  });

  it('长文截断 120 字 + 空白折叠；空命中如实标注未命中', () => {
    const long = recallResult({ hits: [hit('m1', 'x'.repeat(200)), hit('m2', 'line1\n\nline2')] });
    const mdLong = buildRecallMarkdown(long, buildRecallHint(long, none(), null), null);
    expect(mdLong).toContain('x'.repeat(120) + '…');
    expect(mdLong).not.toContain('x'.repeat(121));
    expect(mdLong).toContain('- [L1/hot] line1 line2（相关度 0.90）');

    const empty = recallResult({ hits: [] });
    const mdEmpty = buildRecallMarkdown(empty, buildRecallHint(empty, none(), null), null);
    expect(mdEmpty).toContain('未命中（扫描 20 条，未注入命中内容）');
  });

  it('今日含旧审计 → 省钱段补「旧记录」告警（不假装省量）', () => {
    const now = Date.now();
    const rollup = rollupRecalls([audit({ ts: now, detail: { payload_tokens: 50 } })], now);
    const r = recallResult();
    const md = buildRecallMarkdown(r, buildRecallHint(r, rollup, null), null);
    expect(md).toContain('今日含 1 次旧记录（无省量字段，金额按载荷下限计）');
  });
});

describe('buildRecallMarkdown 纯 Markdown（批次29，DSH 实测只渲染 Markdown 不渲染 HTML）', () => {
  const none = () => rollupRecalls([], Date.now());

  it('htmlDetails:false → 零 HTML 标签/转义，外层加粗提示行 + 四小节加粗标题', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallMarkdown(r, hint, null, { htmlDetails: false });
    expect(md).not.toContain('<details>');
    expect(md).not.toContain('<summary>');
    expect(md).not.toContain('&lt;');
    expect(md.startsWith(`**${hint.line}**`)).toBe(true);
    expect(md).toContain('**📎 项目背景 2 条（2t）**');
    expect(md).toContain('- [decision] 决策');
    expect(md).toContain('**🧠 命中记忆 2 条（100t）**');
    expect(md).toContain('- [L1/hot] ' + 'a'.repeat(100) + '（相关度 0.90）');
    expect(md).toContain('**⚡ Token 用量（本次注入 102t）**');
    expect(md).toContain('**💰 省钱与费用（本次省 9,898t）**');
  });

  it('内容含尖括号 → 纯版原样保留（不转义），HTML 版仍转义护结构', () => {
    const r = recallResult({ hits: [hit('m9', '<script>alert("x")</script> & done')] });
    const hint = buildRecallHint(r, none(), null);
    const plain = buildRecallMarkdown(r, hint, null, { htmlDetails: false });
    expect(plain).toContain('<script>alert("x")</script> & done');
    const html = buildRecallMarkdown(r, hint, null);
    expect(html).toContain('&lt;script&gt;alert("x")&lt;/script&gt; &amp; done');
    expect(html.match(/<details>/g)).toHaveLength(5);
  });
});

// 批次32-C：DSH 里没有可点击折叠控件 → 不支持 HTML 的客户端默认只给短摘要，明细靠 detail=true 再取
// 批次33-C：摘要压到两行（shortLine）+ 可选「展开明细」链接指向本机明细页
describe('buildRecallCompactMarkdown + recallDisplayMode（批次32-C/33-C 默认收起）', () => {
  const none = () => rollupRecalls([], Date.now());

  it('短摘要两行：第一行命中/背景/省量，第二行金额与次数；不铺四小节', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const rows = hint.shortLine.split('\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('🧠 Memory');
    expect(rows[0]).toContain('命中 2 条（100t）');
    expect(rows[0]).not.toContain('💰'); // 金额只在第二行，避免第一行过长换行
    expect(rows[1]).toBe('💰 金额未开（参数页可设 ¥/百万 token） ｜ 今日 0 次 ｜ 全部 0 次');
    // 完整提示行仍是单行（HTML 折叠档 / detail=true 档用）
    expect(hint.line).not.toContain('\n');
  });

  it('设了单价 → 短摘要第二行给本次花费/省额与次数，今日·全部的金额明细挪到明细页', () => {
    const now = Date.now();
    const rollup = rollupRecalls(
      [audit({ ts: now, detail: { saved_tokens: 4000, payload_tokens: 100, injected_tokens: 102 } })],
      now,
    );
    const hint = buildRecallHint(recallResult(), rollup, 10);
    const rows = hint.shortLine.split('\n');
    expect(rows[1]).toBe('💰 本次 ¥0.00102（省 ¥0.099） ｜ 今日 1 次 ｜ 全部 1 次');
    // 今日/全部的金额仍在完整提示行里（同源，只是折叠档不占聊天两行）
    expect(hint.line).toContain(`今日 1 次 ${formatCny(rollup.today_injected_tokens * 10 / 1e6)}`);
  });

  it('无链接（TCP 等）→ 两行摘要 + detail=true 文字指引，零 HTML 标签、不铺四小节', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallCompactMarkdown(hint);
    expect(md.startsWith(`**${hint.shortLine}**`)).toBe(true);
    expect(md).toContain('detail=true');
    expect(md).not.toContain('<details>');
    expect(md).not.toContain('**📎 项目背景');
    expect(md).not.toContain('- [decision] 决策');
  });

  it('有链接（批次33-C）→ 两行摘要 + 一行可点 Markdown 链接，不再要求二次调用', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const url = 'http://127.0.0.1:8204/recall/abcdefghij0123456789AB';
    const md = buildRecallCompactMarkdown(hint, url);
    expect(md.startsWith(`**${hint.shortLine}**`)).toBe(true);
    expect(md).toContain(`▶ [展开本次召回明细（项目背景 / 命中记忆 / Token / 费用）](${url})`);
    expect(md).not.toContain('detail=true'); // 默认档不再引导用户预先展开
    expect(md).not.toContain('<details>');
    expect(md).not.toContain('**📎 项目背景');
    expect(md).not.toContain('- [decision] 决策');
  });

  it('旧记录告警进短摘要（不静默吞掉）', () => {
    const now = Date.now();
    const rollup = rollupRecalls([audit({ ts: now, detail: { payload_tokens: 50 } })], now);
    const hint = buildRecallHint(recallResult(), rollup, 10);
    expect(hint.shortLine.split('\n')).toHaveLength(3);
    expect(hint.shortLine).toContain('⚠ 今日含 1 次旧记录');
  });

  it('档位判定：HTML 客户端恒折叠版；其余默认紧凑、detail=true 才给四小节', () => {
    expect(recallDisplayMode('Qoder/9.9.9', false)).toBe('html-details');
    expect(recallDisplayMode('Qoder/9.9.9', true)).toBe('html-details'); // 已可点开，不必二次调用
    expect(recallDisplayMode('dsh-mcp-client/0.0.1', false)).toBe('markdown-compact');
    expect(recallDisplayMode('dsh-mcp-client/0.0.1', true)).toBe('markdown-full');
    expect(recallDisplayMode(undefined, false)).toBe('markdown-compact'); // TCP/无 clientInfo 保守档
  });
});

// 批次33-C：聊天里点链接打开的本机明细页（真 <details> 折叠，数字与聊天摘要同源）
describe('buildRecallDetailPage + buildRecallSections（批次33-C 本机明细页）', () => {
  const none = () => rollupRecalls([], Date.now());
  const issuedAt = Date.UTC(2026, 10, 1, 1, 33, 0); // 2026-11-01 09:33 UTC+08:00

  const meta = (p: Partial<Parameters<typeof buildRecallDetailPage>[3]> = {}) => ({
    project_id: 'P1',
    query: '批次33 明细页测试',
    client: 'dsh-mcp-client/0.0.1',
    issuedAt,
    expiresAt: issuedAt + 30 * 60 * 1000,
    ...p,
  });

  it('四段 <details> 默认收起 + 全部展开/收起 + 一次性有效期文案', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const html = buildRecallDetailPage(r, hint, null, meta());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/<details>/g)).toHaveLength(4);
    expect(html.match(/<summary>/g)).toHaveLength(4);
    expect(html).not.toContain('<details open'); // 默认收起：只有点击才展开
    expect(html).toContain('全部展开');
    expect(html).toContain('全部收起');
    expect(html).toContain('list-style: disclosure-closed'); // 三角由浏览器原生 disclosure 标记呈现
    expect(html).toContain('30 分钟内有效');
    expect(html).toContain('09:33:00'); // 用户可读本地时刻（UTC+08:00），不露原始 UTC
    expect(html).toContain('（UTC+08:00）');
    expect(html).toContain('调用方 <code>dsh-mcp-client/0.0.1</code>');
  });

  it('摘要两行原样进页面（与聊天同一口径），未设单价如实标注', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const html = buildRecallDetailPage(r, hint, null, meta());
    expect(html).toContain('<p class="sum">🧠 Memory ｜ 命中 2 条（100t） ｜ 📎 背景 2 条（2t） ｜ ⚡ 本次省 9,898t（全量约 10,000t）</p>');
    expect(html).toContain('<p class="sum">💰 金额未开（参数页可设 ¥/百万 token） ｜ 今日 0 次 ｜ 全部 0 次</p>');
    expect(html).toContain('金额未开：未设置单价');
    expect(html).not.toContain('单价：¥');
  });

  it('命中正文按 clipChars 截断并 HTML 转义：记忆里的 <script> 破坏不了折叠结构', () => {
    const r = recallResult({ hits: [hit('m9', `<script>alert("x")</script> ${'y'.repeat(500)}`)] });
    const hint = buildRecallHint(r, none(), null);
    const html = buildRecallDetailPage(r, hint, null, meta({ clipChars: 40 }));
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('…（相关度 0.90）'); // 超长截断标示仍在
    expect(html).toContain('按 40 字截断');
  });

  it('明细页正文 = buildRecallSections 同一口径（背景/命中/Token/费用四段，数字与聊天一致）', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), 10);
    const sections = buildRecallSections(r, hint, 10, (s, n) => plainPass(s, n));
    expect(sections.map((s) => s.title)).toEqual([
      '📎 项目背景 2 条（2t）',
      '🧠 命中记忆 2 条（100t）',
      '⚡ Token 用量（本次注入 102t）',
      '💰 省钱与费用（本次省 9,898t）',
    ]);
    expect(sections[1].lines[0]).toBe('[L1/hot] ' + 'a'.repeat(100) + '（相关度 0.90）');
    expect(sections[3].lines.some((l) => l.startsWith('单价：¥10/百万 token'))).toBe(true); // formatCny 口径
    const html = buildRecallDetailPage(r, hint, 10, meta());
    for (const s of sections) expect(html).toContain(`<summary>${htmlEscape(s.title)}</summary>`);
    expect(html).toContain('非厂商账单');
  });

  function plainPass(s: string, n: number): string {
    const one = s.replace(/\s+/g, ' ').trim();
    return one.length > n ? `${one.slice(0, n)}…` : one;
  }

  it('失效页诚实：给两条退路，不猜数据、不含其它项目记忆', () => {
    const html = buildRecallDetailExpiredPage();
    expect(html).toContain('本次召回明细链接已失效');
    expect(html).toContain('detail=true');
    expect(html).toContain('▶ 展开本次召回明细');
    expect(html).toContain('本页面不含令牌');
    expect(html.match(/<details>/g)).toBeNull();
  });
});

describe('clientSupportsHtmlDetails（批次29 白名单）', () => {  it('只放行实测渲染 HTML 折叠的 Qoder；未知/无标识一律纯 Markdown（fail-safe）', () => {
    expect(clientSupportsHtmlDetails('Qoder/9.9.9')).toBe(true);
    expect(clientSupportsHtmlDetails('qoder/1.0')).toBe(true);
    expect(clientSupportsHtmlDetails('dsh-mcp-client/0.0.1')).toBe(false);
    expect(clientSupportsHtmlDetails('zcode/0.16.9')).toBe(false);
    expect(clientSupportsHtmlDetails('Cursor (UA)')).toBe(false);
    expect(clientSupportsHtmlDetails(undefined)).toBe(false);
  });
});
