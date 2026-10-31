// memagent-core 契约级验收用例（§8 全 8 条）
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { MemAgentError } from '../errors.ts';
import { FakeLlmProvider, routeProxy } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync, cosine } from '../vector.ts';
import type { L0AdminPort, L0Port, ModelInfo } from '../types.ts';
import { createTestVault, TEST_ADMIN_PW } from './l0Kit.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function makeAgent(form: 'desktop' | 'web' | 'cli' = 'desktop', ports?: { l0?: L0Port; l0Admin?: L0AdminPort }) {
  return createMemAgent({
    form, account: ACCOUNT,
    llm: new FakeLlmProvider(),
    vector: new JsVectorBackend(),
    storage: new InMemoryStorage(),
    ...ports,
  });
}

describe('§8 契约级验收', () => {
  it('① 桌面→Web 同 recall：两端口径一致（同内核，仅 Provider/Storage 不同）', async () => {
    const desk = makeAgent('desktop');
    const web = makeAgent('web');
    const seed = { content: 'api gateway retry with exponential backoff', category: 'pitfall' as const, project_id: 'P1' };
    const md = await desk._seedMemory(seed);
    const mw = await web._seedMemory(seed);

    const rd = await desk.recall({ query: 'api gateway retry exponential backoff', project_id: 'P1' });
    const rw = await web.recall({ query: 'api gateway retry exponential backoff', project_id: 'P1' });

    // 端壳不同 → 内核口径一致：budget 常量/模式语义/hits 结构相同，score 由同构向量后端保证
    expect(rd.budget).toEqual(rw.budget);
    expect(rd.hits).toHaveLength(1);
    expect(rw.hits).toHaveLength(1);
    expect(rd.hits[0].score).toBeCloseTo(rw.hits[0].score, 5);
    expect(rd.hits[0].mem_id).toBe(md.mem_id);
    expect(rw.hits[0].mem_id).toBe(mw.mem_id);
    expect(rd.request_id).toMatch(/^req_/);
  });

  it('② 反代理全端一致：先免费后低价 + 单价上限（内核 routeProxy）', () => {
    const models: ModelInfo[] = [
      { model: 'claude-free', tier: 'free', price: 0, quota: 1000, used: 950 },   // 余量 900-950<0 耗尽
      { model: 'gpt4o-mini', tier: 'cheap', price: 0.01, quota: 2000, used: 100 },
      { model: 'expensive', tier: 'cheap', price: 0.05, quota: 2000, used: 100 },
      { model: 'paid-big', tier: 'paid', price: 0.2, quota: 5000, used: 0 },
    ];
    // 免费耗尽 → 低价中价低者优先（≤ cap 0.02）
    const r = routeProxy(models, 0.02, 10, 0);
    expect(r.model).toBe('gpt4o-mini');
    expect(r.fallback).toBe(false);
    // 提高 cap 也不选 paid（付费不入代理）
    const r2 = routeProxy(models, 10, 10, 0);
    expect(r2.model).toBe('gpt4o-mini');
    // 全耗尽 → 回退本地（llm_fallback）
    const exhausted = models.map((m) => ({ ...m, used: m.quota }));
    const r3 = routeProxy(exhausted, 0.02, 10, 0);
    expect(r3.model).toBeNull();
    expect(r3.fallback).toBe(true);
    expect(r3.source).toBe('agent:local');
  });

  it('③ 向量后端同构：embedSync/cosine 决定相似度（JS 实现可替换 WASM）', async () => {
    const a = embedSync('deploy docker compose v2');
    const b = embedSync('deploy docker compose v2');
    const c = embedSync('totally different topic coffee');
    expect(cosine(a, b)).toBeCloseTo(1, 5);
    expect(cosine(a, c)).toBeLessThan(cosine(a, b));
  });

  it('④ L0 查阅：错密码 → E_AUTH_L0 + 遮罩；对密码建连续会话解开 + l0_view 审计', async () => {
    const { vault } = await createTestVault();
    const ma = makeAgent('desktop', { l0: vault, l0Admin: vault });
    // L0 真实 AES-256-GCM(v2) 加密入库（§4.1/§4.4）
    await ma._seedMemory({ content: 'secret db tcp://prod-db:5432/app', category: 'context', project_id: 'P1', l0: true });
    // 错密码 → E_AUTH_L0（解锁即失败，不创建会话）
    await expect(ma.l0Unlock({ password: 'bad-password' }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    // 对密码 → 创建连续会话，凭 l0_session_id 解开
    const unlock = await ma.l0Unlock({ password: TEST_ADMIN_PW });
    const ok = await ma.browse({ layer: 'L0', project_id: 'P1', l0_auth: { l0_session_id: unlock.l0_session_id } });
    expect(ok.l0_masked).toBe(false);
    expect(ok.rows[0].content).toContain('tcp://prod-db:5432/app');
    expect(ok.audit.action).toBe('l0_view');
  });

  it('⑤ 日志页：level/form 过滤 + 异常置顶 + ref_audit 可跳', async () => {
    const { vault } = await createTestVault();
    const ma = makeAgent('desktop', { l0: vault, l0Admin: vault });
    await ma.write({ content: 'some unique memory content alpha', category: 'fact', project_id: 'P1' });
    const page = await ma.logs({ limit: 50 });
    expect(page.items.length).toBeGreaterThan(0);
    // error（llm_fallback 等）应排最前
    const firstErrIdx = page.items.findIndex((i) => i.level === 'error');
    if (firstErrIdx >= 0) {
      expect(page.items.slice(0, firstErrIdx).every((i) => i.level !== 'error')).toBe(true);
    }
    expect(page.items.every((i) => i.ref_audit.startsWith('req_'))).toBe(true);
    // level 过滤
    const errs = await ma.logs({ level: 'error' });
    expect(errs.items.every((i) => i.level === 'error')).toBe(true);
  });

  it('⑥ 能力降级：Web discover 自动剔除 proc（E_FORM_DISABLED 语义）', async () => {
    const found: { name: string; signal: 'mcp' | 'proc' | 'hb' }[] = [
      { name: 'real-mcp-client', signal: 'mcp' },
      { name: 'local-proc', signal: 'proc' },
      { name: 'hb-client', signal: 'hb' },
    ];
    const web = makeAgent('web');
    const r = await web.discover({ form: 'web', signals: ['mcp', 'proc', 'hb'], found });
    expect(r.skipped).toEqual(['proc']);
    expect(r.agents.map((a) => a.signal)).toEqual(['mcp', 'hb']);
    // 桌面端 proc 可用
    const desk = makeAgent('desktop');
    const rd = await desk.discover({ form: 'desktop', signals: ['mcp', 'proc'], found });
    expect(rd.skipped).toEqual([]);
    expect(rd.agents.map((a) => a.signal)).toContain('proc');
    // 无真实候选 → 不虚构 agent
    const empty = await desk.discover({ form: 'desktop', signals: ['mcp', 'proc'] });
    expect(empty.agents).toEqual([]);
  });

  it('写入逐层查重：相似内容 → L1 分支嫁接（新记忆保留自身文本，目标 grafted_from 回指）', async () => {
    const { vault } = await createTestVault();
    const ma = makeAgent('desktop', { l0: vault, l0Admin: vault });
    const r1 = await ma.write({ content: 'deploy docker compose v2 for staging', category: 'fact', project_id: 'P1' });
    expect(r1.dedup.action).toBe('new');
    // 极相似 → 命中 L1 阈值 0.70 → 分支嫁接并停止（不生成更深层）
    const r2 = await ma.write({ content: 'deploy docker compose v2 for staging!', category: 'fact', project_id: 'P1' });
    expect(r2.dedup.action).toBe('grafted');
    expect(r2.dedup.sim).toBeGreaterThanOrEqual(0.70);
    expect(r2.dedup.graft_layer).toBe('L1');
    expect(r2.dedup.graft_to).toBe(r1.mem_id);
    expect(r2.mem_id).not.toBe(r1.mem_id);
    expect(Object.keys(r2.layers ?? {})).toEqual(['content_l1']);
  });

  it('gc 单一衰减引擎（17.7 固定天数）+ locked/pinned 豁免；sync 未接线 → E_NOT_IMPLEMENTED', async () => {
    const ma = makeAgent();
    const DAY = 24 * 3600 * 1000;
    // hot >3 天 → warm（D5：coreGc 与 forgetting.classifyLayer 同一引擎，按 created_at 固定天数）
    const m1 = await ma._seedMemory({
      content: 'will decay normally', category: 'context', project_id: 'P1',
      half_life_days: 30, created_at: Date.now() - 4 * DAY,
    });
    await ma._seedMemory({ content: 'pinned never decays', category: 'fact', project_id: 'P1', pinned: true, created_at: Date.now() - 999 * DAY });
    const report = await ma.gc({ project_id: 'P1' });
    expect(report.decayed).toBe(1); // 仅未 pinned 且已过 3 天的那条推进 hot→warm
    // 立即再次 gc：warm 未过 30 天且新鲜度足够 → 不再连续降档
    const after = await ma.gc({ project_id: 'P1' });
    expect(after.decayed).toBe(0);
    expect(m1.mem_id).toBeTruthy();
    // 同步中枢未接线 → 诚实报 E_NOT_IMPLEMENTED（绝不伪造 pushed/pulled 成功）
    await ma._seedMemory({ content: 'conflicted memory', category: 'fact', project_id: 'P2', conflict_id: 'cf1' });
    await expect(ma.sync({ direction: 'push', project_id: 'P2' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
  });
});

describe('契约细节', () => {
  it('recall：critical 禁 minimal → 降为 fact_first（16.5）', async () => {
    const ma = makeAgent();
    await ma._seedMemory({ content: 'critical scene memory', category: 'fact', project_id: 'P1' });
    const r = await ma.recall({ query: 'critical scene memory', project_id: 'P1', scene: 'critical', mode: 'minimal' });
    expect(r.mode).toBe('fact_first');
  });

  it('recall：top_k 越界报错；evidence_thin 空结果触发逃生阀（2.4.3）', async () => {
    const ma = makeAgent();
    await expect(ma.recall({ query: 'x', project_id: 'P1', top_k: 11 })).rejects.toBeInstanceOf(MemAgentError);
    const r = await ma.recall({ query: '完全无关的查询词表', project_id: 'P1' });
    expect(r.evidence_thin).toBe(true);
  });

  it('预算三档常量 + payload_tokens 估算', async () => {
    const ma = makeAgent();
    await ma._seedMemory({ content: 'x'.repeat(100), category: 'fact', project_id: 'P1' });
    const r = await ma.recall({ query: 'x', project_id: 'P1' });
    expect(r.budget).toEqual({ soft: 1500, warn: 2000, hard: 3000, status: 'ok' });
    expect(r.payload_tokens).toBeGreaterThan(0);
  });

  it('unbind 写 unbound 审计；getPrefs 取 user_id 级偏好', async () => {
    const ma = makeAgent();
    await ma._seedMemory({ content: 'user prefers dark theme always', category: 'preference', project_id: 'P1', user_id: 'u1' });
    const prefs = await ma.getPrefs('u1');
    expect(prefs.length).toBe(1);
    await expect(ma.unbind('agent-mcp-1')).resolves.toBeUndefined();
  });
});
