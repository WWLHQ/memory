// 监控页宿主 Agent 筛选选项（批次48 A25：只由真实账本派生，不内置占位 agent 名）。
// 来源：monitor_alert 审计条目里的 `agent` 字段 + 记忆的 `created_by_agent`（宿主真实清单）；
// 空账本 → 仅「全部」一项，绝不凭空造出 coder-01 / writer-02 / sync-00 之类演示名。
export const ALL_AGENTS_OPTION = 'all';

function pushName(set: Set<string>, raw: unknown): void {
  if (typeof raw !== 'string') return;
  const n = raw.trim();
  if (!n || n === ALL_AGENTS_OPTION) return;
  set.add(n);
}

/**
 * 由真实账本派生宿主 Agent 下拉选项。
 * @param alerts monitor_alert 审计回放出的告警（取 `agent`）
 * @param createdBy 账本记忆的 `created_by_agent`（真实写入来源）
 * 返回稳定排序：`all` 恒在首位，其余按字典序。
 */
export function agentOptionsFromLedger(
  alerts: readonly { agent?: string }[],
  createdBy: readonly (string | undefined)[] = [],
): string[] {
  const names = new Set<string>();
  for (const a of alerts) pushName(names, a.agent);
  for (const c of createdBy) pushName(names, c);
  return [ALL_AGENTS_OPTION, ...[...names].sort((a, b) => a.localeCompare(b))];
}
