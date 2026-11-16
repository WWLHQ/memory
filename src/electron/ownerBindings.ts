// 个人记忆账号绑定真源（OB-1）：数据根级 personal-owner-bindings.json（0600），与 tenant.json 同级同规格。
// 职责单一：把「登录账号 → 内核用户标识」的显式绑定从启动期环境变量（MAM_PERSONAL_OWNER_BINDINGS）收敛到本机文件，
// 管理员可在安全页 UI 维护；env 仍保留为最高优先覆盖（现网语义不变，文件是缺省真源）。
// 语义：
// - 文件不存在 → 返回空表（「未配置」是合法常态；fail-closed：无绑定 = 个人条目仅本机可见，agent 不召回）；
// - 文件存在但损坏 → **抛错**（绑定是身份归属语义，坏数据绝不静默忽略——bootstrap 会打 error 日志并保持空表）；
// - 写口：校验（复用 parsePersonalOwnerBindings 的单项校验 + 新增账号/目标重复拒绝）→ 备份原文件（备份失败即不写）
//   → 临时文件 + rename 原子写 + 0600 → 返回新旧值。
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parsePersonalOwnerBindings, type PersonalOwnerBinding } from '../core/memagent/personalStore.ts';

export const OWNER_BINDINGS_FILE_NAME = 'personal-owner-bindings.json';
/** 文件自述版本（供未来迁移识别；读取时未知 schema 直接拒绝，不猜） */
export const OWNER_BINDINGS_SCHEMA = 'owner-bindings/1';

/**
 * 读取数据根级绑定真源（不首建）：文件缺失 → []（合法常态）；
 * 存在但非 JSON / schema 未知 / 任一项缺 account 或 kernel_user_id → 抛错（fail-closed，绝不静默忽略绑定）。
 * 兼容两种形态：裸数组（历史/手写）与 { schema, bindings } 包装文档（本模块写出的规范形态）。
 */
export function loadOwnerBindings(dataRoot: string): PersonalOwnerBinding[] {
  const file = join(dataRoot, OWNER_BINDINGS_FILE_NAME);
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`个人记忆账号绑定文件不可读 ${file}: ${String((e as Error)?.message ?? e)}——请人工修复，启动不静默忽略绑定`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`个人记忆账号绑定文件损坏（非 JSON）${file}——请人工修复或删除该文件（删除后按「未配置」处理），绝不静默猜映射`);
  }
  let list: unknown = parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const doc = parsed as { schema?: unknown; bindings?: unknown };
    if (doc.schema !== undefined && doc.schema !== OWNER_BINDINGS_SCHEMA) {
      throw new Error(`个人记忆账号绑定文件 schema 未知（${String(doc.schema)}）${file}——请人工核对版本后修复`);
    }
    list = doc.bindings;
  }
  if (!Array.isArray(list)) {
    throw new Error(`个人记忆账号绑定文件损坏（应为数组或 { schema, bindings } 文档）${file}——请人工修复`);
  }
  // 单项校验复用 env 解析器（同一套口径：每项必须含非空 account 与 kernel_user_id）
  return parsePersonalOwnerBindings(JSON.stringify(list));
}

/** 校验（不落盘）：复用 parsePersonalOwnerBindings + 新增重复拒绝——同账号重复（歧义）与同目标重复（并号）都拒绝。 */
export function normalizeOwnerBindingsInput(next: unknown): PersonalOwnerBinding[] {
  const list = parsePersonalOwnerBindings(JSON.stringify(next ?? null));
  const seenAccount = new Set<string>();
  const seenKernel = new Set<string>();
  for (const b of list) {
    if (seenAccount.has(b.account)) {
      throw new Error(`绑定列表里登录账号「${b.account}」出现多次——同一账号只能有一条绑定`);
    }
    if (seenKernel.has(b.kernel_user_id)) {
      throw new Error(`绑定列表里内核用户标识「${b.kernel_user_id}」出现多次——多个账号绑到同一目标会把个人记忆并号，禁止`);
    }
    seenAccount.add(b.account);
    seenKernel.add(b.kernel_user_id);
  }
  return list;
}

export interface WriteOwnerBindingsResult {
  prev: PersonalOwnerBinding[];
  next: PersonalOwnerBinding[];
  /** 写前备份文件路径（备份成功才允许写，回执供审计与回滚定位） */
  backupFile: string;
}

/**
 * 管理员写口（OB-1）：校验 → 备份原文件（只备本文件，备份失败即不写）→ 临时文件 + rename 原子写 + 0600 → 返回新旧值。
 * 备份目录取数据根 backups/owner-bindings/。文件不存在（首次配置）时 prev=[]，无旧文件可备份、直接原子写。
 * 内核用户标识的机器级归属校验（必须等于 tenant.json 的 user_id）在 main.ts handler 里做——那里才有 tenantTriple。
 */
export function writeOwnerBindings(dataRoot: string, next: unknown): WriteOwnerBindingsResult {
  const bindings = normalizeOwnerBindingsInput(next);
  const file = join(dataRoot, OWNER_BINDINGS_FILE_NAME);
  const prev = loadOwnerBindings(dataRoot);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  let backupFile = '';
  if (existsSync(file)) {
    // 写前备份：失败直接抛错，绝不无备份动绑定文件
    const backupDir = join(dataRoot, 'backups', 'owner-bindings');
    mkdirSync(backupDir, { recursive: true });
    backupFile = join(backupDir, `owner-bindings.json.bak-${ts}`);
    copyFileSync(file, backupFile);
  }
  // 原子写：临时文件落盘后 rename 覆盖，避免写一半留下损坏的半份绑定
  const tmp = `${file}.tmp-${ts}`;
  writeFileSync(tmp, `${JSON.stringify({ schema: OWNER_BINDINGS_SCHEMA, bindings }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* Windows 下尽力而为，失败不阻断 */ }
  return { prev, next: bindings, backupFile };
}
