// 同步与裁决页（批次42-C）数据逻辑：内核 agent.sync 真跑 + §9.7 裁决队列经 HostSyncHub 代理。
// 页面数据真相 = 内核引擎 + 主进程 PgSyncHub；空队列 → 诚实空态，绝不伪造冲突。
// ctx 全部可注入（测试用内存 SyncHub 支撑），缺省 = 真实内核 + 真实代理。
import { getKernel, getKernelStorage, getTenant, type KernelOverrides } from '../kernel.ts';
import { HostSyncHub } from '../shared/syncHub.ts';
import type { MemAgent, Memory, SyncReport } from '../../core/memagent/types.ts';
import type { SyncAudit, SyncConflict } from '../../core/memagent/sync.ts';

/** 页面依赖的中枢最小面（结构化）：内存 SyncHub（同步返回）/ HostSyncHub 代理（异步）双兼容 */
export interface SyncPageHub {
  listConflicts(team_id?: string): Promise<SyncConflict[]> | SyncConflict[];
  resolve(conflict_id: string, winner: 'local' | 'remote'): Promise<void> | void;
  reconcile(scope: { team_id: string }):
    Promise<{ items: Memory[]; losers: Memory[]; missing_local: string[] }> | { items: Memory[]; losers: Memory[]; missing_local: string[] };
  /** 游标与通道状态读取（PgSyncHub / HostSyncHub 均有真实实现） */
  getCursor?(): Promise<number> | number;
  auditCount?(): Promise<number> | number;
  auditsFrom?(start: number, team_id?: string): Promise<SyncAudit[]> | SyncAudit[];
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
  let up: SyncReport | null = null;
  let phase: 'push' | 'pull' = 'push';
  try {
    // project_id 在内核 sync() 中仅用于审计归因，不参与同步过滤（引擎按 team_id 隔离）；
    // 全库同步语义用 '*'，与引擎口径一致（syncUp/syncDown 不看 project_id）。
    up = await agent.sync({ direction: 'push', project_id: '*' });
    phase = 'pull';
    const down: SyncReport = await agent.sync({ direction: 'pull', project_id: '*' });
    return {
      ok: true,
      pushed: up.pushed, pulled: down.pulled, conflicts: up.conflicts,
      dedup: up.dedup ?? 0, behind: up.behind ?? 0, lww: up.lww ?? 0,
      l0_skipped: up.l0_skipped ?? 0, cursor: down.cursor ?? 0, team_id,
    };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return {
      ok: false,
      pushed: up?.pushed ?? 0, pulled: 0,
      conflicts: 0, team_id,
      phase,
      code: err.code ?? 'E_SYNC_FAILED',
      error: String(err.message ?? e).replace(/^\[[A-Z0-9_]+\]\s*/, ''),
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
  /** 失败发生的阶段：push=上行未完成 / pull=上行已完成但下行失败 */
  phase?: 'push' | 'pull';
  /** 内核/主进程错误码（如实展示，不吞） */
  code?: string;
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
  // 本端真实账本规模（内核存储实算；不可读 → null，页面显示「不可读」而不是 0）
  let local_memories: number | null = null;
  let local_audits: number | null = null;
  try {
    const storage = getKernelStorage();
    local_memories = (await storage.listMemories({})).length;
    local_audits = (await storage.queryAudit({})).length;
  } catch {
    local_memories = null;
    local_audits = null;
  }
  return {
    ok: true,
    mirror_rows: r.items.length,
    losers: r.losers.length,
    integrity_issues: r.missing_local,
    local_memories,
    local_audits,
    team_id,
  };
}

export interface HubOverviewView {
  ok: boolean;
  mirror_rows: number;
  losers: number;
  integrity_issues: string[];
  /** 本端内核账本行数（null = 存储不可读） */
  local_memories?: number | null;
  local_audits?: number | null;
  team_id: string;
  error?: string;
}

/** 通道与游标（真实中枢状态）：游标、审计游标、上行/下行最近一次动作；绝不出现演示节点 */
export interface SyncChannelRow {
  channel: string;
  direction: '上行' | '下行' | '—';
  cursor: number | string | null;
  last_at: number | null;
  last_action: string | null;
  status: 'ok' | 'warn' | 'fail' | 'idle' | 'info';
  detail: string;
}

export interface SyncChannelsView {
  ok: boolean;
  node: { name: string; status: 'ok' | 'fail'; detail: string };
  cursor: number | null;
  audit_count: number | null;
  channels: SyncChannelRow[];
  error?: string;
  code?: string;
}

/** 读真实中枢：PgSyncHub 游标/审计；不可达如实返回错误码（浏览器降级 E_NOT_IMPLEMENTED） */
export async function syncChannels(ctx: SyncPageCtx = {}): Promise<SyncChannelsView> {
  const { hub } = getCtx(ctx);
  const node = { name: '本机同步中枢（PgSyncHub）', status: 'ok' as const, detail: '' };
  try {
    const cursor = hub.getCursor ? Number(await hub.getCursor()) : null;
    const count = hub.auditCount ? Number(await hub.auditCount()) : null;
    const audits = hub.auditsFrom && count !== null ? await hub.auditsFrom(Math.max(0, count - 100)) : [];
    const lastUp = [...audits].reverse().find((a) => a.action === 'sync_up');
    const lastDown = [...audits].reverse().find((a) => a.action === 'sync_down');
    const lastFail = [...audits].reverse().find((a) => a.action === 'sync_fail');
    const failNewer = lastFail && (!lastUp || lastFail.ts > lastUp.ts);
    return {
      ok: true,
      node: { ...node, detail: `游标 ${cursor ?? '不可读'} · 中枢审计 ${count ?? '不可读'} 条` },
      cursor,
      audit_count: count,
      channels: [
        {
          channel: '本端 → 中枢（上行）', direction: '上行', cursor: '—',
          last_at: lastUp?.ts ?? null, last_action: lastUp?.action ?? (lastFail?.action ?? null),
          status: failNewer ? 'fail' : lastUp ? 'ok' : 'idle',
          detail: failNewer
            ? `最近一次上行失败：${lastFail?.mem_ids.length ?? 0} 条待重试`
            : lastUp ? `最近上行 ${lastUp.mem_ids.length} 条（sha256 幂等 + 版本）` : '尚无上行审计记录',
        },
        {
          channel: '中枢 → 本端（下行）', direction: '下行', cursor,
          last_at: lastDown?.ts ?? null, last_action: lastDown?.action ?? null,
          status: lastDown ? 'ok' : 'idle',
          detail: lastDown ? `最近下行 ${lastDown.mem_ids.length} 条 · since=游标` : '尚无下行审计记录（since=当前游标）',
        },
        {
          channel: 'L0 密文层', direction: '—', cursor: '—', last_at: null, last_action: null,
          status: 'info', detail: '内核同步引擎强制排除（42-A 红线）；条数不在未解锁页展示',
        },
      ],
    };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const code = err.code ?? 'E_SYNC_HUB_UNREACHABLE';
    // 内核错误 message 往往自带 [CODE] 前缀；去掉重复，页面统一用 [CODE] 再拼一次
    const msg = String(err.message ?? e).replace(/^\[[A-Z0-9_]+\]\s*/, '');
    const detail = `${code}：${msg}`;
    return {
      ok: false,
      node: { ...node, status: 'fail', detail },
      cursor: null,
      audit_count: null,
      channels: [
        { channel: '本端 → 中枢（上行）', direction: '上行', cursor: '—', last_at: null, last_action: null, status: 'fail', detail },
        { channel: '中枢 → 本端（下行）', direction: '下行', cursor: null, last_at: null, last_action: null, status: 'fail', detail },
        { channel: 'L0 密文层', direction: '—', cursor: '—', last_at: null, last_action: null, status: 'info', detail: '内核同步引擎强制排除（42-A 红线）' },
      ],
      error: msg,
      code,
    };
  }
}
