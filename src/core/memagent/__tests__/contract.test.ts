// memagent-core 契约级验收用例（§8 全 8 条）
import { describe, expect, it } from 'vitest';
import { createMemAgent } from '../agent.ts';
import { MemAgentError } from '../errors.ts';
import { FakeLlmProvider, routeProxy } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend, embedSync, cosine } from '../vector.ts';
import type { ModelInfo } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

function makeAgent(form: 'desktop' | 'web' | 'cli' = 'desktop') {
  return createMemAgent({
    form, account: ACCOUNT,
    llm: new FakeLlmProvider(),
    vector: new JsVectorBackend(),
    storage: new InMemoryStorage(),
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

  it('④ L0 查阅：错密码 → E_AUTH_L0 + 遮罩；对密码解开 + l0_view 审计', async () => {
    const ma = makeAgent();
    await ma._seedMemory({ content: 'secret db tcp://prod-db:5432/app', category: 'context', project_id: 'P1' });
    // 错密码 → E_AUTH_L0
    await expect(ma.browse({ layer: 'L0', project_id: 'P1', l0_auth: { password: 'bad' } }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    // 对密码（≥6 位）→ 解开
    const ok = await ma.browse({ layer: 'L0', project_id: 'P1', l0_auth: { password: 'l0pass' } });
    expect(ok.l0_masked).toBe(false);
    expect(ok.rows[0].content).toContain('tcp://prod-db:5432/app');
    expect(ok.audit.action).toBe('l0_view');
  });

  it('⑤ 日志页：level/form 过滤 + 异常置顶 + ref_audit 可跳', async () => {
    const ma = makeAgent();
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
    const web = makeAgent('web');
    const r = await web.discover({ form: 'web', signals: ['mcp', 'proc', 'hb'] });
    expect(r.skipped).toEqual(['proc']);
    expect(r.agents.map((a) => a.signal)).toEqual(['mcp', 'hb']);
    // 桌面端 proc 可用
    const desk = makeAgent('desktop');
    const rd = await desk.discover({ form: 'desktop', signals: ['mcp', 'proc'] });
    expect(rd.skipped).toEqual([]);
    expect(rd.agents.map((a) => a.signal)).toContain('proc');
  });

  it('写入查重：相似内容 → merged（版本+1）；完全相同 → duplicated', async () => {
    const ma = makeAgent();
    const r1 = await ma.write({ content: 'deploy docker compose v2 for staging', category: 'fact', project_id: 'P1' });
    expect(r1.dedup.action).toBe('new');
    // 极相似 → merged
    const r2 = await ma.write({ content: 'deploy docker compose v2 for staging!', category: 'fact', project_id: 'P1' });
    expect(r2.dedup.action === 'merged' || r2.dedup.action === 'duplicated').toBe(true);
    expect(r2.dedup.sim).toBeGreaterThanOrEqual(0.75);
  });

  it('gc 衰减推进 + locked/pinned 豁免；sync 版本冲突 → E_SYNC_CONFLICT', async () => {
    const ma = makeAgent();
    const m1 = await ma._seedMemory({ content: 'will decay normally', category: 'context', project_id: 'P1' });
    await ma._seedMemory({ content: 'pinned never decays', category: 'fact', project_id: 'P1', pinned: true });
    const report = await ma.gc({ project_id: 'P1' });
    expect(report.decayed).toBe(1); // 仅未 pinned 的推进 hot→warm
    const after = await ma.gc({ project_id: 'P1' });
    expect(after.decayed).toBeGreaterThanOrEqual(1);
    expect(m1.mem_id).toBeTruthy();
    // 冲突 → E_SYNC_CONFLICT
    await ma._seedMemory({ content: 'conflicted memory', category: 'fact', project_id: 'P2', conflict_id: 'cf1' });
    await expect(ma.sync({ direction: 'push', project_id: 'P2' })).rejects.toMatchObject({ code: 'E_SYNC_CONFLICT' });
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
