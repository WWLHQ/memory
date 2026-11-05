// 批次44-D5-4：scope='session' 工作记忆视图的内核 + MCP 层契约
// 覆盖 A（项目召回路径不变）、B（session_id 真落库/真按会话过滤）、C2（输入与状态变异矩阵）
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { JsVectorBackend } from '../vector.ts';
import { InMemoryStorage } from '../storage.ts';
import { McpToolError, runRecallTool } from '../mcpRecall.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault } from './l0Kit.ts';
import type { MemAgent, Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const FULL_ACCOUNT = { ...ACCOUNT, scope_project_ids: ['*'] };
const SCOPED_P1 = { ...FULL_ACCOUNT, scope_project_ids: ['P1'] };
const LONG = '项目 P1 决策：会话工作记忆按 session_id 精确过滤并按 created_at 倒序取最近若干条，不走向量语义检索';

function mem(over: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'mem_default',
    project_id: 'P1',
    enterprise_id: 'e1',
    team_id: 't1',
    category: 'fact',
    layer: 'L1',
    content: '会话正文',
    content_l1: '脱敏后的会话正文',
    decay_class: 'hot',
    pinned: false,
    locked: false,
    version: 1,
    created_at: 1000,
    ...over,
  };
}

// 真实 ma.write() 会走 L0 写密钥门禁（coreWrite 无 l0 端口即 E_L0_LOCKED）。
// 注入已 setup 的 L0Vault；PBKDF2 只在 beforeAll 跑一次，与 llmHonesty.test.ts 同一装配。
let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

function fixture() {
  const storage = new InMemoryStorage();
  const ma: MemAgent = createMemAgent({
    form: 'desktop', account: ACCOUNT,
    llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage, l0: sharedVault,
  });
  return { storage, ma };
}

/** S1 三条（时间 100/200/300）、S2 一条、无 session_id 历史行一条、P2 一条 */
async function seed(storage: InMemoryStorage): Promise<void> {
  await storage.putMemory(mem({ mem_id: 's1_a', session_id: 'S1', created_at: 100, content: 'S1 最早' }));
  await storage.putMemory(mem({ mem_id: 's1_b', session_id: 'S1', created_at: 300, content: 'S1 最新' }));
  await storage.putMemory(mem({ mem_id: 's1_c', session_id: 'S1', created_at: 200, content: 'S1 中间' }));
  await storage.putMemory(mem({ mem_id: 's2_a', session_id: 'S2', created_at: 400, content: 'S2 别会话' }));
  await storage.putMemory(mem({ mem_id: 'legacy', created_at: 500, content: '历史行无会话字段' }));
  await storage.putMemory(mem({ mem_id: 'p2_s1', project_id: 'P2', session_id: 'S1', created_at: 600, content: '别项目同会话' }));
}

describe('批次44-D5-4：session_id 落库（B 效果验证）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;
  beforeEach(() => { ({ storage, ma } = fixture()); });

  it('write 显式传 session_id → 真落库；未传 → 记录不带该字段（历史行兼容）', async () => {
    const withSid = await ma.write({
      content: LONG, category: 'fact', project_id: 'P1', source_agent: 'workbuddy', session_id: 'S1',
    });
    expect((await storage.getMemory(withSid.mem_id))?.session_id).toBe('S1');

    const without = await ma.write({
      content: '运维手册补充：PostgreSQL 17 的 WAL 归档窗口设为 15 分钟，超过窗口即清理旧日志，避免磁盘被写满',
      category: 'fact', project_id: 'P1', source_agent: 'workbuddy',
    });
    expect((await storage.getMemory(without.mem_id))?.session_id).toBeUndefined();
  });
});

describe('批次44-D5-4：scope=session 内核分支', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;
  beforeEach(async () => {
    ({ storage, ma } = fixture());
    await seed(storage);
  });

  it('只回本会话 + created_at 倒序 + top_k 截断；查询词完全不相关也照回（证明不走向量）', async () => {
    const r = await ma.recall({
      query: 'zzzz 完全无关的检索词', project_id: 'P1', scope: 'session', session_id: 'S1', top_k: 2,
    });
    expect(r.hits.map((h) => h.mem_id)).toEqual(['s1_b', 's1_c']);
    expect(r.hits.every((h) => h.score === 0)).toBe(true); // 未计算语义相关度，不冒充
    expect(r.scanned_memories).toBe(3);
    expect(r.background.items).toHaveLength(0); // 不注入项目背景，别会话不借道回灌
    expect(r.budget.status).toBe('ok');
  });

  it('项目召回路径不变（A 回归）：不带 scope 仍走向量、仍有背景、仍可命中非会话行', async () => {
    // background.candidates = 未进入 top-K 命中的池子长度（selectRecallBackground 口径）。
    // 种子里 5 条 P1 全 hot，默认 top_k=5 会全部命中 → 池子天然为 0，与「背景是否仍生效」无关。
    // 补一条 cold（hardFilter 不收、但背景池会数它），才能真正验证项目背景通道没被会话分支改掉。
    await storage.putMemory(mem({
      mem_id: 'bg_cold', session_id: 'S1', decay_class: 'cold', created_at: 10,
      content: '项目背景候选：这条冷记忆不参与语义命中，但应留在项目背景候选池里',
    }));
    const r = await ma.recall({ query: '会话正文', project_id: 'P1' });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.some((h) => h.mem_id === 'legacy')).toBe(true); // 项目视图仍可见无 session_id 的历史行
    expect(r.hits.some((h) => h.mem_id === 's2_a')).toBe(true);   // 也可见别会话的行（会话视图绝不可见）
    expect(r.hits.some((h) => h.mem_id === 'bg_cold')).toBe(false); // cold 不进语义命中
    expect(r.background.candidates).toBeGreaterThan(0);           // 仍有项目背景（会话视图为空）
    expect(r.request_id).toMatch(/^req_/);
  });

  it('session 命中也写 recall 审计（回显/累计口径与项目召回一致）', async () => {
    const r = await ma.recall({
      query: '刚才聊到哪', project_id: 'P1', scope: 'session', session_id: 'S1', top_k: 3,
    });
    const audits = await storage.queryAudit({ request_id: r.request_id });
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('recall');
    expect(audits[0].detail).toMatchObject({ scope: 'session', session_id: 'S1', hits: 3 });
  });

  it('C2 状态变异：历史行无 session_id / 别会话 / 别项目 / 删除墓碑 / 合并影子 一律不进视图', async () => {
    await storage.putMemory(mem({ mem_id: 'deleted_s1', session_id: 'S1', created_at: 700, deleted: true }));
    await storage.putMemory(mem({ mem_id: 'merged_s1', session_id: 'S1', created_at: 800, merged_into: 's1_b' }));
    const r = await ma.recall({
      query: '任意', project_id: 'P1', scope: 'session', session_id: 'S1', top_k: 10,
    });
    const ids = r.hits.map((h) => h.mem_id);
    expect(ids).toEqual(['s1_b', 's1_c', 's1_a']);
    expect(ids).not.toContain('legacy');
    expect(ids).not.toContain('s2_a');
    expect(ids).not.toContain('p2_s1'); // 项目隔离仍然生效
    expect(ids).not.toContain('deleted_s1');
    expect(ids).not.toContain('merged_s1');
  });

  it('C2 状态变异：不存在的 session_id → 诚实空态，不补造、不回显别会话', async () => {
    const r = await ma.recall({
      query: '任意', project_id: 'P1', scope: 'session', session_id: 'S_NOPE', top_k: 10,
    });
    expect(r.hits).toHaveLength(0);
    expect(r.scanned_memories).toBe(0);
    expect(r.payload_tokens).toBe(0);
  });

  it('预算约束：单条超大内容也不会击穿 3000t 硬熔断', async () => {
    await storage.putMemory(mem({ mem_id: 'huge', session_id: 'S_HUGE', created_at: 900, content: 'x'.repeat(8000) }));
    const r = await ma.recall({
      query: '任意', project_id: 'P1', scope: 'session', session_id: 'S_HUGE', top_k: 10,
    });
    expect(r.payload_tokens).toBeLessThanOrEqual(3000);
    expect(r.hits).toHaveLength(0);
  });
});

describe('批次44-D5-4：runRecallTool 参数校验（C2 输入变异矩阵）', () => {
  let storage: InMemoryStorage;
  let ma: MemAgent;
  beforeEach(async () => {
    ({ storage, ma } = fixture());
    await seed(storage);
  });

  it('scope=session 缺 session_id / 空串 / 非法 scope / session_id 类型错 / top_k 越界 → -32602', async () => {
    const cases: Array<Record<string, unknown>> = [
      { query: 'q', project_id: 'P1', scope: 'session' },
      { query: 'q', project_id: 'P1', scope: 'session', session_id: '' },
      { query: 'q', project_id: 'P1', scope: 'session', session_id: 123 },
      { query: 'q', project_id: 'P1', scope: 'bogus' },
      { query: 'q', project_id: 'P1', session_id: 123 },
      { query: 'q', project_id: 'P1', scope: 'session', session_id: 'S1', top_k: 0 },
      { query: 'q', project_id: 'P1', scope: 'session', session_id: 'S1', top_k: 11 },
      { query: 'q', project_id: 'P1', scope: 'session', session_id: 'S1', top_k: 1.5 },
    ];
    for (const args of cases) {
      await expect(runRecallTool(ma, storage, args, undefined, undefined, FULL_ACCOUNT))
        .rejects.toBeInstanceOf(McpToolError);
    }
    try { await runRecallTool(ma, storage, { query: 'q', project_id: 'P1', scope: 'session' }, undefined, undefined, FULL_ACCOUNT); }
    catch (e) { expect((e as McpToolError).code).toBe(-32602); }
  });

  it('scope=session 端到端：payload 只含本会话命中，且 display 仍按既有档位组装', async () => {
    const out = await runRecallTool(
      ma, storage,
      { query: '刚才', project_id: 'P1', scope: 'session', session_id: 'S1', top_k: 2 },
      undefined, undefined, FULL_ACCOUNT,
    );
    expect(out.payload.hits.map((h) => h.mem_id)).toEqual(['s1_b', 's1_c']);
    expect(out.payload.project_id).toBe('P1');
    expect(out.payload.display.markdown).toBeTruthy();
    expect(out.text).toContain('命中');
  });

  it('C2 输入变异：scope=project 却给 session_id → 仍走项目召回，不误入会话分支', async () => {
    const out = await runRecallTool(
      ma, storage,
      { query: '会话正文', project_id: 'P1', scope: 'project', session_id: 'S1' },
      undefined, undefined, FULL_ACCOUNT,
    );
    expect(out.payload.hits.some((h) => h.mem_id === 'legacy')).toBe(true);
  });

  it('受限令牌：越界项目 → -32602（会话视图不绕过作用域）', async () => {
    await expect(runRecallTool(
      ma, storage,
      { query: 'q', project_id: 'P2', scope: 'session', session_id: 'S1' },
      undefined, undefined, SCOPED_P1,
    )).rejects.toThrow(/作用域/);
  });
});
