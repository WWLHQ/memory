// 批次11/13：召回洞察（背景/省量/累计金额/提示行/折叠明细）纯函数 + 内核接线测试
import { describe, expect, it } from 'vitest';
import type { AuditRecord, Hit, Memory, RecallResult } from '../types.ts';
import {
  BACKGROUND_MAX_ITEMS, BACKGROUND_MAX_TOKENS, buildRecallCompactMarkdown, buildRecallDetailExpiredPage,
  buildRecallDetailPage, buildRecallEchoSummary, buildRecallFoldSummary, buildRecallHint, buildRecallMarkdown,
  buildRecallSections, buildRecallStatLines, computeRecallSavings, corpusTokens, formatCny, htmlEscape,
  localDayStart, normalizeUnitPrice, recallSavingRatio, rollupRecalls, selectRecallBackground,
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
    hit_keywords: [],
    secondary_mode_hint: null,
    // A6：默认夹具不假装有分流事实（要测回显模式行时由用例显式传入）
    dispatch: null,
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
    // 10 元/百万预算单位 t：本次注入 102t → 0.00102 → ¥0.00102（6 位，估算值）
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

  it('批次 RAG：外层短收 summary 默认收起；统计汇总 + 编号依据默认可见；四段降级为二级折叠', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallMarkdown(r, hint, null);
    expect(md.startsWith('<details>\n<summary>🧠 命中 2 条')).toBe(true);
    expect(md).not.toContain('<details open');
    expect(md.match(/<details>/g)).toHaveLength(5); // 外层 1 + 四段 4（无 warning）
    expect(md.match(/<\/details>/g)).toHaveLength(5);
    expect(md).toContain('▶ 展开本次召回汇总');
    expect(md).toContain('**📊 本次召回统计汇总**');
    expect(md).toContain('**🎯 本次用上的依据**');
    expect(md).toContain('- [1] ');
    expect(md).toContain('- [2] ');
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
    expect(md).toContain('本次：估算花费 ¥0.00102（省 ¥0.099；省 9,898t）');
    expect(md).toContain('今日：0 次，估算花费 ¥0（省 ¥0）');
    expect(md).toContain('全部：0 次，估算花费 ¥0（省 ¥0）');
    expect(md).toContain('单价：¥10/百万预算单位 t');
    expect(md).toContain('金额口径：本地预算单位 t');
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

  it('htmlDetails:false → 零 HTML 标签/转义，两行短摘要 + 统计汇总 + 编号依据 + 四小节加粗标题', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallMarkdown(r, hint, null, { htmlDetails: false });
    expect(md).not.toContain('<details>');
    expect(md).not.toContain('<summary>');
    expect(md).not.toContain('&lt;');
    expect(md.startsWith(`**${hint.echo!.headline}**`)).toBe(true);
    expect(md).toContain(`**${hint.echo!.stats}**`);
    // 2026-11-12（与 compact 同源缺陷）：markdown-full 的摘要行也必须是空行分段，否则会被合并成一段
    expect(md).not.toMatch(/\*\*\n\*\*/);
    expect(md.split('\n\n')[1]).toBe(`**${hint.echo!.stats}**`);
    expect(md).toContain('**📊 本次召回统计汇总**');
    expect(md).toContain('**🎯 本次用上的依据**');
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
    expect(rows[1]).toBe('💰 金额未开（参数页可设 ¥/百万预算单位 t） ｜ 今日 0 次 ｜ 全部 0 次');
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
    expect(rows[1]).toBe('💰 估算 本次 ¥0.00102（省 ¥0.099） ｜ 今日 1 次 ｜ 全部 1 次');
    // 今日/全部的金额仍在完整提示行里（同源，只是折叠档不占聊天两行）
    expect(hint.line).toContain(`今日 1 次 ${formatCny(rollup.today_injected_tokens * 10 / 1e6)}`);
  });

  it('无链接（TCP 等）→ 两行摘要 + detail=true 文字指引，零 HTML 标签、不铺四小节', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallCompactMarkdown(hint);
    expect(md.startsWith(`**${hint.echo!.headline}**`)).toBe(true);
    expect(md).toContain(`**${hint.echo!.stats}**`);
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
    expect(md.startsWith(`**${hint.echo!.headline}**`)).toBe(true);
    expect(md).toContain(`**${hint.echo!.stats}**`);
    expect(md).toContain(`▶ [展开本次召回明细（统计汇总 / 命中依据 / Token / 费用）](${url})`);
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
    // 批次41-Q：Qoder Desktop 宿主自报名同样拿折叠版
    expect(recallDisplayMode('qoder-desktop-mcp-host/1.0.0', false)).toBe('html-details');
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

  it('四段 <details>：依据段默认展开（锚点可直达），其余三段收起 + 全部展开/收起 + 一次性有效期文案', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const html = buildRecallDetailPage(r, hint, null, meta());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/<details\b/g)).toHaveLength(4);
    expect(html.match(/<summary>/g)).toHaveLength(4);
    // 批次 RAG T4：依据段默认展开——点链接来就是为了看依据，锚点跳转才有落点
    expect(html).toContain('<details data-fold="cites" open>');
    expect((html.match(/<details[^>]*\bopen\b/g) ?? []).length).toBe(1);
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
    expect(html).toContain(`<p class="sum">${htmlEscape(hint.echo!.headline)}</p>`);
    expect(html).toContain(`<p class="sum">${htmlEscape(hint.echo!.stats)}</p>`);
    expect(html).toContain('金额未开');
    expect(html).toContain('金额未开：未设置单价');
    expect(html).not.toContain('单价：¥');
  });

  it('命中正文按 clipChars 截断并 HTML 转义：记忆里的 <script> 破坏不了折叠结构', () => {
    const r = recallResult({ hits: [hit('m9', `<script>alert("x")</script> ${'y'.repeat(500)}`)] });
    const hint = buildRecallHint(r, none(), null);
    const html = buildRecallDetailPage(r, hint, null, meta({ clipChars: 40 }));
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('…'); // 超长截断标示仍在
    expect(html).toContain('相关度 0.90'); // 相关度挪到卡片头，数字不变
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
    expect(sections[3].lines.some((l) => l.startsWith('单价：¥10/百万预算单位 t'))).toBe(true); // formatCny 口径
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

/* 批次 RAG（T4）：明细页统计汇总 / #hit-n 锚点 / 就地反馈；字段级 AC 见 specs/tasks/RECALL-ECHO-RAG.md §4–§5 */
describe('批次 RAG T4：明细页统计汇总 + #hit-n 锚点 + 就地反馈', () => {
  const none = () => rollupRecalls([], Date.now());
  const issuedAt = Date.UTC(2026, 10, 1, 1, 33, 0);
  const meta = (p: Partial<Parameters<typeof buildRecallDetailPage>[3]> = {}) => ({
    project_id: 'P1', query: 'T4 明细页测试', issuedAt,
    expiresAt: issuedAt + 30 * 60 * 1000, ...p,
  });
  const page = (r: RecallResult, price: number | null = null, m = meta()) =>
    buildRecallDetailPage(r, buildRecallHint(r, none(), price), price, m);

  it('T4-1 顶部状态条 + 统计汇总表：四组字段与 buildRecallStatLines 逐字同源', () => {
    const r = recallResult();
    const html = page(r);
    expect(html).toContain('<p class="statusbar">');
    expect(html).toContain('命中 2 条');
    expect(html).toContain('省 99.0%（9,898t）');
    expect(html).toContain('预算 ok');
    expect(html).toContain('09:33:00');
    expect(html).toContain('有效期 30 分钟');
    expect(html).toContain('<h2>📊 本次召回统计汇总</h2>');
    const hint = buildRecallHint(r, none(), null);
    for (const line of buildRecallStatLines(r, hint)) {
      const at = line.indexOf('：');
      expect(html).toContain(`<th scope="row">${htmlEscape(line.slice(0, at))}</th>`);
      expect(html).toContain(`<td>${htmlEscape(line.slice(at + 1))}</td>`);
    }
  });

  it('T4-2 命中编号卡：id="hit-n" 从 1 连续、编号与 hits 一一对应、带复制引用与相关度条', () => {
    const hits = [hit('m1', '第一条命中'), hit('m2', '第二条命中'), hit('m3', '第三条命中')];
    const html = page(recallResult({ hits }));
    const ids = [...html.matchAll(/id="hit-(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([1, 2, 3]);
    for (let n = 1; n <= 3; n += 1) {
      expect(html).toContain(`<span class="badge num">[${n}]</span>`);
      expect(html).toContain(`复制引用 [${n}]`);
    }
    expect(html).toContain('▮'); // 相关度字符条（零样式依赖）
    expect(html).toContain('<span class="badge">L1</span>');
    expect(html).toContain('<span class="badge">hot</span>');
  });

  it('T4-3 hits=0：页面不出现任何 hit- 锚点与 [n]，并如实说「未命中」', () => {
    const html = page(recallResult({ hits: [] }));
    expect(html).not.toContain('id="hit-');
    expect(html).not.toMatch(/复制引用 \[\d\]/);
    expect(html).not.toMatch(/class="badge num">\[\d\]/);
    expect(html).toContain('未命中');
    expect(html).toContain('本页不编造条目');
  });

  it('T4-4 就地反馈只生成 feedback 指令文本，明示「不会自动生效」；mem_id 非安全字符则隐藏按钮', () => {
    const html = page(recallResult({ hits: [hit('mem_ok_1', '可反馈')] }));
    expect(html).toContain(`mmFeedback('mem_ok_1','confirm',this)`);
    expect(html).toContain(`mmFeedback('mem_ok_1','reject',this)`);
    expect(html).toContain('feedback(verdict='); // 脚本里生成的可粘贴指令
    expect(html).toContain('不会自动生效');
    expect(html).toContain('本页不含 MCP 令牌');
    const bad = page(recallResult({ hits: [hit("mem' onclick='alert(1)", '注入尝试')] }));
    expect(bad).not.toContain('mmFeedback(');
    expect(bad).toContain('已隐藏反馈按钮');
  });

  it('T4-5 折叠状态写本机 localStorage：三段带 data-fold 键 + mmAll 全展开/收起', () => {
    const html = page(recallResult());
    for (const k of ['cites', 'bg', 'token', 'money']) expect(html).toContain(`data-fold="${k}"`);
    expect(html).toContain("var KEY = 'mm.recall.detail.folds.v1'");
    expect(html).toContain('localStorage.setItem(KEY');
    expect(html).toContain("window.mmAll = function (v)");
    expect(html).toContain('折叠状态只写本机');
  });

  it('T4-6 页面不引外部资源、不含令牌与查询外泄面', () => {
    const html = page(recallResult());
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).not.toContain('http://');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });
});

/* 批次 RAG（T2）：引用锚点 / 折叠统计汇总 / 不变项；字段级 AC 见 specs/tasks/RECALL-ECHO-RAG.md §5 */
describe('批次 RAG T2：A 引用锚点 / B 折叠统计汇总 / D 不变项', () => {
  const none = () => rollupRecalls([], Date.now());
  const withTerms = (terms: string[], content = '回显格式与折叠气泡的口径'): Hit => ({
    ...hit('m1', content), matched_terms: terms,
  });
  const URL = 'http://127.0.0.1:8204/recall/abcdefghij0123456789AB';

  it('A1 依据段每条命中以 [n] 开头且序号连续（1-based，按返回顺序）', () => {
    const r = recallResult({ hits: [
      withTerms(['回显']), withTerms(['折叠'], '折叠气泡口径'), withTerms(['ui'], 'ui 原型'),
    ] });
    const md = buildRecallMarkdown(r, buildRecallHint(r, none(), null), null);
    const lines = md.split('\n').filter((l) => /^- \[\d+\]/.test(l));
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.match(/^- \[(\d+)\]/)![1])).toEqual(['1', '2', '3']);
  });

  it('A1 补充：短摘要编号严格对应 hits[i]，不按命中词逐个编号（T2 效果核对修正）', () => {
    const r = recallResult({ hits: [withTerms(['回显', '折叠']), withTerms(['ui'], 'ui 原型')] });
    const head = buildRecallHint(r, none(), null).echo!.headline;
    expect(head).toContain('[1]「回显」');
    expect(head).toContain('[2]「ui」');
    expect(head).not.toContain('[3]');
    expect(head).not.toContain('「折叠」');
  });

  it('A2 hits=0 时三档全文都不出现 [n]，且不产出依据段', () => {
    const r = recallResult({ hits: [], evidence_thin: false });
    const hint = buildRecallHint(r, none(), null);
    for (const md of [
      buildRecallMarkdown(r, hint, null),
      buildRecallMarkdown(r, hint, null, { htmlDetails: false }),
      buildRecallCompactMarkdown(hint, URL),
    ]) {
      expect(md).not.toMatch(/\[\d+\]/);
      expect(md).not.toContain('**🎯 本次用上的依据**');
    }
  });

  it('A5 无 matched_terms 不写 🎯、不谎称语义命中（Hit 类型无 scope 字段，不伪造「会话工作记忆」）', () => {
    const r = recallResult({ hits: [hit('m1', '一条与提问无字面重合的记忆')] });
    const md = buildRecallMarkdown(r, buildRecallHint(r, none(), null), null);
    expect(md).not.toContain('🎯 命中');
    expect(md).toContain('无字面重合，仅按相关度参考');
    expect(md).toContain('- [1] ');
  });

  it('B1/B2 外层默认收起；summary ≤80 字且含命中数·top3 命中词·省量比例·▶', () => {
    const r = recallResult({ hits: [withTerms(['回显']), withTerms(['折叠']), withTerms(['ui'])] });
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallMarkdown(r, hint, null);
    expect(md.startsWith('<details>\n<summary>')).toBe(true);
    expect(md).not.toContain('<details open');
    const summary = buildRecallFoldSummary(r);
    expect(summary.length).toBeLessThanOrEqual(80);
    expect(summary).toContain('命中 3 条');
    expect(summary).toContain('「回显」');
    expect(summary).toContain('「折叠」');
    expect(summary).toContain('「ui」');
    expect(summary).toContain('省 99.0%');
    expect(summary).toContain('▶');
    const bare = buildRecallFoldSummary(recallResult());
    expect(bare).not.toContain('依据');
    expect(bare).toContain('省 99.0%');
  });

  it('B3 统计汇总四行数字与 display.line / sections 同源（不重算）', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), 10);
    const lines = buildRecallStatLines(r, hint);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('命中：2 条（100t）');
    expect(lines[0]).toContain('背景 2 条（2t）');
    expect(lines[0]).toContain('扫描 20 条');
    expect(lines[1]).toContain('用量：本次注入 102t');
    expect(lines[1]).toContain('全量基线 10,000t');
    expect(lines[1]).toContain('预算 ok（软 1,500 / 警 2,000 / 硬 3,000t）');
    expect(lines[2]).toContain('省量：9,898t（99.0%）');
    expect(lines[2]).toContain(formatCny(hint.money!.this_call.cost_cny));
    expect(lines[3]).toContain('今日 0 次');
    expect(lines[3]).toContain('全部 0 次');
    for (const s of ['10,000t', '9,898t', '100t']) expect(hint.line).toContain(s);
  });

  it('B4 依据段默认可见、不套内层 <details>（展开外层即见 <mark> 与 🎯）', () => {
    const r = recallResult({ hits: [withTerms(['回显'])] });
    const md = buildRecallMarkdown(r, buildRecallHint(r, none(), null), null);
    const citeIdx = md.indexOf('**🎯 本次用上的依据**');
    const firstInner = md.indexOf('<details>', 10);
    expect(citeIdx).toBeGreaterThan(-1);
    expect(citeIdx).toBeLessThan(firstInner);
    expect(md.slice(citeIdx, firstInner)).toContain('<mark>回显</mark>');
    expect(md.slice(citeIdx, firstInner)).toContain('🎯 命中「回显」');
  });

  it('B5 告警段仅在 warnings 非空时生成（异常驱动，正常轮次无 ⚠）', () => {
    const ok = recallResult();
    const okHint = buildRecallHint(ok, none(), null);
    expect(buildRecallMarkdown(ok, okHint, null)).not.toContain('⚠ 状态');
    expect(buildRecallCompactMarkdown(okHint, URL)).not.toContain('⚠');

    const thin = recallResult({ evidence_thin: true });
    const thinHint = buildRecallHint(thin, none(), null);
    const md = buildRecallMarkdown(thin, thinHint, null);
    expect(md).toContain('⚠ 状态 1 项');
    expect(md).toContain('⚠ 证据不足：未命中权威来源');
    const compactThin = buildRecallCompactMarkdown(thinHint, URL);
    expect(compactThin).toContain('**⚠ 证据不足：未命中权威来源，建议事实优先重试**');
    // 告警行同样要独占段落：单换行会被合并进 📊 汇总那一行（2026-11-12 实测）
    expect(compactThin.split('\n\n').filter(Boolean)).toHaveLength(5); // 摘要 2 + 告警 1 + 链接 1 + 点不开提示 1
    expect(compactThin).not.toMatch(/\*\*\n\*\*/);
  });

  it('B6/B8 compact 档两行 + 链接，URL 逐字保留；无票据时仍走文字指引、无伪造 URL', () => {
    const r = recallResult({ hits: [withTerms(['回显'])] });
    const hint = buildRecallHint(r, none(), null);
    const md = buildRecallCompactMarkdown(hint, URL);
    const rows = md.split('\n\n').filter(Boolean);
    expect(rows).toHaveLength(4); // 摘要 2 + 链接 1 + 「点不开就说看明细」兜底 1
    expect(rows[0]).toBe(`**${hint.echo!.headline}**`);
    expect(rows[1]).toBe(`**${hint.echo!.stats}**`);
    expect(rows[2]).toContain(URL);
    // 2026-11-12：链接在 WorkBuddy 桌面端/手机端点不开 → 必须有不依赖链接的取明细路径
    expect(rows[3]).toContain('看明细');
    expect(md).not.toContain('<details>');
    expect(md).not.toContain('detail=true');
    expect(rows[0]).toContain('[1]「回显」'); // 默认档也有真实编号可就地引用
    // 2026-11-12 WorkBuddy 实测回填：行间必须空行。单换行是 Markdown 软换行，
    // 客户端会把「🧠 摘要 / 📊 汇总 / ⚠ 告警」合并成一整段（已截图实证）。
    expect(md).not.toMatch(/\*\*\n\*\*/);
    expect(md.split('\n\n')[0]).toBe(`**${hint.echo!.headline}**`);

    const noUrl = buildRecallCompactMarkdown(hint);
    expect(noUrl).toContain('detail=true');
    expect(noUrl).not.toContain('/recall/');
  });

  it('B7 未设单价时 compact 全档输出「金额未开」且无 ¥', () => {
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    expect(hint.money).toBeNull();
    const md = buildRecallCompactMarkdown(hint, URL);
    expect(md).toContain('金额未开');
    expect(md).not.toContain('¥');
  });

  it('B2 补充：省量比例是展示派生值，分母为 0 时输出「—」', () => {
    const r = recallResult({ savings: {
      corpus_tokens: 0, payload_tokens: 0, background_tokens: 0,
      injected_tokens: 0, budget_trimmed_tokens: 0, saved_tokens: 0,
    } });
    expect(recallSavingRatio(r)).toBe('—');
    expect(buildRecallEchoSummary(r, buildRecallHint(r, none(), null), null).headline).toContain('省 —');
  });

  it('D 组：判档 3 档 / 白名单不变 / 四段数字逐字不变 / 高亮三件套不变', () => {
    expect(recallDisplayMode('Qoder/9.9.9', false)).toBe('html-details');
    expect(recallDisplayMode('dsh-mcp-client/0.0.1', false)).toBe('markdown-compact');
    expect(recallDisplayMode('dsh-mcp-client/0.0.1', true)).toBe('markdown-full');
    expect(clientSupportsHtmlDetails('workbuddy/1.0')).toBe(false);
    const r = recallResult();
    const hint = buildRecallHint(r, none(), null);
    const sections = buildRecallSections(r, hint, null, (s, n) => s.slice(0, n), 120);
    expect(sections.map((s) => s.title)).toEqual([
      '📎 项目背景 2 条（2t）', '🧠 命中记忆 2 条（100t）',
      '⚡ Token 用量（本次注入 102t）', '💰 省钱与费用（本次省 9,898t）',
    ]);
    expect(sections[2].lines[0]).toBe('本次注入：102t（命中 100t + 背景 2t）');
    const hot = recallResult({ hits: [{ ...hit('m1', '超时重试'), matched_terms: ['超时'] }] });
    const hotSections = buildRecallSections(hot, buildRecallHint(hot, none(), null), null,
      (s, n) => s.slice(0, n), 120,
      { markup: 'html', readingHint: '黄色 = 与本次提问重合的片段；🎯 = 命中的词' });
    expect(hotSections[1].title).toContain('黄色 = 与本次提问重合的片段；🎯 = 命中的词');
    expect(hotSections[1].lines[0]).toContain('<mark>超时</mark>');
    expect(hotSections[1].lines[0]).toContain('🎯 命中「超时」');
  });
});

describe('clientSupportsHtmlDetails（批次29 白名单 + 批次41-Q 扩 Qoder Desktop + 批次41-X 扩配方 id）', () => {
  it('放行实测渲染 HTML 折叠的 Qoder CN 与 Qoder Desktop 宿主；未知/无标识一律纯 Markdown（fail-safe）', () => {
    expect(clientSupportsHtmlDetails('Qoder/9.9.9')).toBe(true);
    expect(clientSupportsHtmlDetails('qoder/1.0')).toBe(true);
    // 批次41-Q：Qoder Desktop 的 MCP 宿主自报名首段是 qoder-desktop-mcp-host，原先精确等于 qoder 挡在门外
    expect(clientSupportsHtmlDetails('qoder-desktop-mcp-host/1.0.0')).toBe(true);
    expect(clientSupportsHtmlDetails('Qoder-Desktop-MCP-Host/1.0.0')).toBe(true);
    // 批次41-X：显式身份头的值是**配方 id**（Qoder 那一家即 `qoder-cn`），不加进白名单就等于重演
    // 41-S 方案 A——为堵串号把已实机证实的气泡折叠档打回 markdown-compact
    expect(clientSupportsHtmlDetails('qoder-cn')).toBe(true);
    expect(clientSupportsHtmlDetails('qoder-cn/1.0')).toBe(true);
    expect(clientSupportsHtmlDetails('dsh-mcp-client/0.0.1')).toBe(false);
    // 其余配方 id（claude-code/codex/…）未实测渲染 HTML，保持纯 Markdown fail-safe
    expect(clientSupportsHtmlDetails('claude-code')).toBe(false);
    expect(clientSupportsHtmlDetails('zcode/0.16.9')).toBe(false);
    expect(clientSupportsHtmlDetails('Cursor (UA)')).toBe(false);
    // 批次41-S 产出的 unknown 不得吃到 HTML 档
    expect(clientSupportsHtmlDetails('unknown')).toBe(false);
    expect(clientSupportsHtmlDetails(undefined)).toBe(false);
  });
});

/* 2026-11-12（T8）：用户口径「Qoder 已成功，其他 agent 也要按这个折叠效果渲染」。
 * 落地方式不是把未实测客户端硬塞进白名单（DSH 会把 <details> 露成文本），而是三条通道：
 * ① Qoder 同厂商派生名（前缀）；② 请求头自证能力；③ 运行时白名单环境变量。
 * 反向锁：WorkBuddy 恒不吃 HTML（用户拍板走气泡折叠卡），无声明时谁都不许被误放行。 */
describe('T8 折叠能力的三条通道（派生名 / 自证头 / 运行时白名单）', () => {
  it('Qoder 同厂商派生名按前缀放行，跨厂商未实测客户端仍 fail-safe', () => {
    expect(clientSupportsHtmlDetails('qoder-desktop/2.0')).toBe(true);
    expect(clientSupportsHtmlDetails('qoder-ide')).toBe(true);
    expect(clientSupportsHtmlDetails('qoder-cli/1.0')).toBe(true);
    expect(clientSupportsHtmlDetails('qoder-cn-desktop')).toBe(true);
    // 反向：别的厂商/未实测一律不放行（含 WorkBuddy，用户明确禁 HTML）
    for (const c of ['claude-code', 'codex', 'cursor', 'workbuddy/1.0', 'dsh-mcp-client/0.0.1', 'zcode/0.16.9']) {
      expect(clientSupportsHtmlDetails(c)).toBe(false);
    }
  });

  it('运行时白名单 MEMAGENT_HTML_DETAILS_CLIENTS 可临时给某客户端开折叠，移除后即恢复 fail-safe', () => {
    const before = process.env.MEMAGENT_HTML_DETAILS_CLIENTS;
    try {
      process.env.MEMAGENT_HTML_DETAILS_CLIENTS = ' Cursor , my-agent ';
      expect(clientSupportsHtmlDetails('cursor')).toBe(true);
      expect(clientSupportsHtmlDetails('Cursor/0.42')).toBe(true);
      expect(clientSupportsHtmlDetails('my-agent')).toBe(true);
      expect(clientSupportsHtmlDetails('claude-code')).toBe(false);
      delete process.env.MEMAGENT_HTML_DETAILS_CLIENTS;
      expect(clientSupportsHtmlDetails('cursor')).toBe(false);
    } finally {
      if (before === undefined) delete process.env.MEMAGENT_HTML_DETAILS_CLIENTS;
      else process.env.MEMAGENT_HTML_DETAILS_CLIENTS = before;
    }
  });

  it('自证头等价物 renderFold：声明就是折叠档，且优先于 detail 档；不声明时行为与历史完全一致', () => {
    // 声明 → 折叠档（即便客户端不在白名单、即便 detail=true）
    expect(recallDisplayMode('claude-code', false, true)).toBe('html-details');
    expect(recallDisplayMode('dsh-mcp-client/0.0.1', true, true)).toBe('html-details');
    expect(recallDisplayMode(undefined, false, true)).toBe('html-details');
    // 不声明 → 完全走原判据
    expect(recallDisplayMode('claude-code', false)).toBe('markdown-compact');
    expect(recallDisplayMode('claude-code', true)).toBe('markdown-full');
    expect(recallDisplayMode('claude-code', false, false)).toBe('markdown-compact');
    // 白名单客户端不因第三参缺省而退化
    expect(recallDisplayMode('qoder/9.9.9', false)).toBe('html-details');
  });
});

/* 批次59（方案 C）：回显命中高亮——目标是让用户「一眼看出这条为什么被召回」，
 * 所以三件套都要锁：片段高亮（哪句）、🎯 命中词（为什么）、读法说明（黄色是什么意思）。
 * 反向同样重要：没有命中词就**一点都不许标**（宁可不标，不能拿最长句冒充）。 */
describe('批次59 回显命中高亮（方案 C）', () => {
  const noRollup = () => rollupRecalls([], Date.now());
  const MEM = '该服务 P99 延迟必须 <200ms；超时重试上限 3 次；本地缓存 TTL 60s';
  const QUERY = '接口超时怎么调';
  const withTerms = (terms: string[], content = MEM): Hit => ({ ...hit('m1', content), matched_terms: terms });
  const mk = (h: Hit | Hit[]) => recallResult({ hits: Array.isArray(h) ? h : [h] });

  it('html-details 档：命中片段被 <mark> 包裹，相邻命中并成一片（哪一句被用上）', () => {
    const r = mk(withTerms(['超时', '重试']));
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null);
    // 正文是「超时重试上限 3 次」：两个命中词相邻，合并成一片比切成两段更自然
    expect(md).toContain('<mark>超时重试</mark>');
  });

  it('纯 Markdown 档：用 **「」** 包裹，且零 HTML 标签（客户端不渲染 HTML 也不露尖括号）', () => {
    const r = mk(withTerms(['超时']));
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null, { htmlDetails: false });
    expect(md).toContain('**「超时」**');
    expect(md).not.toContain('<mark>');
  });

  it('命中行尾给 🎯 命中词，按正文出现顺序（回答「为什么是它」）', () => {
    const r = mk(withTerms(['重试', '超时']));
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null);
    expect(md).toContain('🎯 命中「超时」「重试」');
  });

  it('段标题给出读法说明（黄色 = 重合片段；🎯 = 命中词）', () => {
    const r = mk(withTerms(['超时']));
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null);
    expect(md).toContain('🧠 命中记忆 1 条');
    expect(md).toContain('黄色 = 与本次提问重合的片段；🎯 = 命中的词');
  });

  it('明细页：<mark> + legend 同时讲清「标黄」与「没标黄」两种含义', () => {
    const r = mk([withTerms(['超时']), withTerms([], '另一条与提问无字面重合的记忆')]);
    const issuedAt = Date.UTC(2026, 10, 1, 1, 33, 0);
    const html = buildRecallDetailPage(r, buildRecallHint(r, noRollup(), null), null, {
      project_id: 'P1', query: QUERY, issuedAt, expiresAt: issuedAt + 30 * 60 * 1000,
    });
    expect(html).toContain('<mark>超时</mark>');
    expect(html).toContain('class="legend"');
    expect(html).toContain('黄色片段 = 与本次提问');
    expect(html).toContain('没标黄的条目 = 与本次提问没有字面重合');
    expect(html).toContain('不代表「没用上」');
  });

  it('旧命中（无 matched_terms）：不高亮、不加 🎯、标题逐字不变（向后兼容）', () => {
    const r = mk(hit('m1', MEM));
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null);
    expect(md).not.toContain('<mark>');
    expect(md).not.toContain('🎯 命中');
    expect(md).toContain('🧠 命中记忆 1 条（');
  });

  it('命中词被截断切掉时不硬标：正文里没有该词就不出现 <mark>', () => {
    const r = mk(withTerms(['超时'], '这条正文里完全没提到那个词'));
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null);
    expect(md).not.toContain('<mark>');
  });

  it('跨句命中各自成片，不连成一整段黄', () => {
    const r = mk(withTerms(['超时', '重试'], '超时。重试'));
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null);
    expect(md).toContain('<mark>超时</mark>。');
    expect(md).toContain('<mark>重试</mark>');
  });
});

describe('批次59 内核接线：recall 真的产出 matched_terms', () => {
  const noRollup = () => rollupRecalls([], Date.now());

  it('项目召回：命中条目带 matched_terms，且与 query 确有共词；回显据此能标出来', async () => {
    const { ma } = makeAgent();
    await ma._seedMemory({
      content: '数据库连接池超时：把 maxWait 调整到 5000 毫秒并观察慢查询',
      category: 'fact', project_id: 'P1',
    });
    const r = await ma.recall({ query: '连接池超时 maxWait 怎么调', project_id: 'P1', top_k: 1 });
    expect(r.hits.length).toBeGreaterThan(0);
    const terms = r.hits[0].matched_terms ?? [];
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.join(',')).toMatch(/超时|连接|maxwait/i);
    // 回显端到端：这条 hit 进 Markdown 后确实出现高亮
    const md = buildRecallMarkdown(r, buildRecallHint(r, noRollup(), null), null, { htmlDetails: false });
    expect(md).toContain('**「');
    expect(md).toContain('🎯 命中');
  });

  it('会话视图（scope=session）不填 matched_terms：不把「最近 N 条」伪装成「相关命中」', async () => {
    const { ma, storage } = makeAgent();
    const seeded = await ma._seedMemory({
      content: '本会话决定：回显高亮改走方案 C', category: 'decision', project_id: 'P1',
    });
    // _seedMemory 不写 session_id（只灌内容），会话视图靠 session_id 精确过滤 → 这里补上
    await storage.putMemory({ ...seeded, session_id: 'sess_hl' });
    const r = await ma.recall({ query: '无关', project_id: 'P1', scope: 'session', session_id: 'sess_hl' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].matched_terms).toBeUndefined();
  });
});

describe('批次60（A 方案）端到端：长文记忆不再被稀释到检索不到', () => {
  it('同一条核心内容撑到 1500+ 字后仍能进 top3（纯余弦口径下会掉到几十名开外）', async () => {
    const { ma } = makeAgent();
    const core = '数据库连接池超时：把 maxWait 调整到 5000 毫秒并观察慢查询。';
    const filler = '本段是无关的历史背景与会议记录，用来把正文撑长。';
    const long = await ma._seedMemory({
      content: core + filler.repeat(70),
      category: 'fact', project_id: 'P1',
    });
    // 短干扰项：各含 query 的一部分词、正文很短 → 纯余弦口径下比长文更容易拿高分
    await ma._seedMemory({ content: '连接池参数配置说明与常见默认值汇总', category: 'fact', project_id: 'P1' });
    await ma._seedMemory({ content: '慢查询排查笔记：先看执行计划再看索引', category: 'fact', project_id: 'P1' });
    await ma._seedMemory({ content: 'maxWait 与 connectionTimeout 的区别', category: 'fact', project_id: 'P1' });

    const r = await ma.recall({ query: '连接池 超时 maxWait 调整 毫秒 慢查询', project_id: 'P1', top_k: 3 });
    expect(r.hits.map((h) => h.mem_id)).toContain(long.mem_id);
    // 两条链路不冲突：命中词还要照常产出（回显高亮依赖 matched_terms）
    const hit = r.hits.find((h) => h.mem_id === long.mem_id);
    expect((hit?.matched_terms ?? []).length).toBeGreaterThan(0);
  });
});
