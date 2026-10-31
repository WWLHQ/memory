import { app, BrowserWindow, ipcMain, powerMonitor, screen, session, shell } from 'electron';
process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err?.message, err?.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled-rejection]', reason);
});
// Electron 主进程入口：
// - bootstrap：静态服务 + 本机后端（home / agentOnboard / MCP / webhook）+ FileStorage（userData 持久化），
//   失败统一走 handleBootFailure（日志 + 弹窗 + exit(1)，A3）；
// - 窗口：主窗口加载 overview.html，webPreferences.preload 只注入主 frame；
// - IPC：channel 常量统一在 ipcChannels.ts，启动时校验注册完整性（A2）。
import { createServer, type HomeServer } from '../home/server.ts';
import { createServer as createAgentOnboardServer } from '../agentOnboard/server.ts';
import { FileStorage } from '../core/memagent/fileStorage.ts';
import { validateAuditRecord as sharedValidateAuditRecord } from '../shared/auditShape.ts';
import { scanHost } from './hostScan.ts';
import { IPC, missingChannels, handleBootFailure } from './ipcChannels.ts';
import { initActionLog, actionLog, actionLogError, tailActionLog } from './actionLog.ts';
import type { TenantContext } from '../types/home.ts';
import {
  DATA_ROOT_POINTER_VERSION, clearDataRootMigrateFrom, dataRootPointerPath, defaultDataRoot,
  detectDataRoots, ensureDirWritable, hasAnyData, migrateDataRoot, readDataRootPointer,
  samePath, summarizeDataDir, validateDataRootPath, writeDataRootPointer,
  type DataRootMigration, type DataRootSummary,
} from './dataRoot.ts';
import { detectLocalAgents, hostAgentConfig } from './agentDetect.ts';
import { applyRecallEvidence, scanMcpClients, snippetForClient, wireMcpClient } from './mcpClients.ts';
import {
  deepseekKeyExists, loadDeepseekKey, loadLlmConfig, loadLlmGateway, saveDeepseekKey, saveLlmConfig,
  testDeepseek, testOllama, type LlmGatewayConfig, type TieredLlmProvider,
} from './llmGateway.ts';
import { createServer as httpCreateServer } from 'node:http';
import { runMcpServer } from '../core/memagent/mcp.ts';
import { runMcpHttpServer } from '../core/memagent/mcpHttp.ts';
import { createWebhook } from '../core/memagent/webhook.ts';
import { createWebhookHttpServer } from './webhookServer.ts';
import type { AuditAction, Category } from '../core/memagent/types.ts';
import {
  createReconciler, applyScanToStore, defaultAgentSources,
  type CollectorCursor, type ScanResult,
} from '../core/memagent/sessionCollector.ts';
import { coreWrite } from '../core/memagent/memories.ts';
import { L0Vault } from '../core/memagent/l0vault.ts';
import { demoteStubLayers, scanStubLayers } from '../core/memagent/legacyLayers.ts';
import { MemAgentError } from '../core/memagent/errors.ts';
import { cleanupTempFiles, createHomeLockStore, createL0KeyringStore } from './l0KeyringStore.ts';
import type { L0GrantReq, L0UnlockReq } from '../core/memagent/types.ts';
import { runForgettingCycle } from '../core/memagent/forgetting.ts';
import { autoOrganizeEnabled } from '../core/memagent/paramsSnapshot.ts';
import { JsVectorBackend } from '../core/memagent/vector.ts';
import { readFile, appendFile, mkdir, writeFile, copyFile, readdir, unlink, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync } from 'node:fs';
import { dialog } from 'electron';

// ═══════════════════════════════════════════════════════════════════════════
// 文件地图（改代码先看这里；按 § 标题搜索，不要依赖行号）：
//   §1 路径与常量（DIST / USER_DATA / 端口）          搜 "§1 路径与常量"
//   §2 数据根目录（首次选择/迁移/指针）                搜 "§2 数据根目录"
//   §3 IPC 信任基座（来源白名单/注册表/采集器常量）    搜 "§3 IPC 信任基座"
//   §4 诊断日志（flog / mlog / mcp-token）             搜 "§4 诊断日志"
//   §5 备份（配置/调度/执行/列表）                     搜 "§5 备份"
//   §6 管理员门禁 + 备份/数据根 IPC                    搜 "§6 管理员门禁"
//   §6c MCP 客户端接入 IPC（状态/片段/一键写入）        搜 "§6c MCP 客户端接入"
//   §6d LLM 精炼网关 IPC（配置/拨测/逐层代理）          搜 "§6d LLM 精炼网关"
//   §7 静态服务与请求来源判定                          搜 "§7 静态服务"
//   §8 IPC 包装器 + 日志/存储 IPC                      搜 "§8 IPC 包装器"
//   §9 悬浮窗（Claude 归因）                           搜 "§9 悬浮窗"
//   §10 bootstrap（数据根→后端→采集器→窗口→退出）      搜 "§10 bootstrap"
//   §11 单实例与窗口生命周期                           搜 "§11 生命周期"
// 排查入口：<数据根>/actions.log（一行一个动作，格式 [ts] [level] [scope:action] [rid] {json}）。
// ═══════════════════════════════════════════════════════════════════════════

// ── §1 路径与常量 ───────────────────────────────────────────────────────────
// 静态资源目录：esbuild 产物位于 <root>/dist-electron/main.cjs，故 __dirname/../dist 即 <root>/dist；
// 打包后为 resources/app/dist（相对布局不变）。兜底再试 app.getAppPath()/dist（asar 场景）。
function resolveDistDir(): string {
  const candidate = join(__dirname, '..', 'dist');
  if (existsSync(candidate)) return candidate;
  try {
    const inApp = join(app.getAppPath(), 'dist');
    if (existsSync(inApp)) return inApp;
  } catch { /* ignore */ }
  return candidate;
}
// 顶层不再直接调用 app.getPath（避免 require('electron') 在打包环境中解析到 shim 导致崩溃）
// USER_DATA / DB_PATH 等在 bootstrap() 内部延迟初始化
const DIST = resolveDistDir();
// USER_DATA / DB_PATH 等移至 bootstrap 内部（顶层 let 声明，bootstrap 内赋值；
// flog/mlog 等顶层函数闭包依赖这些变量，必须在顶层声明而非 const 初始化）
let USER_DATA: string;
let DB_PATH: string;
let FLOAT_LOG: string;
let MAIN_LOG: string;
let BACKUP_CFG_PATH: string;
let COLLECTOR_CURSOR_FILE: string;
let storage: FileStorage;
/** 登录会话真源（批次7）：敏感 IPC 经此校验管理员身份；bootstrap 创建后赋值 */
let homeServerRef: HomeServer | null = null;
/** L0 密钥环（§4.4）：DEK 只在主进程内存；退出时清空写密钥缓存 */
let l0VaultRef: L0Vault | null = null;
const MIRROR_PORT = 8201;
const AGENT_ONBOARD_PORT = 8200;
const MCP_PORT = 8202;
const MCP_HTTP_PORT = 8204;
const WEBHOOK_PORT = 8203;

// ── §2 数据根目录（批次6）───────────────────────────────────────────────────
// 引导指针固定放在 %APPDATA%\MultiAgent Memory\data-root.json（不随 userData 漂移）；
// 有指针时在 app ready 前 setPath，保证 Chromium 缓存与全部应用数据都落在用户选定目录。
let APP_DATA_DIR: string | null = null;
try {
  APP_DATA_DIR = app?.getPath ? normalize(app.getPath('appData')) : null;
} catch {
  APP_DATA_DIR = null;
}
const DATA_ROOT_POINTER: string | null = APP_DATA_DIR ? dataRootPointerPath(APP_DATA_DIR) : null;
const DEFAULT_DATA_ROOT: string | null = APP_DATA_DIR ? defaultDataRoot(APP_DATA_DIR) : null;

type DataRootSetupReason = 'first-run' | 'corrupt' | 'unusable';
interface DataRootStartup { root?: string; setup?: DataRootSetupReason; previousRoot?: string; error?: string }
let dataRootPointerWriteError: string | null = null;

/** 启动早期解析数据根：可用则在 ready 前 setPath；首次启动/指针损坏/目录不可用 → 交给 prepareDataRoot */
function resolveDataRootAtStartup(): DataRootStartup {
  if (!APP_DATA_DIR || !DATA_ROOT_POINTER) return { setup: 'unusable', error: '无法确定应用数据目录（appData）' };
  const read = readDataRootPointer(DATA_ROOT_POINTER);
  if (read.status === 'missing') return { setup: 'first-run' };
  if (read.status === 'corrupt') return { setup: 'corrupt', error: read.error };
  const v = validateDataRootPath(read.pointer.root);
  if (!v.ok) return { setup: 'unusable', previousRoot: read.pointer.root, error: v.error };
  const writable = ensureDirWritable(v.root);
  if (!writable.ok) return { setup: 'unusable', previousRoot: v.root, error: writable.error };
  try {
    app.setPath('userData', v.root);
    return { root: v.root };
  } catch (e) {
    return { setup: 'unusable', previousRoot: v.root, error: `设置 userData 失败：${String((e as Error)?.message ?? e)}` };
  }
}
const dataRootStartup = resolveDataRootAtStartup();

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function describeSummary(s: DataRootSummary): string {
  const when = s.newest ? new Date(s.newest).toLocaleString() : '无修改记录';
  return `${s.dir}（${s.files} 个文件，${formatBytes(s.bytes)}，最近修改 ${when}）`;
}

/** 首启/修复对话框：默认位置 / 选择文件夹 / 退出；不可写就带着原因继续问，绝不静默降级 */
async function chooseDataRootInteractive(): Promise<string | null> {
  const repair = dataRootStartup.setup === 'unusable';
  let lastError = dataRootStartup.error ?? '';
  if (repair && dataRootStartup.previousRoot) lastError = `上次使用的数据目录不可用：${dataRootStartup.previousRoot}\n原因：${lastError}`;
  for (;;) {
    const res = await dialog.showMessageBox({
      type: repair || dataRootStartup.setup === 'corrupt' ? 'warning' : 'question',
      title: '选择数据存放位置',
      message: repair ? '数据目录不可用，请重新选择' : '首次启动：选择数据存放位置',
      detail: [
        lastError,
        `默认位置：${DEFAULT_DATA_ROOT}`,
        '记忆库、采集游标、main.log、MCP 令牌、备份配置等全部数据都会保存在该位置。',
      ].filter(Boolean).join('\n\n'),
      buttons: repair ? ['重新选择文件夹…', '改用默认位置', '退出'] : ['使用默认位置', '选择文件夹…', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (res.response === 2) return null;
    const useDefault = repair ? res.response === 1 : res.response === 0;
    if (useDefault) {
      const w = ensureDirWritable(DEFAULT_DATA_ROOT as string);
      if (w.ok) return DEFAULT_DATA_ROOT;
      lastError = `默认位置不可写：${w.error}`;
      continue;
    }
    const pick = await dialog.showOpenDialog({ title: '选择数据存放文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) continue;
    const v = validateDataRootPath(pick.filePaths[0]);
    if (!v.ok) { lastError = v.error; continue; }
    const w = ensureDirWritable(v.root);
    if (!w.ok) { lastError = `目录不可写：${w.error}`; continue; }
    return v.root;
  }
}

/** 目标位置已是空目录时，询问是否复制最近一份旧数据；绝不把两份不同记忆库合并 */
async function chooseMigrationSource(chosenRoot: string): Promise<string | undefined> {
  if (!APP_DATA_DIR || hasAnyData(chosenRoot)) return undefined;
  const candidates: DataRootSummary[] = [];
  const push = (s: DataRootSummary) => { if (!candidates.some((c) => samePath(c.dir, s.dir))) candidates.push(s); };
  if (dataRootStartup.previousRoot && existsSync(dataRootStartup.previousRoot)
    && !samePath(dataRootStartup.previousRoot, chosenRoot) && hasAnyData(dataRootStartup.previousRoot)) {
    push(summarizeDataDir(dataRootStartup.previousRoot));
  }
  for (const s of detectDataRoots(APP_DATA_DIR, chosenRoot)) push(s);
  candidates.sort((a, b) => b.newest.localeCompare(a.newest) || b.bytes - a.bytes);
  const best = candidates[0];
  if (!best) return undefined;
  const others = candidates.slice(1);
  const res = await dialog.showMessageBox({
    type: 'question',
    title: '检测到旧数据',
    message: '是否把旧数据复制到新的数据位置？',
    detail: [
      `迁移源：${describeSummary(best)}`,
      others.length ? `其他检测到的位置（不会自动迁移）：\n${others.map(describeSummary).join('\n')}` : '',
      '迁移只复制白名单数据（记忆库/采集游标/日志/MCP 令牌/备份配置等），不覆盖新位置已有文件，也不删除旧位置。',
    ].filter(Boolean).join('\n\n'),
    buttons: ['迁移旧数据', '不迁移（从空库开始）'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return res.response === 0 ? best.dir : undefined;
}

/**
 * ready 后、bootstrap 前：首次启动/指针损坏/原目录不可用时完成选择，写指针并重启。
 * 重启后指针在 ready 前生效，Chromium 缓存与全部应用数据才真正落到新根目录。
 */
async function prepareDataRoot(): Promise<boolean> {
  if (!dataRootStartup.setup) return true;
  if (!APP_DATA_DIR || !DEFAULT_DATA_ROOT || !DATA_ROOT_POINTER) {
    throw new Error('无法确定应用数据目录（appData），请检查系统环境后重试');
  }
  const root = await chooseDataRootInteractive();
  if (!root) { app.exit(0); return false; }
  const migrateFrom = await chooseMigrationSource(root);
  dataRootStartup.setup = undefined;
  try {
    writeDataRootPointer(DATA_ROOT_POINTER, {
      version: DATA_ROOT_POINTER_VERSION,
      root,
      ...(migrateFrom ? { migrateFrom } : {}),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    dataRootPointerWriteError = String((e as Error)?.message ?? e);
    dialog.showErrorBox('无法保存数据位置', `本次仍使用所选位置，但下次启动会重新询问。\n${dataRootPointerWriteError}`);
    try { app.setPath('userData', root); } catch { /* ignore */ }
    return true;
  }
  try {
    app.relaunch();
  } catch (e) {
    console.error('[data-root] relaunch failed', e);
  }
  app.exit(0);
  return false;
}

// IPC 信任面：只接受精确的页面来源（静态服务端口在 bootstrap 拿到后填充）+ dist 下的 file: 页面。
// 绝不接受「任意 127.0.0.1 端口」——否则开发服务器或其它本机应用的页面也能调存储/备份 IPC。
// ── §3 IPC 信任基座 ─────────────────────────────────────────────────────────
const trustedIpcOrigins = new Set<string>();
let trustedFileRoot: string | null = null;
const registeredIpcChannels = new Set<string>();

// 端口冲突改由单实例锁 + 各 server 的 error 事件兜底诊断：
// 不在模块加载期杀任何进程（避免误杀占用同端口的他人程序）。
// COLLECTOR_CURSOR_FILE 改为 bootstrap 内赋值（USER_DATA 在 app ready 后才可用）
const COLLECTOR_INTERVAL_MS = 300_000;
const COLLECTOR_MAX_PER_ROUND = 50;
const COLLECTOR_FIRST_SCAN_DELAY_MS = 10_000;

// storage / FLOAT_LOG / MAIN_LOG 改为 bootstrap 内赋值（DB_PATH/USER_DATA 在 app ready 后才可用）
// ── §4 诊断日志（旧版 flog/mlog；批次7 起新代码一律用 actionLog）─────────────
async function flog(tag: string, msg: string): Promise<void> {
  try {
    await mkdir(USER_DATA, { recursive: true });
    const ts = new Date().toISOString();
    await appendFile(FLOAT_LOG, `[${ts}] [${tag}] ${msg}\n`, 'utf8');
  } catch {
    //                               
  }
}

/**                                                    bootstrap         ?+ collector                                */
async function mlog(step: string, detail?: unknown): Promise<void> {
  try {
    await mkdir(USER_DATA, { recursive: true });
    const ts = new Date().toISOString();
    const extra = detail === undefined ? '' : ' ' + JSON.stringify(detail);
    await appendFile(MAIN_LOG, `[${ts}] ${step}${extra}\n`, 'utf8');
  } catch {
    //                               
  }
}

/**
 * MCP 访问令牌：首次启动生成 32 字节随机 hex 并持久化到 userData/mcp-token.txt（0600），后续复用。
 * 只允许通过文件把令牌交给 Agent；绝不打进日志/审计。
 */
function loadOrCreateMcpToken(): string {
  const file = join(USER_DATA, 'mcp-token.txt');
  try {
    const saved = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(saved)) return saved;
  } catch {
    /* 首次启动：文件不存在 */
  }
  const token = randomBytes(32).toString('hex');
  mkdirSync(USER_DATA, { recursive: true });
  writeFileSync(file, token + '\n', { encoding: 'utf8', mode: 0o600 });
  return token;
}

// ── §5 备份（记忆库管理页 P8 扩展）──────────────────────────────────────────
// 备份配置持久化于 userData/backup-config.json；
// 调度器每分钟 tick 一次，到用户设定时刻自动把 memories.db.json 复制到备份目录（带时间戳，保留最近 N 份）。
// 日志：backup:start / backup:auto-done / backup-auto-error → mlog（main.log）
interface BackupConfig {
  enabled: boolean;
  dir: string;            // 备份位置（用户选定目录）；空 = 未设置（自动备份不触发，手动立即备份仍可用，落到 userData 下）
  hour: number;          // 自动备份时刻 0-23
  minute: number;        // 0-59
  keepCount: number;     // 保留份数（默认 7）
  lastRun?: string;      // ISO 时间
  lastOk?: boolean;
}

// BACKUP_CFG_PATH 改为 bootstrap 内赋值

function defaultBackupConfig(): BackupConfig {
  return { enabled: false, dir: '', hour: 3, minute: 0, keepCount: 7 };
}

/** 重启应用让新路径生效：给 IPC 响应留出发送时间 */
function scheduleRelaunch(): void {
  setTimeout(() => {
    try {
      app.relaunch();
      app.exit(0);
    } catch (e) {
      void mlog('backup:relaunch-failed', String((e as Error)?.message ?? e));
    }
  }, 400);
}

/**
 * 启动期执行数据根迁移（此时没有 storage/服务在写）：只复制白名单文件，目标已存在则跳过；
 * 全部成功才清除指针里的 migrateFrom，失败保留以便下次重试（不覆盖、不删除源）。
 */
function applyDataRootMigration(): DataRootMigration | null {
  if (!DATA_ROOT_POINTER) return null;
  const read = readDataRootPointer(DATA_ROOT_POINTER);
  if (read.status !== 'ok' || !read.pointer.migrateFrom) return null;
  const from = read.pointer.migrateFrom;
  if (samePath(from, USER_DATA)) {
    clearDataRootMigrateFrom(DATA_ROOT_POINTER);
    return null;
  }
  const report = migrateDataRoot(from, USER_DATA, process.platform, { overwrite: read.pointer.migrateOverwrite === true });
  void mlog('data-root:migrate', {
    from: report.from, to: report.to, copied: report.copied, skipped: report.skipped,
    backedUp: report.backedUp, errors: report.errors, dbSource: report.dbSource,
  });
  if (report.errors.length === 0) clearDataRootMigrateFrom(DATA_ROOT_POINTER);
  else void mlog('data-root:migrate-incomplete', { errors: report.errors });
  return report;
}

/**
 * 旧版 P8「记忆库保存位置（dbDir）」已由全局数据根取代：若旧配置把库放在别处且新根尚无库，
 * 一次性导入该库，然后清掉 dbDir/pendingMove（其余备份配置保留）。
 */
function importLegacyDbDir(): string | null {
  if (!BACKUP_CFG_PATH || !DB_PATH) return null;
  let raw: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(readFileSync(BACKUP_CFG_PATH, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw) return null;
  const legacyDbDir = typeof raw.dbDir === 'string' && raw.dbDir.trim() ? normalize(raw.dbDir.trim()) : '';
  const hadLegacy = !!legacyDbDir || raw.pendingMove !== undefined;
  let imported: string | null = null;
  if (legacyDbDir) {
    const src = join(legacyDbDir, 'memories.db.json');
    if (existsSync(src) && !samePath(src, DB_PATH) && !existsSync(DB_PATH)) {
      try {
        copyFileSync(src, DB_PATH);
        imported = src;
      } catch (e) {
        void mlog('data-root:legacy-db-dir-import-error', { from: src, error: String((e as Error)?.message ?? e) });
      }
    }
  }
  if (hadLegacy) {
    delete raw.dbDir;
    delete raw.pendingMove;
    try {
      const tmp = `${BACKUP_CFG_PATH}.tmp`;
      writeFileSync(tmp, JSON.stringify(raw, null, 2), 'utf8');
      renameSync(tmp, BACKUP_CFG_PATH);
    } catch (e) {
      void mlog('data-root:legacy-config-clean-error', String((e as Error)?.message ?? e));
    }
  }
  if (imported) void mlog('data-root:legacy-db-dir-imported', { from: imported, to: DB_PATH });
  return imported;
}

function loadBackupConfig(): BackupConfig {
  try {
    const raw = existsSync(BACKUP_CFG_PATH) ? readFileSync(BACKUP_CFG_PATH, 'utf8') : '';
    if (!raw) return defaultBackupConfig();
    const parsed = JSON.parse(raw) as Partial<BackupConfig>;
    return { ...defaultBackupConfig(), ...parsed };
  } catch {
    return defaultBackupConfig();
  }
}

function saveBackupConfig(cfg: BackupConfig): void {
  const tmp = `${BACKUP_CFG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  renameSync(tmp, BACKUP_CFG_PATH);
  void mlog('backup:config-saved', { enabled: cfg.enabled, dir: cfg.dir || '(default)', time: `${String(cfg.hour).padStart(2, '0')}:${String(cfg.minute).padStart(2, '0')}`, keep: cfg.keepCount });
}

/** 执行一次备份：复制 DB → 备份目录（时间戳文件名）+ 清理超出保留份数的旧备份 + 写审计 */
async function runBackupOnce(trigger: 'manual' | 'auto'): Promise<{ ok: boolean; file?: string; error?: string }> {
  const cfg = loadBackupConfig();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = cfg.dir || join(USER_DATA, 'backups');
  const dbPath = DB_PATH;
  try {
    await mkdir(backupDir, { recursive: true });
    if (!existsSync(dbPath)) {
      return { ok: false, error: '记忆库文件不存在（尚未产生记忆）' };
    }
    const target = join(backupDir, `memories-${ts}.json`);
    await copyFile(dbPath, target);
    // 保留最近 keepCount 份（按文件名时间戳排序）
    const all = (await readdir(backupDir)).filter((n) => n.startsWith('memories-') && n.endsWith('.json')).sort();
    const removeCount = all.length - cfg.keepCount;
    for (let i = 0; i < removeCount; i++) {
      await unlink(join(backupDir, all[i])).catch(() => { /* ignore */ });
    }
    cfg.lastRun = new Date().toISOString();
    cfg.lastOk = true;
    if (trigger === 'auto') saveBackupConfig(cfg); // 手动触发也更新 lastRun 但不重复写 config（幂等无妨）
    await storage.appendAudit({
      request_id: `req_bk_${Date.now().toString(36)}`,
      action: 'memory_op',
      ts: Date.now(),
      project_id: 'P1',
      detail: { op: 'auto_backup', trigger, file: target, keep: cfg.keepCount, memories: Object.keys(storageSize()).length },
    } as never);
    void mlog(`backup:${trigger}-done`, { file: target });
    return { ok: true, file: target };
  } catch (e) {
    cfg.lastOk = false;
    void mlog(`backup:${trigger}-error`, String((e as Error)?.message ?? e));
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 内存中记忆条数（备份审计用；轻量读，不走全量拷贝） */
function storageSize(): Record<string, unknown> {
  try {
    const raw = readFileSync(DB_PATH, 'utf8');
    const doc = JSON.parse(raw) as { memories?: Record<string, unknown> };
    return doc.memories ?? {};
  } catch {
    return {};
  }
}

/** 备份历史（最近 20 份，倒序） */
async function listBackups(): Promise<{ dir: string; items: { name: string; time: string; size: number }[] }> {
  const cfg = loadBackupConfig();
  const backupDir = cfg.dir || join(USER_DATA, 'backups');
  try {
    if (!existsSync(backupDir)) return { dir: backupDir, items: [] };
    const names = (await readdir(backupDir)).filter((n) => n.startsWith('memories-') && n.endsWith('.json')).sort();
    const items = await Promise.all(names.slice(-20).reverse().map(async (n) => {
      const s = await stat(join(backupDir, n));
      return { name: n, time: s.mtime.toISOString(), size: s.size };
    }));
    return { dir: backupDir, items };
  } catch {
    return { dir: backupDir, items: [] };
  }
}

let backupTicker: NodeJS.Timeout | null = null;

/** 每分钟 tick：cfg.enabled 且当前 HH:mm 到达设定时刻且今日尚未跑过 → 自动备份 */
function ensureBackupScheduler(): void {
  if (backupTicker) return;
  backupTicker = setInterval(() => {
    const cfg = loadBackupConfig();
    if (!cfg.enabled) return;
    const now = new Date();
    const hh = now.getHours(), mm = now.getMinutes();
    const dueNow = hh === cfg.hour && mm === cfg.minute;
    if (!dueNow) return;
    const today = now.toISOString().slice(0, 10);
    const ranToday = cfg.lastRun?.slice(0, 10) === today;
    if (ranToday) return;
    void mlog('backup:auto-due');
    void runBackupOnce('auto');
  }, 60_000);
  backupTicker.unref?.();
}

type AdminGate = { ok: true; ctx: TenantContext } | { ok: false; error: string };

/**
 * 敏感 IPC 的管理员闸门（批次7）：会话必须是 home server 真源里的有效会话，且 role=admin。
 * 拒绝时落一行 warn 日志（channel + 原因）；成功路径由 handleIpc 的统一耗时日志覆盖。
 */
// ── §6 管理员门禁 + 备份/数据根 IPC ─────────────────────────────────────────
/** 敏感 IPC 的管理员校验：以 home server 会话为准（不信任渲染层自报角色） */
function requireAdmin(sessionId: unknown, channel: string): AdminGate {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  const ctx = sid ? homeServerRef?.getSessionContext(sid) ?? null : null;
  if (!ctx) {
    actionLog('ipc', channel, { denied: 'no_session' }, { level: 'warn' });
    return { ok: false, error: '需要登录后操作（会话已过期或未登录）' };
  }
  if (ctx.role !== 'admin') {
    actionLog('ipc', channel, { denied: 'not_admin', user: ctx.user_id }, { level: 'warn' });
    return { ok: false, error: '需要管理员权限' };
  }
  return { ok: true, ctx };
}

async function registerBackupIpc(): Promise<void> {
  ensureBackupScheduler();
  handleIpc(IPC.backupGetConfig, () => loadBackupConfig());
  handleIpc(IPC.backupSaveConfig, (_e, patch: Partial<BackupConfig>, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.backupSaveConfig);
    if (!gate.ok) return { ok: false, error: gate.error };
    const cur = loadBackupConfig();
    const cfg = { ...cur, ...patch };
    // 钳制
    cfg.hour = Math.min(23, Math.max(0, Math.round(cfg.hour ?? 3)));
    cfg.minute = Math.min(59, Math.max(0, Math.round(cfg.minute ?? 0)));
    cfg.keepCount = Math.min(50, Math.max(1, Math.round(cfg.keepCount ?? 7)));
    cfg.enabled = !!cfg.enabled;
    cfg.dir = typeof cfg.dir === 'string' ? cfg.dir : '';
    saveBackupConfig(cfg);
    void mlog('backup:config-saved', { by: gate.ctx.user_id, enabled: cfg.enabled, hour: cfg.hour, minute: cfg.minute, keepCount: cfg.keepCount });
    return { ok: true, cfg };
  });
  handleIpc(IPC.backupChooseDir, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.backupChooseDir);
    if (!gate.ok) return { ok: false, dir: '', error: gate.error };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, { title: '选择备份目录', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, dir: '' };
    const dir = normalize(res.filePaths[0]);
    const cfg = loadBackupConfig();
    cfg.dir = dir;
    saveBackupConfig(cfg);
    void mlog('backup:dir-changed', { by: gate.ctx.user_id, dir });
    return { ok: true, dir };
  });
  handleIpc(IPC.backupRunNow, (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.backupRunNow);
    if (!gate.ok) return { ok: false, error: gate.error };
    void mlog('backup:manual-requested', { by: gate.ctx.user_id });
    return runBackupOnce('manual');
  });
  handleIpc(IPC.backupList, () => listBackups());
}

/**
 * 数据存放位置（全局参数页）：展示当前根目录，更改/恢复默认时写指针并重启。
 * 旧数据由下次启动的 applyDataRootMigration 复制到新根（不覆盖、不删除源）。
 */
function registerDataRootIpc(): void {
  handleIpc(IPC.dataRootGet, () => ({
    root: USER_DATA,
    defaultRoot: DEFAULT_DATA_ROOT,
    isDefault: !!DEFAULT_DATA_ROOT && samePath(USER_DATA, DEFAULT_DATA_ROOT),
    pointer: DATA_ROOT_POINTER,
    activeDbPath: DB_PATH,
    actionsLogPath: join(USER_DATA, 'actions.log'),
  }));
  handleIpc(IPC.dataRootOpen, async () => {
    const err = await shell.openPath(USER_DATA);
    if (err) return { ok: false, error: err };
    return { ok: true, path: USER_DATA };
  });
  handleIpc(IPC.dataRootChange, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.dataRootChange);
    if (!gate.ok) return { ok: false, error: gate.error };
    return scheduleDataRootChange('change', gate.ctx.user_id);
  });
  handleIpc(IPC.dataRootRestoreDefault, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.dataRootRestoreDefault);
    if (!gate.ok) return { ok: false, error: gate.error };
    return scheduleDataRootChange('restore', gate.ctx.user_id);
  });
}

// ── §6c MCP 客户端接入 IPC（批次15）────────────────────────────────────────
// 状态扫描需登录会话（批次27 P3-4）；含令牌片段与一键写配置会暴露/改写本机凭据 → 仅管理员。
// 令牌只在返回值出现一次，日志只记客户端/路径/备份与结果，绝不记令牌。
function registerMcpClientsIpc(token: string): void {
  handleIpc(IPC.mcpClients, async (_e, sessionId?: string) => {
    // 成功回包形状是 { endpoint, clients, scannedAt }（非 IpcResult）——闸门失败必须抛错，
    // 让渲染层走「扫描失败」路径，而不是被当成空 clients 静默显示「无客户端」。
    const gate = requireSession(sessionId, IPC.mcpClients);
    if (!gate.ok) throw new Error(gate.error);
    // 批次30：召回审计作为接入证据（Zcode 等配置存应用内部的客户端文件扫不到，但真实调用可证明接通）；
    // 审计读不到时退回纯文件扫描，不影响扫描本身。
    let recallEvidence: Parameters<typeof applyRecallEvidence>[1] = [];
    try {
      recallEvidence = (await storage.queryAudit({ action: 'recall' })).map((a) => ({
        ts: a.ts, client: (a.detail as { client?: unknown } | null)?.client,
      }));
    } catch { /* 证据不可用 → 纯文件口径 */ }
    return scanMcpClients({ currentToken: token, recallEvidence });
  });
  handleIpc(IPC.mcpClientSnippet, (_e, id: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.mcpClientSnippet);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      return { ok: true, snippet: snippetForClient(String(id ?? ''), token) };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  });
  handleIpc(IPC.mcpClientWire, (_e, id: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.mcpClientWire);
    if (!gate.ok) return { ok: false, error: gate.error };
    const client = String(id ?? '');
    const r = wireMcpClient(client, token, { currentToken: token });
    actionLog('mcp', 'client-wire', {
      client, ok: r.ok, changed: !!r.changed, path: r.path, backup: r.backupPath,
      ...(r.error ? { error: r.error } : {}),
    }, { level: r.ok ? 'info' : 'warn' });
    return r;
  });
}

// ── §6d LLM 精炼网关 IPC（批次31）──────────────────────────────────────────
// 读配置需登录会话；写配置/真拨测仅管理员；逐层精炼代理需登录会话（内核写路径经此走主进程 HTTP）。
// DeepSeek Key 只经参数写入 0600 文件，绝不回显、绝不进日志/审计；拨测错误文本已由网关清洗（不含密钥）。

let llmGateway: TieredLlmProvider | null = null;

const LLM_REFINE_LAYERS = ['L2', 'L3', 'L4', 'L5', 'L6'] as const;
const LLM_REFINE_CATEGORIES = ['fact', 'decision', 'pitfall', 'insight', 'preference', 'context'] as const;

function llmGatewayView(): { config: LlmGatewayConfig; deepseekKeySet: boolean; usable: boolean } {
  const config = loadLlmConfig(USER_DATA);
  return { config, deepseekKeySet: deepseekKeyExists(USER_DATA), usable: !!llmGateway };
}

function registerLlmIpc(): void {
  handleIpc(IPC.llmConfigGet, (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.llmConfigGet);
    if (!gate.ok) throw new Error(gate.error);
    return { ok: true, ...llmGatewayView() };
  });
  handleIpc(IPC.llmConfigSet, (_e, patch: { config?: Partial<LlmGatewayConfig>; deepseekKey?: string } | undefined, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.llmConfigSet);
    if (!gate.ok) return { ok: false, error: gate.error };
    let keyUpdated = false;
    if (patch && typeof patch.deepseekKey === 'string') {
      saveDeepseekKey(USER_DATA, patch.deepseekKey);
      keyUpdated = true;
    }
    const cur = loadLlmConfig(USER_DATA);
    const p = patch?.config ?? {};
    const cfg: LlmGatewayConfig = {
      ollama: { ...cur.ollama, ...(typeof p.ollama === 'object' && p.ollama ? p.ollama : {}) },
      deepseek: { ...cur.deepseek, ...(typeof p.deepseek === 'object' && p.deepseek ? p.deepseek : {}) },
    };
    saveLlmConfig(USER_DATA, cfg);
    llmGateway = loadLlmGateway(USER_DATA);
    void mlog('llm:config-saved', {
      by: gate.ctx.user_id, keyUpdated,
      ollama: { enabled: cfg.ollama.enabled, model: cfg.ollama.model, baseURL: cfg.ollama.baseURL },
      deepseek: { enabled: cfg.deepseek.enabled, model: cfg.deepseek.model },
      usable: !!llmGateway,
    });
    return { ok: true, ...llmGatewayView() };
  });
  handleIpc(IPC.llmTest, async (_e, target: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.llmTest);
    if (!gate.ok) return { ok: false, error: gate.error };
    const cfg = loadLlmConfig(USER_DATA);
    const r = target === 'deepseek'
      ? await testDeepseek(cfg, loadDeepseekKey(USER_DATA))
      : await testOllama(cfg);
    // r.error 来自网关 safeErrorText（状态码 + 截断响应体，不含密钥）
    void mlog(`llm:test-${target === 'deepseek' ? 'deepseek' : 'ollama'}`, {
      by: gate.ctx.user_id, ok: r.ok, model: r.model, latencyMs: r.latencyMs, ...(r.error ? { error: r.error } : {}),
    });
    return { ...r };
  });
  handleIpc(IPC.llmRefine, async (_e, payload: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.llmRefine);
    if (!gate.ok) throw new Error(gate.error);
    if (!llmGateway) throw new Error('LLM 网关未启用：请管理员在参数页配置并启用 Ollama / DeepSeek');
    const p = (payload ?? {}) as {
      mode?: unknown; layer?: unknown; input?: unknown; category?: unknown; prompt?: unknown;
      request_id?: unknown; usage?: unknown;
    };
    const request_id = typeof p.request_id === 'string' && p.request_id ? p.request_id : 'llm-refine';
    if (p.mode === 'layer') {
      if (!(LLM_REFINE_LAYERS as readonly unknown[]).includes(p.layer)
        || typeof p.input !== 'string' || !p.input
        || !(LLM_REFINE_CATEGORIES as readonly unknown[]).includes(p.category)) {
        throw new Error('llm:refine 参数非法');
      }
      const text = await llmGateway.refineLayer(
        '', p.layer as Parameters<typeof llmGateway.refineLayer>[1], p.input,
        p.category as Parameters<typeof llmGateway.refineLayer>[3],
        { request_id, usage: 'write' },
      );
      return { ok: true, text };
    }
    if (p.mode === 'raw') {
      if (typeof p.prompt !== 'string' || !p.prompt) throw new Error('llm:refine 参数非法');
      const r = await llmGateway.call('', p.prompt, { request_id, usage: typeof p.usage === 'string' ? p.usage : 'call' });
      return { ok: true, ...r };
    }
    throw new Error('llm:refine 参数非法');
  });
}

// ── §6b L0 密钥环 IPC（9-D，§4.4）──────────────────────────────────────────
// 管理端（初始化/轮换/授权/撤销/写密钥/迁移）只认管理员；申请/查阅端只认登录会话。
// user_id 一律取自 home server 会话（不信任渲染层自报），密码只经参数传递、绝不落日志。

function l0Fail(e: unknown): { ok: false; code: string; error: string } {
  const code = e instanceof MemAgentError ? e.code : 'E_AUTH_L0';
  return { ok: false, code, error: String((e as Error)?.message ?? e) };
}

/** 任意登录会话闸门（L0 申请/解锁/心跳/结束；不要求管理员） */
function requireSession(sessionId: unknown, channel: string): AdminGate {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
  const ctx = sid ? homeServerRef?.getSessionContext(sid) ?? null : null;
  if (!ctx) {
    actionLog('ipc', channel, { denied: 'no_session' }, { level: 'warn' });
    return { ok: false, error: '需要登录后操作（会话已过期或未登录）' };
  }
  return { ok: true, ctx };
}

/**
 * 批量改写账本前的自动备份（§4.4.6 口径，批次24 起 L0 迁移与遗留账本清理共用）：
 * 备份失败 → 调用方拒绝改写，绝不无备份动用户数据。
 */
async function backupBeforeKernelChange(dirPrefix: string, logAction: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = loadBackupConfig().dir || join(USER_DATA, 'backups');
  const dir = join(base, `${dirPrefix}-${ts}`);
  await mkdir(dir, { recursive: true });
  for (const f of ['memories.db.json', 'l0-keyring.json']) {
    const src = join(USER_DATA, f);
    if (existsSync(src)) await copyFile(src, join(dir, f));
  }
  actionLog('kernel', logAction, { dir });
  return dir;
}

function registerL0Ipc(vault: L0Vault): void {
  /** 查阅会话必须属于当前登录账号（管理员也不能借用他人会话；直接查阅请用管理密码） */
  const assertOwner = async (l0SessionId: unknown, ctx: TenantContext, channel: string): Promise<string> => {
    const id = typeof l0SessionId === 'string' ? l0SessionId.trim() : '';
    if (!id) throw new MemAgentError('E_AUTH_L0', '缺少 l0_session_id（§4.4.3）');
    const info = await vault.sessionInfo(id);
    if (info.user_id !== ctx.user_id) {
      actionLog('ipc', channel, { denied: 'not_owner', user: ctx.user_id }, { level: 'warn' });
      throw new MemAgentError('E_AUTH_L0', '该 L0 会话不属于当前登录账号（§4.4.2）');
    }
    return id;
  };

  // ── 管理端（仅管理员） ──
  handleIpc(IPC.l0Status, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0Status);
    if (!gate.ok) return { ok: false, error: gate.error };
    return { ok: true, ...(await vault.status()) };
  });
  handleIpc(IPC.l0Setup, async (_e, password: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0Setup);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      await vault.setupAdminPassword(password, gate.ctx.user_id);
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0ChangePassword, async (_e, oldPassword: string, newPassword: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0ChangePassword);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      await vault.changeAdminPassword(oldPassword, newPassword, gate.ctx.user_id);
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0ListRequests, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0ListRequests);
    if (!gate.ok) return { ok: false, error: gate.error };
    return { ok: true, requests: await vault.listRequests() };
  });
  handleIpc(IPC.l0ListGrants, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0ListGrants);
    if (!gate.ok) return { ok: false, error: gate.error };
    return { ok: true, grants: await vault.listGrants() };
  });
  handleIpc(IPC.l0Grant, async (_e, req: L0GrantReq, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0Grant);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const grant = await vault.grantAccess({ ...req, admin_user_id: gate.ctx.user_id });
      return { ok: true, grant };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0Deny, async (_e, requestId: string, reason: string | undefined, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0Deny);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      await vault.denyRequest({ request_id: requestId, admin_user_id: gate.ctx.user_id, reason });
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0Revoke, async (_e, grantId: string, reason: string | undefined, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0Revoke);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      await vault.revokeGrant({ grant_id: grantId, admin_user_id: gate.ctx.user_id, reason });
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0WriteUnlock, async (_e, password: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0WriteUnlock);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      await vault.unlockWrite({ password, admin_user_id: gate.ctx.user_id });
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0WriteLock, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0WriteLock);
    if (!gate.ok) return { ok: false, error: gate.error };
    await vault.lockWrite({ admin_user_id: gate.ctx.user_id });
    return { ok: true };
  });
  /** §4.4.6：迁移前自动备份（记忆库 + 密钥环）；备份失败 → 拒绝迁移，绝不无备份改写 */
  handleIpc(IPC.l0Migrate, async (_e, opts: { oldPassword?: string } | undefined, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0Migrate);
    if (!gate.ok) return { ok: false, error: gate.error };
    let backupDir: string;
    try {
      backupDir = await backupBeforeKernelChange('l0-migrate', 'l0:migrate-backup');
    } catch (e) {
      actionLog('kernel', 'l0:migrate-backup-fail', { error: String((e as Error)?.message ?? e) }, { level: 'error' });
      return { ok: false, error: `迁移前备份失败：${String((e as Error)?.message ?? e)}` };
    }
    try {
      const report = await vault.migrateLegacy(storage, {
        admin_user_id: gate.ctx.user_id,
        oldPassword: opts?.oldPassword,
      });
      return { ok: true, report, backup_dir: backupDir };
    } catch (e) { return l0Fail(e); }
  });

  // ── 申请/查阅端（任意已登录账号；user_id 只信 home 会话） ──
  handleIpc(IPC.l0Request, async (_e, projectIds: string[], reason: string | undefined, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0Request);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const r = await vault.requestAccess({ project_ids: projectIds ?? [], reason, user_id: gate.ctx.user_id });
      return { ok: true, ...r };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0Unlock, async (_e, req: L0UnlockReq, sessionId?: string) => {
    // 批次26-B P1-11：无 grant_id = 管理密码直接查阅（scope ['*'] 全项目）→ 仅管理员；
    // 带 grant_id 的授权码查阅（grant_id + 一次性密码，§4.4.2）仍只需登录会话 + 归属校验。
    const gate = (req && typeof req === 'object' && !req.grant_id)
      ? requireAdmin(sessionId, IPC.l0Unlock)
      : requireSession(sessionId, IPC.l0Unlock);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const r = await vault.unlock({ grant_id: req?.grant_id, password: req?.password, user_id: gate.ctx.user_id });
      return { ok: true, ...r };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0Heartbeat, async (_e, l0SessionId: string, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0Heartbeat);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const id = await assertOwner(l0SessionId, gate.ctx, IPC.l0Heartbeat);
      return { ok: true, ...(await vault.heartbeat(id)) };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0Lock, async (_e, l0SessionId: string, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0Lock);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const id = await assertOwner(l0SessionId, gate.ctx, IPC.l0Lock);
      await vault.lock(id);
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0SessionInfo, async (_e, l0SessionId: string, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0SessionInfo);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const id = await assertOwner(l0SessionId, gate.ctx, IPC.l0SessionInfo);
      return { ok: true, info: await vault.sessionInfo(id) };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0Decrypt, async (
    _e,
    req: { l0_session_id: string; project_id: string; mem_id: string; envelope: string },
    sessionId?: string,
  ) => {
    const gate = requireSession(sessionId, IPC.l0Decrypt);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const id = await assertOwner(req?.l0_session_id, gate.ctx, IPC.l0Decrypt);
      return { ok: true, content: await vault.decrypt({ ...req, l0_session_id: id }) };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.l0Seal, async (_e, plain: string, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0Seal);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      // 写入加密只认主进程写密钥缓存（未解锁 → [E_L0_LOCKED]），不暴露任何密钥
      return { ok: true, sealed: await vault.seal(plain) };
    } catch (e) { return l0Fail(e); }
  });
}

/**
 * 遗留账本清理（批次24）：§2.2 规则落地前 stub 精炼器给历史行编满 L2–L6，
 * 且可召回正文取的是 stub L2。这里提供只读预览 + 管理员执行两条通道，
 * 把这类行降级回真实的 L1；执行前自动备份，备份失败一律拒绝改写。
 */
/**
 * 遗留账本清理（批次24）：§2.2 规则落地前 stub 精炼器给历史行编满 L2–L6，
 * 且可召回正文取的是 stub L2。这里提供只读预览 + 管理员执行两条通道，
 * 把这类行降级回真实的 L1；执行前自动备份，备份失败一律拒绝改写。
 */
/** 批次28-C：启动自动清理（不再等管理员点卡）。命中才备份+改写；失败只记日志不影响启动。 */
async function autoDemoteLegacyLayers(): Promise<void> {
  try {
    const scan = await scanStubLayers(storage);
    if (scan.hits === 0) return;
    const backupDir = await backupBeforeKernelChange('legacy-auto-demote', 'legacy:auto-demote-backup');
    const now = Date.now();
    const report = await demoteStubLayers({
      storage, admin_user_id: 'system:startup', request_id: `req_legacy_auto_${now}`, now,
    });
    actionLog('kernel', 'legacy:auto-demote', {
      scanned: report.scanned, hits: report.hits, demoted: report.demoted,
      mislabeled: report.mislabeled, missing_l1: report.missing_l1, dir: backupDir,
    });
  } catch (e) {
    actionLog('kernel', 'legacy:auto-demote-fail', { error: String((e as Error)?.message ?? e) }, { level: 'error' });
  }
}

function registerLegacyIpc(): void {
  handleIpc(IPC.legacyScan, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.legacyScan);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      return { ok: true, scan: await scanStubLayers(storage) };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.legacyDemote, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.legacyDemote);
    if (!gate.ok) return { ok: false, error: gate.error };
    let backupDir: string;
    try {
      backupDir = await backupBeforeKernelChange('legacy-demote', 'legacy:demote-backup');
    } catch (e) {
      actionLog('kernel', 'legacy:demote-backup-fail', { error: String((e as Error)?.message ?? e) }, { level: 'error' });
      return { ok: false, error: `清理前备份失败：${String((e as Error)?.message ?? e)}` };
    }
    try {
      const now = Date.now();
      const report = await demoteStubLayers({
        storage, admin_user_id: gate.ctx.user_id, request_id: `req_legacy_${now}`, now,
      });
      actionLog('kernel', 'legacy:demote', {
        scanned: report.scanned, hits: report.hits, demoted: report.demoted,
        missing_l1: report.missing_l1, dir: backupDir,
      });
      return { ok: true, report, backup_dir: backupDir };
    } catch (e) { return l0Fail(e); }
  });
}

async function scheduleDataRootChange(mode: 'change' | 'restore', actor?: string): Promise<{
  ok: boolean; root?: string; restartRequired?: boolean; canceled?: boolean; error?: string;
}> {
  if (!DATA_ROOT_POINTER || !DEFAULT_DATA_ROOT) return { ok: false, error: '无法确定数据目录指针位置' };
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  let root = DEFAULT_DATA_ROOT;
  if (mode === 'change') {
    const pick = await dialog.showOpenDialog(win, { title: '选择新的数据存放位置', properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    const v = validateDataRootPath(pick.filePaths[0]);
    if (!v.ok) return { ok: false, error: v.error };
    root = v.root;
  }
  if (samePath(root, USER_DATA)) return { ok: true, root: USER_DATA, restartRequired: false };
  const writable = ensureDirWritable(root);
  if (!writable.ok) return { ok: false, error: `目录不可写：${writable.error}` };
  const migrateFrom = hasAnyData(USER_DATA) ? USER_DATA : undefined;
  const targetHasData = hasAnyData(root);
  const confirm = await dialog.showMessageBox(win, {
    type: 'warning',
    title: mode === 'restore' ? '恢复默认数据位置' : '更改数据存放位置',
    message: '应用将自动重启',
    detail: [
      `新位置：${root}`,
      migrateFrom ? `现有数据将复制到新位置（不删除原位置）：${USER_DATA}` : '当前没有需要迁移的数据。',
      targetHasData ? '目标目录已有数据：同名文件会先备份为 *.bak-<时间戳>，再用当前数据覆盖。' : '',
      '重启后记忆库、采集游标、main.log、MCP 令牌、备份配置等全部数据都使用新位置。',
    ].filter(Boolean).join('\n\n'),
    buttons: ['确认并重启', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (confirm.response !== 0) return { ok: false, canceled: true };
  try {
    writeDataRootPointer(DATA_ROOT_POINTER, {
      version: DATA_ROOT_POINTER_VERSION,
      root,
      ...(migrateFrom ? { migrateFrom } : {}),
      ...(targetHasData ? { migrateOverwrite: true } : {}),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
  void mlog('data-root:change-scheduled', { by: actor, mode, from: USER_DATA, to: root, migrate: !!migrateFrom, overwrite: targetHasData });
  scheduleRelaunch();
  return { ok: true, root, restartRequired: true };
}

// ── §7 静态服务与请求来源判定 ───────────────────────────────────────────────
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** 静态页服务：监听 0（系统分配），只服务 dist/ 且限制路径穿越；返回实际端口 */
function startStaticServer(): Promise<number> {
  return new Promise((resolve) => {
    const srv = httpCreateServer((req, res) => {
      let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/overview.html';
      const filePath = normalize(join(DIST, urlPath));
      // 前缀边界必须是「目录分隔符」而非字符串前缀：否则 dist-evil/ 也能通过 startsWith(DIST)
      if (filePath !== DIST && !filePath.startsWith(DIST + sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      readFile(filePath)
        .then((buf) => {
          res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
          res.end(buf);
        })
        .catch(() => {
          res.writeHead(404);
          res.end('not found');
        });
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

/** 只信任本机页面：精确静态端口（bootstrap 填充）或 dist 下的 file: 页面；外部站点/其它本机端口一律不信任 */
function isTrustedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === 'file:') {
      if (!trustedFileRoot) return false;
      // 批次27 P3-6：Windows 下 file:///D:/... 的 u.pathname 是 /D:/...，旧实现直接 normalize
      // 得到 \d:\...，永远匹配不上 d:\... 根目录——该分支在 Windows 上从未生效过。
      // fileURLToPath 按平台正确转换；根目录拼 sep 保证目录边界（dist-evil 同样拒绝）。
      let filePath: string;
      try {
        filePath = normalize(fileURLToPath(u)).toLowerCase();
      } catch {
        return false; // file: URL 无法转为本机路径（畸形）→ 不信任
      }
      return filePath.startsWith(normalize(trustedFileRoot + sep).toLowerCase());
    }
    if (u.protocol !== 'http:') return false;
    return trustedIpcOrigins.has(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

/** 只信任本机渲染进程：拒绝被导航到外部页面的 frame 直接调用 IPC（纵深防御） */
function isTrustedSender(event: { senderFrame?: { url?: string } | null }): boolean {
  return isTrustedUrl(event.senderFrame?.url ?? '');
}

/**
 * 带来源校验的 IPC 注册（所有存储/宿主动作统一走这里）；同时记录已注册 channel 供启动自检。
 * 批次7：每个 IPC 动作统一留一行耗时日志（成功/失败），失败额外带 error（脱敏见 shared/actionLog）。
 */
// ── §8 IPC 包装器 + 日志/存储 IPC ───────────────────────────────────────────
/** 观测类通道：成功调用不写动作日志，避免「看日志」本身污染被看的日志（轮询会刷屏） */
const QUIET_IPC_CHANNELS = new Set<string>([IPC.logTail]);

/** 统一 IPC 包装：来源校验 + 耗时/异常动作日志（每个通道一行 ipc:action） */
function handleIpc<A extends unknown[], R>(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: A) => R,
): void {
  registeredIpcChannels.add(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      actionLog('ipc', channel, { rejected: 'untrusted_sender' }, { level: 'warn' });
      throw new Error(`IPC rejected: untrusted sender (${channel})`);
    }
    const started = Date.now();
    try {
      const result = await fn(event, ...(args as A));
      if (!QUIET_IPC_CHANNELS.has(channel)) actionLog('ipc', channel, { ms: Date.now() - started });
      return result;
    } catch (e) {
      actionLog('ipc', channel, { ms: Date.now() - started, error: String((e as Error)?.message ?? e) }, { level: 'error' });
      throw e;
    }
  });
}

/** 单向 IPC（ipcMain.on）：同样做来源校验并纳入注册清单 */
function handleIpcEvent<A extends unknown[]>(
  channel: string,
  fn: (event: Electron.IpcMainEvent, ...args: A) => void,
): void {
  registeredIpcChannels.add(channel);
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) {
      actionLog('ipc', channel, { rejected: 'untrusted_sender' }, { level: 'warn' });
      return;
    }
    // 日志通道自身不再记日志（否则每条 UI 日志都会翻倍）
    if (channel !== IPC.logWrite) actionLog('ipc', channel, { args: args.length });
    fn(event, ...(args as A));
  });
}

/**
 * 渲染层动作日志入口（批次7）：统一校验形状后写入 actions.log。
 * 只接受 { scope, action, detail?, level?, requestId? }，绝不信任渲染层的其他字段。
 */
function registerLogIpc(): void {
  handleIpcEvent(IPC.logWrite, (_e, payload: unknown) => {
    const p = payload as { scope?: unknown; action?: unknown; detail?: unknown; level?: unknown; requestId?: unknown } | null;
    if (!p || typeof p.scope !== 'string' || typeof p.action !== 'string') return;
    const level = p.level === 'warn' || p.level === 'error' ? p.level : 'info';
    actionLog(p.scope.slice(0, 40), p.action.slice(0, 80), p.detail, {
      level,
      requestId: typeof p.requestId === 'string' ? p.requestId.slice(0, 80) : undefined,
    });
  });
  // 程序运行日志窗口（批次19 起由日志记录页使用）：只读尾读，limit 由渲染层传入（1..50 由 tailActionLog 钳制）
  handleIpc(IPC.logTail, (_e, limit?: unknown) =>
    tailActionLog(typeof limit === 'number' ? limit : 5));
}

/**
 * 批次26-B P1-2：数据面写通道会话闸门（删除/审计写/宿主真扫；读与 putMemory 保持开放）。
 * 拒绝时 throw（而非返回 {ok:false}）：调用方是内核 StorageBackend，约定以 Promise 拒绝表达失败，
 * 页面才能把「需要登录」如实透出，而不是把错误对象当成功吞掉。
 */
function requireDataPlaneSession(sessionId: unknown, channel: string): void {
  const gate = requireSession(sessionId, channel);
  if (!gate.ok) throw new Error(gate.error);
}

/** 审计写形状校验（P1-2）：内核合法自报的 request_id（ulid/req_* 关联键，P0-2 依赖）放行，
 *  伪造的超长/非法字符 id、缺 action/ts 的记录整条拒绝 —— 不做语义猜测，只挡注入面。
 *  批次28-A：实现抽到 shared/auditShape.ts，与 home server HTTP 数据面同口径。 */
const validateAuditRecord = sharedValidateAuditRecord;

async function registerStorageIpc(): Promise<void> {
  handleIpc(IPC.storagePutMemory, (_e, m) => storage.putMemory(m as Parameters<typeof storage.putMemory>[0]));
  handleIpc(IPC.storageGetMemory, (_e, id) => storage.getMemory(id as string));
  handleIpc(IPC.storageListMemories, (_e, f) => storage.listMemories(f as Parameters<typeof storage.listMemories>[0]));
  handleIpc(IPC.storageDeleteMemory, (_e, id, sessionId?: unknown) => {
    requireDataPlaneSession(sessionId, IPC.storageDeleteMemory);
    return storage.deleteMemory(id as string);
  });
  handleIpc(IPC.storageAppendAudit, (_e, a, sessionId?: unknown) => {
    requireDataPlaneSession(sessionId, IPC.storageAppendAudit);
    validateAuditRecord(a);
    return storage.appendAudit(a as Parameters<typeof storage.appendAudit>[0]);
  });
  handleIpc(IPC.storageQueryAudit, (_e, f) => storage.queryAudit(f as Parameters<typeof storage.queryAudit>[0]));
  handleIpc(IPC.storageOpenMemoryFile, async (_e, memId: string) => {
    try {
      // 记忆 ID 仅允许安全字符（防路径穿越：memId 直接进导出文件名）
      if (typeof memId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(memId)) {
        return { ok: false, error: 'invalid memory id' };
      }
      const m = await storage.getMemory(memId);
      if (!m) return { ok: false, error: 'Memory not found (may have been deleted)' };
      const exportDir = join(USER_DATA, 'memories-export');
      await mkdir(exportDir, { recursive: true });
      const filePath = join(exportDir, `${memId}.json`);
      await writeFile(filePath, JSON.stringify(m, null, 2), 'utf8');
      const err = await shell.openPath(filePath);
      if (err) return { ok: false, error: err };
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  });
  // 账本位置（「记忆存储在哪」卡片）：真实路径 + 来源（全局数据根）
  handleIpc(IPC.storageLocation, () => ({
    path: DB_PATH,
    source: 'dataRoot',
  }));
  // 宿主真扫（discover 真实化）：主进程执行真实进程/配置探测，绝不返回伪造命中
  // P1-2：真扫一次最多返回 200 个真实进程名（本机信息面），纳入登录会话闸门
  handleIpc(IPC.hostScanRun, (_e, sessionId?: unknown) => {
    requireDataPlaneSession(sessionId, IPC.hostScanRun);
    return scanHost();
  });
  handleIpc(IPC.hostAgentDetectRun, (_e, sessionId?: unknown) => {
    requireDataPlaneSession(sessionId, IPC.hostAgentDetectRun);
    return detectLocalAgents();
  });
  handleIpc(IPC.hostAgentDetectConfig, (_e, agentName) => hostAgentConfig(agentName as string));
  // 批次26-B P1-3：租户三元组由主进程按会话下发（真实源 = home server 会话），渲染层不再自报 mam.tenant.v1
  handleIpc(IPC.tenantGet, (_e, sessionId?: unknown) => {
    const gate = requireSession(sessionId, IPC.tenantGet);
    if (!gate.ok) return { ok: false, error: gate.error };
    return {
      ok: true,
      tenant: { user_id: gate.ctx.user_id, team_id: gate.ctx.team_id, enterprise_id: gate.ctx.enterprise_id },
    };
  });
}

// 悬浮归因窗：贴靠 Claude Desktop 窗口显示（detectClaudeWindow 定位）
// ── §9 悬浮窗（Claude 归因）─────────────────────────────────────────────────
let floatWin: BrowserWindow | null = null;

/** 探测 Claude Desktop 主窗口 bounds（无进程/无可见窗口时返回 null） */
function detectClaudeWindow(): { x: number; y: number; width: number; height: number } | null {
  // 通过 PowerShell P/Invoke（EnumWindows + GetWindowRect）枚举 claude.exe 的可见窗口，取面积最大者。
  // 执行策略可能为 Restricted、且脚本含 here-string/JSON 引号，故统一走 -EncodedCommand（UTF-16LE base64），
  // 不落 .ps1 文件，也不依赖 -Command 的转义规则。
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "$src = @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class W {',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }',
    '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, uint[] pid);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);',
    '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);',
    '  public static string GetLargestRect(uint targetPid) {',
    '    int bestW = 0, bestH = 0, bestL = 0, bestT = 0;',
    '    EnumWindows((h, p) => {',
    '      var pids = new uint[1]; GetWindowThreadProcessId(h, pids);',
    '      if (pids[0] != targetPid || !IsWindowVisible(h)) return true;',
    '      RECT r; GetWindowRect(h, out r);',
    '      int w = r.Right - r.Left; int hh = r.Bottom - r.Top;',
    '      if (w > 100 && hh > 100 && w * hh > bestW * bestH) { bestW = w; bestH = hh; bestL = r.Left; bestT = r.Top; }',
    '      return true;',
    '    }, IntPtr.Zero);',
    '    if (bestW <= 0) return "";',
    '    return bestL + "," + bestT + "," + bestW + "," + bestH;',
    '  }',
    '}',
    "'@",
    "Add-Type -TypeDefinition $src",
    "$cpids = (Get-Process -Name 'claude' -ErrorAction SilentlyContinue).Id",
    "if (-not $cpids) { exit 0 }",
    '$best = ""; $bestArea = 0',
    'foreach ($cpid in $cpids) {',
    '  $line = [W]::GetLargestRect([uint32]$cpid)',
    '  if (-not $line) { continue }',
    "  $parts = $line -split ','",
    '  if ($parts.Count -lt 4) { continue }',
    '  $w = [int]$parts[2]; $h = [int]$parts[3]',
    '  if ($w * $h -gt $bestArea) { $bestArea = $w * $h; $best = $line }',
    '}',
    'if ($best) { Write-Output $best }',
  ].join('\n');
  try {
    const b64 = Buffer.from(psScript, 'utf16le').toString('base64');
    const out = execSync(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`,
      { encoding: 'utf8', timeout: 8000 },
    ).trim();
    if (!out) {
      void flog('detectClaude', 'Claude process not found or no visible window -> null');
      return null;
    }
    const parts = out.split(',');
    if (parts.length < 4) {
      void flog('detectClaude', `                  : "${out}"`);
      return null;
    }
    const x = Number(parts[0]), y = Number(parts[1]), w = Number(parts[2]), h = Number(parts[3]);
    if (Number.isNaN(x) || Number.isNaN(w) || w < 100 || h < 100) {
      void flog('detectClaude', `            : ${out}`);
      return null;
    }
    const best = { x, y, width: w, height: h };
    void flog('detectClaude', `       pos(${x},${y}) ${w}x${h}`);
    return best;
  } catch (e) {
    const msg = (e as { message?: string })?.message ?? String(e);
    void flog('detectClaude', `      : ${msg.slice(0, 500)}`);
    return null;
  }
}

/** 打开（或聚焦）归因浮窗：优先贴在 Claude 窗口右侧，其次左侧，均不可用时屏幕居中 */
function openFloatWindow(staticPort: number): void {
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.focus();
    return;
  }
  const w = 280, h = 520;
  // 跟随 Claude 窗口定位；未检测到则屏幕居中
  const pos = detectClaudeWindow();
  const sw = screen.getPrimaryDisplay().size.width;
  const sh = screen.getPrimaryDisplay().size.height;
  let x: number, y: number;
  if (pos) {
    // 默认放在 Claude 窗口右侧，间隔 8px
    x = pos.x + pos.width + 8;
    // 右侧放不下 → 改放左侧
    if (x + w > sw) x = Math.max(0, pos.x - w - 8);
    y = Math.max(0, pos.y + 40);
    // 浮窗比 Claude 窗口矮时垂直居中
    if (h < pos.height) y += Math.round((pos.height - h) / 2);
  } else {
    // 未检测到 Claude → 屏幕居中
    x = Math.round(sw / 2 - w / 2);
    y = Math.round(sh / 2 - h / 2);
  }
  floatWin = new BrowserWindow({
    width: w, height: h,
    x, y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    show: false, // 等 did-finish-load 后再 showInactive，避免白屏闪一下
    title: '归因浮窗',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  floatWin.setAlwaysOnTop(true, 'screen-saver');
  console.log(`[float] open @(${x},${y}) ${w}x${h}`);
  void flog('open', `浮窗打开 pos(${x},${y}) ${w}x${h} pos=${pos ? `claude(${pos.x},${pos.y})` : 'null'}`);
  void floatWin.loadURL(`http://127.0.0.1:${staticPort}/floatattribution.html`)
    .then(() => {
      console.log('[float] loadURL ok');
      void flog('loadURL', 'ok');
    })
    .catch((e) => {
      console.error('[float] loadURL failed:', e);
      void flog('loadURL', `failed: ${String(e)}`);
    });
  floatWin.webContents.on('did-finish-load', () => {
    floatWin?.showInactive();
    void flog('did-finish-load', 'showInactive');
  });
  floatWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[float] did-fail-load code=${code} desc=${desc} url=${url}`);
    void flog('did-fail-load', `code=${code} desc=${desc} url=${url}`);
    // 加载失败也把窗口显示出来：让用户看到错误页，而不是静默什么都不出现
    floatWin?.showInactive();
  });
  floatWin.on('closed', () => {
    floatWin = null;
    void flog('closed', 'float window closed');
  });
}

// 浮窗 IPC：bootstrap 内、创建窗口前统一注册（含启动自检覆盖）
function registerFloatIpc(staticPort: number): void {
  // 探测 Claude 窗口位置（供渲染层定位归因浮窗）
  handleIpc(IPC.floatDetectClaude, () => {
    const pos = detectClaudeWindow();
    return pos ? { x: pos.x, y: pos.y, width: pos.width, height: pos.height } : null;
  });
  //                               
  handleIpc(IPC.floatSetPosition, (_e, x: number, y: number) => {
    if (floatWin && !floatWin.isDestroyed()) {
      floatWin.setPosition(Math.round(x), Math.round(y));
    }
  });
  //                                                    
  handleIpc(IPC.floatOpen, () => {
    try {
      void flog('open-request', `staticPort=${staticPort}`);
      openFloatWindow(staticPort);
      return { ok: true };
    } catch (e) {
      console.error('[float] open       :', e);
      void flog('open-fail', String((e as { message?: string })?.message ?? e));
      return { ok: false, error: String((e as { message?: string })?.message ?? e) };
    }
  });
  //       
  handleIpc(IPC.floatClose, () => {
    void flog('close', 'request close float win');
    if (floatWin && !floatWin.isDestroyed()) floatWin.close();
    floatWin = null;
    return { ok: true };
  });
  // 渲染层日志回写（单向 IPC，来源校验统一由 handleIpcEvent 完成）
  handleIpcEvent(IPC.floatLog, (_e, msg: string) => {
    void flog('render', String(msg ?? ''));
  });
}

// ── §10 bootstrap ───────────────────────────────────────────────────────────
let bootStarted = false;

async function bootstrap(): Promise<void> {
  // activate 事件可能重复触发；重复执行会二次注册 IPC（ipcMain.handle 抛 duplicate）并抢端口
  if (bootStarted) return;
  bootStarted = true;
  // 延迟初始化 USER_DATA / DB_PATH（在 Electron 主进程上下文中，require('electron') 才返回真实 API）
  // 赋值给顶层 let，供 flog/mlog 等顶层函数闭包使用（避免模块加载期 ReferenceError）
  USER_DATA = app.getPath('userData');
  DB_PATH = join(USER_DATA, 'memories.db.json');
  COLLECTOR_CURSOR_FILE = join(USER_DATA, 'collector-cursor.json');
  FLOAT_LOG = join(USER_DATA, 'float.log');
  MAIN_LOG = join(USER_DATA, 'main.log');
  BACKUP_CFG_PATH = join(USER_DATA, 'backup-config.json');
  // 动作日志（批次7）：先于迁移/服务启动初始化，保证启动期动作也有落盘
  initActionLog({ file: join(USER_DATA, 'actions.log') });
  actionLog('app', 'bootstrap:start', { root: USER_DATA });
  // 数据根迁移必须在 FileStorage/服务启动前完成（无在途写）：只复制白名单、不覆盖、不删源
  const dataRootMigration = applyDataRootMigration();
  const legacyDbImported = importLegacyDbDir();
  storage = new FileStorage(DB_PATH);
  // 上次损坏已隔离 → 本次是空库：必须让用户知道原件位置，不能静默开空库
  const corruptNotice = storage.takeCorruptionNotice();
  if (corruptNotice) void mlog('storage:corrupt-notice', corruptNotice);
  void mlog('bootstrap:data-root', {
    root: USER_DATA,
    defaultRoot: DEFAULT_DATA_ROOT,
    isDefault: !!DEFAULT_DATA_ROOT && samePath(USER_DATA, DEFAULT_DATA_ROOT),
    pointer: DATA_ROOT_POINTER,
    pointerWriteError: dataRootPointerWriteError,
    migration: dataRootMigration
      ? { from: dataRootMigration.from, copied: dataRootMigration.copied, skipped: dataRootMigration.skipped, errors: dataRootMigration.errors, dbSource: dataRootMigration.dbSource }
      : null,
    legacyDbImported,
  });
  if (dataRootMigration || legacyDbImported) {
    void storage.appendAudit({
      request_id: `req_dataroot_${Date.now().toString(36)}`,
      action: 'memory_op',
      ts: Date.now(),
      project_id: 'P1',
      detail: {
        op: 'data_root_migrate',
        from: dataRootMigration?.from ?? legacyDbImported,
        to: USER_DATA,
        copied: dataRootMigration?.copied ?? [],
        skipped: dataRootMigration?.skipped ?? [],
        backedUp: dataRootMigration?.backedUp ?? [],
        errors: dataRootMigration?.errors ?? [],
        legacyDbImported,
      },
    } as never);
  }
  void mlog('bootstrap:start');
  registerStorageIpc();
  registerLogIpc();
  registerBackupIpc();
  registerDataRootIpc();
  void mlog('backup:scheduler-ready');

  // 账号只来自真实注册（POST /api/register 落盘）；不再预置演示账号

  // 敏感 Web 权限默认拒绝（本应用不需要摄像头/麦克风/定位/通知/USB 等）
  try {
    const DENY = new Set([
      'media', 'audioCapture', 'videoCapture', 'geolocation', 'notifications',
      'midi', 'midiSysex', 'usb', 'serial', 'hid', 'idle-detection',
    ]);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(!DENY.has(permission));
    });
  } catch (err) {
    console.error('[electron] setPermissionRequestHandler failed', err);
  }

  // 静态服务端口是 IPC/CORS 信任的唯一页面来源，必须在创建任何窗口/服务前确定
  const staticPort = await startStaticServer();
  void mlog('bootstrap:static-server', { port: staticPort });
  const uiOrigins = [`http://127.0.0.1:${staticPort}`, `http://localhost:${staticPort}`];
  for (const o of uiOrigins) trustedIpcOrigins.add(o);
  trustedFileRoot = DIST;
  registerFloatIpc(staticPort);

  // preload 只在主 frame 执行（webPreferences.preload），overview.html 内嵌 <iframe> 拿不到
  // window.__ELECTRON__/window.api 属预期行为：子页面统一走 desktop/hostBridge.ts 的消息桥，
  // 由顶层窗口代理 storage.*/hostScan.* 等能力。session.registerPreloadScript 对子 frame 无效，勿再尝试。

  // home server（登录/审计镜像）：CORS/IPC 同源白名单 = 静态服务精确来源
  const home = createServer({
    port: MIRROR_PORT,
    dataFile: join(USER_DATA, 'home-audit.json'),
    allowedOrigins: uiOrigins,
    // 未打包（npm run dev 配合桌面壳调试）时额外信任 Vite dev 源 5180；打包态严格只认自身静态端口
    allowDevOrigins: !app.isPackaged,
    // 批次28-A：内核数据面 —— 浏览器页面凭登录会话直连本进程的 FileStorage；
    // 桌面端持有写锁（唯一写者），HTTP 数据面与 IPC 数据面共用同一账本实例。
    kernelStorage: storage,
    kernelInfo: { readonly: storage.readOnly, db_path: DB_PATH },
    onLog: (scope, action, detail) => { actionLog(scope, action, detail); },
  });
  // 登录会话真源：敏感 IPC（数据位置/备份/安全）用 getSessionContext 校验管理员
  homeServerRef = home;
  home.listen(MIRROR_PORT, '127.0.0.1').on('error', (e) => { void mlog('bootstrap:home-listen-error', String(e?.message ?? e)); });

  // L0 密钥环（§4.4）：DEK 只在主进程内存；管理/授权密码只以 PBKDF2 包裹 DEK 落盘。
  // 启动即作废上次未消费的授权（连续性已断）并清空内存密钥，写密钥需管理员重新解锁。
  const l0KeyringFile = join(USER_DATA, 'l0-keyring.json');
  await cleanupTempFiles(l0KeyringFile);
  const l0Vault = new L0Vault({
    keyring: createL0KeyringStore(l0KeyringFile),
    locks: createHomeLockStore(() => homeServerRef),
    audit: storage,
    storage,
    form: 'desktop',
  });
  await l0Vault.onAppRestart();
  registerL0Ipc(l0Vault);
  registerLegacyIpc();
  // 批次28-C：遗留账本自动清理 —— 批次24 的清理卡要管理员手动点，实际一直没执行；
  // 现在启动即扫描（stub 深层行 + 误标层行），命中就先备份再自动降级回 L1，审计可回查。
  void autoDemoteLegacyLayers();
  // 空闲到期必须有主进程定时兜底：无人操作时也按 5min 清会话/DEK 并作废 grant（§4.4.3）
  const l0Sweeper = setInterval(() => {
    void l0Vault.sweep().catch((e) => { void mlog('l0:sweep-error', String((e as Error)?.message ?? e)); });
  }, 30_000);
  l0Sweeper.unref?.();
  l0VaultRef = l0Vault;
  void mlog('bootstrap:l0-vault-ready', { keyring: l0KeyringFile, ...(await l0Vault.status()) });

  const agentOnboard = await createAgentOnboardServer({
    port: AGENT_ONBOARD_PORT,
    dataFile: join(USER_DATA, 'agent-onboard.json'),
    allowedOrigins: uiOrigins,
    // 未打包调试时允许 Vite dev 源；打包态不放开
    allowDevOrigins: !app.isPackaged,
    // 批次26 P0-5：写端点以 x-session-id 经登录服务校验（密钥类操作需 admin）；缺省拒绝
    getSession: (sid) => homeServerRef?.getSessionContext(sid) ?? null,
    onLog: (scope, action, detail) => { actionLog(scope, action, detail); },
  }).catch((e) => {
    // 端口被占（EADDRINUSE）→ 写诊断日志后上抛，避免 bootstrap 静默挂起
    void mlog('bootstrap:agentOnboard-error', String((e as Error)?.message ?? e));
    throw e;
  });

  // MCP 两端口都要求令牌：HTTP 走 Authorization/x-mcp-token，TCP 走 initialize params.token。
  // 令牌只落 userData/mcp-token.txt（0600），用户把它配置给 Agent；日志只记路径，绝不记明文。
  const mcpToken = loadOrCreateMcpToken();
  const mcpTokenFile = join(USER_DATA, 'mcp-token.txt');
  void mlog('bootstrap:mcp-token-ready', { file: mcpTokenFile });
  // 客户端接入面板（批次15）：令牌就绪后才能生成片段/一键写入
  registerMcpClientsIpc(mcpToken);
  // LLM 精炼网关（批次31）：配置/密钥就绪后内核写路径才能产出 L2–L6；未配置时保持 stub 口径
  llmGateway = loadLlmGateway(USER_DATA);
  void mlog('bootstrap:llm-gateway', { usable: !!llmGateway });
  registerLlmIpc();

  const mcp = runMcpServer({ storage, port: MCP_PORT, token: mcpToken, l0: l0Vault });
  mcp.ready
    .then((p) => { void mlog('bootstrap:mcp-listening', { port: p }); })
    .catch((e) => { void mlog('bootstrap:mcp-listen-error', String((e as Error)?.message ?? e)); });

  // 标准 MCP streamable-http（DSH dsh-mcp-client 走这条路连记忆库；POST /mcp → initialize/tools/list/tools/call）
  const mcpHttp = runMcpHttpServer({ storage, port: MCP_HTTP_PORT, token: mcpToken, l0: l0Vault });
  mcpHttp.ready
    .then((p) => { void mlog('bootstrap:mcp-http-listening', { port: p }); })
    .catch((e) => { void mlog('bootstrap:mcp-http-listen-error', String((e as Error)?.message ?? e)); });

  // Webhook 入口（19.3）：POST /ingest 收外部 agent 推送 → SHA-256 去重 → coreWrite 走 L0 加密与 L1~L6 分层精炼
  // 批次26-A P0-4：信任边界与 MCP 同源（mcp-token.txt 令牌 + 受信 Origin + 1 MiB 上限）；status/hash 只回 id 与状态。
  const webhookVector = new JsVectorBackend();
  const webhook = createWebhook({
    storage,
    refinePipeline: async (input) => {
      const r = await coreWrite(
        {
          content: input.content,
          category: input.category,
          project_id: input.project_id,
          source_agent: input.source_agent,
        },
        { storage, vector: webhookVector, account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' }, request_id: `req_wh_${Date.now()}`, now: Date.now(), l0: l0Vault },
      );
      const filtered = r.dedup.action === 'filtered';
      return {
        ok: !filtered,
        // filtered 未入库 → error（不伪装成 duplicate）；grafted 已新建但嫁接到既有记忆 → grafted
        dedup: filtered ? 'error' : r.dedup.action === 'duplicated' ? 'duplicate' : r.dedup.action === 'grafted' ? 'grafted' : 'new',
        mem_id: r.mem_id,
        l2_preview: r.layers?.content_l2,
        refined_by: r.refined_by,
        error: filtered ? `L0→L1 质量门拦截：${(r.spec_violations ?? []).join('；')}` : undefined,
        ts: new Date().toISOString(),
      };
    },
  });

  const webhookSrv = createWebhookHttpServer({
    token: mcpToken,
    webhook,
    trustedOrigins: trustedIpcOrigins,
    onLog: (action, detail) => { actionLog('webhook', action, detail); },
  });
  webhookSrv.listen(WEBHOOK_PORT, '127.0.0.1', () => {
    console.log(`[webhook] listening 127.0.0.1:${WEBHOOK_PORT} (19.3 入口，需 mcp-token)`);
  });
  webhookSrv.on('error', (err) => {
    console.error('[webhook] listen failed', err.message);
  });
  void mlog('bootstrap:webhook-listening', { port: WEBHOOK_PORT });

  // 会话自动采集（§5.1 双链路补偿 P0）：游标 + seenHashes 持久化到 userData，首扫延迟、周期 5min，
  // 只读真实存在的 Agent 会话日志（Claude Code JSONL / workbuddy Markdown 等），无日志则诚实 skip。      
  const collectorCursorFile = COLLECTOR_CURSOR_FILE;
  let collectorCursor: CollectorCursor = {};
  let collectorSeen = new Set<string>();
  try {
    const raw = await readFile(collectorCursorFile, 'utf8');
    const parsed = JSON.parse(raw) as { cursor?: CollectorCursor; seen?: string[] };
    if (parsed.cursor) collectorCursor = parsed.cursor;
    collectorSeen = new Set(parsed.seen ?? []);
  } catch {
    // 首次启动 / 文件损坏 → 从空游标开始（不阻塞启动）
  }

  const collectorVector = new JsVectorBackend();

  // 首扫：等窗口 ready-to-show 后延迟触发一次（避免启动即抢 IO 卡住首屏）；
  // 之后由 reconciler 每 5min 自动对账，单轮最多 COLLECTOR_MAX_PER_ROUND 条。
  const startFirstScan = () => {
    void mlog('collector:first-scan:scheduled', { delayMs: COLLECTOR_FIRST_SCAN_DELAY_MS, maxPerRound: COLLECTOR_MAX_PER_ROUND });
    setTimeout(() => {
      void mlog('collector:first-scan:start');
      reconciler.runOnce()
        .then((s) => void mlog('collector:first-scan:done', { collected: s.collected, deduped: s.deduped, skipped: s.skipped.length }))
        .catch((e) => void mlog('collector:first-scan:error', String((e as Error)?.message ?? e)));
    }, COLLECTOR_FIRST_SCAN_DELAY_MS);
  };

  // 探测到的已安装 agent（宿主真扫 + 接入流程回填），用于扩展采集源白名单
  // 缺省覆盖 Qoder CN / Trae / Zcode / Cursor / Gemini / Qwen 等已知会话日志位置
  let detectedAgentNames: string[] = [];
  const buildSources = () => defaultAgentSources({ agents: detectedAgentNames.length > 0 ? detectedAgentNames : undefined });
  // source 用函数形式：每轮现取游标与 agent 白名单，保证增量续采与动态扩展都生效
  const reconciler = createReconciler({
    intervalMs: COLLECTOR_INTERVAL_MS, // §5.1 预设 5min
    source: () => ({
      sources: buildSources(),
      cursor: collectorCursor,
      seenHashes: collectorSeen,
      maxItemsPerRun: COLLECTOR_MAX_PER_ROUND, // 单轮上限 50 条，防大批量灌入卡死事件循环
    }),
    runOnStart: false,
    onScan: async (scan: ScanResult) => {
      // 扫描阶段会把新指纹写进 seenHashes；失败时整体回滚，避免残留“已见”导致下轮跳过
      const seenBefore = new Set(collectorSeen);
      // 一批写入只落盘一次（L0→L6 逐条 coreWrite 期间不逐次同步写盘），finally 统一 commit
      storage.beginBatch?.();
      let applied: { written: number; failed: number } | null = null;
      let committed = false;
      try {
        applied = await applyScanToStore(scan, {
          write: async (input) => {
            const r = await coreWrite(
              {
                content: input.content,
                category: input.category as Category,
                project_id: input.project_id,
                source_agent: input.source_agent,
                session_id: input.session_id,
              },
              { storage, vector: collectorVector, account: { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' }, request_id: `req_col_${Date.now()}`, now: Date.now(), l0: l0Vault },
            );
            return { mem_id: r.mem_id, dedup: r.dedup };
          },
          audit: async (rec) => {
            await storage.appendAudit({
              request_id: rec.request_id,
              action: rec.action as AuditAction,
              ts: rec.ts,
              project_id: rec.project_id,
              detail: rec.detail as Record<string, unknown>,
            });
          },
          project_id: 'P1',
        });
      } catch (e) {
        console.error('[collector] scan apply failed', e);
        void mlog('collector:scan-apply-error', String((e as Error)?.message ?? e));
      } finally {
        // 无论成功失败都尝试提交本批（异常时也避免已写入的内存数据丢失）
        try {
          storage.commitBatch();
          committed = true;
        } catch (e) {
          console.error('[collector] commit failed', e);
          void mlog('collector:commit-error', String((e as Error)?.message ?? e));
        }
      }

      // 游标只在「本批提交成功 + 无失败写入」后推进；否则保留旧游标 + 回滚 seen，下轮重采（coreWrite 去重兜底）。
      // 旧实现先写游标后 commit：崩溃窗口或单条写失败会永久跳过这些消息。
      const canAdvance = committed && applied !== null && applied.failed === 0;
      if (canAdvance) {
        collectorCursor = scan.cursors;
        try {
          await mkdir(USER_DATA, { recursive: true });
          await writeFile(
            collectorCursorFile,
            JSON.stringify({
              cursor: scan.cursors,
              seen: [...collectorSeen].slice(-5000), // 只保留最近 5000 条指纹，防文件无限膨胀
              updatedAt: new Date().toISOString(),
            }),
            'utf8',
          );
        } catch (e) {
          console.error('[collector] cursor persist failed', e);
        }
      } else {
        collectorSeen = seenBefore;
        if (applied !== null && applied.failed > 0) {
          void mlog('collector:cursor-hold', { failed: applied.failed, collected: scan.collected, reason: 'write_failed' });
        }
      }

      if (scan.collected > 0 || (applied?.written ?? 0) > 0) {
        console.log(`[collector] period done: collected=${scan.collected} written=${applied?.written ?? 0}${applied && applied.failed > 0 ? ` failed=${applied.failed}` : ''} ${scan.deduped ? `deduped=${scan.deduped}` : ''}`);
      }
      if (scan.skipped.length > 0) {
        for (const s of scan.skipped) console.log(`[collector] ${s}`);
      }
    },
  });

  handleIpc(IPC.collectorStatus, () => {
    const last = reconciler.last;
    return {
      ok: true,
      running: !reconciler.stopped,
      intervalMs: reconciler.intervalMs,
      last: last ? { collected: last.collected, deduped: last.deduped, skipped: last.skipped, ts: last.ts } : null,
    };
  });
  // 19.9 接入成功立即对账：不等 5min 周期，接入后马上读新 agent 的会话日志
  handleIpc(IPC.collectorTriggerNow, async (_e, agentNames?: string[]) => {
    // 把 detector/接入流程探测到的 agent 并入白名单，再触发一轮采集
    if (agentNames && agentNames.length > 0) {
      detectedAgentNames = [...new Set([...detectedAgentNames, ...agentNames])];
    }
    const r = await reconciler.runOnce();
    return { ok: true, collected: r.collected, deduped: r.deduped, skipped: r.skipped, ts: r.ts };
  });

  console.log(`[collector] 会话采集器已创建（§5.1 周期 ${COLLECTOR_INTERVAL_MS / 1000}s，预设 5min）`);
  void mlog('bootstrap:collector-created', { intervalMs: COLLECTOR_INTERVAL_MS });

  // 遗忘引擎周期调度（REQ-010 17.10）：runForgettingCycle 此前只有定义、无生产调用，
  // 参数页「自动整理」开关也未生效。现按 6h 真实执行；auto_organize=false 时按 AC-14
  // 只记 skipped 审计、不改任何记忆；冷压缩每周最多一次。可用 MAM_FORGETTING_DISABLED=1 整体关闭。
  const FORGETTING_FIRST_DELAY_MS = Number(process.env.MAM_FORGETTING_FIRST_DELAY_MS) || 10 * 60_000;
  const FORGETTING_INTERVAL_MS = Number(process.env.MAM_FORGETTING_INTERVAL_MS) || 6 * 3600_000;
  const runForgettingScheduled = async (why: string): Promise<void> => {
    const now = Date.now();
    try {
      const mems = await storage.listMemories({});
      const enabled = autoOrganizeEnabled(mems);
      const gcAudits = await storage.queryAudit({ action: 'gc' });
      const lastCompress = Math.max(
        0,
        ...gcAudits.filter((a) => a.detail?.weeklyCompress === true).map((a) => a.ts),
      );
      const weeklyCompress = now - lastCompress >= 7 * 24 * 3600_000;
      // 一轮写盘一次（层迁移/合并可能涉及上千条），避免逐条全量 persist 卡住主进程
      storage.beginBatch?.();
      try {
        const report = await runForgettingCycle(storage, now, { enabled, weeklyCompress });
        void mlog('forgetting:cycle:done', { why, enabled, weeklyCompress, ...report });
      } finally {
        storage.commitBatch();
      }
    } catch (e) {
      void mlog('forgetting:cycle:error', { why, error: String((e as Error)?.message ?? e) });
    }
  };
  if (process.env.MAM_FORGETTING_DISABLED === '1') {
    void mlog('forgetting:scheduler-disabled', { reason: 'MAM_FORGETTING_DISABLED=1' });
  } else {
    setTimeout(() => {
      void runForgettingScheduled('first');
      setInterval(() => void runForgettingScheduled('interval'), FORGETTING_INTERVAL_MS);
    }, FORGETTING_FIRST_DELAY_MS);
    void mlog('bootstrap:forgetting-scheduled', {
      firstDelayMs: FORGETTING_FIRST_DELAY_MS, intervalMs: FORGETTING_INTERVAL_MS,
    });
  }

  // 所有 IPC 注册完毕：preload 声明了但没注册的 channel = 渲染层死桥；宁可启动失败也不静默
  const missing = missingChannels(registeredIpcChannels);
  if (missing.length > 0) throw new Error(`IPC 注册缺失: ${missing.join(', ')}`);

  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: '多Agent记忆助手',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
  } catch (e) {
    void mlog('bootstrap:window-failed', String((e as Error)?.message ?? e));
    return;
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // 仅本机页面允许开新窗口并注入 preload；来源必须是精确受信 origin，外部 URL 交给系统浏览器
    if (isTrustedUrl(url)) {
      const child = new BrowserWindow({
        width: 1280,
        height: 860,
        title: '记忆助手',
        webPreferences: {
          preload: join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      void child.loadURL(url);
      return { action: 'deny' };
    }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // 显式传端口：?backend= 供 mirrorClient 走 home server，?agentBackend= 供 useBackendMirror 走 agentOnboard server
  win.loadURL(`http://127.0.0.1:${staticPort}/overview.html?backend=http://127.0.0.1:${MIRROR_PORT}&agentBackend=http://127.0.0.1:${AGENT_ONBOARD_PORT}`);

  if (corruptNotice) {
    const detail = [
      `损坏文件：${corruptNotice.db_path}`,
      `备份位置：${corruptNotice.backup_path ?? '备份失败（请保留原文件排查）'}`,
      `检测时间：${corruptNotice.ts}`,
      `错误：${corruptNotice.error}`,
    ].join('\n');
    win.webContents.once('did-finish-load', () => {
      void dialog.showMessageBox(win, {
        type: 'warning',
        title: '本地记忆库曾被隔离',
        message: '上次启动检测到本地记忆库损坏，已隔离损坏文件并新建空库。',
        detail,
        buttons: ['知道了'],
      });
    });
  }

  // 首扫自带 10s 延迟（startFirstScan 内部 setTimeout），不依赖窗口事件，避免事件名写错导致永不触发
  startFirstScan();
  void mlog('bootstrap:done');


  win.on('closed', () => {
    // close() 内部会把未提交批次落盘；写盘失败（磁盘满/被占用/权限）现在会抛出。
    // 这里必须兜住：退出路径不能被一个 flush 异常打断，导致 home/mcp/webhook 后续服务关不掉。
    // 失败要可见（动作日志 + 主日志），绝不静默当作已保存。
    try {
      storage.close();
      void mlog('kernel:storage-close', { result: 'flushed' });
    } catch (e) {
      void mlog('kernel:storage-close-fail', { error: String((e as Error)?.message ?? e) });
      actionLogError('kernel', 'storage:close-commit-fail', e, {
        note: '退出前未提交批次落盘失败，数据可能未保存',
      });
    }
    home.close();
    homeServerRef = null;
    void agentOnboard.stop();
    mcp.stop();
    mcpHttp.stop();
    webhookSrv.close();
    reconciler.stop();
  });
}



// 顶层注册：exe 正常启动时 require("electron") 返回主进程完整对象（app 一定可用）。
// 保留 app 判空：若 main.cjs 被误用普通 Node 加载（shim 环境，app 为 undefined），
// 直接记日志并退出，避免静默卡死成"打不开"。
// 单实例：第二个实例直接退出并唤起已有窗口（避免两个进程抢同一端口/同一账本文件）
// ── §11 单实例与窗口生命周期 ────────────────────────────────────────────────
const gotSingleInstanceLock = app?.requestSingleInstanceLock ? app.requestSingleInstanceLock() : true;
if (app && !gotSingleInstanceLock) {
  app.quit();
}

if (app && gotSingleInstanceLock) {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  // 未捕获异常/未处理拒绝由顶部 process.on 统一记录（app 上没有同名事件，别写 app.on）
  // L0 安全钩子（§4.4.3/§4.4.4）：退出清空内存密钥；锁屏/休眠在 whenReady 内注册（powerMonitor 需 app ready）
  app.on('before-quit', () => { void l0VaultRef?.onExit().catch(() => undefined); });
  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error('[fail-load]', code, desc, url));
    win.webContents.on('render-process-gone', (_e, d) => console.error('[gone]', JSON.stringify(d)));
    // 导航闸门：只允许留在本机页面；外部 http(s) 交给系统浏览器，其余一律拦截
    win.webContents.on('will-navigate', (event, url) => {
      if (isTrustedUrl(url)) return;
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    });
    win.on('closed', () => console.error('[window-closed]'));
  });
} else if (!app) {
  console.error('[main] require("electron") 返回的对象没有 app（shim 环境）— 请在 Electron 主进程中运行 main.cjs');
}
if (app?.whenReady && gotSingleInstanceLock) {
  // 单点失败出口：日志 + 弹窗 + 退出（旧实现双 catch 串联，第二层永远不可达 → 无窗口僵尸进程）
  app.whenReady().then(async () => {
    // 锁屏/休眠立即清空 L0 查阅会话与写密钥并作废 active grants（§4.4.3；两者互不替代 §4.4.4）
    powerMonitor.on('lock-screen', () => { void l0VaultRef?.onSecurityLock('screen_lock').catch(() => undefined); });
    powerMonitor.on('suspend', () => { void l0VaultRef?.onSecurityLock('suspend').catch(() => undefined); });
    if (!(await prepareDataRoot())) return;
    await bootstrap();
  }).catch((err: unknown) => {
    handleBootFailure(err, {
      log: (e) => {
        console.error('[electron] bootstrap failed', e);
        void mlog('bootstrap:fatal', String(e));
      },
      showError: (title, message) => dialog.showErrorBox(title, message),
      exit: (code) => app.exit(code),
    });
  });
}

app?.on?.('window-all-closed', () => {
  if (process.platform !== 'darwin') void app?.quit?.();
});

app?.on?.('activate', () => {
  if (!gotSingleInstanceLock) return;
  if (BrowserWindow.getAllWindows().length === 0) void bootstrap();
});
