// 客户端软件运行态探测（T6）：按真实进程可执行文件名判断客户端是否在运行。
// 只收录能确认真实 exe 名的客户端（含桌面版 Claude Code / Codex）；Gemini CLI / Qwen 暂无可信桌面进程 → 不收录。
import { execSync } from 'node:child_process';

/** 客户端 id → 具体进程可执行文件名（小写比较）。未列出的客户端不判运行态。
 *  deepseek harness 随宿主 Qoder 运行 → 与 qoder-cn 同一进程。 */
export const CLIENT_PROCESS_NAMES: Record<string, readonly string[]> = {
  // 2026-11-28 实测纠错：真实可执行文件名与旧白名单不符（本机 tasklist 为 "Qoder CN.exe"
  // 与 "WorkBuddy-app.exe"），旧白名单按 qoder.exe / workbuddy.exe 精确比对 → 应用明明开着也全报「未启动」。
  // 现在按「归一化后的完整进程名」比对，两个变体都收，且不是子串匹配（codex-windows-sandbox-service 不算 codex）。
  'qoder-cn': ['qoder cn', 'qoder'],
  'claude-code': ['claude'],
  'codex': ['codex'],
  'trae-cn': ['trae cn', 'trae'],
  'cursor': ['cursor'],
  'workbuddy': ['workbuddy-app', 'workbuddy'],
  'zcode': ['zcode'],
  'deepseek-harness': ['qoder cn', 'qoder'],
};

/** 归一化进程名：去首尾空白、去 .exe 后缀、小写、压缩连续空格（"Qoder CN.exe" → "qoder cn"）。 */
export function normalizeProcessName(name: string): string {
  return name.trim().replace(/\.exe$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 纯函数：给定当前进程名列表，返回各桌面客户端的运行态；未映射的客户端不在结果里。 */
export function matchRunningClients(processNames: readonly string[]): Record<string, boolean> {
  const set = new Set(
    processNames.map(normalizeProcessName).filter((n) => n.length > 0),
  );
  const out: Record<string, boolean> = {};
  for (const [id, exes] of Object.entries(CLIENT_PROCESS_NAMES)) {
    out[id] = exes.some((exe) => set.has(normalizeProcessName(exe)));
  }
  return out;
}

/** 列出当前进程名（失败不抛：返回空数组，扫描照常）。 */
export function listProcessNames(): string[] {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /FO CSV /NH', {
        encoding: 'utf8', windowsHide: true, timeout: 4000,
      });
      return out.split(/\r?\n/)
        .map((line) => /^"([^"]+)"/.exec(line.trim())?.[1] ?? '')
        .filter((n) => n.length > 0);
    }
    const out = execSync('ps -A -o comm=', { encoding: 'utf8', timeout: 4000 });
    return out.split(/\r?\n/)
      .map((l) => l.trim().split('/').pop() ?? '')
      .filter((n) => n.length > 0);
  } catch {
    return [];
  }
}

/**
 * 进程表缓存（2026-11-22 启动提速）：tasklist 是同步子进程，实测单次约 0.45–0.5s，
 * 会卡住主进程事件循环，连状态栏的 L0 读数也被排队（表现为「L0 读取中」迟迟不消失）。
 * 运行态只用于展示，10s 内的结果足够准；失败（空表）不缓存，下次照常重试。
 */
const PROCESS_CACHE_MS = 10_000;
let processCache: { at: number; value: Record<string, boolean> } | null = null;

/** 探测桌面客户端运行态（仅主进程用）；失败返回 {} → UI 不显示运行态。 */
export function probeRunningClients(opts: { now?: number; lister?: () => string[] } = {}): Record<string, boolean> {
  const now = opts.now ?? Date.now();
  if (!opts.lister && processCache && now - processCache.at < PROCESS_CACHE_MS) {
    return processCache.value;
  }
  const names = (opts.lister ?? listProcessNames)();
  if (names.length === 0) return {};
  const value = matchRunningClients(names);
  processCache = { at: now, value };
  return value;
}

/** 测试用：清空进程表缓存 */
export function resetProcessCache(): void {
  processCache = null;
}
