// 批次45-A1 单一租户真源：本机规范租户三元组的**缺省值**与**校验**。
// 三个写者（页面 kernel / 采集器·webhook / MCP）共用同一份常量，杜绝「页面造一个、采集器写一个」：
// - 主进程首建 tenant.json 用它（与存量账本 u1/t1/e1 一致 → 45-A2 存量迁移近零）；
// - 页面浏览器降级也用它（不再现造 u_<ulid> 本机身份——那是账本租户混住的根源）；
// - 登录 bindTenant / 桌面壳 syncTenantFromHost 仍会用真实身份覆盖（真源 = home 会话）。
export interface TenantTriple {
  user_id: string;
  team_id: string;
  enterprise_id: string;
}

/** 本机规范缺省三元组。与存量账本硬编码值一致，改动即破坏 45-A2 近零迁移——有测试锁定。 */
export const DEFAULT_TENANT: TenantTriple = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

/** 三字段均为非空字符串才认定合法；多余字段忽略（schema 等元数据共存）。 */
export function normalizeTenantTriple(raw: unknown): TenantTriple | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.user_id !== 'string' || !r.user_id) return null;
  if (typeof r.team_id !== 'string' || !r.team_id) return null;
  if (typeof r.enterprise_id !== 'string' || !r.enterprise_id) return null;
  return { user_id: r.user_id, team_id: r.team_id, enterprise_id: r.enterprise_id };
}
