// 日志记录页（REQ-011 / P15）种子数据
// 覆盖：全动作枚举 + error 各分类 + 跨端样本 + 无 request_id 样本（R-LOG2 演示）。
import type { LogEntry } from './types.ts';

export const SEED_LOGS: LogEntry[] = [
  { ts: '2026-10-10T11:50:10Z', level: 'error', form: 'desktop', action: 'conflict_resolve', request_id: 'req_l10', message: '冲突自动裁决失败，转人工', extra: { conflict: 'mem_020 vs mem_021', kind: '冲突挂起' } },
  { ts: '2026-10-10T11:42:00Z', level: 'error', form: 'web', action: 'sync_fail', request_id: 'req_l09', message: '同步失败：对账不一致', extra: { reason: 'hash mismatch', kind: '同步失败' } },
  { ts: '2026-10-10T11:30:00Z', level: 'error', form: 'desktop', action: 'recall', request_id: 'req_l08', message: '主通道连续失败≥5，熔断 OPEN', extra: { agent: 'coder-01', kind: '熔断 OPEN' } },
  { ts: '2026-10-10T11:20:00Z', level: 'warn', form: 'mac', action: 'llm_fallback', request_id: 'req_l07', message: '反代理额度超限，已回退', extra: { quota: '20/20', kind: '额度超限' } },
  { ts: '2026-10-10T11:12:32Z', level: 'info', form: 'desktop', action: 'recall', request_id: 'req_l01', message: '召回命中 3 条（mode=事实优先）', extra: { hits: 3, payload: 1240 } },
  { ts: '2026-10-10T11:10:05Z', level: 'info', form: 'desktop', action: 'write', request_id: 'req_l02', message: '写入 mem_070（L3）', extra: { tokens: 210 } },
  { ts: '2026-10-10T11:05:00Z', level: 'info', form: 'web', action: 'sync_down', request_id: 'req_l03', message: 'web 端拉取增量 12 条', extra: { count: 12 } },
  { ts: '2026-10-10T10:58:00Z', level: 'info', form: 'web', action: 'sync_up', request_id: 'req_l04', message: 'web 端上传变更 3 条' },
  { ts: '2026-10-10T10:55:41Z', level: 'info', form: 'cli', action: 'login', request_id: 'req_l05', message: 'CLI 登录成功（系统密钥）' },
  { ts: '2026-10-10T10:50:00Z', level: 'info', form: 'desktop', action: 'team_assign', request_id: 'req_l06', message: 'user_002 分配至 team_001' },
  { ts: '2026-10-10T10:45:00Z', level: 'info', form: 'desktop', action: 'gc', request_id: 'req_l11', message: 'GC 归档 4 条冷记忆' },
  { ts: '2026-10-10T10:40:00Z', level: 'info', form: 'desktop', action: 'l0_view', request_id: 'req_l12', message: '管理员查阅 L0（已记审计）', extra: { memory_id: 'mem_005' } },
  { ts: '2026-10-10T10:35:00Z', level: 'warn', form: 'desktop', action: 'rerank_fallback', request_id: 'req_l13', message: '重排失败，回退第二层' },
  { ts: '2026-10-10T10:30:00Z', level: 'info', form: 'mobile', action: 'recall', request_id: 'req_l14', message: '移动端召回 1 条' },
  // 无 request_id 样本（R-LOG2：前端补 n/a + 告警）
  { ts: '2026-10-10T10:20:00Z', level: 'warn', form: 'linux', action: 'auto_bind', request_id: '', message: 'Agent 自动绑定（日志缺审计链，严重 bug 演示）' },
];

export const ACTION_LABEL: Record<string, string> = {
  recall: '召回', write: '写入', gc: '清理归档', auto_bind: 'Agent绑定', unbound: '解绑',
  sync_up: '同步上行', sync_down: '同步下行', sync_fail: '同步失败', sync_reconcile: '对账',
  conflict_resolve: '冲突裁决', llm_proxy: 'LLM代理', llm_fallback: 'LLM回退',
  l0_view: 'L0查阅', l0_auth_fail: 'L0授权失败', login: '登录', team_assign: '团队分配',
  mode_dispatch: '模式分流', rerank_fallback: '重排回退', audit_delete: '审计删除',
};

export const FORM_LABEL: Record<string, string> = {
  desktop: '桌面', web: 'Web', mobile: '移动', mac: 'macOS', linux: 'Linux', cli: 'CLI',
};
