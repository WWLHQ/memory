// 批次45-A1 单一租户真源：数据根级 tenant.json（0600），类比 dataRoot 指针 / mcp-token.txt 的启动期指针文件。
// 职责单一：把「本机规范租户三元组」裁决收敛到这一个文件——采集器 / webhook / MCP 引导账户都读它，不再写死。
// 语义：
// - 文件不存在 → 首建并写规范缺省三元组（DEFAULT_TENANT = u1/t1/e1，与存量账本一致，45-A2 迁移近零）；
// - 文件存在且合法 → 原样返回（复用，不改写）；
// - 文件损坏 / 字段缺失 → **fail-fast 抛错阻断启动**（与 mcp-tokens.json 同口径）：
//   身份是账本归属的根，静默重造会让同一份账本再次混住多租户——宁可让用户人工修复。
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TENANT, normalizeTenantTriple, type TenantTriple } from '../shared/tenantDefaults.ts';

export const TENANT_FILE_NAME = 'tenant.json';
/** 文件自述版本（供未来迁移识别；读取时对未知 schema 保持宽容，只校验三元组字段） */
export const TENANT_SCHEMA = 'tenant/1';

/** 读取（或首建）数据根级租户真源；损坏 fail-fast，绝不静默回落重造身份。 */
export function loadOrCreateTenant(dataRoot: string): TenantTriple {
  const file = join(dataRoot, TENANT_FILE_NAME);
  mkdirSync(dataRoot, { recursive: true });
  if (existsSync(file)) {
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      throw new Error(`租户真源不可读 ${file}: ${String((e as Error)?.message ?? e)}——请人工修复，启动不静默重造身份`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`租户真源损坏（非 JSON）${file}——请人工修复或删除该文件后重启（将重建规范缺省身份），绝不静默重造`);
    }
    const t = normalizeTenantTriple(parsed);
    if (!t) {
      throw new Error(`租户真源损坏（user_id/team_id/enterprise_id 任一字段缺失或非字符串）${file}——请人工修复，绝不静默重造`);
    }
    return t;
  }
  // 首建：规范缺省三元组（与存量账本 u1/t1/e1 一致）
  writeFileSync(file, `${JSON.stringify({ schema: TENANT_SCHEMA, ...DEFAULT_TENANT }, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows 下尽力而为，失败不阻断 */ }
  return { ...DEFAULT_TENANT };
}
