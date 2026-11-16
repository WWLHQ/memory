// 批次45-A1 单一租户真源：数据根级 tenant.json（0600），类比 dataRoot 指针 / mcp-token.txt 的启动期指针文件。
// 职责单一：把「本机规范租户三元组」裁决收敛到这一个文件——采集器 / webhook / MCP 引导账户都读它，不再写死。
// 语义：
// - 文件不存在 → 首建并写规范缺省三元组（DEFAULT_TENANT = u1/t1/e1，与存量账本一致，45-A2 迁移近零）；
// - 文件存在且合法 → 原样返回（复用，不改写）；
// - 文件损坏 / 字段缺失 → **fail-fast 抛错阻断启动**（与 mcp-tokens.json 同口径）：
//   身份是账本归属的根，静默重造会让同一份账本再次混住多租户——宁可让用户人工修复。
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, copyFileSync, renameSync } from 'node:fs';
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
    return parseTenantFile(file);
  }
  // 首建：规范缺省三元组（与存量账本 u1/t1/e1 一致）
  writeFileSync(file, `${JSON.stringify({ schema: TENANT_SCHEMA, ...DEFAULT_TENANT }, null, 2)}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows 下尽力而为，失败不阻断 */ }
  return { ...DEFAULT_TENANT };
}

/** 解析单个 tenant.json：非 JSON / 字段缺失均 fail-fast（身份损坏宁可让用户人工修复，绝不静默重造）。 */
function parseTenantFile(file: string): TenantTriple {
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

/** 机器级 tenant.json 只读口（tenant:read 专用，不首建）：不存在返回 null；存在但损坏抛错（同口径 fail-fast）。 */
export function readTenantFile(dataRoot: string): TenantTriple | null {
  const file = join(dataRoot, TENANT_FILE_NAME);
  if (!existsSync(file)) return null;
  return parseTenantFile(file);
}

export interface WriteTenantResult {
  prev: TenantTriple;
  next: TenantTriple;
  /** 写前备份文件路径（备份成功才允许写，回执供审计与回滚定位） */
  backupFile: string;
}

/**
 * 管理员写口（T2，规格 §6.1）：校验三元组 → 备份原文件（复用 backupBeforeKernelChange 的
 * 「备份失败即不写」口径，但只备 tenant.json 本身——账本四源与本写口无关，不重复备份）
 * → 临时文件 + rename 原子写 + 0600 → 返回新旧值。备份目录取数据根 backups/tenant/（gitignored 之外，与既有 backups/ 同级管理）。
 */
export function writeTenant(dataRoot: string, next: unknown): WriteTenantResult {
  const triple = normalizeTenantTriple(next);
  if (!triple) {
    throw new Error('三元组不合法：user_id / team_id / enterprise_id 均须为非空字符串');
  }
  const file = join(dataRoot, TENANT_FILE_NAME);
  const prev = readTenantFile(dataRoot);
  if (!prev) {
    throw new Error('tenant.json 不存在，无法安全改写（请重启应用让其按规范首建后再改）');
  }
  // 写前备份：失败直接抛错，绝不无备份动身份文件
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(dataRoot, 'backups', 'tenant');
  mkdirSync(backupDir, { recursive: true });
  const backupFile = join(backupDir, `tenant.json.bak-${ts}`);
  copyFileSync(file, backupFile);
  // 原子写：临时文件落盘后 rename 覆盖，避免写一半留下损坏的半份身份
  const tmp = `${file}.tmp-${ts}`;
  writeFileSync(tmp, `${JSON.stringify({ schema: TENANT_SCHEMA, ...triple }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* Windows 下尽力而为，失败不阻断 */ }
  return { prev, next: triple, backupFile };
}
