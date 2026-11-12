// coreHome 溯源查询验收：按 request_id 过滤 home 账本 + 后端不在时安全空
import { describe, expect, it, vi } from 'vitest';
import { coreTraceLookup } from '../coreHome.ts';

describe('coreTraceLookup（首页 .rid 溯源真查 home 账本）', () => {
  it('命中条目按 request_id 过滤并映射字段', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          { seq: 1, source: 'params', action: 'params_save', request_id: 'req_a' },
          { seq: 2, source: 'growth', action: 'weight_tuned', request_id: 'req_b' },
          { seq: 3, source: 'growth', action: 'schedule_changed', request_id: 'req_a' },
          { source: 'bad' }, // 缺字段容错
        ],
        total: 4,
      }),
    })));
    const hits = await coreTraceLookup('req_a');
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({ source: 'params', action: 'params_save', request_id: 'req_a', seq: 1 });
    vi.unstubAllGlobals();
  });

  it('后端不在（mirrorBackendUrl 空串）→ 空数组不抛', async () => {
    // location 未定义分支在 jsdom 有 location；用 ?backend= 空覆盖模拟关闭后端
    const url = new URL(location.href);
    url.searchParams.set('backend', ' ');
    history.replaceState(null, '', url.toString());
    const hits = await coreTraceLookup('req_x');
    expect(hits).toEqual([]);
    history.replaceState(null, '', location.pathname);
  });
});

// ---------- getHomeFeed（真实可算：内核账本聚合） ----------
import type { StorageBackend, AuditRecord, Memory } from '../../../core/memagent/types.ts';
import { getHomeFeed, L0_LOCK_ANOMALY_WINDOW_MS, type MirrorItem } from '../coreHome.ts';

function fakeStorage(opts: {
  audits?: AuditRecord[];
  memories?: Memory[];
  getMemoryMap?: Record<string, Memory>;
}): StorageBackend {
  const mems = opts.memories ?? [];
  const byId = opts.getMemoryMap ?? Object.fromEntries(mems.map((m) => [m.mem_id, m]));
  return {
    putMemory: async () => {},
    getMemory: async (id: string) => byId[id] ?? null,
    listMemories: async () => mems,
    deleteMemory: async () => {},
    appendAudit: async () => {},
    queryAudit: async () => opts.audits ?? [],
    // ── 批次46-D6：项目注册表（本测试不覆盖，给占位实现以满足 StorageBackend 契约）──
    createProject: async () => ({ project_id: 'x', kind: 'general', created_at: 0, created_by: 'u' }),
    getProject: async () => null,
    listProjects: async () => [],
  };
}

const memA = {
  mem_id: 'mem_a', project_id: 'p1', enterprise_id: 'e1', team_id: 't1', category: 'lesson',
  layer: 'L1', content: '为什么上次重构失败', decay_class: 'hot', pinned: false, locked: false,
  access_count: 0, created_at: 0, updated_at: 0,
} as unknown as Memory;

describe('getHomeFeed（首页真实可算，内核账本聚合）', () => {
  it('四卡为内核账本实时指标（无示例/假数据）', async () => {
    const audits: AuditRecord[] = [
      { request_id: 'r1', action: 'recall', ts: Date.now(), detail: { query: 'q', hits: 1, mems: ['mem_a'] } },
      { request_id: 'r2', action: 'write', ts: Date.now(), detail: {} },
    ];
    const feed = await getHomeFeed(fakeStorage({ audits, memories: [memA] }));
    expect(feed.raw.gains!).toHaveLength(4);
    const byTitle = Object.fromEntries(feed.raw.gains!.map((g) => [g.title, g.big]));
    expect(byTitle['累计记忆']).toBe('1');
    expect(byTitle['累计动作']).toBe('2');
    expect(byTitle['近 1h 调用']).toBe('2');
    expect(byTitle['待裁决']).toBe('0');
    expect(feed.raw.gains!.every((g) => g.src.includes('内核账本'))).toBe(true);
    // L1–L6 图谱：同一批真实记忆推导（1 条 L1 记忆）
    expect(feed.graph.stats.total).toBe(1);
    expect(feed.graph.hubs).toHaveLength(6);
    expect(feed.graph.hubs.find((h) => h.layer === 'L1')?.count).toBe(1);
    expect(feed.graph.nodes[0].memId).toBe('mem_a');
    // 批次55：同一份账本派生七档刻度（memA 无 L0 原文、仅 L1 有内容）
    expect(feed.strata).toEqual([
      { layer: 'L0', count: 0 }, { layer: 'L1', count: 1 }, { layer: 'L2', count: 0 },
      { layer: 'L3', count: 0 }, { layer: 'L4', count: 0 }, { layer: 'L5', count: 0 },
      { layer: 'L6', count: 0 },
    ]);
  });

  it('批次55：strata L0 按原文标记、L1–L6 按层内容计数，与 graph 同源', async () => {
    const memories = [
      { ...memA, mem_id: 'm1', has_l0: true, content: 'L1 正文' },
      { ...memA, mem_id: 'm2', content_l0_enc: 'ENV:v2:seal', content: '', layer: 'L1' },
      { ...memA, mem_id: 'm3', content_orig: '   ', content: 'L1 正文', content_l2: '会话摘要' },
      { ...memA, mem_id: 'm4', content: '', layer: 'L2', content_l2: '另一份摘要' },
    ] as unknown as Memory[];
    const feed = await getHomeFeed(fakeStorage({ memories }));
    expect(feed.strata).toEqual([
      { layer: 'L0', count: 2 }, // m1 has_l0 + m2 行上信封；m3 空白不算、m4 无
      { layer: 'L1', count: 2 }, // m1 / m3 有非空 L1 正文
      { layer: 'L2', count: 2 }, // m3 / m4 有非空 content_l2
      { layer: 'L3', count: 0 }, { layer: 'L4', count: 0 },
      { layer: 'L5', count: 0 }, { layer: 'L6', count: 0 },
    ]);
    expect(feed.graph.hubs.find((h) => h.layer === 'L1')?.count).toBe(2);
    expect(feed.graph.hubs.find((h) => h.layer === 'L2')?.count).toBe(2);
  });

  it('空账本 → 四卡全 0（真实语义：无数据）', async () => {
    const feed = await getHomeFeed(fakeStorage({}));
    expect(feed.raw.gains!.every((g) => g.big === '0')).toBe(true);
    expect(feed.graph.nodes).toHaveLength(0);
    expect(feed.graph.hubs.every((h) => h.count === 0)).toBe(true);
    expect(feed.strata?.every((s) => s.count === 0)).toBe(true);
  });

  it('llm_fallback 审计 → 真实异常速览（error 级，可溯源 request_id）', async () => {
    const audits: AuditRecord[] = [{
      request_id: 'req_fb', action: 'llm_fallback',
      ts: Date.now(), detail: { source: 'claude-free', reason: 'quota', code: 'E_LLM_FALLBACK' },
    }];
    const feed = await getHomeFeed(fakeStorage({ audits }));
    expect(feed.raw.anomalies!).toHaveLength(1);
    expect(feed.raw.anomalies![0]).toMatchObject({ level: 'error', request_id: 'req_fb' });
    expect(feed.raw.anomalies![0].title).toContain('降级');
  });

  it('recall 审计 mems 计频 → 近 1h 召回 Top3（真实标题 + 命中数）', async () => {
    const audits: AuditRecord[] = [
      { request_id: 'r1', action: 'recall', ts: Date.now(), detail: { query: 'q', hits: 2, mems: ['mem_a', 'mem_a', 'mem_b'] } },
      { request_id: 'r2', action: 'recall', ts: Date.now(), detail: { query: 'q', hits: 1, mems: ['mem_b'] } },
    ];
    const feed = await getHomeFeed(fakeStorage({ audits, memories: [memA] }));
    expect(feed.raw.activeMemories!.length).toBeGreaterThanOrEqual(1);
    const top = feed.raw.activeMemories![0];
    expect(top.title).toContain('重构失败'); // 真实 memory content
    expect(top.hits).toBeGreaterThanOrEqual(2);
    expect(top.request_id).toMatch(/^r/);
  });

  it('含 conflict_id 的记忆 → 真实待裁决待办；无冲突审计时 request_id 留空（不把 mem_id 冒充 request_id）', async () => {
    const conflictMem = { ...memA, mem_id: 'mem_c', conflict_id: 'cf_1' } as unknown as Memory;
    const feed = await getHomeFeed(fakeStorage({ memories: [conflictMem] }));
    expect(feed.raw.todos!).toHaveLength(1);
    expect(feed.raw.todos![0].kind).toBe('dispute');
    expect(feed.raw.todos![0].label).toContain('待裁决');
    expect(feed.raw.todos![0].request_id).toBe(''); // 批次48 A11：不冒用 mem_id
  });

  it('待裁决 request_id 取真实冲突审计（conflict_resolve 且 detail 引用该冲突）', async () => {
    const conflictMem = { ...memA, mem_id: 'mem_c', conflict_id: 'cf_1' } as unknown as Memory;
    const audits: AuditRecord[] = [
      { request_id: 'req_real', action: 'conflict_resolve', ts: Date.now(), detail: { conflict_id: 'cf_1', old_id: 'mem_a', new_id: 'mem_c', verdict: 'hold', pending: true } },
    ];
    const feed = await getHomeFeed(fakeStorage({ memories: [conflictMem], audits }));
    expect(feed.raw.todos![0].request_id).toBe('req_real');
  });

  it('同步未实现：任意审计不得冒充对账时间（wired=false · lastReconcileAt=0）', async () => {
    const now = Date.now();
    const audits: AuditRecord[] = [
      { request_id: 'r1', action: 'write', ts: now - 5000, detail: {} },
      { request_id: 'r2', action: 'recall', ts: now - 1000, detail: { query: 'q', hits: 1, mems: ['mem_a'] } },
      { request_id: 'r3', action: 'sync', ts: now - 500, detail: { implemented: false } },
    ];
    const feed = await getHomeFeed(fakeStorage({ audits, memories: [memA] }));
    expect(feed.sync.role).toBe('primary');
    expect(feed.sync.wired).toBe(false);
    expect(feed.sync.lastReconcileAt).toBe(0);
    expect(feed.sync.pendingSync).toBe(0);
  });

  it('真实同步审计才更新 lastReconcileAt；pending_sync 计入待回传', async () => {
    const now = Date.now();
    const audits: AuditRecord[] = [
      { request_id: 'r1', action: 'sync', ts: now - 2000, detail: { implemented: false } },
      { request_id: 'r2', action: 'sync_up', ts: now - 1000, detail: { applied: 1 } },
    ];
    const pending = { ...memA, mem_id: 'mem_p', pending_sync: true } as Memory;
    const feed = await getHomeFeed(fakeStorage({ audits, memories: [memA, pending] }));
    expect(feed.sync.lastReconcileAt).toBe(now - 1000);
    expect(feed.sync.pendingSync).toBe(1);
  });

  it('内核不可达 → offline（lastReconcileAt=0 · wired=false）', async () => {
    const broken: StorageBackend = {
      putMemory: async () => {}, getMemory: async () => null, listMemories: async () => { throw new Error('x'); },
      deleteMemory: async () => {}, appendAudit: async () => {}, queryAudit: async () => { throw new Error('x'); },
      // ── 批次46-D6：项目注册表（占位，getHomeFeed 不调用）──
      createProject: async () => ({ project_id: 'x', kind: 'general', created_at: 0, created_by: 'u' }),
      getProject: async () => null,
      listProjects: async () => [],
    };
    const feed = await getHomeFeed(broken);
    expect(feed.sync.role).toBe('offline');
    expect(feed.sync.wired).toBe(false);
    expect(feed.sync.lastReconcileAt).toBe(0);
    // 内核不可达：图谱不得伪造数据（保留六层结构 + 零节点），刻度整块为 null
    expect(feed.graph.nodes).toHaveLength(0);
    expect(feed.graph.stats.total).toBe(0);
    expect(feed.strata).toBeNull();
  });

  it('内核不可达 → storageError 带真实原因（绝不冒充空账本）', async () => {
    const broken: StorageBackend = {
      putMemory: async () => {}, getMemory: async () => null,
      listMemories: async () => { throw new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'); },
      deleteMemory: async () => {}, appendAudit: async () => {},
      queryAudit: async () => { throw new Error('E_IPC_TIMEOUT 宿主桥 3s 未回话'); },
      // ── 批次46-D6：项目注册表（占位，getHomeFeed 不调用）──
      createProject: async () => ({ project_id: 'x', kind: 'general', created_at: 0, created_by: 'u' }),
      getProject: async () => null,
      listProjects: async () => [],
    };
    const feed = await getHomeFeed(broken);
    expect(feed.storageError).toContain('E_IPC_TIMEOUT');
    expect(feed.strata).toBeNull();
  });

  it('账本可读 → storageError 为 null（真空账本也算「读到」）', async () => {
    const feed = await getHomeFeed(fakeStorage({}));
    expect(feed.storageError).toBeNull();
  });

  it('storage 不可达 → 安全降级为空（不抛），依赖 mirror 兜底', async () => {
    const broken: StorageBackend = {
      putMemory: async () => {}, getMemory: async () => { throw new Error('x'); },
      listMemories: async () => { throw new Error('x'); }, deleteMemory: async () => {},
      appendAudit: async () => {}, queryAudit: async () => { throw new Error('x'); },
      // ── 批次46-D6：项目注册表（占位，getHomeFeed 不调用）──
      createProject: async () => ({ project_id: 'x', kind: 'general', created_at: 0, created_by: 'u' }),
      getProject: async () => null,
      listProjects: async () => [],
    };
    const mirror: MirrorItem[] = [{ request_id: 'm1', action: 'recall', payload: { query: 'q', evidence_thin: true } }];
    const feed = await getHomeFeed(broken, { mirrorItems: mirror });
    expect(feed.raw.anomalies!).toHaveLength(1);
    expect(feed.raw.anomalies![0].request_id).toBe('m1');
  });

  it('效果证据四卡：与接入页同口径来自真实账本（首页关系图谱上方数据源）', async () => {
    const audits: AuditRecord[] = [
      { request_id: 'r1', action: 'recall', ts: Date.now(), detail: { query: 'q', hits: 3, mems: ['mem_a'], payload_tokens: 300 } },
      { request_id: 'r2', action: 'llm_proxy', ts: Date.now(), detail: { cost: 0.02 } },
    ];
    const feed = await getHomeFeed(fakeStorage({ audits, memories: [memA] }));
    expect(feed.effectGains).toHaveLength(4);
    expect(feed.effectGains[0].big).toBe('-80%');
    expect(feed.effectGains[1].big).toBe('3 次命中');
    expect(feed.effectGains[2].big).toContain('1 条');
    expect(feed.effectGains[3].big).toContain('¥0.02');
  });

  it('效果证据四卡：空账本全「未取数」，绝不伪造示例数字', async () => {
    const feed = await getHomeFeed(fakeStorage({}));
    expect(feed.effectGains).toHaveLength(4);
    expect(feed.effectGains.every((g) => g.big === '未取数')).toBe(true);
  });

  it('storage 不可达 → 效果证据四卡安全降级为「未取数」', async () => {
    const broken: StorageBackend = {
      putMemory: async () => {}, getMemory: async () => null, listMemories: async () => { throw new Error('x'); },
      deleteMemory: async () => {}, appendAudit: async () => {}, queryAudit: async () => { throw new Error('x'); },
      // ── 批次46-D6：项目注册表（占位，getHomeFeed 不调用）──
      createProject: async () => ({ project_id: 'x', kind: 'general', created_at: 0, created_by: 'u' }),
      getProject: async () => null,
      listProjects: async () => [],
    };
    const feed = await getHomeFeed(broken);
    expect(feed.effectGains).toHaveLength(4);
    expect(feed.effectGains.every((g) => g.big === '未取数')).toBe(true);
  });
});

// ---------- 批次41-W：L0 写密钥锁定聚合成一条异常 ----------

describe('getHomeFeed · 批次41-W L0 写密钥未解锁异常', () => {
  const lock = (request_id: string, ts: number): AuditRecord => ({
    request_id, action: 'write', ts,
    detail: { source: 'collector', error: '[E_L0_LOCKED] L0 写密钥未解锁：请输入 L0 管理密码解锁写密钥后再写入' },
  });

  it('窗口内多条锁定失败 → 聚合成一条 error（计数 + 最近一次可溯源 request_id，正文不上首页）', async () => {
    const now = Date.now();
    const audits: AuditRecord[] = [lock('req_l1', now - 60_000), lock('req_l2', now - 30_000), lock('req_l3', now - 10_000)];
    const feed = await getHomeFeed(fakeStorage({ audits }));
    expect(feed.raw.anomalies!).toHaveLength(1);
    const a = feed.raw.anomalies![0];
    expect(a.level).toBe('error');
    expect(a.title).toContain('L0 写密钥未解锁');
    expect(a.detail).toContain('3 条没入库');
    expect(a.request_id).toBe('req_l3');
    expect(a.detail).not.toContain('请输入'); // 只报计数，审计里的错误原文不铺到首页
  });

  it('超出窗口的历史锁定失败不再挂 error（解锁后自动消失，不是假警报）', async () => {
    const now = Date.now();
    const audits: AuditRecord[] = [lock('req_old', now - L0_LOCK_ANOMALY_WINDOW_MS - 60_000)];
    const feed = await getHomeFeed(fakeStorage({ audits }));
    expect(feed.raw.anomalies ?? []).toHaveLength(0);
  });

  it('普通写失败（非 E_L0_LOCKED）不冒充这条异常', async () => {
    const audits: AuditRecord[] = [{ request_id: 'req_x', action: 'write', ts: Date.now(), detail: { source: 'collector', error: 'boom' } }];
    const feed = await getHomeFeed(fakeStorage({ audits }));
    expect(feed.raw.anomalies ?? []).toHaveLength(0);
  });

  // 2026-11-13 用户实测回归：解锁后首页仍挂着「写入被挡 → 去安全页解锁」
  const unlock = (ts: number, member = true): AuditRecord => ({
    request_id: `req_unlock_${ts}`, action: 'security_change', ts,
    detail: { op: member ? 'l0_write_unlock_member' : 'l0_write_unlock', user_id: 'u1' },
  });

  it('解锁发生在被挡之后 → 那条历史不再报警（刚解完锁回首页不该继续催解锁）', async () => {
    const now = Date.now();
    const audits: AuditRecord[] = [
      lock('req_l1', now - 120_000),
      lock('req_l2', now - 100_000),
      unlock(now - 60_000),
    ];
    const feed = await getHomeFeed(fakeStorage({ audits }));
    expect(feed.raw.anomalies ?? []).toHaveLength(0);
  });

  it('解锁之后又被挡（重新锁上）→ 照常报警，只计解锁后的条数', async () => {
    const now = Date.now();
    const audits: AuditRecord[] = [
      lock('req_before', now - 300_000),
      unlock(now - 200_000),
      lock('req_after', now - 50_000),
    ];
    const feed = await getHomeFeed(fakeStorage({ audits }));
    const list = feed.raw.anomalies ?? [];
    expect(list).toHaveLength(1);
    expect(list[0].title).toContain('L0 写密钥未解锁');
    expect(list[0].detail).toContain('1 条没入库');
    expect(list[0].request_id).toBe('req_after');
  });
});
