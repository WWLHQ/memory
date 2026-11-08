// 审计日志页（REQ-006 / P11）纯逻辑层
// 全部为纯函数，便于单测覆盖（T2 验收）。
import type { AuditAction, AuditEntry, AuditFilter } from './types.ts';

/** 审计动作中文可读名（4.3 枚举可读化） */
export const ACTION_LABEL: Record<AuditAction, string> = {
  recall: '召回',
  write: '写入',
  verify: '核验',
  dispute: '争议',
  archive: '归档',
  ban: '封禁',
  merge: '合并',
  recall_skip: '召回跳过',
  recall_breach: '召回超支',
  rerank_on: '重排开启',
  rerank_fallback: '重排回退',
  cold_recall: '冷召回',
  mode_dispatch: '模式分流',
  mode_fallback: '模式兜底',
  evidence_thin: '证据不足',
  graft: '层级嫁接',
  memory_op: '记忆操作',
  l0_view: 'L0 查阅',
  l0_auth_fail: 'L0 授权失败',
  l0_auth_request: 'L0 授权申请',
  l0_auth_grant: 'L0 授权发放',
  l0_auth_deny: 'L0 授权拒绝',
  l0_auth_revoke: 'L0 授权撤销',
  l0_auth_expire: 'L0 授权过期',
  security_change: '安全变更',
  agent_onboard: 'Agent 接入',
  agent_test: 'Agent 连通测试',
  agent_rotate: 'Agent 密钥轮换',
  agent_revoke: 'Agent 密钥吊销',
  auto_bind: 'Agent 自动绑定',
  unbound: 'Agent 撤销绑定',
};

export function actionLabel(a: AuditAction): string {
  return ACTION_LABEL[a] ?? a;
}

/** D4 深链支持的过滤字段（未列出的维度不解析，避免把未知参数当筛选） */
const INITIAL_FILTER_KEYS = ['enterprise_id', 'user_id', 'ip_address', 'device_info', 'request_id', 'agent', 'from', 'to'] as const;

/** D4：从 `?user_id=xxx&request_id=yyy&from=...` 解析审计页初始过滤 */
export function initialAuditFilter(search: string): AuditFilter {
  const p = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const k of INITIAL_FILTER_KEYS) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out as AuditFilter;
}

/** D4：从 `?chain=<request_id>` 直接进入 request_id 链路视图 */
export function initialAuditChain(search: string): string | null {
  const v = new URLSearchParams(search).get('chain')?.trim();
  return v || null;
}

/** 过滤（§P11 过滤栏各维，全部 AND） */
export function filterEntries(list: AuditEntry[], f: AuditFilter): AuditEntry[] {
  return list.filter((e) => {
    if (f.enterprise_id && e.enterprise_id !== f.enterprise_id) return false;
    if (f.user_id && e.user_id !== f.user_id) return false;
    if (f.ip_address && e.ip_address !== f.ip_address) return false;
    if (f.device_info && !e.device_info.includes(f.device_info)) return false;
    if (f.action && e.action !== f.action) return false;
    if (f.request_id && e.request_id !== f.request_id) return false;
    if (f.agent && (e.agent ?? '') !== f.agent) return false;
    if (f.from && e.created_at < localInputToIso(f.from)) return false;
    if (f.to && e.created_at > localInputToIso(f.to)) return false;
    return true;
  });
}

/** datetime-local（本地时间）→ ISO；解析失败则不参与过滤（不静默改变结果） */
export function localInputToIso(v: string): string {
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : new Date(t).toISOString();
}

/** 链路追踪（18.2-E）：同一 request_id 全部行，按时间升序 */
export function chainByRequest(list: AuditEntry[], requestId: string): AuditEntry[] {
  return list
    .filter((e) => e.request_id === requestId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 导出 CSV（4.3 全量字段） */
export function exportCsv(list: AuditEntry[]): string {
  const headers = [
    'created_at', 'action', 'resource_type', 'resource_id', 'old_status', 'new_status',
    'old_id', 'new_id', 'evidence_thin', 'request_id', 'payload_tokens',
    'pipeline_llm_tokens', 'enterprise_id', 'user_id', 'ip_address', 'device_info',
    'agent', 'result', 'source', 'duration_ms', 'note',
  ];
  const rows = list.map((e) =>
    headers.map((h) => csvCell((e as unknown as Record<string, unknown>)[h])).join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}

/** 导出 JSON */
export function exportJson(list: AuditEntry[]): string {
  return JSON.stringify(list, null, 2);
}

export interface ChainStage {
  key: 'kernel' | 'rid' | 'quality' | 'mirror' | 'disk';
  label: string;
  value: string;
  /** 是否有真实证据；false 时页面只显示「—」，不补造节点 */
  evidence: boolean;
}

/**
 * 链路视图 5 段（18.2-E）：只连真实存在的事件。
 * 段位不补造——查不到对应动作/字段时 evidence=false，页面显示「—」。
 */
export function chainStages(rows: AuditEntry[]): ChainStage[] {
  const first = rows[0];
  const quality = rows.filter((e) => e.action === 'graft' || e.action === 'merge');
  const mirror = rows.filter((e) => (e.source ?? '').includes('mirror') || (e.action as string) === 'mirror');
  const clock = (iso?: string) => (iso && iso.length >= 19 ? iso.slice(11, 19) : '—');
  return [
    {
      key: 'kernel', label: '① 内核调用',
      value: first ? `${clock(first.created_at)} · ${first.action} · ${first.resource_type}/${first.resource_id}` : '—',
      evidence: !!first,
    },
    {
      key: 'rid', label: '② request_id 签发',
      value: first?.request_id || '—',
      evidence: !!first?.request_id,
    },
    {
      key: 'quality', label: '③ qualityGate / 去重',
      value: quality.length ? `${quality.length} 行 graft/merge 真实事件` : '—',
      evidence: quality.length > 0,
    },
    {
      key: 'mirror', label: '④ mirror 审计上抛',
      value: mirror.length ? `${mirror.length} 行 source=mirror` : '—',
      evidence: mirror.length > 0,
    },
    {
      key: 'disk', label: '⑤ 落盘（append-only）',
      value: rows.length ? `已落盘 ${rows.length} 行` : '—',
      evidence: rows.length > 0,
    },
  ];
}
