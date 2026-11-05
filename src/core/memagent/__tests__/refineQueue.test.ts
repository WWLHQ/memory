// 批次39 后台补炼队列回归：入队去重与三类不计入、日额度与跨日归零、failed 不自动重试、
// 状态 0600 落盘可续炼、单行补炼的四种结局（全层 / 残缺 llm_partial / 无 LLM / 不合规格不写行）、
// pinned+locked 与缺 L1 不碰、审计只有层名计数（新正文一字不入账本）。
// 批次40-C 追加：深度按 L1 的料给（cap L3 的行不会被要求炼 L4/L5）、L6 独立通道（中间层判废不牵连索引，
// 但 layer 不冒充深度）、太短行入队即 skipped、done 也记停层与原因码。
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryStorage } from '../storage.ts';
import { embedSync, JsVectorBackend, DEFAULT_VECTOR_DIM } from '../vector.ts';
import type { LlmProvider, Memory } from '../types.ts';
import {
  REFINE_MAX_ROWS_PER_DAY, clampRefineQueue, dailyBudgetLeft, effectiveCap, emptyRefineQueue,
  enqueueRows, isRefinable, loadRefineQueue, markRefineFailed, markRefineSkipped, markRefined,
  nextPending, reconcileAndPersistRefineQueue, reconcileRefineQueue, removeRefineQueueRowAndPersist,
  refineRowLayers, removeRefineRows, retryFailed,
  saveRefineQueue, setRefineCap, settleRowOutcome, summarizeRefineQueue, dayKey,
  type RefineQueueState,
} from '../refineQueue.ts';

const NOW = 1_800_000_000_000; // 2027-01-15T08:00:00Z → UTC+08:00 记账日 2027-01-15
/**
 * 批次40-C：深度上限按 L1 的有效字数给（`depthCapFor`）。这条 L1 有效字 245 → 允许炼到 L5 + L6；
 * 短 L1 只允许炼到 L2（见「料不够」用例）。层级规格是**相对**的，产物区间由源文算出。
 */
const L1 = '线上事故复盘：支付接口在高峰期大面积超时，根因是连接池配置项 pool_size=5 过小，压测时未覆盖真实并发量。'
  + '排查过程：先看网关 5xx 曲线，再对比数据库活跃连接数，确认连接等待队列堆积；把 pool_size 从 5 调到 50 并加上超时回收后恢复正常。'
  + '后续动作：压测脚本补上并发档位，配置项进代码仓库并加评审；同时在告警里增加连接池饱和度指标，避免下次只能靠人肉看曲线定位。'
  + '教训：容量类参数不能按开发机经验拍脑袋，必须按峰值流量的两倍预留，并且要有一个可观测指标兜底，'
  + '否则每次都要从零排查一遍，故障恢复时间完全取决于谁值班、谁恰好看过这条曲线。';
/** 逐层落在各自压缩区间内的合规产物链（与 L1 同源算出，见 layerBand） */
const LADDER: Record<string, string> = {
  L2: '支付接口高峰期大面积超时的根因是连接池配置项 pool_size=5 过小，压测未覆盖真实并发；'
    + '排查靠网关 5xx 曲线对比数据库活跃连接数，确认等待队列堆积。把配置项调到 50 并加超时回收后恢复，'
    + '后续把并发档位补进压测脚本、配置项入仓评审，并新增连接池饱和度告警指标。',
  L3: '成功点：用两条曲线对比快速定位到连接池根因，改配置项后立即恢复。失败点：上线前压测没覆盖真实并发量，容量参数按开发机经验拍脑袋。'
    + '教训：容量类配置项必须按峰值流量两倍预留，并配一个可观测指标兜底，否则故障恢复时间取决于谁值班。',
  L4: '适用场景：接口偶发超时、错误码集中在网关层的容量类故障。做法：先对齐入口错误率与资源活跃连接数两条曲线，'
    + '确认是等待堆积而非代码缺陷，再按峰值流量两倍预留配置项，并补一个资源饱和度指标做告警兜底。',
  L5: '边界条件：只适用于等待队列堆积（连接池或线程池饱和）；若表现为单请求耗时上升，则属代码或下游变慢，不适用。',
};
const L6_OK = JSON.stringify({ keywords: ['连接池', '超时', '容量', '压测', '告警'], projections: ['接口超时排查'] });

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_q_1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L1', content: L1, content_l1: L1,
    layer_specs: { L1: 'v1:清洗脱敏' }, refined_by: 'stub',
    decay_class: 'hot', pinned: false, locked: false, version: 1, created_at: NOW,
    ...over,
  };
}

async function seeded(mems: Memory[]) {
  const storage = new InMemoryStorage();
  for (const m of mems) await storage.putMemory(m);
  return storage;
}

/** 逐层合规的假 LLM（与 rebuild.test.ts 同口径：每层都过 checkLayerSpec） */
function goodLlm(): LlmProvider & { calls: number } {
  const out: Record<string, string> = {
    ...LADDER,
    L6: L6_OK,
  };
  const p = {
    calls: 0, listModels: () => [], call: async () => ({ text: '', tokens: 0 }), isStub: false,
    async refineLayer(_m: string, layer: string): Promise<string> { p.calls++; return out[layer] ?? ''; },
  };
  return p;
}

/** 只会产出合规 L2、到 L3 就交白卷 → 阶梯停止 → llm_partial */
function partialLlm(): LlmProvider {
  return {
    listModels: () => [], call: async () => ({ text: '', tokens: 0 }), isStub: false,
    async refineLayer(_m: string, layer: string): Promise<string> {
      return layer === 'L2' ? LADDER.L2 : '';
    },
  };
}

/** L2 就违反规格（太短）：一行都不该写 */
function badLlm(): LlmProvider {
  return {
    listModels: () => [], call: async () => ({ text: '', tokens: 0 }), isStub: false,
    async refineLayer(): Promise<string> { return '太短。'; },
  };
}

const rowCtx = (storage: InMemoryStorage, llm?: LlmProvider) => ({
  storage, llm, llmModel: llm ? 'fake-model' : undefined,
  request_id: 'req_q_1', now: NOW, actor: 'refine_queue',
});

describe('队列状态：记账日、归一化与落盘', () => {
  it('dayKey 用 UTC+08:00，不是 UTC', () => {
    expect(dayKey(NOW)).toBe('2027-01-15');
    expect(dayKey(Date.UTC(2027, 0, 15, 20, 0, 0))).toBe('2027-01-16'); // UTC 20 点 = 北京时间次日 04 点
  });

  it('坏状态文件被归一化：未知状态按 pending、attempts 兜底为 1、跨日清零计数', () => {
    const s = clampRefineQueue({
      enabled: 'yes', day: '2020-01-01', dayRows: 4_000,
      items: { a: { state: 'zzz' }, b: { state: 'done', attempts: -3 }, c: null, d: { state: 'failed', attempts: 2, reason: 'x'.repeat(500) } },
    }, NOW);
    expect(s.enabled).toBe(true);
    expect(s.day).toBe(dayKey(NOW));
    expect(s.dayRows).toBe(0);
    expect(s.items.a).toMatchObject({ state: 'pending', attempts: 1 });
    expect(s.items.b.attempts).toBe(1);
    expect(s.items.d.reason?.length).toBe(200);
    expect('c' in s.items).toBe(false);
  });

  it('落盘 0600 并原样读回（重启续炼）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mam-refine-'));
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'mem_a' }), mem({ mem_id: 'mem_b' })], NOW).state;
    s = markRefined(s, 'mem_a', NOW);
    saveRefineQueue(dir, s);
    // Windows 的 NTFS 不映射 POSIX 权限位（statSync 恒回 0o666），只在类 Unix 上断言 0600
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'refine-queue.json')).mode & 0o777).toBe(0o600);
    }
    const back = loadRefineQueue(dir, NOW);
    expect(back.items.mem_a.state).toBe('done');
    expect(back.items.mem_b.state).toBe('pending');
    expect(back.dayRows).toBe(1);
    // 文件里只有 id 与状态：正文一个字都不落
    expect(readFileSync(join(dir, 'refine-queue.json'), 'utf8')).not.toContain(L1);
  });

  it('读不到的目录 = 空队列（不抛错、不冒充有进度）', () => {
    const s = loadRefineQueue(join(mkdtempSync(join(tmpdir(), 'mam-refine-empty-')), 'nope'), NOW);
    expect(s).toEqual(emptyRefineQueue(NOW));
  });
});

describe('入队：只增不改，三类不花冤枉钱', () => {
  it('新行入队；已有 pending 不重复；done/failed 不再自动回队；受保护与不合格单独计数', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'mem_1' })], NOW).state;
    const again = enqueueRows(s, [
      mem({ mem_id: 'mem_1' }),                       // already_queued
      mem({ mem_id: 'mem_2', content_l2: '已有深层' }), // not_eligible（已有深层）
      mem({ mem_id: 'mem_3', content_l1: '   ' }),     // not_eligible（缺 L1）
      mem({ mem_id: 'mem_4', pinned: true }),          // protected
      mem({ mem_id: 'mem_5', locked: true }),          // protected
      mem({ mem_id: 'mem_6', deleted: true }),         // not_eligible
      mem({ mem_id: 'mem_7' }),                        // added
    ], NOW);
    expect(again.report).toEqual({ added: 1, already_queued: 1, settled: 0, protected_skipped: 2, not_eligible: 3, thin_skipped: 0 });
    expect(Object.keys(again.state.items).sort()).toEqual(['mem_1', 'mem_7']);

    const settled = markRefineFailed(again.state, 'mem_1', '引擎全挂', NOW);
    const r3 = enqueueRows(settled, [mem({ mem_id: 'mem_1' })], NOW);
    expect(r3.report.settled).toBe(1);
    expect(r3.state.items.mem_1.state).toBe('failed'); // 不被悄悄放回 pending
  });

  it('批次40-C：L1 短到没有料炼摘要 → 当场记 skipped（不起活、不占当日额度、不进 pending）', () => {
    let s = emptyRefineQueue(NOW);
    const r = enqueueRows(s, [
      mem({ mem_id: 'thin_1', content_l1: '连接池改成 50 之后恢复正常了', content: '连接池改成 50 之后恢复正常了' }),
      mem({ mem_id: 'fat_1' }),
    ], NOW);
    expect(r.report).toEqual({ added: 1, already_queued: 0, settled: 0, protected_skipped: 0, not_eligible: 0, thin_skipped: 1 });
    expect(r.state.items.thin_1).toMatchObject({ state: 'skipped', stop_code: 'thin' });
    expect(r.state.items.fat_1.state).toBe('pending');
    // skipped 不消耗额度，也不被「重试失败行」放回队列
    expect(r.state.dayRows).toBe(0);
    expect(retryFailed(r.state, NOW).retried).toBe(0);
  });

  it('isRefinable 与入队判据一致', () => {
    expect(isRefinable(mem())).toBe(true);
    expect(isRefinable(mem({ content_l5: 'x' }))).toBe(false);
    expect(isRefinable(mem({ content_l1: undefined }))).toBe(false);
    expect(isRefinable(mem({ deleted: true }))).toBe(false);
  });
});

describe('批次41-C：删除行后同步摘除队列幽灵条目', () => {
  it('removeRefineRows：按 id 摘除（任意状态），不在队列的幂等返回 0', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' }), mem({ mem_id: 'b' }), mem({ mem_id: 'c' })], NOW).state;
    s = markRefineFailed(s, 'b', '引擎挂', NOW);
    const r = removeRefineRows(s, ['a', 'b', 'ghost_not_there'], NOW);
    expect(r.removed).toBe(2);
    expect(Object.keys(r.state.items)).toEqual(['c']);
    // 幂等：再删一次不命中
    expect(removeRefineRows(r.state, ['a', 'b'], NOW).removed).toBe(0);
  });

  it('reconcileRefineQueue：按「未删行」集合摘除，活行保留、死行剔除（含 done/failed/skipped 都算幽灵）', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [
      mem({ mem_id: 'live_1' }), mem({ mem_id: 'live_2' }),
      mem({ mem_id: 'dead_1' }), mem({ mem_id: 'dead_2' }),
    ], NOW).state;
    s = markRefined(s, 'live_1', NOW);
    s = markRefineFailed(s, 'dead_1', '引擎挂', NOW);
    s = markRefineSkipped(s, 'dead_2', '料太短', NOW, 'thin');
    // 活着的只有 live_1 / live_2
    const r = reconcileRefineQueue(s, ['live_1', 'live_2'], NOW);
    expect(r.pruned).toBe(2);
    expect(Object.keys(r.state.items).sort()).toEqual(['live_1', 'live_2']);
    // 活行状态原样保留
    expect(r.state.items.live_1.state).toBe('done');
    expect(r.state.items.live_2.state).toBe('pending');
  });

  it('reconcileRefineQueue：全部都在活集合里 → 不动（pruned=0，原 state 原样返回）', () => {
    const s = enqueueRows(emptyRefineQueue(NOW), [mem({ mem_id: 'x' })], NOW).state;
    const r = reconcileRefineQueue(s, ['x'], NOW);
    expect(r.pruned).toBe(0);
    expect(r.state).toBe(s);
  });

  it('summarizeRefineQueue 不再把已删行算进 pending/failed（幽灵被摘除后计数回落到真实）', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'k1' }), mem({ mem_id: 'gone' })], NOW).state;
    s = markRefineFailed(s, 'gone', '引擎挂', NOW);
    // 该行已被外部删除 → 对账摘除
    s = reconcileRefineQueue(s, ['k1'], NOW).state;
    const sum = summarizeRefineQueue(s, '/tmp/refine-queue.json', NOW);
    expect(sum.pending).toBe(1);
    expect(sum.failed).toBe(0);
  });
});

describe('批次41-H：补炼接线「只在真改到才落盘」的判定（主进程 handler 直接调用）', () => {
  /** 注入式 load/save：用一个可变状态 + 落盘收集器模拟主进程的文件系统调用 */
  function harness(initial: RefineQueueState) {
    let cur: RefineQueueState = initial;
    const saved: RefineQueueState[] = [];
    return {
      get state() { return cur; },
      saved,
      load: () => cur,
      save: (s: RefineQueueState) => { cur = s; saved.push(s); },
    };
  }

  it('reconcileAndPersistRefineQueue：有幽灵才 save；dir 未就绪 / 无幽灵都绝不落盘（幂等）', () => {
    // 有幽灵 → 摘除 + 落盘一次
    {
      let s = emptyRefineQueue(NOW);
      s = enqueueRows(s, [mem({ mem_id: 'live' }), mem({ mem_id: 'ghost' })], NOW).state;
      const h = harness(s);
      const r = reconcileAndPersistRefineQueue({ queueDir: '/data/refine', liveIds: ['live'], now: NOW, load: h.load, save: h.save });
      expect(r.pruned).toBe(1);
      expect(r.persisted).toBe(true);
      expect(h.saved).toHaveLength(1);
      expect(Object.keys(r.state!.items)).toEqual(['live']);
    }
    // 无幽灵（都在活集合里）→ 不落盘
    {
      let s = emptyRefineQueue(NOW);
      s = enqueueRows(s, [mem({ mem_id: 'live' })], NOW).state;
      const h = harness(s);
      const r = reconcileAndPersistRefineQueue({ queueDir: '/data/refine', liveIds: ['live'], now: NOW, load: h.load, save: h.save });
      expect(r.pruned).toBe(0);
      expect(r.persisted).toBe(false);
      expect(h.saved).toHaveLength(0);
    }
    // dir 未就绪（主进程启动中 / 数据根不可写）→ 连 load 都不该碰，直接不落盘
    {
      const h = harness(emptyRefineQueue(NOW));
      const r = reconcileAndPersistRefineQueue({ queueDir: null, liveIds: [], now: NOW, load: h.load, save: h.save });
      expect(r.persisted).toBe(false);
      expect(h.saved).toHaveLength(0);
    }
  });

  it('removeRefineQueueRowAndPersist：真摘到这一个 id 才落盘；dir 空 / id 空 / id 不在队列都幂等不落盘', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' }), mem({ mem_id: 'b' })], NOW).state;
    const h = harness(s);
    // 真摘 a
    const hit = removeRefineQueueRowAndPersist({ queueDir: '/data/refine', id: 'a', now: NOW, load: h.load, save: h.save });
    expect(hit.removed).toBe(1);
    expect(hit.persisted).toBe(true);
    expect(Object.keys(hit.state!.items)).toEqual(['b']);
    // 再摘 a（已没了）→ 幂等不落盘
    const again = removeRefineQueueRowAndPersist({ queueDir: '/data/refine', id: 'a', now: NOW, load: h.load, save: h.save });
    expect(again.removed).toBe(0);
    expect(again.persisted).toBe(false);
    expect(h.saved).toHaveLength(1);
    // dir 未就绪 / id 为空 → 一律不碰
    expect(removeRefineQueueRowAndPersist({ queueDir: null, id: 'a', now: NOW, load: h.load, save: h.save }).persisted).toBe(false);
    expect(removeRefineQueueRowAndPersist({ queueDir: '/data/refine', id: '', now: NOW, load: h.load, save: h.save }).persisted).toBe(false);
  });
});

describe('闸门：开关、日额度与跨日', () => {
  it('未启用 = 不起活；当日额度用尽 = 不起活；跨日自动恢复', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'm0' }), mem({ mem_id: 'm1' }), mem({ mem_id: 'm2' })], NOW).state;
    expect(nextPending(s, NOW)).toBe('m0');

    const off = { ...s, enabled: false };
    expect(nextPending(off, NOW)).toBeNull();

    // 额度用尽（把 dayRows 直接顶到上限，不逐行 burn——上限是编译常量，循环会随档位漂移而 O(n²) 爆掉；
    //   这里验的是闸门算术，不是 burn 次数。队列里那三行仍是 pending，证明挡的是额度不是空队列）
    s = { ...s, dayRows: REFINE_MAX_ROWS_PER_DAY };
    expect(dailyBudgetLeft(s, NOW)).toBe(0);
    expect(nextPending(s, NOW)).toBeNull();

    const tomorrow = NOW + 24 * 3600_000;
    expect(dailyBudgetLeft(s, tomorrow)).toBe(REFINE_MAX_ROWS_PER_DAY);
    expect(nextPending(s, tomorrow)).toBe('m0');
  });

  it('批次41-I 后续：默认限额 500（cap_enabled=true / cap_rows=500）', () => {
    const s = emptyRefineQueue(NOW);
    expect(s).toMatchObject({ cap_enabled: true, cap_rows: REFINE_MAX_ROWS_PER_DAY });
  });

  it('批次41-I 后续：坏 cap 字段归一化——缺省按限额、坏 cap_rows 回落 500、cap_enabled=false 保留', () => {
    // 缺字段：默认为「限额 + 500」
    const d = clampRefineQueue({ day: dayKey(NOW) }, NOW);
    expect(d).toMatchObject({ cap_enabled: true, cap_rows: REFINE_MAX_ROWS_PER_DAY });
    // cap_rows 坏值（0 / 负 / 小数 / 非数 / Infinity）一律回落 500
    for (const bad of [0, -5, 12.7, 'x', Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(clampRefineQueue({ cap_enabled: true, cap_rows: bad }, NOW).cap_rows)
        .toBe(bad === 12.7 ? 12 : REFINE_MAX_ROWS_PER_DAY); // 有限整数≥1 下取整，其余回落
    }
    // cap_rows=1000 合法；cap_enabled=false 如实保留（但 cap_rows 仍存供切回复用）
    const off = clampRefineQueue({ cap_enabled: false, cap_rows: 1000 }, NOW);
    expect(off).toMatchObject({ cap_enabled: false, cap_rows: 1000 });
  });

  it('批次41-I 后续：不限额 = 真不限量，pending 不因额度被挡（哪怕今天已炼很多）', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'm0' })], NOW).state;
    s = setRefineCap(s, { enabled: false });
    s = { ...s, dayRows: 999_999 }; // 今天已远超任何合理限额
    expect(effectiveCap(s)).toBe(Number.POSITIVE_INFINITY);
    expect(dailyBudgetLeft(s, NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(nextPending(s, NOW)).toBe('m0'); // 不限额：额度不挡活
  });

  it('批次41-I 后续：setRefineCap 限额校验 + 不限额忽略 rows（保留旧值供切回复用）', () => {
    let s = emptyRefineQueue(NOW); // cap_enabled=true, cap_rows=500
    // 切「不限额」：rows 被忽略，旧的 cap_rows=500 原样留着
    s = setRefineCap(s, { enabled: false, rows: 8888 });
    expect(s).toMatchObject({ cap_enabled: false, cap_rows: 500 });
    // 切回「限额」不传 rows → 复用旧的 500
    s = setRefineCap(s, { enabled: true });
    expect(s).toMatchObject({ cap_enabled: true, cap_rows: 500 });
    // 限额给合法 rows（小数下取整）
    s = setRefineCap(s, { enabled: true, rows: 1234.9 });
    expect(s.cap_rows).toBe(1234);
    // 限额给坏 rows（<1 / 非有限）→ 维持原值不动，坏值不冒充「不限额」
    s = setRefineCap(s, { enabled: true, rows: 0 });
    expect(s).toMatchObject({ cap_enabled: true, cap_rows: 1234 });
    s = setRefineCap(s, { enabled: true, rows: Number.NaN });
    expect(s).toMatchObject({ cap_enabled: true, cap_rows: 1234 });
  });

  it('批次41-I 后续：summary 不限额时 day_limit/day_left 为 null，限额时为数字', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' })], NOW).state;
    s = markRefined(s, 'a', NOW);
    const capped = summarizeRefineQueue(s, 'q.json', NOW);
    expect(capped).toMatchObject({ cap_enabled: true, day_limit: REFINE_MAX_ROWS_PER_DAY, day_left: REFINE_MAX_ROWS_PER_DAY - 1 });
    const free = summarizeRefineQueue(setRefineCap(s, { enabled: false }), 'q.json', NOW);
    expect(free).toMatchObject({ cap_enabled: false, day_limit: null, day_left: null, day_rows: 1 });
  });

  it('done/failed 计入当日额度，skipped 不计（没调用就不算钱）', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' }), mem({ mem_id: 'b' }), mem({ mem_id: 'c' })], NOW).state;
    s = markRefined(s, 'a', NOW);
    s = markRefineFailed(s, 'b', 'refine_error', NOW);
    s = markRefineSkipped(s, 'c', 'pinned/locked 行不补炼', NOW);
    expect(s.dayRows).toBe(2);
    expect(s.items.c).toMatchObject({ state: 'skipped', attempts: 1 });
  });

  it('settleRowOutcome：成功=done、没得炼=skipped（不占额度）、炼不出=failed（占额度）', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' }), mem({ mem_id: 'b' }), mem({ mem_id: 'c' })], NOW).state;
    s = settleRowOutcome(s, 'a', { ok: true });
    s = settleRowOutcome(s, 'b', { ok: false, code: 'protected', error: 'pinned/locked 行不补炼' });
    s = settleRowOutcome(s, 'c', { ok: false, code: 'refine_error', error: 'ollama HTTP 500' });
    expect(Object.fromEntries(Object.entries(s.items).map(([k, v]) => [k, v.state]))).toEqual({ a: 'done', b: 'skipped', c: 'failed' });
    expect(s.dayRows).toBe(2); // 只有真调用的两行算额度
    expect(s.items.c.reason).toBe('ollama HTTP 500');
  });

  it('跨日的第一行计数从 0 起算（旧日额度不能顶到新日，也不能把新日首行算丢）', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' })], NOW).state;
    s = markRefined(s, 'a', NOW);
    expect(s).toMatchObject({ day: dayKey(NOW), dayRows: 1 });
    const tomorrow = NOW + 24 * 3600_000;
    const s2 = markRefined(s, 'mem_tomorrow', tomorrow);
    expect(s2).toMatchObject({ day: dayKey(tomorrow), dayRows: 1 });
  });

  it('retryFailed 只把 failed 放回 pending，done/skipped 不动', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' }), mem({ mem_id: 'b' }), mem({ mem_id: 'c' })], NOW).state;
    s = markRefined(s, 'a', NOW);
    s = markRefineFailed(s, 'b', 'LLM 精炼失败：HTTP 503', NOW);
    s = markRefineSkipped(s, 'c', '该行没有可炼的 L1', NOW);
    const { state, retried } = retryFailed(s, NOW);
    expect(retried).toBe(1);
    expect(state.items.b).toMatchObject({ state: 'pending', reason: undefined, attempts: 1 });
    expect(state.items.a.state).toBe('done');
    expect(state.items.c.state).toBe('skipped');
  });

  it('summary 回显四态计数、额度、引擎预算与队列路径', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' }), mem({ mem_id: 'b' })], NOW).state;
    s = markRefined(s, 'a', NOW);
    const v = summarizeRefineQueue(s, 'C:\\x\\refine-queue.json', NOW);
    expect(v).toMatchObject({
      enabled: true, pending: 1, done: 1, failed: 0, skipped: 0,
      day: '2027-01-15', day_rows: 1, day_limit: REFINE_MAX_ROWS_PER_DAY,
      day_left: REFINE_MAX_ROWS_PER_DAY - 1, max_engines_per_call: 3,
      queue_path: 'C:\\x\\refine-queue.json',
    });
  });

  it('批次40-C：summary 汇总停层原因码；重新炼成的行不留上次「为什么停在 L3」', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'a' }), mem({ mem_id: 'b' }), mem({ mem_id: 'c' })], NOW).state;
    s = settleRowOutcome(s, 'a', { ok: true, stop_layer: 'L3', stop_code: 'too_short' });
    s = settleRowOutcome(s, 'b', { ok: false, code: 'spec_violation', error: 'L2 过短', stop_code: 'too_short' });
    s = settleRowOutcome(s, 'c', { ok: false, code: 'no_source', error: '该行没有可炼的 L1', stop_code: 'no_source' });
    expect(summarizeRefineQueue(s, 'q.json', NOW).stop_codes).toEqual({ too_short: 2, no_source: 1 });

    // 放回队列 → 重新炼成：旧的停层结论必须一起清掉，否则「为什么只到 L3」是上一轮的答案
    const retried = retryFailed(s, NOW).state;
    expect(retried.items.b.state).toBe('pending');
    expect(retried.items.b.stop_layer).toBeUndefined();
    expect(retried.items.b.stop_code).toBeUndefined();
    const done = markRefined(retried, 'b', NOW);
    expect(done.items.b.state).toBe('done');
    expect(done.items.b.stop_layer).toBeUndefined();
    expect(done.items.b.stop_code).toBeUndefined();
    expect(summarizeRefineQueue(done, 'q.json', NOW).stop_codes).toEqual({ too_short: 1, no_source: 1 });
  });
});

describe('refineRowLayers 单行补炼', () => {
  it('五层全合规：写深层、layer 前进、refined_by=llm、L1 与向量一字不动、审计无正文', async () => {
    const vec = embedSync(L1, DEFAULT_VECTOR_DIM);
    const storage = await seeded([mem({ mem_id: 'q_ok', embedding: vec, layer_specs: { L1: 'v1:清洗脱敏' } })]);
    const llm = goodLlm();
    const r = await refineRowLayers('q_ok', rowCtx(storage, llm));
    expect(r).toMatchObject({ ok: true, refined_by: 'llm', llm_calls: 5 });
    expect(r.layers).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);

    const after = (await storage.getMemory('q_ok'))!;
    expect(after.layer).toBe('L6');
    expect(after.content).toBe(L6_OK);
    expect(after.content_l1).toBe(L1);
    expect(after.refined_by).toBe('llm');
    expect(after.version).toBe(2);
    expect(after.layers_generated_at).toBe(NOW);
    expect(after.layer_specs?.L3).toBe('v1:得失分析');
    // 向量原样保留（L1 没变，补炼不重算嵌入）
    expect(after.embedding).toEqual(vec);

    const audit = await storage.queryAudit({ request_id: 'req_q_1' });
    const row = audit.find((a) => a.action === 'memory_op')!;
    expect(row.detail).toMatchObject({ op: 'layer_refine', actor: 'refine_queue', to_layer: 'L6', refined_by: 'llm', llm_calls: 5 });
    // L2 正文与 L1 都不进审计
    expect(JSON.stringify(row.detail)).not.toContain('遍历装配体可行');
    expect(JSON.stringify(row.detail)).not.toContain(L1);
  });

  it('只炼出 L2：残缺如实 llm_partial，不冒充全量精炼', async () => {
    const storage = await seeded([mem({ mem_id: 'q_partial' })]);
    const r = await refineRowLayers('q_partial', rowCtx(storage, partialLlm()));
    expect(r).toMatchObject({ ok: true, refined_by: 'llm_partial' });
    expect((await storage.getMemory('q_partial'))!.layer).toBe('L2');
  });

  it('首层就不合规格：一行都不写、不刷戳、不审计', async () => {
    const storage = await seeded([mem({ mem_id: 'q_bad', layers_generated_at: 1 })]);
    const before = (await storage.getMemory('q_bad'))!;
    const r = await refineRowLayers('q_bad', rowCtx(storage, badLlm()));
    expect(r).toMatchObject({ ok: false, code: 'spec_violation' });
    const after = (await storage.getMemory('q_bad'))!;
    expect(after.layer).toBe(before.layer);
    expect(after.layers_generated_at).toBe(1);
    expect((await storage.queryAudit({})).length).toBe(0);
  });

  it('无真实 LLM（stub / 未配模型）：no_llm，不动行', async () => {
    const storage = await seeded([mem({ mem_id: 'q_nollm' })]);
    expect((await refineRowLayers('q_nollm', rowCtx(storage))).code).toBe('no_llm');
    const stub: LlmProvider = { isStub: true, listModels: () => [], call: async () => ({ text: '', tokens: 0 }) };
    expect((await refineRowLayers('q_nollm', rowCtx(storage, stub))).code).toBe('no_llm');
    expect((await storage.getMemory('q_nollm'))!.refined_by).toBe('stub');
  });

  it('pinned/locked、缺 L1、不存在的行：各给原因码且不写', async () => {
    const storage = await seeded([
      mem({ mem_id: 'q_pin', pinned: true }), mem({ mem_id: 'q_lock', locked: true }),
      mem({ mem_id: 'q_nol1', content_l1: undefined }),
    ]);
    const llm = goodLlm();
    expect((await refineRowLayers('q_pin', rowCtx(storage, llm))).code).toBe('protected');
    expect((await refineRowLayers('q_lock', rowCtx(storage, llm))).code).toBe('protected');
    expect((await refineRowLayers('q_nol1', rowCtx(storage, llm))).code).toBe('no_source');
    expect((await refineRowLayers('q_ghost', rowCtx(storage, llm))).code).toBe('no_source');
    expect((await storage.getMemory('q_pin'))!.content_l2).toBeUndefined();
  });

  it('LLM 抛错：refine_error 与原因进结果，残缺产物不落行', async () => {
    const storage = await seeded([mem({ mem_id: 'q_err' })]);
    const boom: LlmProvider = {
      isStub: false, listModels: () => [], call: async () => ({ text: '', tokens: 0 }),
      refineLayer: async () => { throw new Error('ollama HTTP 500：connection reset'); },
    };
    const r = await refineRowLayers('q_err', rowCtx(storage, boom));
    expect(r).toMatchObject({ ok: false, code: 'refine_error' });
    expect(r.error).toContain('HTTP 500');
    expect((await storage.getMemory('q_err'))!.content_l2).toBeUndefined();
  });

  it('带 vector 后端时按新 layer 刷新索引元数据，向量仍按 L1 计算', async () => {
    const storage = await seeded([mem({ mem_id: 'q_vec' })]);
    const vector = new JsVectorBackend();
    await vector.upsert('q_vec', L1, { project_id: 'P1', layer: 'L1' });
    await refineRowLayers('q_vec', { ...rowCtx(storage, goodLlm()), vector });
    const q = embedSync(L1, DEFAULT_VECTOR_DIM);
    const asL6 = await vector.search(q, 5, { project_id: 'P1', layer: 'L6' });
    expect(asL6.map((h) => h.mem_id)).toContain('q_vec');
    // 旧口径（L1）不再命中：索引里的 layer 元数据确实被前进了
    expect((await vector.search(q, 5, { project_id: 'P1', layer: 'L1' })).map((h) => h.mem_id)).not.toContain('q_vec');
    // 向量仍来自 L1：按 L1 检索的余弦就是 1
    expect((await vector.search(q, 1, { project_id: 'P1' }))[0].score).toBeCloseTo(1, 6);
  });
});

describe('批次40-C：深度按料给 + L6 独立通道 + 停在哪儿记哪儿', () => {
  /** 有效字 84 → depthCapFor = L3：这一行「该炼的层」只有 L2、L3 与索引 L6 */
  const MEDIUM = '本地联调记录：Node 服务启动失败，错误码 EADDRINUSE 提示端口 8201 已被安装版桌面端占用。'
    + '改用 PORT=8211 另起一份受信登录后端后启动成功，登录与镜像接口都恢复可用。';
  const M_L2 = '本地联调：Node 服务启动报错误码 EADDRINUSE，端口 8201 被安装版桌面端占用；改用 PORT=8211 另起登录后端后恢复可用。';
  const M_L3 = '成功点：换端口一次恢复。失败点：起服务前没先探端口占用。教训：默认端口要先探测再启。';

  it('中等 L1 只被要求炼 L2/L3/L6：L4、L5 一次都不调，targets 原样进审计', async () => {
    const asked: string[] = [];
    const storage = await seeded([mem({ mem_id: 'q_cap', content_l1: MEDIUM, content: MEDIUM })]);
    const llm: LlmProvider = {
      isStub: false, listModels: () => [], call: async () => ({ text: '', tokens: 0 }),
      refineLayer: async (_m, layer) => {
        asked.push(layer);
        return layer === 'L2' ? M_L2 : layer === 'L3' ? M_L3 : JSON.stringify({ keywords: ['EADDRINUSE', '端口'], projections: ['本地联调'] });
      },
    };
    const r = await refineRowLayers('q_cap', rowCtx(storage, llm));
    expect({ asked, calls: r.llm_calls, by: r.refined_by, layer: r.layers }).toEqual({
      asked: ['L2', 'L3', 'L6'], calls: 3, by: 'llm', layer: ['L1', 'L2', 'L3', 'L6'],
    });
    expect(r.targets).toEqual(['L1', 'L2', 'L3', 'L6']);
    const after = (await storage.getMemory('q_cap'))!;
    expect(after.content_l4).toBeUndefined();
    expect(after.content_l5).toBeUndefined();
    const audit = (await storage.queryAudit({ request_id: 'req_q_1' })).find((a) => a.action === 'memory_op')!;
    expect(audit.detail).toMatchObject({ targets: ['L1', 'L2', 'L3', 'L6'], to_layer: 'L6', refined_by: 'llm' });
  });

  it('L3 交白卷：L6 索引照炼（陪葬的是这一层不是整行），但 layer 记 L2、标 llm_partial', async () => {
    const asked: string[] = [];
    const storage = await seeded([mem({ mem_id: 'q_gap', content_l1: MEDIUM, content: MEDIUM })]);
    const llm: LlmProvider = {
      isStub: false, listModels: () => [], call: async () => ({ text: '', tokens: 0 }),
      refineLayer: async (_m, layer) => {
        asked.push(layer);
        return layer === 'L2' ? M_L2 : layer === 'L6' ? JSON.stringify({ keywords: ['EADDRINUSE'], projections: ['本地联调'] }) : '';
      },
    };
    const r = await refineRowLayers('q_gap', rowCtx(storage, llm));
    expect(asked).toEqual(['L2', 'L3', 'L6']); // 判废后跳过去试 L6，不再往下走 L4/L5
    expect(r).toMatchObject({ ok: true, refined_by: 'llm_partial', stop_layer: 'L3', stop_code: 'empty' });
    expect(r.violations?.[0]).toMatchObject({ layer: 'L3', code: 'empty' });
    const after = (await storage.getMemory('q_gap'))!;
    expect(after.layer).toBe('L2');           // 有 L6 也不冒充「炼到 L6」
    expect(after.content).toBe(M_L2);
    expect(after.content_l6).toBeTruthy();    // 到手的索引不因为上游判废而丢掉
  });

  it('done 也带上停层与原因码：落盘读回后仍能回答「为什么只炼到 L2」', () => {
    let s = emptyRefineQueue(NOW);
    s = enqueueRows(s, [mem({ mem_id: 'q_done_partial' })], NOW).state;
    s = settleRowOutcome(s, 'q_done_partial', { ok: true, stop_layer: 'L3', stop_code: 'too_short' });
    expect(s.items.q_done_partial).toMatchObject({ state: 'done', stop_layer: 'L3', stop_code: 'too_short' });
    const dir = mkdtempSync(join(tmpdir(), 'mam-refine-stop-'));
    saveRefineQueue(dir, s);
    expect(loadRefineQueue(dir, NOW).items.q_done_partial)
      .toMatchObject({ state: 'done', stop_layer: 'L3', stop_code: 'too_short' });
    // 队列文件里没有正文
    expect(readFileSync(join(dir, 'refine-queue.json'), 'utf8')).not.toContain(L1);
  });

  it('入队后才变短的行：refineRowLayers 给 thin，正文与版本戳一动不动', async () => {
    const storage = await seeded([mem({ mem_id: 'q_thin', content_l1: '连接池改成 50 之后恢复正常了', content: '连接池改成 50 之后恢复正常了' })]);
    const before = (await storage.getMemory('q_thin'))!;
    const r = await refineRowLayers('q_thin', rowCtx(storage, goodLlm()));
    expect(r).toMatchObject({ ok: false, code: 'thin', stop_code: 'thin', targets: ['L1'] });
    const after = (await storage.getMemory('q_thin'))!;
    expect(after).toEqual(before);
    expect((await storage.queryAudit({})).length).toBe(0);
  });
});
