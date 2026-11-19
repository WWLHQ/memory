// 批次42 阶段2 · Gate C 变异验证（2-A / 2-B）
// 目的：锁定 coreEngine 不得回退到任何「写死 / 伪造」的真实数据。
// 变异算子：① pipeline_llm_tokens 640→0 反向；② breach_detail 写死估算文案；③ payload_tokens 伪造 3100；④ project_id 写死 'P1'。
// 任一变异若未被本文件断言拦截，即视为 Gate C 失效（测试无法「杀死」变异）。
import { describe, it, expect, beforeEach } from 'vitest';
import { coreEngine, coreRecentRecalls, coreLastRecall, beijingDayStart } from '../coreEngine.ts';
import { resetKernelForTests, getKernelWithSeed } from '../../kernel.ts';

const SEED = { content: '缓存 TTL 设为 300s（生产默认）', category: 'fact', project_id: 'P-real' } as const;

describe('coreEngine 真实数据不变量（Gate C 变异验证）', () => {
  beforeEach(() => resetKernelForTests());

  it('pipeline_llm_tokens 恒为 0（不得回退写死 640）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c1');
    expect(r.budget.pipeline_llm_tokens).toBe(0);
  });

  it('breach_detail 恒为 undefined（不得回退写死估算文案 "L2 摘要 × 1 条"）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c2');
    expect(r.budget.breach_detail).toBeUndefined();
  });

  it('payload_tokens 来自内核真 recall（不得是伪造 3100，命中为真实正数值）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c3');
    expect(r.budget.payload_tokens).not.toBe(3100);
    expect(r.budget.payload_tokens).toBeGreaterThan(0);
  });

  it('project_id 从 listProjectIds 真实派生（写死 P1 会因项目过滤导致 0 命中）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c4');
    // 真实派生 → 命中真实项目下的记忆；若写死 'P1' 则过滤掉 'P-real' → 0 命中
    expect(r.hits.length).toBeGreaterThanOrEqual(1);
  });

  // 批次62：右侧栏「漏斗 / 裁剪明细」口径必须取内核真值，不得留 0 或本地估算
  it('漏斗计数取内核 scanned_memories（>0 且 ≥ 命中条数）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c5');
    expect(r.budget.scanned_count).toBeGreaterThan(0);
    expect(r.budget.scanned_count).toBeGreaterThanOrEqual(r.hits.length);
  });

  it('注入总量 = payload + 背景（内核 savings.injected_tokens 口径）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c6');
    const injected = r.budget.injected_total_tokens ?? -1;
    expect(injected).toBeGreaterThanOrEqual(r.budget.payload_tokens);
    expect(injected).toBe(r.budget.payload_tokens + (r.budget.background_tokens ?? 0));
  });

  // 右侧栏「最近召回」：只读账本 recall 审计行，真跑一次召回就必须多出一条
  it('coreRecentRecalls 取真实审计行（query / 命中 / 注入 t 与本次召回一致）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c7');
    const { rows, today } = await coreRecentRecalls(5);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const top = rows[0];
    expect(top.query).toBe('缓存 TTL 是多少');
    expect(top.hits).toBe(r.hits.length);
    // 注入 t 取审计 injected_tokens（= payload + 背景），旧行缺失时才回落 payload
    expect(top.injected_tokens).toBe(r.budget.injected_total_tokens);
    expect(today).toBeGreaterThanOrEqual(1);
  });

  it('「今日」按北京时间自然日归属（不是 UTC 也不是本机时区）', () => {
    // 2026-11-19T08:00:00Z = 北京时间 11-19 16:00 → 当日 00:00(+08) = 2026-11-18T16:00:00Z
    expect(beijingDayStart(Date.UTC(2026, 10, 19, 8, 0, 0))).toBe(Date.UTC(2026, 10, 18, 16, 0, 0));
    // 北京时间 00:30（= UTC 前一日 16:30）仍属当日，不得被算进前一天
    expect(beijingDayStart(Date.UTC(2026, 10, 18, 16, 30, 0))).toBe(Date.UTC(2026, 10, 18, 16, 0, 0));
  });

  // 右栏在「本次还没检索」时用最近一次审计回填：必须真读账本，且不拿命中数冒充注入条数
  it('coreLastRecall 把最近一条审计还原成右栏结构（注入量 / 扫描 / 裁剪都是真值）', async () => {
    await getKernelWithSeed()._seedMemory(SEED);
    const r = await coreEngine('缓存 TTL 是多少', 'default', null, 'req_c8');
    const snap = await coreLastRecall();
    expect(snap).not.toBeNull();
    expect(snap!.request_id).toBe(r.banner.request_id);
    expect(snap!.data.injected_total_tokens).toBe(r.budget.injected_total_tokens);
    expect(snap!.data.scanned_count).toBe(r.budget.scanned_count);
    expect(snap!.data.stage1_count).toBe(r.hits.length);
    // 审计不记录注入条数 → 必须留 undefined，由 UI 改写成「命中」，不能伪造
    expect(snap!.data.injected_count).toBeUndefined();
  });

  it('账本零召回 → coreLastRecall 返回 null（右栏写原因，不编数）', async () => {
    resetKernelForTests();
    expect(await coreLastRecall()).toBeNull();
  });
});
