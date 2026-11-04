// 批次37-D：双库备份的文件配方（纯函数，主进程与单测共用同一真源）。
// 记忆库（L1–L6）、L0 原数据库（密文）、L0 密钥环各自一个文件名前缀 + 同一时间戳，
// 各自按保留份数滚动；历史列表按文件名里的时间戳段排序（三类前缀长度不同，整串排序会让一个库独占榜单）。
// 批次41-A：审计账本（audit.jsonl）也纳进配方——它从记忆库里搬出去之后，「备了记忆库」不再等于「备了审计」。
export type BackupKind = 'ledger' | 'l0' | 'keyring' | 'audit';

/** 备份种类 → 文件名前缀（旧版只有 memories-，因此记忆库前缀保持不变以兼容既有备份） */
export const BACKUP_PREFIX: Record<BackupKind, string> = {
  ledger: 'memories-',
  l0: 'meml0-',
  keyring: 'l0key-',
  audit: 'memaudit-',
};

/** 备份种类 → 落盘扩展名：审计是追加式 JSONL，备出来也必须还是 JSONL（能直接 diff/回放） */
export const BACKUP_EXT: Record<BackupKind, string> = {
  ledger: '.json',
  l0: '.json',
  keyring: '.json',
  audit: '.jsonl',
};

/** 固定顺序：记忆库在前，缺哪个源就少哪个回执 */
export const BACKUP_KINDS: BackupKind[] = ['ledger', 'l0', 'keyring', 'audit'];

export interface BackupSourceFile {
  kind: BackupKind;
  /** 源文件绝对路径 */
  src: string;
  /** 目标文件名（不含目录） */
  name: string;
}

/**
 * 生成一次备份要复制的文件清单：只收真实存在的源。
 * `exists` 由调用方注入（主进程 = fs.existsSync，单测 = 内存集合），本模块不碰文件系统。
 */
export function planBackupFiles(
  ts: string,
  paths: Record<BackupKind, string>,
  exists: (path: string) => boolean,
): { files: BackupSourceFile[]; missing: BackupKind[] } {
  const files: BackupSourceFile[] = [];
  const missing: BackupKind[] = [];
  for (const kind of BACKUP_KINDS) {
    const src = paths[kind];
    if (!exists(src)) { missing.push(kind); continue; }
    files.push({ kind, src, name: `${BACKUP_PREFIX[kind]}${ts}${BACKUP_EXT[kind]}` });
  }
  return { files, missing };
}

/** 从备份文件名认出处：`meml0-2026-11-02T03-00-00-000Z.json` → 'l0'，`memaudit-….jsonl` → 'audit' */
export function kindOfBackupName(name: string): BackupKind | null {
  return BACKUP_KINDS.find((k) => name.startsWith(BACKUP_PREFIX[k]) && name.endsWith(BACKUP_EXT[k])) ?? null;
}

/** 时间戳段（第一个 `-` 之后）：各前缀长度不同，排序必须只用它 */
export function tsOfBackupName(name: string): string {
  const i = name.indexOf('-');
  return i < 0 ? name : name.slice(i + 1);
}

/**
 * 批次41-F：本配方实际产出的备份名——`<前缀><UTC时间戳><扩展名>`，且中间必须是一段
 * 合法时间戳段（`planBackupFiles` 用的 `toISOString().replace(/[:.]/g,'-')` 形态）。
 * 前缀 + 扩展名匹配只说明「长得像我们的备份」；外来目录里恰好同名、中间却不是时间戳的文件
 * （如人工塞进去的 `memories-notes.json`、`meml0-template.json`）判为**非本配方**，滚动删除不碰它。
 */
const RECIPE_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
export function isRecipeBackupName(name: string): boolean {
  const kind = BACKUP_KINDS.find((k) => name.startsWith(BACKUP_PREFIX[k]) && name.endsWith(BACKUP_EXT[k]));
  if (!kind) return false;
  const body = name.slice(BACKUP_PREFIX[kind].length, name.length - BACKUP_EXT[kind].length);
  return RECIPE_TS_RE.test(body);
}

/**
 * 该删的旧备份：同一前缀内按文件名升序（= 时间升序），超出 keep 份数的最旧若干个。
 * 只处理单一前缀，避免记忆库的份数把 L0 库/审计账本的备份挤掉。
 * 批次41-F：删除只针对**已确认是本配方产出**的文件（`isRecipeBackupName`），
 * 前缀匹配本身不再作为删除依据——共享目录里外来的、恰好同前缀的文件不会被删。
 */
export function selectBackupsToDelete(names: readonly string[], prefix: string, keep: number): string[] {
  const kind = BACKUP_KINDS.find((k) => BACKUP_PREFIX[k] === prefix);
  const ext = kind ? BACKUP_EXT[kind] : '.json';
  const same = names
    .filter((n) => n.startsWith(prefix) && n.endsWith(ext) && isRecipeBackupName(n))
    .sort();
  const removeCount = same.length - Math.max(1, keep);
  return removeCount > 0 ? same.slice(0, removeCount) : [];
}

/** 备份目录里的全部已知备份，按时间戳倒序（最近在前） */
export function sortBackupsNewestFirst(names: readonly string[]): string[] {
  return names
    .filter((n) => kindOfBackupName(n) !== null)
    .sort((a, b) => {
      const ta = tsOfBackupName(a);
      const tb = tsOfBackupName(b);
      return ta < tb ? 1 : ta > tb ? -1 : 0;
    });
}
