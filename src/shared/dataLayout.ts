// 数据根内的子目录归类布局（2026-11-18 用户约定「每个数据及配置按实际情况分文件夹归类」）。
//
// 设计原则：
//  1. 单一真源：子目录名与「逻辑文件名 → 子目录」映射都在这里定义，main.ts / 各模块共用同一份。
//  2. 纯文件：只拼路径，不碰 fs，electron 主进程与外部 node 钩子都能 import（esbuild 会内联）。
//  3. 两库与审计不在此列：它们的位置由 dataRoot.ts 的指针 ledgerDir/l0Dir 决定（向导所选），
//     归类通过「向导默认目录指向 data 子目录」实现；audit.jsonl 按既有铁律跟记忆库同目录
//     （合规账本与正文绑定，搬库时不拆证），因此随 ledgerDir 一起落 data。
//
// Electron 自管的 Chromium 目录（Cache / Code Cache / Local Storage / GPUCache…）由
// app.setPath('userData', root) 决定，仍直接落 root 根——那是浏览器引擎写的，不是应用数据。
//
// ⚠️ 目录名禁忌（2026-11-18 实测，代价是连续 7 次启动清库）：
// `databases` 是 Chromium 用户配置目录的保留名。因为 app.setPath('userData', root) 让数据根
// 同时就是 Chromium 的 userData，一旦我们的库放进 <root>/databases，Chromium 启动时会把它
// 当自己的 WebSQL 目录**整目录递归删除**——C++ 层行为，Node 的 fs 探针（unlink/rename/rm）
// 完全抓不到，业务代码里也找不到任何调用点。判别实验：同样内容放 <root>/libs 存活，
// 放 <root>/databases 连哨兵文件一起消失（与内容无关，只与名字有关）。
// 因此两库目录改名为 `data`；禁止再改回或使用其它 Chromium 保留名（见 __tests__ 里的断言）。
import { join, normalize } from 'node:path';

export const DATA_SUBDIRS = {
  /** 两库 + 密钥环 + 审计（向导默认库目录指向这里）。名字不能叫 databases：那是 Chromium 保留名 */
  data: 'data',
  /** 配置类 json */
  config: 'config',
  /** 密钥与身份（均 0600 敏感文件） */
  keys: 'keys',
  /** 账号与登录审计（home-* 同目录，home/server.ts 依赖 dirname(auditFile) 推导） */
  accounts: 'accounts',
  /** 日志与召回执行状态 */
  logs: 'logs',
  /** 导出与中转 */
  exports: 'exports',
  /** 备份（沿用历史名字，不改以免旧备份历史断链） */
  backups: 'backups',
} as const;

export type DataSubdir = keyof typeof DATA_SUBDIRS;

/** 逻辑文件名 → 归类子目录。两库/密钥环/审计不在这里（跟随指针库目录）。 */
const FILE_PLACEMENT: Record<string, DataSubdir> = {
  // 配置
  'collector-cursor.json': 'config',
  'backup-config.json': 'config',
  'llm-config.json': 'config',
  'recall-hard-config.json': 'config',
  'agent-onboard.json': 'config',
  'chat-exports.json': 'config',
  'webchat-ingest.json': 'config',
  'webchat-export-status.json': 'config',
  'refine-queue.json': 'config',
  // 密钥与身份
  'mcp-token.txt': 'keys',
  'mcp-tokens.json': 'keys',
  'llm-keys.json': 'keys',
  'llm-billing-keys.json': 'keys',
  'llm-deepseek-key.txt': 'keys',
  'tenant.json': 'keys',
  'members.json': 'keys',
  'personal-owner-bindings.json': 'keys',
  // 账号与登录审计（home-mirror.key 必须与 home-audit.json 同目录：mirrorLedger 用 dirname(auditFile)）
  'home-accounts.json': 'accounts',
  'home-locks.json': 'accounts',
  'home-audit.json': 'accounts',
  'home-mirror.json': 'accounts',
  'home-policy.json': 'accounts',
  'home-mirror.key': 'accounts',
  // 日志与召回状态
  'main.log': 'logs',
  'actions.log': 'logs',
  'float.log': 'logs',
  'recall-hook-status.json': 'logs',
  'recall-hook-log.jsonl': 'logs',
  // 个人记忆库（独立文件，归 data，但位置在 main.ts 单独拼）
  'personal-memory.db.json': 'data',
};

/** 历史子目录名（2026-11-18 前的档2 布局）：启动时由 dataRoot.ts 自动搬到 `data`。 */
export const LEGACY_LIBRARY_SUBDIR = 'databases';

/** Chromium 用户配置目录的保留名：库目录绝不能落在这些名字上（否则启动即被引擎删除） */
const CHROMIUM_RESERVED_SUBDIRS = ['databases', 'Cache', 'Code Cache', 'Local Storage', 'Network', 'Session Storage'];

/** 该子目录名是否撞了 Chromium 保留名（测试与启动自检共用同一份判据） */
export function isChromiumReservedSubdir(name: string): boolean {
  return CHROMIUM_RESERVED_SUBDIRS.some((n) => n.toLowerCase() === String(name).toLowerCase());
}

/**
 * 逻辑目录名 → 归类子目录。backups / sync-hub / recall-hard / webchat-extension 等
 * 目录名本身就是落点（root/backups），不在此映射，classifiedDir 原样返回 root/<dir>。
 */
const DIR_PLACEMENT: Record<string, DataSubdir> = {
  'memories-export': 'exports',
  'webchat-verify': 'exports',
};

export function subdirForFile(fileName: string): DataSubdir | null {
  return FILE_PLACEMENT[fileName] ?? null;
}

export function subdirForDir(dirName: string): DataSubdir | null {
  return DIR_PLACEMENT[dirName] ?? null;
}

/** 归类后的目标路径：root/<子目录>/<文件名>；未列出的文件留在 root（后方兼容面）。 */
export function classifiedPath(root: string, fileName: string): string {
  const sub = subdirForFile(fileName);
  return sub ? join(normalize(root), DATA_SUBDIRS[sub], fileName) : join(normalize(root), fileName);
}

/** 归类后的目录路径 */
export function classifiedDir(root: string, dirName: string): string {
  const sub = subdirForDir(dirName);
  return sub ? join(normalize(root), DATA_SUBDIRS[sub], dirName) : join(normalize(root), dirName);
}

/** 两库默认目录（向导所选库的归类落点）：root/data */
export function libraryDir(root: string): string {
  return join(normalize(root), DATA_SUBDIRS.data);
}
