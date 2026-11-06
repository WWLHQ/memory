// 批次44-A：独立采集守护（headless）——daemon 只做「扫描 + 指纹去重 + 暂存分片」，**永不碰账本**。
// 44-B 双写者风险由架构消解（比原方案「建议性写锁竞争调优」更干净）：
//   · 单写者 = 桌面端（持 L0 写密钥，coreWrite 完整入库）；
//   · daemon 是只读侦察兵：scanSessionLogs 纯 fs 读（引擎原注释「不写库」口径复用），
//     新消息写进自己的 pending 分片文件（只创建新文件、永不修改已有文件 → 与桌面端零竞争）；
//   · 交接 = drainCollectPending：桌面端逐条 coreWrite（dedup 幂等兜底重复），**全文件成功才删除**——
//     崩溃窗口只可能重复写（幂等兜底），不可能丢消息（文件保留待重试）。
// L0 硬约束（方案未覆盖处，实施拍板）：daemon 无 L0 写密钥（DEK 在桌面端 L0Vault），无法 seal 原文
// → daemon 不写账本（含 L0）是唯一诚实形态；「只写 L1 不写 L0」会造成行不完整，违反重建链路。
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from './ulid.ts';
import {
  scanSessionLogs,
  type CollectedItem, type CollectorCursor, type ScanOptions,
} from './sessionCollector.ts';

export const DAEMON_DIR_NAME = 'collect-daemon';
export const PENDING_DIR_NAME = 'pending';
const STATE_FILE = 'state.json';
const SEEN_CAP = 5000; // 指纹上限（与桌面端游标文件同口径，防文件无限膨胀）

export interface DaemonState {
  cursor: CollectorCursor;
  seen: string[];
}

export interface DaemonRoundReport {
  scanned: number;          // scanSessionLogs 本轮采到（未滤 daemon 指纹）
  deduped: number;          // daemon 指纹命中（此前已暂存过）
  newItems: number;         // 真正新暂存的
  pendingFile: string | null; // 本轮分片（0 条时不产文件）
  cursorAdvanced: boolean;
  skipped: string[];
}

async function loadState(stateDir: string): Promise<DaemonState> {
  try {
    const raw = JSON.parse(await readFile(join(stateDir, STATE_FILE), 'utf8')) as {
      cursor?: CollectorCursor; seen?: unknown;
    };
    return {
      cursor: raw.cursor ?? {},
      seen: Array.isArray(raw.seen) ? raw.seen.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { cursor: {}, seen: [] }; // 状态缺失/损坏 → 从头扫（消息靠指纹与桌面端 dedup 兜底，不丢）
  }
}

async function saveState(stateDir: string, s: DaemonState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, STATE_FILE),
    JSON.stringify({ cursor: s.cursor, seen: s.seen.slice(-SEEN_CAP), updatedAt: new Date().toISOString() }),
    'utf8',
  );
}

/**
 * daemon 一轮采集：扫描（增量游标）→ daemon 指纹去重 → 新消息写 pending 分片。
 * 分片文件名 `<UTC时间戳>-<ulid>.json`；daemon 只创建新文件，永不修改/删除已有分片
 * （分片删除权只在桌面端 drain——写成功后删，竞争消解）。
 */
export async function runDaemonRound(opts: {
  stateDir: string;
  scan: Omit<ScanOptions, 'cursor' | 'seenHashes'> & { sources: ScanOptions['sources'] };
  now?: number;
}): Promise<DaemonRoundReport> {
  const { stateDir, scan, now = Date.now() } = opts;
  const state = await loadState(stateDir);
  // 扫描前快照指纹：scanSessionLogs 会把本轮 items 的 hash 写进传入的 seenHashes 集合
  //（引擎口径：失败回滚用），fresh 判定必须以扫描前的集合为准，否则全部误判已见。
  const seenBefore = new Set(state.seen);
  const seen = new Set(state.seen);
  const result = await scanSessionLogs({ ...scan, cursor: state.cursor, seenHashes: seen });
  const fresh = result.items.filter((it) => !seenBefore.has(it.hash));
  const report: DaemonRoundReport = {
    scanned: result.collected,
    deduped: result.collected - fresh.length,
    newItems: fresh.length,
    pendingFile: null,
    cursorAdvanced: false,
    skipped: result.skipped,
  };
  if (fresh.length > 0) {
    const pendingDir = join(stateDir, PENDING_DIR_NAME);
    await mkdir(pendingDir, { recursive: true });
    const file = join(pendingDir, `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${ulid()}.json`);
    await writeFile(file, JSON.stringify({ ts: now, items: fresh }, null, 0), 'utf8');
    report.pendingFile = file;
    for (const it of fresh) seen.add(it.hash);
    report.cursorAdvanced = true;
  }
  // 游标推进：本轮 scan 的 cursors 是相对本轮起点的最新状态；即使无新消息也推进（文件游标已消费）
  state.cursor = result.cursors;
  state.seen = [...seen].slice(-SEEN_CAP);
  await saveState(stateDir, state);
  return report;
}

export interface DrainReport {
  files: number;          // 扫到的分片数
  written: number;        // 成功写入的条目数（含 dedup 幂等命中——write 回调自行计数）
  failedFiles: string[];  // 未全成功而保留待重试的分片
  errors: string[];
}

/**
 * 桌面端交接：读 pending 分片 → 逐条 write（coreWrite，dedup 幂等兜底）→ **全部成功才删整个文件**。
 * 部分失败：保留整个分片（下轮重写全部条目——重复写入由 dedup 幂等兜底，绝不丢消息）。
 * 删除是唯一的分片变更操作，且只在桌面端（持有账本写锁的进程）发生——与 daemon 的
 * 「只创建新文件」原则合起来保证任一时刻只有一个进程碰某个具体分片文件。
 */
export async function drainCollectPending(opts: {
  pendingDir: string;
  write: (item: CollectedItem) => Promise<void>;
}): Promise<DrainReport> {
  const report: DrainReport = { files: 0, written: 0, failedFiles: [], errors: [] };
  if (!existsSync(opts.pendingDir)) return report;
  let files: string[];
  try {
    files = (await readdir(opts.pendingDir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return report;
  }
  for (const f of files) {
    const path = join(opts.pendingDir, f);
    report.files++;
    let items: CollectedItem[];
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { items?: unknown };
      items = Array.isArray(parsed.items) ? (parsed.items as CollectedItem[]) : [];
    } catch (e) {
      // 损坏分片：如实记错并保留（daemon 可能正在写半截——留待下一轮完整重读）
      report.failedFiles.push(f);
      report.errors.push(`${f}: ${String((e as Error)?.message ?? e)}`);
      continue;
    }
    let allOk = true;
    for (const it of items) {
      try {
        await opts.write(it);
        report.written++;
      } catch (e) {
        allOk = false;
        report.errors.push(`${f}[${it.hash?.slice(0, 8) ?? '?'}]: ${String((e as Error)?.message ?? e)}`);
      }
    }
    if (allOk && items.length > 0) {
      try { await rm(path); } catch (e) {
        allOk = false;
        report.errors.push(`${f}: 删除失败 ${String((e as Error)?.message ?? e)}`);
      }
    }
    if (!allOk) report.failedFiles.push(f);
  }
  return report;
}
