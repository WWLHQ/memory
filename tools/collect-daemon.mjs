// 批次44-A：独立采集守护 CLI（headless 常驻，不依赖 Electron 窗口）。
// 口径（见 core/memagent/collectDaemon.ts 头注）：daemon 只做「扫描 + 指纹去重 + 暂存分片」，
// **永不碰账本**（单写者 = 桌面端，44-B 双写者风险由架构消解）。
// 用法：
//   node tools/collect-daemon.mjs                     # 常驻（数据根按指针解析），每 5min 一轮
//   node tools/collect-daemon.mjs --root <数据根>      # 指定数据根
//   node tools/collect-daemon.mjs --interval 60000    # 轮询间隔
//   node tools/collect-daemon.mjs --once              # 单轮后退出（排查用）
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR_NAME = 'MultiAgent Memory';
const POINTER_NAME = 'data-root.json';

function appDataDir() {
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

function parseArgs(argv) {
  const out = { root: '', interval: 300_000, once: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = resolve(argv[++i] ?? '');
    else if (argv[i] === '--interval') out.interval = Number(argv[++i]) || 300_000;
    else if (argv[i] === '--once') out.once = true;
  }
  return out;
}

function resolveRoot(args) {
  if (args.root) return args.root;
  const fallback = join(appDataDir(), ROOT_DIR_NAME);
  try {
    const ptr = JSON.parse(readFileSync(join(fallback, POINTER_NAME), 'utf8'));
    if (typeof ptr?.root === 'string' && ptr.root.trim()) return ptr.root.trim();
  } catch { /* 指针缺失 → 默认数据根 */ }
  return fallback;
}

const args = parseArgs(process.argv.slice(2));
const root = resolveRoot(args);
if (!existsSync(root)) {
  console.error(`[collect-daemon] 数据根不存在：${root}（用 --root 显式指定）`);
  process.exit(1);
}

const { defaultAgentSources, collectDaemon: daemon } = await (async () => {
  const base = pathToFileURL(resolve('src/core/memagent/')).href;
  const [sources, daemonMod] = await Promise.all([
    import(new URL('sessionCollector.ts', base).href),
    import(new URL('collectDaemon.ts', base).href),
  ]);
  return { defaultAgentSources: sources.defaultAgentSources, collectDaemon: daemonMod };
})();

const stateDir = join(root, daemon.DAEMON_DIR_NAME);
console.log(`[collect-daemon] 启动：root=${root} state=${stateDir} interval=${args.interval}ms`);
console.log('[collect-daemon] 口径：只扫描 + 暂存（collect-daemon/pending/），永不写账本；写入由桌面端 drain 交接。');

let stopped = false;
const round = async (why) => {
  try {
    const r = await daemon.runDaemonRound({ stateDir, scan: { sources: defaultAgentSources() }, now: Date.now() });
    console.log(`[collect-daemon] ${why}: scanned=${r.scanned} new=${r.newItems} deduped=${r.deduped} pending=${r.pendingFile ? '1 file' : 'none'}`);
  } catch (e) {
    console.error(`[collect-daemon] ${why} error:`, e?.message ?? e);
  }
};

if (args.once) {
  await round('once');
  process.exit(0);
}

process.on('SIGINT', () => { stopped = true; });
process.on('SIGTERM', () => { stopped = true; });

await round('first');
const timer = setInterval(() => {
  if (stopped) {
    clearInterval(timer);
    console.log('[collect-daemon] 已停止（状态已随每轮落盘，安全退出）');
    process.exit(0);
  }
  void round('interval');
}, Math.max(30_000, args.interval));
