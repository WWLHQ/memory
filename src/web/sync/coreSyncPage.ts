// 同步与裁决页（批次42-C）数据逻辑：内核 agent.sync 真跑 + §9.7 裁决队列经 HostSyncHub 代理。
// 页面数据真相 = 内核引擎 + 主进程 PgSyncHub；空队列 → 诚实空态，绝不伪造冲突。
// ctx 全部可注入（测试用内存 SyncHub 支撑），缺省 = 真实内核 + 真实代理。
import { getKernel, getTenant, type KernelOverrides } from '../kernel.ts';
import { HostSyncHub } from '../shared/syncHub.ts';
import type { MemAgent, Memory, SyncReport } from '../../core/memagent/types.ts';
import type { SyncConflict } from '../../core/memagent/sync.ts';

/** 页面依赖的中枢最小面（结构化）：内存 SyncHub（同步返回）/ HostSyncHub 代理（异步）双兼容 */
export interface SyncPageHub {
  listConflicts(team_id?: string): Promise<SyncConflict[]> | SyncConflict[];
  resolve(conflict_id: string, winner: 'local' | 'remote'): Promise<void> | void;
  reconcile(scope: { team_id: string }):
    Promise<{ items: Memory[]; losers: Memory[]; missing_local: string[] }> | { items: Memory[]; losers: Memory[]; missing_local: string[] };
}

export interface SyncPageCtx {
  agent?: Pick<MemAgent, 'sync'>;
  hub?: SyncPageHub;
  team_id?: string;
  overrides?: KernelOverrides;
}

function getCtx(overrides: SyncPageCtx = {}): Required<Omit<SyncPageCtx, 'overrides'>> {
  return {
    agent: overrides.agent ?? getKernel(overrides.overrides),
    hub: overrides.hub ?? new HostSyncHub(),
    // 45-A1：kernel tenant 是规范三元组真值（桌面壳经 IPC 下发 / 浏览器缺省 u1/t1/e1）
    team_id: overrides.team_id ?? getTenant().team_id,
  };
}

/** 一次完整同步 = push（上行）+ pull（下行），返回真实报告（绝不伪造数字） */
export async function runSync(ctx: SyncPageCtx = {}): Promise<SyncRunView> {
  const { agent, team_id } = getCtx(ctx);
  try {
    // project_id 在内核 sync() 中仅用于审计归因，不参与同步过滤（引擎按 team_id 隔离）；
    // 全库同步语义用 '*'，与引擎口径一致（syncUp/syncDown 不看 project_id）。
    const up: SyncReport = await agent.sync({ direction: 'push', project_id: '*' });
    const down: SyncReport = await agent.sync({ direction: 'pull', project_id: '*' });
    return {
      ok: true,
      pushed: up.pushed, pulled: down.pulled, conflicts: up.conflicts,
      dedup: up.dedup ?? 0, behind: up.behind ?? 0, lww: up.lww ?? 0,
      l0_skipped: up.l0_skipped ?? 0, cursor: down.cursor ?? 0, team_id,
    };
  } catch (e) {
    return {
      ok: false,
      pushed: 0, pulled: 0, conflicts: 0, team_id,
      error: (e as { message?: string })?.message ?? String(e),
    };
  }
}

export interface SyncRunView {
  ok: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  dedup?: number;
  behind?: number;
  lww?: number;
  l0_skipped?: number;
  cursor?: number;
  team_id: string;
  error?: string;
}

/** §9.7 裁决队列（pending）：中枢侧真实状态 */
export async function listSyncConflicts(ctx: SyncPageCtx = {}): Promise<SyncConflict[]> {
  const { hub, team_id } = getCtx(ctx);
  return hub.listConflicts(team_id);
}

/** 人工裁决：主进程 requireAdmin 门禁 + 中枢 resolve 落 conflict_resolve 审计；失败如实上抛 */
export async function resolveConflict(conflict_id: string, winner: 'local' | 'remote', ctx: SyncPageCtx = {}): Promise<void> {
  const { hub } = getCtx(ctx);
  await hub.resolve(conflict_id, winner);
}

/** 中枢对账视图（§3.4 镜像全景）：行数 / 败者留档 / 指纹异常——只读，绝不静默覆盖 */
export async function hubOverview(ctx: SyncPageCtx = {}): Promise<HubOverviewView> {
  const { hub, team_id } = getCtx(ctx);
  const r = await hub.reconcile({ team_id });
  return {
    ok: true,
    mirror_rows: r.items.length,
    losers: r.losers.length,
    integrity_issues: r.missing_local,
    team_id,
  };
}

export interface HubOverviewView {
  ok: boolean;
  mirror_rows: number;
  losers: number;
  integrity_issues: string[];
  team_id: string;
  error?: string;
}
