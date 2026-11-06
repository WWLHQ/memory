// 阶段4-H / B7 → 42-A：诚实边界契约 —— 「已实现」不等于「已接线」，「未装配」也不等于「没实现」。
// 事实（42-A 后）：SyncHub / PgSyncHub + syncUp/syncDown/reconcile 已实现并有集成测试，内核 sync()
// 已支持 hub 注入真调引擎；hub 未注入时 agent.sync 仍如实报 E_NOT_IMPLEMENTED（诚实降级保留）；
// 桌面壳 kernel.hostL0Ports() 真注入 HostL0Admin（主进程 L0Vault IPC），缺端口只是纯浏览器的诚实降级。
// 本套件锁住这两条事实，同时锁住：注入后 pushed/pulled 是引擎真实结果，绝不伪造。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMemAgent } from '../agent.ts';
import { FakeLlmProvider } from '../llm.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import { SyncHub, syncDown, syncUp } from '../sync.ts';
import type { L0AdminPort, Memory } from '../types.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };
const NOW = 1_800_000_000_000;

function mem(o: Partial<Memory> = {}): Memory {
  return {
    mem_id: 'm1', project_id: 'P1', enterprise_id: 'e1', team_id: 't1',
    category: 'fact', layer: 'L2', content: 'desktop authored note',
    decay_class: 'hot', pinned: false, locked: false, version: 1,
    created_at: NOW, updated_at: NOW,
    ...o,
  } as Memory;
}

function makeAgent(storage: InMemoryStorage, l0Admin?: L0AdminPort) {
  return createMemAgent({
    form: 'desktop' as const,
    account: ACCOUNT,
    llm: new FakeLlmProvider(),
    vector: new JsVectorBackend(),
    storage,
    ...(l0Admin ? { l0Admin } : {}),
  });
}

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('同步与 L0 接线诚实边界（阶段4-H / B7 变异杀手）', () => {
  it('SyncHub 三端引擎已实现且真能跑通上行/下行（不得被误读成「不存在」而删除）', async () => {
    const hub = new SyncHub();
    const desk = new InMemoryStorage();
    const web = new InMemoryStorage();
    await desk.putMemory(mem());
    const up = await syncUp(desk, hub, 'desktop');
    expect(up.applied + up.lww).toBeGreaterThan(0);
    const down = await syncDown(hub, web, { team_id: 't1' }, 0);
    expect(down.pulled).toBe(1);
    expect((await web.getMemory('m1'))?.content).toBe('desktop authored note');
  });

  it('agent.sync hub 未注入 → 仍抛 E_NOT_IMPLEMENTED + implemented:false 审计（42-A 诚实降级保留），绝不伪造 pushed/pulled', async () => {
    const storage = new InMemoryStorage();
    const ma = makeAgent(storage);
    await expect(ma.sync({ direction: 'push', project_id: 'P1' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
    const audits = await storage.queryAudit({ action: 'sync' });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ implemented: false, direction: 'push', project_id: 'P1' });
    expect(audits[0].detail).not.toHaveProperty('pushed');
    expect(audits[0].detail).not.toHaveProperty('pulled');
  });

  it('agent.sync hub 注入 → 真调引擎：push 上行落中枢 + implemented:true 审计，绝不伪造数字', async () => {
    const storage = new InMemoryStorage();
    const hub = new SyncHub();
    const ma = createMemAgent({
      form: 'desktop' as const, account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage, hub,
    });
    await storage.putMemory(mem({ mem_id: 'm1' }));
    await storage.putMemory(mem({ mem_id: 'm2', content: 'second note' }));
    const r = await ma.sync({ direction: 'push', project_id: 'P1' });
    expect(r.pushed).toBe(2);
    expect(r.conflicts).toBe(0);
    expect(hub.reconcile({ team_id: 't1' }).items).toHaveLength(2);
    const audits = await storage.queryAudit({ action: 'sync' });
    expect(audits[0].detail).toMatchObject({ implemented: true, direction: 'push', pushed: 2 });
  });

  it('agent.sync hub 注入 → pull 真下行：他端上行的行落本地 + cursor 回传', async () => {
    const storage = new InMemoryStorage();
    const hub = new SyncHub();
    // 他端（web）先上行一行
    const other = new InMemoryStorage();
    await other.putMemory(mem({ mem_id: 'm9', content: 'from web end' }));
    await syncUp(other, hub, 'web');
    const ma = createMemAgent({
      form: 'desktop' as const, account: ACCOUNT,
      llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage, hub,
    });
    const r = await ma.sync({ direction: 'pull', project_id: 'P1' });
    expect(r.pulled).toBe(1);
    expect(r.cursor).toBeGreaterThan(0);
    expect((await storage.getMemory('m9'))?.content).toBe('from web end');
    const audits = await storage.queryAudit({ action: 'sync' });
    expect(audits[0].detail).toMatchObject({ implemented: true, direction: 'pull', pulled: 1 });
  });

  it('L0AdminPort 未提供 → 诚实 E_NOT_IMPLEMENTED；注入后真委托（桌面壳确实能接通）', async () => {
    const bare = makeAgent(new InMemoryStorage());
    await expect(bare.l0ListGrants()).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });

    const fake = { listGrants: async () => [{ grant_id: 'g1' }] } as unknown as L0AdminPort;
    const wired = makeAgent(new InMemoryStorage(), fake);
    await expect(wired.l0ListGrants()).resolves.toEqual([{ grant_id: 'g1' }]);
  });

  it('桌面壳装配契约：hostL0Ports() 真注入 HostL0Admin；SyncHub / PgSyncHub 中枢真实存在；kernel hostSyncHub() 真注入（42-B）', () => {
    const kernel = src('src/web/kernel.ts');
    const pg = src('src/core/memagent/pgSyncHub.ts');
    const sync = src('src/core/memagent/sync.ts');
    expect(kernel).toMatch(/l0Admin: new HostL0Admin\(\)/);
    expect(kernel).toMatch(/if \(!l0HostAvailable\(\)\) return \{\}/); // 仅纯浏览器不注入端口
    expect(kernel).toMatch(/\.\.\.hostSyncHub\(\)/); // 42-B：桌面壳内 agent 拿到中枢代理，纯浏览器不注入
    expect(pg).toMatch(/export class PgSyncHub/);
    expect(sync).toMatch(/export class SyncHub/);
    expect(sync).toMatch(/export async function syncUp/);
    expect(sync).toMatch(/export async function syncDown/);
  });

  it('源码声明：agent / 顶栏必须说清「引擎已实现、未接入 API」「L0 桌面壳已接线」', () => {
    const agent = src('src/core/memagent/agent.ts');
    const home = src('src/web/Home/coreHome.ts');
    expect(agent).toMatch(/同步引擎已实现/);
    expect(agent).toMatch(/未接入内核 API/);
    expect(agent).toMatch(/hostL0Ports\(\)/);
    expect(agent).toMatch(/诚实降级，不是/);
    expect(home).toMatch(/已实现并有集成测试/);
    expect(home).toMatch(/wired=false/);
  });

  it('源码声明杀手：旧「本版本未实现 / L0 未接线 / 中枢尚未接线」措辞不得回流', () => {
    const files = [
      'src/core/memagent/agent.ts',
      'src/core/memagent/types.ts',
      'src/core/memagent/fieldBackfill.ts',
      'src/core/memagent/__tests__/contract.test.ts',
      'src/web/Home/coreHome.ts',
      'src/web/Home/TopBar.tsx',
    ].map(src).join('\n');
    expect(files).not.toMatch(/云端同步本版本未实现（syncUp/);
    expect(files).not.toMatch(/L0 授权管理未接线/);
    expect(files).not.toMatch(/同步中枢尚未接线/);
    expect(files).not.toMatch(/中枢未接线 → wired=false/);
    expect(files).not.toMatch(/未接线显式 E_NOT_IMPLEMENTED/);
    expect(files).not.toMatch(/未接线三件套/);
  });
});
