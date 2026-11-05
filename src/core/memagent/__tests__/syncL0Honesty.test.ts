// 阶段4-H / B7：诚实边界契约 —— 「已实现」不等于「已接线」，「未接线」也不等于「没实现」。
// 事实：SyncHub / PgSyncHub + syncUp/syncDown/reconcile 已实现并有集成测试，只是未接入内核 API 与桌面主进程；
//       桌面壳 kernel.hostL0Ports() 真注入 HostL0Admin（主进程 L0Vault IPC），缺端口只是纯浏览器的诚实降级。
// 旧注释把前者写成「本版本未实现」、把后者写成「L0 授权未接线」，本套件锁住这两条事实，
// 同时锁住 agent.sync() 绝不拿本地条数/内存中枢伪造 pushed/pulled 云端同步成功。
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

  it('agent.sync 未接入 API 层 → 抛 E_NOT_IMPLEMENTED + implemented:false 审计，绝不伪造 pushed/pulled', async () => {
    const storage = new InMemoryStorage();
    const ma = makeAgent(storage);
    await expect(ma.sync({ direction: 'push', project_id: 'P1' })).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });
    const audits = await storage.queryAudit({ action: 'sync' });
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ implemented: false, direction: 'push', project_id: 'P1' });
    expect(audits[0].detail).not.toHaveProperty('pushed');
    expect(audits[0].detail).not.toHaveProperty('pulled');
  });

  it('L0AdminPort 未提供 → 诚实 E_NOT_IMPLEMENTED；注入后真委托（桌面壳确实能接通）', async () => {
    const bare = makeAgent(new InMemoryStorage());
    await expect(bare.l0ListGrants()).rejects.toMatchObject({ code: 'E_NOT_IMPLEMENTED' });

    const fake = { listGrants: async () => [{ grant_id: 'g1' }] } as unknown as L0AdminPort;
    const wired = makeAgent(new InMemoryStorage(), fake);
    await expect(wired.l0ListGrants()).resolves.toEqual([{ grant_id: 'g1' }]);
  });

  it('桌面壳装配契约：hostL0Ports() 真注入 HostL0Admin；SyncHub / PgSyncHub 中枢真实存在', () => {
    const kernel = src('src/web/kernel.ts');
    const pg = src('src/core/memagent/pgSyncHub.ts');
    const sync = src('src/core/memagent/sync.ts');
    expect(kernel).toMatch(/l0Admin: new HostL0Admin\(\)/);
    expect(kernel).toMatch(/if \(!l0HostAvailable\(\)\) return \{\}/); // 仅纯浏览器不注入端口
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
