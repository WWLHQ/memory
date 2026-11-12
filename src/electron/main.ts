import { app, BrowserWindow, ipcMain, Menu, nativeTheme, powerMonitor, session, shell } from 'electron';
process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err?.message, err?.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled-rejection]', reason);
});
// Electron 主进程入口：
// - bootstrap：静态服务 + 本机后端（home / agentOnboard / MCP / webhook）+ FileStorage（userData 持久化），
//   失败统一走 handleBootFailure（日志 + 弹窗 + exit(1)，A3）；
// - 窗口：主窗口加载 workspace.html（工作台壳层），webPreferences.preload 只注入主 frame；
// - IPC：channel 常量统一在 ipcChannels.ts，启动时校验注册完整性（A2）。
import { createServer, type HomeServer } from '../home/server.ts';
import { createServer as createAgentOnboardServer } from '../agentOnboard/server.ts';
import { FileStorage } from '../core/memagent/fileStorage.ts';
import { FilePersonalStore } from '../core/memagent/personalStoreFile.ts';
import { parsePersonalOwnerBindings, type PersonalOwnerBinding } from '../core/memagent/personalStore.ts';
import { createPersonalApi, type PersonalSyncPort } from '../core/memagent/personal.ts';
import { FileL0BlobStore } from '../core/memagent/l0Store.ts';
import {
  BACKUP_PREFIX, backupTargetDir, backupTargetDirs, kindOfBackupName, planBackupFiles, selectBackupsToDelete, sortBackupsNewestFirst,
  type BackupKind,
} from './backupFiles.ts';
import { validateAuditRecord as sharedValidateAuditRecord } from '../shared/auditShape.ts';
import { scanHost } from './hostScan.ts';
import { IPC, missingChannels, handleBootFailure, SHELL_SHORTCUT_CHANNEL, type ShellShortcut } from './ipcChannels.ts';
import { createStorageReadWriteHandlers } from './storageIpc.ts';
import { initActionLog, actionLog, actionLogError, tailActionLog } from './actionLog.ts';
import type { TenantContext } from '../types/home.ts';
import {
  DATA_ROOT_POINTER_VERSION, LEDGER_FILE_NAME, L0_FILE_NAME, L0_KEYRING_FILE_NAME,
  adoptLibraryDirIntoPlace, clearDataRootMigrateFrom, dataRootPointerPath, defaultDataRoot, detectDataRoots, ensureDirWritable,
  hasAnyData, hasLibraryDirs, isSetupComplete, libraryFileState, migrateDataRoot, readDataRootPointer, resolveLibraryPaths,
  samePath, summarizeDataDir, validateDataRootPath, wizardRequired, writeDataRootPointer,
  type DataRootMigration, type DataRootPointer, type DataRootSummary, type LibraryPaths,
} from './dataRoot.ts';
import { AUDIT_FILE_NAME } from '../core/memagent/auditLog.ts';
import { detectLocalAgents, hostAgentConfig } from './agentDetect.ts';
import { applyRecallEvidence, scanMcpClients, snippetForClient, wireMcpClient } from './mcpClients.ts';
import {
  applyProbeResult, applyProxyAccounting, LLM_PRESETS, llmEngineViews, loadLlmConfig, loadLlmGateway, loadLlmKeys, mergeLlmConfig,
  saveLlmConfig, saveLlmKey, testEngine, type LlmConfigPatch, type LlmGatewayConfig, type LlmGatewayProvider,
} from './llmGateway.ts';
import { BILLING_TTL_MS, LlmBillingService } from './llmBilling.ts';
import { UNSET_MANUAL_BILLING } from '../shared/billing.ts';
import { createServer as httpCreateServer } from 'node:http';
import { runMcpServer } from '../core/memagent/mcp.ts';
import { runMcpHttpServer } from '../core/memagent/mcpHttp.ts';
import { MemoryPendingStore, type PendingStore } from '../core/memagent/pendingWrites.ts';
import { summarizePendingWrites } from '../shared/pendingWritesView.ts';
import { ensureSharedProject } from '../core/memagent/mcpRecall.ts';
import { FileTokenStore } from '../core/memagent/tokenStore.ts';
import { FileMemberStore } from '../core/memagent/memberStore.ts';
import { loadOrCreateTenant } from './tenantSource.ts';
import { PgSyncHub } from '../core/memagent/pgSyncHub.ts';
import { reconcile as syncReconcileEngine } from '../core/memagent/sync.ts';
import { createWebhook } from '../core/memagent/webhook.ts';
import { createWebhookHttpServer } from './webhookServer.ts';
import type { AuditAction, Category, Form, Memory } from '../core/memagent/types.ts';
import {
  createReconciler, applyScanToStore, defaultAgentSources,
  type CollectorCursor, type ScanResult,
} from '../core/memagent/sessionCollector.ts';
import { DAEMON_DIR_NAME, drainCollectPending, PENDING_DIR_NAME } from '../core/memagent/collectDaemon.ts';
import { coreWrite } from '../core/memagent/memories.ts';
import { L0Vault } from '../core/memagent/l0vault.ts';
import { demoteStubLayers, scanStubLayers } from '../core/memagent/legacyLayers.ts';
import { purgeLedger, scanLedgerForReset } from '../core/memagent/ledgerReset.ts';
import { rejudgeRows, scanRowsForRejudge } from '../core/memagent/rejudge.ts';
import { backfillMissingFields, scanRowsForBackfill } from '../core/memagent/fieldBackfill.ts';
import { normalizeTenantFields, scanRowsForTenantNormalize } from '../core/memagent/tenantNormalize.ts';
import { scanLedgerForSplit, splitLedger } from '../core/memagent/l0Split.ts';
import { makeL0Reader, rebuildLayersFromL0, scanRowsForRebuild } from '../core/memagent/rebuild.ts';
import { buildRecoveryCard, formatRecoveryCode } from '../core/memagent/l0Recovery.ts';
import {
  REFINE_QUEUE_FILE, enqueueRows, loadRefineQueue, nextPending,
  reconcileAndPersistRefineQueue, reconcileRefineQueue, removeRefineQueueRowAndPersist,
  refineRowLayers, retryFailed, saveRefineQueue, setRefineCap, settleRowOutcome, summarizeRefineQueue,
} from '../core/memagent/refineQueue.ts';
import { MemAgentError } from '../core/memagent/errors.ts';
import { cleanupTempFiles, createHomeLockStore, createL0KeyringStore } from './l0KeyringStore.ts';
import type { L0GrantReq, L0UnlockReq } from '../core/memagent/types.ts';
import { runForgettingCycle, archiveAgedMemories } from '../core/memagent/forgetting.ts';
import {
  forgettingPrefsFromSnapshot, growthConfigFromLedger, PARAMS_PREF_PREFIX, proxyAccountingFromSnapshot,
} from '../core/memagent/paramsSnapshot.ts';
import { UNSET_PROXY_ACCOUNTING } from '../shared/proxyAccounting.ts';
import { nextDue } from '../shared/cron.ts';
import { SCHEDULE_TASKS, type ScheduleKey, type ScheduleTaskSpec } from '../shared/growthConfig.ts';
import { ulid } from '../core/memagent/ulid.ts';
import { regressionRequestId, runGrowthRegression } from '../core/memagent/regression.ts';
import { JsVectorBackend } from '../core/memagent/vector.ts';
import { readFile, appendFile, mkdir, writeFile, copyFile, readdir, unlink, stat } from 'node:fs/promises';
import { join, extname, normalize, sep, basename, dirname } from 'node:path';
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
/** 批次37-A：L0 原数据库文件（密文独立成库，不再和 L1–L6 混在 memories.db.json 里） */
let L0_DB_PATH: string;
/**
 * 批次41-A：内核审计账本文件（追加式 JSONL，跟记忆库同目录）。
 * 审计从 `memories.db.json` 里搬出去的理由只有一个：以前每追加一条审计 = 整库 stringify + fsync + rename。
 */
let AUDIT_PATH: string;
/** 批次37-A：L0 原数据库实例（主进程独占写；页面只能经 l0:blobs 按会话批量回读密文） */
let l0Store: FileL0BlobStore;
/**
 * 批次42-B：云端同步中枢（主进程 pglite 落盘，dataDir = 数据根 sync-hub/）。
 * init 失败不阻断应用启动（同步是增量能力）：置 null 并记日志，sync:* handler 如实报「中枢未就绪」。
 */
let syncHub: PgSyncHub | null = null;
/**
 * 批次37-B：两个库 + 密钥环的真实路径（按指针 ledgerDir/l0Dir 解析）。
 * 未走过首启向导的老指针两个字段都没有 → 都跟随数据根，行为与拆库前一致；
 * 但 `isSetupComplete()` 仍为 false，窗口照样进向导（兼容读取 ≠ 免向导）。
 */
let LIB_PATHS: LibraryPaths;
/** 密钥环与 L0 原数据库同目录：恢复 L0 需要的两件东西必须放在一起备份/搬走 */
let L0_KEYRING_PATH: string;
let MAIN_LOG: string;
let BACKUP_CFG_PATH: string;
let COLLECTOR_CURSOR_FILE: string;
let storage: FileStorage;
/** 第一轮个人记忆：独立于记忆主库的文件存储（<数据根>/personal-memory.db.json） */
let personalStoreRef: FilePersonalStore | null = null;
/**
 * 第二轮 owner 口径：登录账号 → 内核账号显式绑定（env MAM_PERSONAL_OWNER_BINDINGS）。
 * 未配置 / 不同名不绑定 → 个人条目仅本机可见，agent 不召回（fail-closed，绝不静默并号）。
 */
let personalOwnerBindings: PersonalOwnerBinding[] = [];
/** 登录会话真源（批次7）：敏感 IPC 经此校验管理员身份；bootstrap 创建后赋值 */
let homeServerRef: HomeServer | null = null;
/** L0 密钥环（§4.4）：DEK 只在主进程内存；退出时清空写密钥缓存 */
let l0VaultRef: L0Vault | null = null;
/**
 * 批次37-G：本次运行内**待导出**的 L0 恢复卡（正文含恢复码，只在内存，绝不落数据根/日志）。
 * 换发新卡即覆盖；导出成功不改写（用户可能第一次选了别处想再存一份）。
 */
let pendingRecoveryCard: { fingerprint: string; text: string } | null = null;
/**
 * 批次37-B：本次运行是否真导出过一张恢复卡。
 * 只在内存里记账（换发新卡即清零），所以「没导出过就重启」不会留下一个可以糊弄过去的持久标记。
 */
let recoveryCardExported = false;
const MIRROR_PORT = 8201;
const AGENT_ONBOARD_PORT = 8200;
const MCP_PORT = 8202;
const MCP_HTTP_PORT = 8204;
const WEBHOOK_PORT = 8203;
/** 批次37-A：l0:blobs 单次回读上限（渲染层按 200 一批，留出余量；超限如实拒绝而不是静默截断） */
const L0_BLOBS_MAX_IDS = 500;
/**
 * 批次48 S11：顶部四段（定稿 final-01-workspace 实测）——
 * 第 1 段标题行高 32px，系统只画三个窗口按钮（titleBarOverlay 覆盖在标题行右侧）；
 * 菜单行 / Ribbon 标签行 / 功能区都在自绘内容里，不占用系统标题栏高度。
 */
const TITLEBAR_HEIGHT = 32;
const TITLEBAR_LIGHT = { color: '#f6f7fa', symbolColor: '#1f2430' };
const TITLEBAR_DARK = { color: '#1c2330', symbolColor: '#dde4f2' };

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
 * 读指针（批次37-B 向导与 `dataRoot:get` 共用）。没有指针文件 / 损坏 → null，
 * 由调用方按「没配好」处理：向导会重新问，绝不静默当成已配置。
 */
function readSetupPointer(): DataRootPointer | null {
  const r = DATA_ROOT_POINTER ? readDataRootPointer(DATA_ROOT_POINTER) : ({ status: 'missing' } as const);
  return r.status === 'ok' ? r.pointer : null;
}

/**
 * 首启向导是否还开着（批次37-B 的唯一门禁口径）：
 * `setupDone` 只有在「两库位置已定 + L0 管理密码已设 + 恢复卡已导出」三件事都做完后才置真，
 * 所以这里只看指针字段就够了——升级上来的老指针没有 setupDone，照样进向导（用户拍板：升级也走强制向导）。
 */
function isWizardIncomplete(): boolean {
  // 批次41-H：主进程判定收成纯函数 wizardRequired（缺失/损坏/老指针没 setupDone 一律进向导），端壳只做读指针
  const read = DATA_ROOT_POINTER ? readDataRootPointer(DATA_ROOT_POINTER) : ({ status: 'missing' } as const);
  return wizardRequired(read);
}

/** 主窗口地址：向导没走完先进 setup.html，走完进 workspace.html（工作台壳层，带上两个后端端口） */
function mainWindowUrl(staticPort: number, wizardFirst: boolean): string {
  const origin = `http://127.0.0.1:${staticPort}`;
  if (wizardFirst) return `${origin}/setup.html`;
  return `${origin}/workspace.html?backend=${origin}:${MIRROR_PORT}&agentBackend=${origin}:${AGENT_ONBOARD_PORT}`;
}

/**
 * 库位置选择（批次37-B 第一段向导）。
 * 取消 = 返回 null，由调用方诚实退出；绝不带着半配好的指针继续启动，也不替用户塞默认值。
 */
async function chooseLibraryDir(step: string, what: string, defaultDir: string): Promise<string | null> {
  for (;;) {
    const res = await dialog.showMessageBox({
      type: 'question',
      title: `首启设置 ${step}`,
      message: `${what}放在哪里？`,
      detail: [
        `默认位置：${defaultDir}`,
        '两个库可以在同一目录，也可以分开（比如把原数据库单独放加密盘）。',
        '文件名固定、不可改：记忆库 memories.db.json / 原数据库 memories.l0.json，密钥环 l0-keyring.json 与原数据库同目录。',
        '所选目录必须可写；选已有库文件的目录=直接用那份，向导不会覆盖它。',
      ].join('\n'),
      buttons: ['使用默认位置', '选择文件夹…', '退出'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (res.response === 2) return null;
    if (res.response === 0) return defaultDir;
    const pick = await dialog.showOpenDialog({ title: `${step} 选择文件夹`, properties: ['openDirectory', 'createDirectory'] });
    if (pick.canceled || !pick.filePaths[0]) continue;
    const v = validateDataRootPath(pick.filePaths[0]);
    if (!v.ok) { dialog.showErrorBox('目录不可用', v.error); continue; }
    const w = ensureDirWritable(v.root);
    if (!w.ok) { dialog.showErrorBox('目录不可写', `${v.root}\n${w.error}`); continue; }
    return v.root;
  }
}

/**
 * 换目录时把数据根里的同名库**复制**过去（不删源、目标已存在则不动）。
 * 记忆库 / 原数据库 / 密钥环 / 审计账本四件都走这里——少搬一件就等于把恢复与追责的拼图拆散了。
 */
function adoptLibraryFile(fromDir: string, toDir: string, fileName: string): { copied: boolean; kept_target: boolean; error?: string } {
  if (samePath(fromDir, toDir)) return { copied: false, kept_target: false };
  const dst = join(toDir, fileName);
  const src = join(fromDir, fileName);
  if (existsSync(dst)) return { copied: false, kept_target: true };
  if (!existsSync(src)) return { copied: false, kept_target: false };
  try {
    mkdirSync(toDir, { recursive: true });
    copyFileSync(src, dst);
    return { copied: true, kept_target: false };
  } catch (e) {
    return { copied: false, kept_target: false, error: String((e as Error)?.message ?? e) };
  }
}

/** 两库位置依次问完（原数据库默认跟记忆库同目录）；任一步取消 → null */
async function chooseLibraryDirs(root: string): Promise<{ ledgerDir: string; l0Dir: string } | null> {
  const ledgerDir = await chooseLibraryDir('1/2', 'L1–L6 记忆库（可检索正文 + 层级 + 审计）', root);
  if (!ledgerDir) return null;
  const l0Dir = await chooseLibraryDir('2/2', 'L0 原数据库（每条记忆的加密原文，唯一的原件副本）', ledgerDir);
  if (!l0Dir) return null;
  return { ledgerDir, l0Dir };
}

/** 把两库位置写进指针（保留 root / migrateFrom 等既有字段）；失败弹错误框并返回 false */
function persistPointer(pointer: DataRootPointer): boolean {
  if (!DATA_ROOT_POINTER) return false;
  try {
    writeDataRootPointer(DATA_ROOT_POINTER, { ...pointer, updatedAt: new Date().toISOString() });
    return true;
  } catch (e) {
    dialog.showErrorBox('无法保存库位置设置', `本次仍使用所选位置，但下次启动会重新询问。\n${String((e as Error)?.message ?? e)}`);
    return false;
  }
}

/**
 * 批次37-B 第一段：把两个库的位置定下来并落指针，然后重启（路径在 ready 前解析，重启才生效）。
 * 已指定过（指针两个字段都在）直接放行。返回 false = 已安排退出，调用方不再继续 bootstrap。
 */
async function ensureLibraryDirs(pointer: DataRootPointer): Promise<boolean> {
  if (hasLibraryDirs(pointer)) return true;
  const dirs = await chooseLibraryDirs(pointer.root);
  if (!dirs) {
    actionLog('dataRoot', 'setup:dirs-canceled', { root: pointer.root });
    app.exit(0);
    return false;
  }
  const next: DataRootPointer = { ...pointer, ledgerDir: dirs.ledgerDir, l0Dir: dirs.l0Dir };
  actionLog('dataRoot', 'setup:dirs-set', { ledgerDir: dirs.ledgerDir, l0Dir: dirs.l0Dir });
  if (!persistPointer(next)) { app.exit(0); return false; }
  try {
    app.relaunch();
  } catch (e) {
    console.error('[setup] relaunch failed', e);
  }
  app.exit(0);
  return false;
}

/**
 * 批次37-B：把数据根里已有的库文件补送到各自目录（复制，不删源，目标已存在一律不动）。
 * 放在 bootstrap 里而不是向导里，是因为 migrateFrom（旧数据迁移）也在这一步才落进数据根——
 * 向导执行时那两个文件可能还没搬来。缺这一句的后果是「换了目录 → 账本凭空变空」，所以每启动都核对一次。
 */
function adoptLibraryFilesIntoPlace(): void {
  const moves = [
    ['记忆库', adoptLibraryFile(USER_DATA, LIB_PATHS.ledgerDir, LEDGER_FILE_NAME)],
    ['原数据库', adoptLibraryFile(USER_DATA, LIB_PATHS.l0Dir, L0_FILE_NAME)],
    ['L0 密钥环', adoptLibraryFile(USER_DATA, LIB_PATHS.l0Dir, L0_KEYRING_FILE_NAME)],
    ['审计账本', adoptLibraryFile(USER_DATA, LIB_PATHS.ledgerDir, AUDIT_FILE_NAME)],
  ] as const;
  const copied: string[] = moves.filter(([, r]) => r.copied).map(([n]) => n);
  const errors = moves.filter(([, r]) => r.error).map(([n, r]) => `${n}: ${r.error}`);
  // 批次41-A：归档目录整批补送（逐文件，目标同名不动）——漏了它 = 换了目录后历史审计查不到
  const archive = adoptLibraryDirIntoPlace(USER_DATA, LIB_PATHS.ledgerDir, 'audit-archive');
  if (archive.copied > 0) copied.push(`审计归档（${archive.copied} 个文件）`);
  for (const err of archive.errors) errors.push(`审计归档: ${err}`);
  if (copied.length > 0 || errors.length > 0) {
    actionLog('dataRoot', 'setup:library-adopted', { copied, errors, ledgerDir: LIB_PATHS.ledgerDir, l0Dir: LIB_PATHS.l0Dir });
  }
  if (errors.length > 0) {
    dialog.showErrorBox('库文件没能送到指定目录', `${errors.join('\n')}\n\n向导不会删原文件；本次按指定目录启动，若那里没有库就是空账本——请手动复制或重新选择目录。`);
  }
}

/**
 * ready 后、bootstrap 前：首次启动/指针损坏/原目录不可用时完成选择，写指针并重启。
 * 重启后指针在 ready 前生效，Chromium 缓存与全部应用数据才真正落到新根目录。
 */
async function prepareDataRoot(): Promise<boolean> {
  if (!dataRootStartup.setup) {
    // 数据根可用，但两库位置从未指定（升级上来的老指针）→ 照样强制走一次向导
    const read = DATA_ROOT_POINTER ? readDataRootPointer(DATA_ROOT_POINTER) : { status: 'missing' as const };
    if (read.status !== 'ok') return true;
    return ensureLibraryDirs(read.pointer);
  }
  if (!APP_DATA_DIR || !DEFAULT_DATA_ROOT || !DATA_ROOT_POINTER) {
    throw new Error('无法确定应用数据目录（appData），请检查系统环境后重试');
  }
  const root = await chooseDataRootInteractive();
  if (!root) { app.exit(0); return false; }
  const migrateFrom = await chooseMigrationSource(root);
  dataRootStartup.setup = undefined;
  const base: DataRootPointer = {
    version: DATA_ROOT_POINTER_VERSION,
    root,
    ...(migrateFrom ? { migrateFrom } : {}),
    updatedAt: new Date().toISOString(),
  };
  try {
    writeDataRootPointer(DATA_ROOT_POINTER, base);
  } catch (e) {
    dataRootPointerWriteError = String((e as Error)?.message ?? e);
    dialog.showErrorBox('无法保存数据位置', `本次仍使用所选位置，但下次启动会重新询问。\n${dataRootPointerWriteError}`);
    try { app.setPath('userData', root); } catch { /* ignore */ }
    return true;
  }
  // 首启在同一次向导里接着问两个库的位置（ensureLibraryDirs 自己负责重启与退出）
  return ensureLibraryDirs(base);
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
// 批次41-D（P1-12）：失败指数退避 5→10→20→40→80→120(cap) 封顶 2h；连续失败 6 轮后停自动重试（保留手动重跑）
const COLLECTOR_BACKOFF_CAP_MS = 2 * 60 * 60_000;
const COLLECTOR_MAX_CONSECUTIVE_FAILS = 6;
/** 批次35：清空重采后的连续补采——单轮仍钳 50 条，最多 80 轮（≈4000 条），轮间让出 300ms */
const RECOLLECT_MAX_ROUNDS = 80;
const RECOLLECT_ROUND_GAP_MS = 300;

// storage / MAIN_LOG 改为 bootstrap 内赋值（DB_PATH/USER_DATA 在 app ready 后才可用）
// ── §4 诊断日志（旧版 mlog；批次7 起新代码一律用 actionLog）─────────────
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
// 调度器每分钟 tick 一次，到用户设定时刻自动把 memories.db.json / memories.l0.json / l0-keyring.json
// 各复制一份到备份目录（前缀 memories- / meml0- / l0key- + 时间戳，各自保留最近 N 份）。批次37-D。
// 日志：backup:start / backup:auto-done / backup-auto-error → mlog（main.log）
interface BackupConfig {
  enabled: boolean;
  dir: string;            // 备份位置（用户选定目录）；空 = 未设置（自动备份不触发，手动立即备份仍可用，落到 userData 下）
  /**
   * 批次58（首启向导「两个备份路径」）：分组专用目录，空 = 回落到 dir / 默认目录。
   * ledgerDir 收记忆库 + 审计账本，l0Dir 收原数据库 + 密钥环（密钥环必须跟原数据库一处，否则谁也解不开谁）。
   */
  ledgerDir?: string;
  l0Dir?: string;
  hour: number;          // 自动备份时刻 0-23
  minute: number;        // 0-59
  keepCount: number;     // 保留份数（默认 7）
  lastRun?: string;      // ISO 时间
  lastOk?: boolean;
}

// BACKUP_CFG_PATH 改为 bootstrap 内赋值

/** 批次37-D：一次备份里每个落盘文件的回执（哪个库、叫什么、多大）——回执逐文件如实列出，缺哪个也说明缺哪个 */
interface BackupFileReceipt {
  kind: BackupKind;
  name: string;
  size: number;
  /** 批次58：这份落到了哪个目录（两个备份路径时逐文件如实回执，不再假装只有一个目录） */
  dir?: string;
}
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

/**
 * 批次37-D：双库备份的文件配方在 backupFiles.ts（纯函数 + 单测同一真源），这里只做落盘。
 * 批次41-A 起含审计账本：**只备记忆库不再等于备了审计**——审计搬出主库后是唯一一件「搬走了就不在老地方」的数据。
 * 归档目录 `audit-archive/` 不在这份配方里（轮转出的旧行仍在数据目录，从不删除），
 * 需要异地留存时请把数据目录整体纳入备份——这条边界写进 AGENTS §9 与手测报告，不假装备份覆盖了全量历史。
 */
function backupPaths(): Record<BackupKind, string> {
  return { ledger: DB_PATH, l0: L0_DB_PATH, keyring: L0_KEYRING_PATH, audit: AUDIT_PATH };
}

/** 按前缀滚动删除超出保留份数的旧备份（删除失败只忽略，不影响本次备份结果） */
async function rotateBackups(backupDir: string, prefix: string, keepCount: number): Promise<void> {
  const names = await readdir(backupDir);
  for (const n of selectBackupsToDelete(names, prefix, keepCount)) {
    await unlink(join(backupDir, n)).catch(() => { /* ignore */ });
  }
}

/**
 * 执行一次备份（批次37-D 起双库 + 密钥环；批次41-A 起再加审计账本）：各自复制一份、
 * 各自按 keepCount 滚动，回执逐文件记录。缺哪个就如实说缺哪个——绝不只备记忆库就宣称"已备份"。
 * 审计是追加式文件，复制瞬间可能截到半行；读侧按行容错，不影响其余行（不为此加锁，备份不该阻塞写入）。
 */
async function runBackupOnce(
  trigger: 'manual' | 'auto',
): Promise<{ ok: boolean; file?: string; files?: BackupFileReceipt[]; missing?: BackupKind[]; dirs?: string[]; error?: string }> {
  const cfg = loadBackupConfig();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fallbackDir = join(USER_DATA, 'backups');
  const usedDirs = backupTargetDirs(cfg, fallbackDir).map((d) => d.dir);
  const files: BackupFileReceipt[] = [];
  try {
    const plan = planBackupFiles(ts, backupPaths(), (p) => existsSync(p));
    if (plan.files.length === 0) {
      return { ok: false, error: '记忆库、原数据库与审计账本都还不存在（尚未产生记忆）' };
    }
    for (const f of plan.files) {
      // 批次58：逐文件选目录（记忆库组 / 原数据库组各自一处），不再假设「所有备份都进同一个 dir」
      const dir = backupTargetDir(f.kind, cfg, fallbackDir);
      await mkdir(dir, { recursive: true });
      const target = join(dir, f.name);
      await copyFile(f.src, target);
      files.push({ kind: f.kind, name: f.name, size: (await stat(target)).size, dir });
      await rotateBackups(dir, BACKUP_PREFIX[f.kind], cfg.keepCount);
    }
    cfg.lastRun = new Date().toISOString();
    cfg.lastOk = true;
    if (trigger === 'auto') saveBackupConfig(cfg); // 手动触发也更新 lastRun 但不重复写 config（幂等无妨）
    await storage.appendAudit({
      request_id: `req_bk_${Date.now().toString(36)}`,
      action: 'memory_op',
      ts: Date.now(),
      project_id: 'P1',
      detail: {
        op: 'auto_backup', trigger, dir: usedDirs.join(' | '), dirs: usedDirs,
        files: files.map((f) => `${f.kind}:${f.name}`), missing: plan.missing, keep: cfg.keepCount,
        memories: Object.keys(storageSize()).length,
      },
    } as never);
    void mlog(`backup:${trigger}-done`, { files, missing: plan.missing, dirs: usedDirs });
    return { ok: true, file: files[0] ? join(files[0].dir ?? fallbackDir, files[0].name) : undefined, files, missing: plan.missing, dirs: usedDirs };
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

/** 备份历史（批次37-D：三类文件合并列表，最近 20 份倒序；kind 说明这份是哪个库；批次58：跨两个目录合并） */
async function listBackups(): Promise<{
  dir: string;
  dirs: string[];
  items: { name: string; time: string; size: number; kind: BackupKind; dir: string }[];
}> {
  const cfg = loadBackupConfig();
  const fallbackDir = join(USER_DATA, 'backups');
  const dirs = backupTargetDirs(cfg, fallbackDir).map((d) => d.dir);
  const items: { name: string; time: string; size: number; kind: BackupKind; dir: string }[] = [];
  for (const dir of dirs) {
    try {
      if (!existsSync(dir)) continue;
      for (const n of sortBackupsNewestFirst(await readdir(dir))) {
        const s = await stat(join(dir, n));
        items.push({ name: n, time: s.mtime.toISOString(), size: s.size, kind: kindOfBackupName(n) ?? 'ledger' as const, dir });
      }
    } catch {
      // 某个目录读不动（权限/掉盘）：其余目录照常列，不因此把整个历史说成空
      continue;
    }
  }
  items.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  return { dir: dirs[0] ?? fallbackDir, dirs, items: items.slice(0, 20) };
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

type AdminGate = { ok: true; ctx: TenantContext } | { ok: false; error: string; code?: string };

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
    return { ok: false, code: 'E_AUTH_SESSION', error: '需要登录后操作（会话已过期或未登录）' };
  }
  if (ctx.role !== 'admin') {
    actionLog('ipc', channel, { denied: 'not_admin', user: ctx.user_id }, { level: 'warn' });
    return { ok: false, code: 'E_AUTH_FORBIDDEN', error: '需要管理员权限' };
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
    cfg.dir = typeof cfg.dir === 'string' ? cfg.dir.trim() : '';
    // 批次41-F：手动改 dir 也走与数据根同一套校验（绝对路径 / 拒 UNC·相对 / 可写），
    // 拒绝时如实报错不落配置——配错目录会让滚动删除在共享目录里误删别人的同名文件。
    if (cfg.dir) {
      const dv = validateDataRootPath(cfg.dir);
      if (!dv.ok) {
        void mlog('backup:dir-invalid', { by: gate.ctx.user_id, dir: cfg.dir, error: dv.error });
        return { ok: false, error: `备份目录非法：${dv.error}` };
      }
      const dw = ensureDirWritable(dv.root);
      if (!dw.ok) {
        void mlog('backup:dir-unwritable', { by: gate.ctx.user_id, dir: dv.root, error: dw.error });
        return { ok: false, error: `备份目录不可写：${dw.error}` };
      }
      cfg.dir = dv.root;
    }
    saveBackupConfig(cfg);
    void mlog('backup:config-saved', { by: gate.ctx.user_id, enabled: cfg.enabled, hour: cfg.hour, minute: cfg.minute, keepCount: cfg.keepCount, dir: cfg.dir || '(default)' });
    return { ok: true, cfg };
  });
  handleIpc(IPC.backupChooseDir, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.backupChooseDir);
    if (!gate.ok) return { ok: false, dir: '', error: gate.error };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const res = await dialog.showOpenDialog(win, { title: '选择备份目录', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return { ok: false, dir: '' };
    const raw = res.filePaths[0];
    // 批次41-F：原生目录选择结果也必须校验后落配置，与数据根同规格
    const dv = validateDataRootPath(raw);
    if (!dv.ok) {
      void mlog('backup:dir-invalid', { by: gate.ctx.user_id, dir: raw, error: dv.error });
      return { ok: false, dir: '', error: `备份目录非法：${dv.error}` };
    }
    const dw = ensureDirWritable(dv.root);
    if (!dw.ok) {
      void mlog('backup:dir-unwritable', { by: gate.ctx.user_id, dir: dv.root, error: dw.error });
      return { ok: false, dir: '', error: `备份目录不可写：${dw.error}` };
    }
    const cfg = loadBackupConfig();
    cfg.dir = dv.root;
    saveBackupConfig(cfg);
    void mlog('backup:dir-changed', { by: gate.ctx.user_id, dir: dv.root });
    return { ok: true, dir: dv.root };
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
    // 批次37-A：L0 原数据库独立位置（页面「记忆存储在哪」卡片据此显示两个库）
    activeL0Path: L0_DB_PATH,
    l0ReadOnly: l0Store.readOnly,
    // 批次41-A：审计账本独立成追加文件，位置与体量如实回显（页面据此说明「审计不再混在主库里」）
    activeAuditPath: AUDIT_PATH,
    audit: storage.auditStats,
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

// ── 个人记忆 IPC（独立存储 personal-memory.db.json；第二轮接真实 PgSyncHub）──────────
// 单一数据面：op = list/quick_add/confirm/reject/revoke/delete/push_team/retry_sync；
// owner 由会话解析，渲染层不得自报；个人确认不会自动提权为团队可见，上行必须显式授权。
// 每个写动作经内核 personal.ts 落 personal_memory 审计并回执 request_id；失败如实返回 code/error。
function registerPersonalIpc(opts: {
  kernelUserId: string;
  bindings: PersonalOwnerBinding[];
  sync: PersonalSyncPort | undefined;
}): void {
  handleIpc(IPC.personalInvoke, async (_e, op: unknown, payload?: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.personalInvoke);
    if (!gate.ok) return { ok: false, code: gate.code, error: gate.error };
    const store = personalStoreRef;
    if (!store) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '个人记忆存储尚未就绪（数据根未初始化）' };
    const api = createPersonalApi({
      store,
      owner: gate.ctx.user_id,
      kernelUserId: opts.kernelUserId,
      ownerBindings: opts.bindings,
      form: 'desktop',
      team_id: gate.ctx.team_id,
      enterprise_id: gate.ctx.enterprise_id,
      sync: opts.sync,
      appendAudit: (a) => storage.appendAudit(a),
    });
    const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
    const id = typeof p.id === 'string' ? p.id : '';
    try {
      switch (op) {
        case 'list': return { ok: true, data: await api.list() };
        case 'quick_add': return { ok: true, data: await api.quickAdd(String(p.content ?? '')) };
        case 'import_from_agent': return {
          ok: true,
          data: await api.importFromAgent({
            content: String(p.content ?? ''),
            sourceAgent: String(p.source_agent ?? ''),
            sourceRefId: String(p.source_ref_id ?? ''),
            originTs: typeof p.origin_ts === 'number' ? p.origin_ts : undefined,
          }),
        };
        case 'reject_from_agent': return {
          ok: true,
          data: await api.rejectFromAgent({
            content: String(p.content ?? ''),
            sourceAgent: String(p.source_agent ?? ''),
            sourceRefId: String(p.source_ref_id ?? ''),
            originTs: typeof p.origin_ts === 'number' ? p.origin_ts : undefined,
          }),
        };
        case 'confirm': return { ok: true, data: await api.confirm(id) };
        case 'reject': return { ok: true, data: await api.reject(id) };
        case 'revoke': return { ok: true, data: await api.revoke(id) };
        case 'delete': return { ok: true, data: await api.remove(id, p.confirm === true) };
        case 'push_team': return {
          ok: true,
          data: await api.pushToTeam(id, {
            explicit: p.explicit === true,
            team_id: typeof p.team_id === 'string' ? p.team_id : undefined,
          }),
        };
        case 'retry_sync': return { ok: true, data: await api.retrySync(id) };
        default: return { ok: false, code: 'E_NOT_IMPLEMENTED', error: `未知个人记忆动作：${String(op)}` };
      }
    } catch (e) {
      return { ok: false, code: (e as { code?: string })?.code ?? 'E_PERSONAL', error: String((e as Error)?.message ?? e) };
    }
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

// ── §6d LLM 精炼网关 IPC（批次31 建，批次32 多引擎化）───────────────────────
// 读配置需登录会话；写配置/真拨测仅管理员；逐层精炼代理需登录会话（内核写路径经此走主进程 HTTP）。
// 各引擎 API Key 只经参数写入 0600 文件（llm-keys.json），绝不回显、绝不进日志/审计；
// 拨测/精炼错误文本已由网关 safeErrorText 清洗（状态码 + 截断响应体，不含密钥）。

let llmGateway: LlmGatewayProvider | null = null;

/**
 * 批次48 A16：反代理记账（云端单价/日配额）由参数页写入参数快照，主进程内核路由读取同一份真源。
 * 启动时与每次 params 快照写入后刷新；读不到 → 未设置（云端引擎不进入路由，不编造）。
 */
async function refreshProxyAccounting(): Promise<void> {
  try {
    applyProxyAccounting(proxyAccountingFromSnapshot(await storage.listMemories({})));
  } catch {
    applyProxyAccounting(UNSET_PROXY_ACCOUNTING);
  }
}

const LLM_REFINE_LAYERS = ['L2', 'L3', 'L4', 'L5', 'L6'] as const;
const LLM_REFINE_CATEGORIES = ['fact', 'decision', 'pitfall', 'insight', 'preference', 'context'] as const;

/** 网关视图：引擎列表（含 keySet，不含密钥本体）+ 预设 + 当前是否可用 */
function llmGatewayView() {
  return llmEngineViews(loadLlmConfig(USER_DATA), loadLlmKeys(USER_DATA));
}

/**
 * 批次48 A31：余额查询服务（独立 billing 凭据槽 + 每引擎 10 分钟 TTL）。
 * 余额查询只打厂商余额端点：不计入 cost_cap、不写 llm_proxy 审计（用户拍板口径）。
 */
let llmBillingSvc: LlmBillingService | null = null;

/** 余额视图：逐引擎 refreshAll（force=页面手动刷新，绕过 TTL）；凭据明文不出主进程 */
async function llmBillingView(force: boolean) {
  if (!llmBillingSvc) return { ok: false, error: '余额查询服务未初始化' };
  const cfg = loadLlmConfig(USER_DATA);
  const manualOf = (id: string) => cfg.engines.find((e) => e.id === id)?.billing ?? UNSET_MANUAL_BILLING;
  const engines = await llmBillingSvc.refreshAll(cfg, loadLlmKeys(USER_DATA), manualOf, force);
  return { ok: true, ttlMs: BILLING_TTL_MS, asOf: Date.now(), engines };
}

function registerLlmIpc(): void {
  llmBillingSvc = new LlmBillingService({ dataDir: USER_DATA });
  handleIpc(IPC.llmConfigGet, (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.llmConfigGet);
    if (!gate.ok) throw new Error(gate.error);
    return { ok: true, ...llmGatewayView() };
  });
  handleIpc(IPC.llmConfigSet, (_e, patch: LlmConfigPatch | undefined, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.llmConfigSet);
    if (!gate.ok) return { ok: false, error: gate.error };
    const { cfg, keyOp } = mergeLlmConfig(loadLlmConfig(USER_DATA), patch ?? {});
    saveLlmConfig(USER_DATA, cfg);
    if (keyOp) saveLlmKey(USER_DATA, keyOp.id, keyOp.value); // 空值 = 清除；密钥本体不进日志
    llmGateway = loadLlmGateway(USER_DATA);
    const savedDetail = {
      by: gate.ctx.user_id,
      keyOp: keyOp ? { id: keyOp.id, cleared: !keyOp.value } : null,
      engines: cfg.engines.map((e) => ({ id: e.id, enabled: e.enabled, model: e.model })),
      usable: !!llmGateway,
    };
    void mlog('llm:config-saved', savedDetail);
    // 批次34：同一条也落 actions.log —— AGENTS §4 写明排查第一入口是 actions.log，此前这两个 LLM 事件只进 main.log
    actionLog('llm', 'config-saved', savedDetail);
    return { ok: true, ...llmGatewayView() };
  });
  handleIpc(IPC.llmTest, async (_e, target: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.llmTest);
    if (!gate.ok) return { ok: false, error: gate.error };
    const id = typeof target === 'string' ? target : '';
    const r = await testEngine(loadLlmConfig(USER_DATA), loadLlmKeys(USER_DATA), id);
    // 拨测结果写回配置 → 精炼按「最近实测最快」排队（失败不记延时，避免把坏引擎顶到前面）
    saveLlmConfig(USER_DATA, applyProbeResult(loadLlmConfig(USER_DATA), id, r));
    llmGateway = loadLlmGateway(USER_DATA);
    // r.error 来自网关 safeErrorText（状态码 + 截断响应体，不含密钥）
    const probeDetail = {
      by: gate.ctx.user_id, engine: id || '(空)', ok: r.ok, model: r.model, latencyMs: r.latencyMs,
      enabled: r.enabled, // 批次34：拨测不再要求启用，回显当时是否已勾选，便于区分「连通但未启用」
      ...(r.error ? { error: r.error } : {}),
    };
    void mlog('llm:test-engine', probeDetail);
    actionLog('llm', 'test-engine', probeDetail);
    return { ...r };
  });
  handleIpc(IPC.llmRefine, async (_e, payload: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.llmRefine);
    if (!gate.ok) throw new Error(gate.error);
    if (!llmGateway) throw new Error('LLM 网关未启用：请管理员在参数页配置并启用至少一个引擎（测试连通通过）');
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
      // 批次48 A24：把本层调用的真实 usage 一并回传，渲染层内核按 tokens × 单价记账
      const usage = llmGateway.takeUsage();
      return { ok: true, text, tokens: usage ? usage.tokens : null };
    }
    if (p.mode === 'raw') {
      if (typeof p.prompt !== 'string' || !p.prompt) throw new Error('llm:refine 参数非法');
      const r = await llmGateway.call('', p.prompt, { request_id, usage: typeof p.usage === 'string' ? p.usage : 'call' });
      return { ok: true, ...r };
    }
    throw new Error('llm:refine 参数非法');
  });
  // 批次48 A31-b：余额视图（需登录会话；force = 页面手动刷新）。不写 llm_proxy 审计、不计 cost_cap。
  handleIpc(IPC.llmBilling, async (_e, req: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.llmBilling);
    if (!gate.ok) return { ok: false, error: gate.error };
    const force = !!((req ?? {}) as { force?: unknown }).force;
    return await llmBillingView(force);
  });
  // 批次48 A31-b：独立 billing 凭据写入/清除（仅管理员）。凭据只落 0600 文件，日志只记「写/清」不记明文。
  handleIpc(IPC.llmBillingKey, async (_e, payload: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.llmBillingKey);
    if (!gate.ok) return { ok: false, error: gate.error };
    const p = (payload ?? {}) as { id?: unknown; value?: unknown };
    const id = typeof p.id === 'string' ? p.id.trim() : '';
    if (!id) return { ok: false, error: '缺少引擎 id' };
    const value = typeof p.value === 'string' ? p.value.trim() : '';
    llmBillingSvc?.saveCredential(id, value);
    actionLog('llm', 'billing-key', { by: gate.ctx.user_id, engine: id, cleared: !value });
    // 凭据变了就立即重查（绕过 TTL），页面能马上看到新的 provenance
    return await llmBillingView(true);
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
    return { ok: false, code: 'E_AUTH_SESSION', error: '需要登录后操作（会话已过期或未登录）' };
  }
  return { ok: true, ctx };
}

/**
 * 批量改写账本前的自动备份（§4.4.6 口径，批次24 起 L0 迁移与遗留账本清理共用）：
 * 备份失败 → 调用方拒绝改写，绝不无备份动用户数据。
 */
async function backupBeforeKernelChange(dirPrefix: string, logAction: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const cfg = loadBackupConfig();
  // 批次58：这里是「一次性回滚快照」而不是滚动备份——四类源**故意放进同一个子目录**，
  // 好在出事时整套回到同一时刻；目录位置取记忆库组（原数据库组可能被指到另一块盘，回滚快照分两处反而难用）。
  const base = backupTargetDir('ledger', cfg, join(USER_DATA, 'backups'));
  const dir = join(base, `${dirPrefix}-${ts}`);
  await mkdir(dir, { recursive: true });
  // 批次37-D：批量改写账本前把三类落盘源一起备份 —— 只备记忆库会让 L0 原数据库成为唯一没有退路的那一份。
  const copied: string[] = [];
  for (const src of Object.values(backupPaths())) {
    if (!existsSync(src)) continue;
    await copyFile(src, join(dir, basename(src)));
    copied.push(basename(src));
  }
  actionLog('kernel', logAction, { dir, copied });
  return dir;
}

/**
 * 把内存里那张待导出的恢复卡写盘（批次37-G 换发后 / 批次37-B 向导强制导出共用同一段真实现）。
 * 原生「另存为」，默认落系统下载目录并逐字提示别和数据根放一起。
 * 卡面含恢复码：日志只记文件名/字节数/指纹，绝不记正文；选在数据根内也允许（不替用户保管决定），
 * 但回执如实标注 inside_data_root 供页面警告。
 */
async function exportPendingRecoveryCard(user: string): Promise<
  { ok: true; file_name: string; inside_data_root: boolean; fingerprint: string }
  | { ok: false; canceled?: true; error: string }
> {
  const card = pendingRecoveryCard;
  if (!card) {
    return { ok: false, error: '本次没有待导出的恢复卡：恢复码只在生成那一次可见，请重新换发一张' };
  }
  const res = await dialog.showSaveDialog({
    title: '导出 L0 恢复卡',
    defaultPath: join(app.getPath('downloads'), `L0恢复卡-${card.fingerprint}.txt`),
    filters: [{ name: '文本', extensions: ['txt'] }],
    message: '请存到与这台电脑分开的地方（U 盘/打印/密码管理器）——和数据根放在一起的备份，会在同一次事故里一起没了',
  });
  if (res.canceled || !res.filePath) {
    actionLog('kernel', 'l0:recovery-export-canceled', { user });
    return { ok: false, canceled: true, error: '未导出恢复卡：恢复码仍在内存里，可再次点击导出' };
  }
  try {
    await writeFile(res.filePath, card.text, { encoding: 'utf8', mode: 0o600 });
    const inside = samePath(dirname(res.filePath), USER_DATA)
      || normalize(res.filePath).startsWith(normalize(USER_DATA) + sep);
    recoveryCardExported = true;
    actionLog('kernel', 'l0:recovery-exported', {
      file: basename(res.filePath), bytes: Buffer.byteLength(card.text), fingerprint: card.fingerprint,
      inside_data_root: inside, user,
    });
    return { ok: true, file_name: basename(res.filePath), inside_data_root: inside, fingerprint: card.fingerprint };
  } catch (e) {
    const err = String((e as Error)?.message ?? e);
    actionLog('kernel', 'l0:recovery-export-fail', { error: err }, { level: 'error' });
    return { ok: false, error: `恢复卡写入失败：${err}` };
  }
}

/**
 * 发一张恢复卡：主进程拼卡面正文（l0Recovery.ts 引了 node:crypto，渲染层打包不了），
 * 并把码明文**只**放进本次返回值——之后任何接口都只回状态，绝不回显。
 * 批次37-B 首启向导与批次37-G 安全页发码共用：新码覆盖旧码，上一次导出随之作废。
 */
function issueRecoveryCard(i: { recovery_code: string; fingerprint: string; created_at: number }): {
  recovery_code: string; recovery_code_grouped: string; fingerprint: string; created_at: number;
} {
  pendingRecoveryCard = {
    fingerprint: i.fingerprint,
    text: buildRecoveryCard({
      code: i.recovery_code, fingerprint: i.fingerprint, l0_path: L0_DB_PATH,
      created_at: i.created_at, has_admin_password: true,
    }),
  };
  // 新码 = 新卡：上一次导出作废，向导/卡面都要求重新导一次（旧码已经进不了这个进程了）
  recoveryCardExported = false;
  return {
    recovery_code: i.recovery_code,
    recovery_code_grouped: formatRecoveryCode(i.recovery_code),
    fingerprint: i.fingerprint,
    created_at: i.created_at,
  };
}

function registerL0Ipc(vault: L0Vault, collectorVector: JsVectorBackend, pendingStore: PendingStore): void {
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
  handleIpc(IPC.l0WriteUnlock, async (_e, password: string, memberId?: string | null, sessionId?: string) => {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (memberId) {
      // §4.4.4-B：成员自解锁写密钥——需登录且会话用户就是该成员（防越权替他人解），不要求管理员
      const ctx = sid ? homeServerRef?.getSessionContext(sid) ?? null : null;
      if (!ctx) return { ok: false, code: 'E_AUTH_SESSION', error: '需要登录后操作（会话已过期或未登录）' };
      if (ctx.user_id !== memberId) return { ok: false, code: 'E_AUTH_FORBIDDEN', error: '只能解锁自己的写密钥' };
      try {
        await vault.unlockWrite({ password, admin_user_id: memberId, member_id: memberId });
        return { ok: true };
      } catch (e) { return l0Fail(e); }
    }
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
  /** §4.4.4-B：管理员为成员发放写解锁口令（需先解锁写密钥；vault 内部再校验 writeDek 在内存） */
  handleIpc(IPC.l0AddMemberWriteWrap, async (_e, memberId: string, passphrase: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0AddMemberWriteWrap);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      await vault.addMemberWriteWrap({ member_id: memberId, passphrase, admin_user_id: gate.ctx.user_id });
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  /** §4.4.4-B：撤销某成员的写解锁口令 */
  handleIpc(IPC.l0RemoveMemberWriteWrap, async (_e, memberId: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0RemoveMemberWriteWrap);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      await vault.removeMemberWriteWrap({ member_id: memberId, admin_user_id: gate.ctx.user_id });
      return { ok: true };
    } catch (e) { return l0Fail(e); }
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
  /**
   * 批次37-A：拆库后按 mem_id 批量回读 L0 信封（密文）。
   * 记忆库行上只剩 has_l0，正文原文在这独立文件里；渲染层持有的是账本镜像，取不到它，
   * 所以开这条只读通道。出主进程前只过登录会话校验（密文仍需授权会话才能解密），
   * 日志只记条数，绝不记信封值。缺的 id 如实不返回 —— 由内核判成断链错误。
   */
  handleIpc(IPC.l0Blobs, async (_e, memIds: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0Blobs);
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!Array.isArray(memIds)) return { ok: false, error: 'l0:blobs 需要 mem_id 数组' };
    const ids = [...new Set(memIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()))];
    if (ids.length === 0) return { ok: true, envelopes: {} };
    if (ids.length > L0_BLOBS_MAX_IDS) {
      return { ok: false, error: `一次最多回读 ${L0_BLOBS_MAX_IDS} 条（本次 ${ids.length} 条，请分批）` };
    }
    const found = await l0Store.getAll(ids);
    actionLog('ipc', 'l0:blobs', { asked: ids.length, found: found.size });
    return { ok: true, envelopes: Object.fromEntries(found) };
  });

  /**
   * S5 / D6：MCP 写入兜底队列只读摘要。
   * L0 写密钥锁定期间 write_memory 会进 pending 队列（解锁后由下一次写入自动重放）。
   * 只回计数与可排查字段（id/时间/项目/来源/字数/评分），正文与密钥材料绝不出主进程；
   * 日志只记条数。队列实现由 bootstrap 注入且与两个 MCP server 共用一个实例。
   */
  handleIpc(IPC.l0PendingWrites, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0PendingWrites);
    if (!gate.ok) return { ok: false, error: gate.error };
    const all = await pendingStore.list();
    const { items, truncated } = summarizePendingWrites(all);
    actionLog('ipc', 'l0:pendingWrites', { count: all.length, shown: items.length });
    return {
      ok: true,
      count: all.length,
      items,
      truncated,
      source: 'MCP 写入兜底队列（主进程内存 · 与 8202/8204 MCP 共用）',
      note: 'L0 写密钥锁定期间的 write_memory 暂存于此，解锁后由下一次写入自动重放；进程重启即清空。只读摘要，不含正文与密钥材料。',
      captured_at: new Date().toISOString(),
    };
  });

  /**
   * 批次37-C：存量拆分迁移 —— 把历史行上还躺着的 L0 原文搬进独立的 L0 原数据库。
   * 本机实测（2026-11-02）1642 行里 1641 行带着**明文** `content_orig`（约 5.5 MB）：拆库之前
   * 这批原文一直在记忆库文件里裸奔，拆库之后若不搬家就永远留在错误的位置。
   * 与 `l0:migrate` 的分工：那边把明文/v1 **再加密**在行上；这边把（加密后的）信封**换地方存**，
   * 行上只留 `has_l0`。明文必须经写密钥封存才允许进 L0 库——没解锁就整轮拒绝，绝不搬明文。
   */
  handleIpc(IPC.l0SplitPreview, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0SplitPreview);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      return { ok: true, preview: await scanLedgerForSplit(storage, l0Store) };
    } catch (e) { return l0Fail(e); }
  });

  handleIpc(IPC.l0SplitRun, async (_e, confirmText?: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0SplitRun);
    if (!gate.ok) return { ok: false, error: gate.error };
    // 二次确认口令：搬完行上就再也没有原件，唯一退路是执行前的双库备份 → 逐字 SPLIT
    if ((confirmText ?? '').trim().toUpperCase() !== 'SPLIT') {
      actionLog('kernel', 'l0:split-rejected', { reason: 'confirm_text', user: gate.ctx.user_id });
      return { ok: false, error: '未输入确认口令 SPLIT，已取消（拆分后原文不再留在记忆库，不可逆）' };
    }
    let preview: Awaited<ReturnType<typeof scanLedgerForSplit>>;
    try {
      preview = await scanLedgerForSplit(storage, l0Store);
    } catch (e) { return l0Fail(e); }
    // 有明文却没解锁写密钥 → 在备份之前如实拒绝：本轮一行都搬不了，没必要先动盘
    if (preview.plaintext_orig > 0 && !(await vault.status()).write_unlocked) {
      actionLog('kernel', 'l0:split-rejected', { reason: 'write_key_locked', plaintext: preview.plaintext_orig, user: gate.ctx.user_id });
      return { ok: false, error: `${preview.plaintext_orig} 行带着明文原文：请先解锁 L0 写密钥再执行（§4.4.4，绝不把明文当 L0 存）` };
    }
    let backupDir: string;
    try {
      backupDir = await backupBeforeKernelChange('l0-split', 'l0:split-backup');
    } catch (e) {
      const err = String((e as Error)?.message ?? e);
      actionLog('kernel', 'l0:split-backup-fail', { error: err }, { level: 'error' });
      return { ok: false, error: `拆分前备份失败：${err}` };
    }
    try {
      const now = Date.now();
      const report = await splitLedger({
        storage, l0Blobs: l0Store, seal: (p) => vault.seal(p),
        admin_user_id: gate.ctx.user_id, request_id: `req_l0_split_${now}`, now, backup_confirmed: true,
      });
      // 只记条数与字节：原文、信封、口令一律不落日志
      actionLog('kernel', 'l0:split-run', {
        scanned: report.total, moved: report.moved, sealed: report.sealed_from_plaintext,
        cipher_moved: report.cipher_moved, failed: report.failed,
        l0_count: report.l0_count, l0_bytes: report.l0_bytes,
        orphan_blobs: report.orphan_blobs, broken_links: report.broken_links,
        dir: backupDir,
      });
      return { ok: true, report, backup_dir: backupDir };
    } catch (e) { return l0Fail(e); }
  });

  /**
   * 批次37-E：按 L0 原文重建 L1–L6（用户口径「删的只是 L1–L6 那份库，不用重新采集，直接从 L0 重新生成」）。
   * 原文怎么来只有两条路：行上的历史明文，或经**管理员的 L0 查阅会话**解密——本通道不开新的解密口子：
   * 传了 l0_session_id 就照 §4.4.2 校验归属并按会话 scope 解密；没传则密文一律判 `view_locked`、如实计数。
   * 预览也是读操作、但会真读原文（不改任何数据），所以同样要过会话校验。
   */
  const makeRebuildReader = async (l0SessionId: unknown, ctx: TenantContext, channel: string) => {
    const sid = (typeof l0SessionId === 'string' ? l0SessionId.trim() : '');
    if (!sid) return makeL0Reader({ l0Blobs: l0Store });
    const id = await assertOwner(sid, ctx, channel);
    return makeL0Reader({
      l0Blobs: l0Store,
      decrypt: (m, envelope) => vault.decrypt({ l0_session_id: id, project_id: m.project_id, mem_id: m.mem_id, envelope }),
    });
  };

  handleIpc(IPC.l0RebuildPreview, async (_e, req: { l0_session_id?: string; use_llm?: boolean } | undefined, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.l0RebuildPreview);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const readL0 = await makeRebuildReader(req?.l0_session_id, gate.ctx, IPC.l0RebuildPreview);
      const llmReady = Boolean(llmGateway && llmGateway.usable());
      const preview = await scanRowsForRebuild({ storage, readL0, llmAvailable: req?.use_llm === true && llmReady });
      return { ok: true, llm_ready: llmReady, preview };
    } catch (e) { return l0Fail(e); }
  });

  handleIpc(IPC.l0RebuildRun, async (_e, req: { confirm_text?: string; l0_session_id?: string; use_llm?: boolean } | undefined, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0RebuildRun);
    if (!gate.ok) return { ok: false, error: gate.error };
    // 二次确认口令：旧 L1–L6 正文会被覆盖，唯一退路是执行前的双库备份 → 逐字 REBUILD
    if ((req?.confirm_text ?? '').trim().toUpperCase() !== 'REBUILD') {
      actionLog('kernel', 'l0:rebuild-rejected', { reason: 'confirm_text', user: gate.ctx.user_id });
      return { ok: false, error: '未输入确认口令 REBUILD，已取消（重建会覆盖现有 L1–L6 正文，不可逆）' };
    }
    let readL0: Awaited<ReturnType<typeof makeRebuildReader>>;
    let preview: Awaited<ReturnType<typeof scanRowsForRebuild>>;
    try {
      readL0 = await makeRebuildReader(req?.l0_session_id, gate.ctx, IPC.l0RebuildRun);
      const useLlm = req?.use_llm === true && Boolean(llmGateway && llmGateway.usable());
      preview = await scanRowsForRebuild({ storage, readL0, llmAvailable: useLlm });
    } catch (e) { return l0Fail(e); }
    // 密文没解锁就拒绝：别把盘动一遍才告诉用户读不到原文
    const locked = preview.by_unavailable.view_locked ?? 0;
    if (locked > 0) {
      actionLog('kernel', 'l0:rebuild-rejected', { reason: 'view_locked', rows: locked, user: gate.ctx.user_id });
      return { ok: false, error: `${locked} 行的原文是 L0 密文：请先在安全页解锁 L0 查阅会话再重建（§4.4.3，绝不猜正文）` };
    }
    let backupDir: string;
    try {
      backupDir = await backupBeforeKernelChange('l0-rebuild', 'l0:rebuild-backup');
    } catch (e) {
      const err = String((e as Error)?.message ?? e);
      actionLog('kernel', 'l0:rebuild-backup-fail', { error: err }, { level: 'error' });
      return { ok: false, error: `重建前备份失败：${err}` };
    }
    try {
      const now = Date.now();
      const useLlm = req?.use_llm === true && Boolean(llmGateway && llmGateway.usable());
      const report = await rebuildLayersFromL0({
        storage, vector: collectorVector, readL0,
        llm: useLlm ? llmGateway ?? undefined : undefined,
        llmModel: useLlm ? 'llm-gateway' : undefined,
        useLlm,
        admin_user_id: gate.ctx.user_id, request_id: `req_l0_rebuild_${now}`, now, backup_confirmed: true,
      });
      // 只记计数与层级名：L0 原文、新旧正文一律不落日志
      actionLog('kernel', 'l0:rebuild-run', {
        scanned: report.total, rebuilt: report.rebuilt, l1_changed: report.rebuilt_l1_changed,
        purged: report.purged, deep_generated: report.deep_generated, deep_cleared: report.deep_cleared,
        llm: useLlm, llm_calls: report.llm_calls, refine_failed: report.refine_failed,
        protected_skipped: report.skipped_protected, unavailable_skipped: report.skipped_unavailable,
        failed: report.failed, dir: backupDir,
      });
      // 批次41-P：重建的 purge 分支同样是硬删行（rebuild.ts 的 deleteMemory），队列里即成幽灵。
      // 只在真删了行时才做一次全量对账——purged=0 是常态，不该为此白扫整本账本。
      if (report.purged > 0) void reconcileRefineQueueDir('l0-rebuild');
      return { ok: true, report, backup_dir: backupDir };
    } catch (e) { return l0Fail(e); }
  });

  // ── 批次37-G：L0 恢复码（忘记管理密码的唯一找回通道，一次性） ──────────────────
  // 卡面正文只能在主进程拼：l0Recovery.ts 引了 node:crypto，渲染层打包不了。
  // 码明文只在「发码那一次」的返回值里出现一次，之后任何接口都只回状态，绝不回显。
  handleIpc(IPC.l0RecoveryStatus, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0RecoveryStatus);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      return { ok: true, ...(await vault.recoveryStatus()), has_pending_card: Boolean(pendingRecoveryCard) };
    } catch (e) { return l0Fail(e); }
  });

  /** 首启向导：一次建好 DEK + 管理密码包 + 恢复码包（已设过密码的库走「换发恢复码」） */
  handleIpc(IPC.l0RecoveryInit, async (_e, password?: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0RecoveryInit);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const issued = await vault.initL0WithRecovery({ password: password ?? '', admin_user_id: gate.ctx.user_id });
      actionLog('kernel', 'l0:recovery-issued', { op: 'init', fingerprint: issued.fingerprint, user: gate.ctx.user_id });
      return { ok: true, ...issueRecoveryCard(issued) };
    } catch (e) { return l0Fail(e); }
  });

  /** 换发一张新卡（卡被人看过 / 旧库首次发码）：需已解锁 L0 写密钥，否则等于给拿到文件的人免密发码 */
  handleIpc(IPC.l0RecoveryIssue, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0RecoveryIssue);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const issued = await vault.rotateRecoveryCode({ admin_user_id: gate.ctx.user_id });
      actionLog('kernel', 'l0:recovery-issued', { op: 'rotate', fingerprint: issued.fingerprint, user: gate.ctx.user_id });
      return { ok: true, ...issueRecoveryCard(issued) };
    } catch (e) { return l0Fail(e); }
  });

  /** 忘记管理密码 → 恢复码找回并当场设新密码；旧码当场作废，返回的是**新**码，必须重新导出卡 */
  handleIpc(IPC.l0Recover, async (_e, req?: { code?: string; newPassword?: string }, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0Recover);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const issued = await vault.recoverWithCode({
        code: typeof req?.code === 'string' ? req.code : '',
        newPassword: typeof req?.newPassword === 'string' ? req.newPassword : '',
        admin_user_id: gate.ctx.user_id,
      });
      actionLog('kernel', 'l0:recovery-issued', { op: 'recover', fingerprint: issued.fingerprint, user: gate.ctx.user_id });
      return { ok: true, ...issueRecoveryCard(issued) };
    } catch (e) { return l0Fail(e); }
  });

  /**
   * 导出恢复卡：实现抽到 `exportPendingRecoveryCard`（首启向导的强制导出走的是同一段真实现）。
   */
  handleIpc(IPC.l0RecoveryExport, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.l0RecoveryExport);
    if (!gate.ok) return { ok: false, error: gate.error };
    return exportPendingRecoveryCard(gate.ctx.user_id);
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

// ── §6f L2–L6 后台补炼队列（批次39）──────────────────────────────────────────
// 用户拍板（2026-11-02）：写入只落 L0（密文）+ 脱敏 L1，L2–L6 交给后台异步队列补炼；
// 存量 1585 行全量补炼；单条最多试 3 个引擎；每日额度默认 500 行；llm_partial 不自动重试（要点「重试失败行」才回队）。
// 〔批次41-I 后续 · 已正规化〕每日额度不再是编译期常量：由参数页「限额/不限额」按钮运行时决定
//   （队列状态 cap_enabled / cap_rows，仅管理员可改）。「不限额」= 今日不按行数截断，主动权交给用户；
//   常量 REFINE_MAX_ROWS_PER_DAY=500 只剩「默认值 + cap_rows 非法时回落值」。吞吐仍受模型速度限制（~15s tick × 单行多层真调）。
// 队列状态落 ledger 目录 refine-queue.json（0600，只有 mem_id + 状态 + 原因码，正文一个字不落）。
// 关键取舍：引擎没就绪时**不起活也不把行判死**——没有真实调用就没有失败，也不消耗当日额度。

/** 每 15 秒最多补炼一行：本机 7B 模型单次约 28s，靠 refineInFlight 防重入，不靠间隔排队 */
const REFINE_TICK_MS = 15_000;
let refineQueueDir = '';
let refineInFlight = false;
let refineTimer: ReturnType<typeof setInterval> | null = null;

const refineQueuePath = (): string => join(refineQueueDir, REFINE_QUEUE_FILE);

async function runRefineTick(vector: JsVectorBackend): Promise<void> {
  if (refineInFlight || !refineQueueDir) return;
  refineInFlight = true;
  try {
    const state = loadRefineQueue(refineQueueDir);
    const id = nextPending(state); // 已含「未启用 / 当日额度用尽」两道闸门
    if (!id) return;
    if (!llmGateway || !llmGateway.usable()) return;
    const now = Date.now();
    const r = await refineRowLayers(id, {
      storage, vector, llm: llmGateway, llmModel: 'llm-gateway',
      request_id: `req_refine_${now}`, now, actor: 'refine_queue',
    });
    const settled = settleRowOutcome(state, id, r, now);
    saveRefineQueue(refineQueueDir, settled);
    // 只记计数与层名：新正文、L1、原文一律不进动作日志
    actionLog('kernel', 'refine:row', {
      mem_id: id, ok: r.ok, refined_by: r.refined_by, to_layer: r.to_layer,
      layers: r.layers.length, targets: r.targets?.length ?? null, llm_calls: r.llm_calls,
      code: r.code ?? null, stop_layer: r.stop_layer ?? null, stop_code: r.stop_code ?? null,
      ms: Date.now() - now,
      day_rows: settled.dayRows, day_limit: settled.cap_enabled ? settled.cap_rows : null,
      cap_enabled: settled.cap_enabled,
    });
  } catch (e) {
    actionLog('kernel', 'refine:tick-error', { error: String((e as Error)?.message ?? e) }, { level: 'error' });
  } finally {
    refineInFlight = false;
  }
}

/** 启动：把「有 L1 但没有任一深层」的存量行全部入队（幂等，已在队列里的不重复计），然后起定时器 */
async function startRefineQueue(vector: JsVectorBackend): Promise<void> {
  try {
    refineQueueDir = LIB_PATHS?.ledgerDir ?? USER_DATA;
    await mkdir(refineQueueDir, { recursive: true });
    const state = loadRefineQueue(refineQueueDir);
    const live = await storage.listMemories({});
    const { state: enq, report } = enqueueRows(state, live);
    // 批次41-C：启动即对账——把账本里已不存在的行（硬删/清空/重判遗留的幽灵）从队列摘掉，
    // 任何删除通道没同步摘除都能在这里自净一遍（覆盖本机已攒下的存量幽灵）。
    const { state: next, pruned } = reconcileRefineQueue(enq, live.map((m) => m.mem_id));
    saveRefineQueue(refineQueueDir, next);
    actionLog('kernel', 'refine:backfill-scan', {
      ...report, pending: Object.values(next.items).filter((i) => i.state === 'pending').length,
      pruned_ghosts: pruned, enabled: next.enabled, file: refineQueuePath(),
    });
    if (!refineTimer) {
      refineTimer = setInterval(() => { void runRefineTick(vector); }, REFINE_TICK_MS);
      refineTimer.unref?.();
    }
  } catch (e) {
    actionLog('kernel', 'refine:start-error', { error: String((e as Error)?.message ?? e) }, { level: 'error' });
  }
}

/**
 * 批次41-C：按「当前未删行」对账并摘掉补炼队列里的幽灵条目（覆盖所有硬删通道：
 * 清空重采 / 规则重判 / 手动删除 / 按 L0 重建的 purge，批次41-P 补最后一条）。
 * 只在全量摘除发生时落盘 + 记一条动作日志（pruned>0）。
 * 删行的通道执行完调用一次即可，队列文件在写锁进程内维护。
 */
async function reconcileRefineQueueDir(why: string): Promise<void> {
  if (!refineQueueDir) return;
  try {
    const live = new Set((await storage.listMemories({})).map((m) => m.mem_id));
    const r = reconcileAndPersistRefineQueue({
      queueDir: refineQueueDir, liveIds: live,
      load: () => loadRefineQueue(refineQueueDir),
      save: (s) => saveRefineQueue(refineQueueDir, s),
    });
    if (r.persisted) actionLog('kernel', 'refine:queue-reconciled', { pruned: r.pruned, why });
  } catch (e) {
    actionLog('kernel', 'refine:queue-reconcile-error', { error: String((e as Error)?.message ?? e), why }, { level: 'warn' });
  }
}

/** 批次41-C：单条硬删后只摘这一个 id（热路径，不做全量对账；id 不在队列则幂等不动）。 */
function removeRefineQueueRow(id: string): void {
  if (!refineQueueDir || !id) return;
  try {
    void removeRefineQueueRowAndPersist({
      queueDir: refineQueueDir, id,
      load: () => loadRefineQueue(refineQueueDir),
      save: (s) => saveRefineQueue(refineQueueDir, s),
    });
  } catch (e) {
    actionLog('kernel', 'refine:queue-remove-error', { error: String((e as Error)?.message ?? e) }, { level: 'warn' });
  }
}

function registerRefineIpc(): void {
  const view = () => ({
    summary: summarizeRefineQueue(loadRefineQueue(refineQueueDir), refineQueuePath()),
    engine: { loaded: Boolean(llmGateway), usable: Boolean(llmGateway?.usable()) },
  });
  handleIpc(IPC.refineState, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.refineState);
    if (!gate.ok) return { ok: false, error: gate.error };
    if (!refineQueueDir) return { ok: false, error: '补炼队列还没就绪（主进程启动中或数据根不可写）' };
    try {
      return { ok: true, ...view() };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.refineSetEnabled, async (_e, enabled: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.refineSetEnabled);
    if (!gate.ok) return { ok: false, error: gate.error };
    if (typeof enabled !== 'boolean') return { ok: false, error: '需要一个布尔值（开 / 关）' };
    try {
      const state = loadRefineQueue(refineQueueDir);
      saveRefineQueue(refineQueueDir, { ...state, enabled, updated_at: Date.now() });
      actionLog('kernel', 'refine:set-enabled', { enabled, user: gate.ctx.user_id });
      return { ok: true, ...view() };
    } catch (e) { return l0Fail(e); }
  });
  // 批次41-I 后续：设置补炼每日额度（限额/不限额），仅管理员。载荷 = {enabled, rows?}
  handleIpc(IPC.refineSetCap, async (_e, payload: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.refineSetCap);
    if (!gate.ok) return { ok: false, error: gate.error };
    const p = (payload ?? {}) as { enabled?: unknown; rows?: unknown };
    if (typeof p.enabled !== 'boolean') return { ok: false, error: '需要一个 {enabled:boolean, rows?:number} 载荷' };
    if (p.enabled) {
      if (typeof p.rows !== 'number' || !Number.isFinite(p.rows) || p.rows < 1) {
        return { ok: false, error: '限额时 rows 必须是 ≥1 的数字' };
      }
    }
    try {
      const state = loadRefineQueue(refineQueueDir);
      const next = setRefineCap(state, { enabled: p.enabled, rows: typeof p.rows === 'number' ? p.rows : undefined });
      saveRefineQueue(refineQueueDir, next);
      // 只记布尔与计数：没有正文，且不限额时不落一个假的大数字
      actionLog('kernel', 'refine:set-cap', {
        cap_enabled: next.cap_enabled, cap_rows: next.cap_enabled ? next.cap_rows : null, user: gate.ctx.user_id,
      });
      return { ok: true, ...view() };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.refineBackfill, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.refineBackfill);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const { state, report } = enqueueRows(loadRefineQueue(refineQueueDir), await storage.listMemories({}));
      saveRefineQueue(refineQueueDir, state);
      actionLog('kernel', 'refine:backfill-run', { ...report, user: gate.ctx.user_id });
      return { ok: true, report, ...view() };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.refineRetryFailed, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.refineRetryFailed);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      const { state, retried } = retryFailed(loadRefineQueue(refineQueueDir));
      saveRefineQueue(refineQueueDir, state);
      actionLog('kernel', 'refine:retry-failed', { retried, user: gate.ctx.user_id });
      return { ok: true, retried, ...view() };
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
      // 批次41-G：畸形 % 序列会让 decodeURIComponent 抛 URIError，未捕获会打断整个请求回调
      let urlPath: string;
      try {
        urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
      } catch {
        res.writeHead(400);
        res.end('bad request');
        return;
      }
      if (urlPath === '/') urlPath = '/workspace.html';
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
 * 顶部自绘标题栏（批次48 S10）：窗口按钮覆盖层跟随壳层主题换底色/符号色。
 * 只接受 light|dark 两个值；按钮本身仍由系统绘制与响应，主进程不接管点击。
 */
function registerShellIpc(): void {
  handleIpc(IPC.shellTitleBarTheme, (event, theme: unknown) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isDestroyed()) return { ok: false, error: '找不到调用方窗口' };
    const colors = theme === 'dark' ? TITLEBAR_DARK : TITLEBAR_LIGHT;
    w.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
    return { ok: true };
  });
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
  // 批次47 P0-3：读写通道也需登录会话（此前只有删除/审计写有闸门，读与 putMemory 匿名可用）
  const rw = createStorageReadWriteHandlers({
    storage,
    requireSession: (sessionId, channel) => requireDataPlaneSession(sessionId, channel),
    // 批次48 A7：归属校验按 home server 会话真源判定（不接受渲染层自报租户）
    getSessionContext: (sessionId) => {
      const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
      return sid ? homeServerRef?.getSessionContext(sid) ?? null : null;
    },
  });
  handleIpc(IPC.storagePutMemory, async (_e, m, sessionId?: unknown) => {
    const r = await rw.putMemory(m, sessionId);
    // 批次48 A16：参数快照写入后立即刷新反代理记账（后续路由/审计用新值，无需重启）
    const content = (m as { content?: unknown } | null)?.content;
    if (typeof content === 'string' && content.startsWith(PARAMS_PREF_PREFIX)) await refreshProxyAccounting();
    return r;
  });
  handleIpc(IPC.storageGetMemory, (_e, id, sessionId?: unknown) => rw.getMemory(id, sessionId));
  handleIpc(IPC.storageListMemories, (_e, f, sessionId?: unknown) => rw.listMemories(f, sessionId));
  handleIpc(IPC.storageDeleteMemory, async (_e, id, sessionId?: unknown) => {
    requireDataPlaneSession(sessionId, IPC.storageDeleteMemory);
    const r = await storage.deleteMemory(id as string);
    // 批次41-C：硬删后同 id 的补炼队列条目即成幽灵，摘掉（热路径只删这一个，不触发全量对账）
    removeRefineQueueRow(id as string);
    return r;
  });
  handleIpc(IPC.storageAppendAudit, (_e, a, sessionId?: unknown) => {
    requireDataPlaneSession(sessionId, IPC.storageAppendAudit);
    validateAuditRecord(a);
    return storage.appendAudit(a as Parameters<typeof storage.appendAudit>[0]);
  });
  handleIpc(IPC.storageQueryAudit, (_e, f, sessionId?: unknown) => rw.queryAudit(f, sessionId));
  // ── 批次46-D6：项目注册表（多用户三池基础）──
  handleIpc(IPC.storageCreateProject, (_e, input) => storage.createProject(input as Parameters<typeof storage.createProject>[0]));
  handleIpc(IPC.storageGetProject, (_e, id) => storage.getProject(id as string));
  handleIpc(IPC.storageListProjects, (_e, f) => storage.listProjects(f as Parameters<typeof storage.listProjects>[0]));
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

// ── §6e 首启向导 IPC（批次37-B）────────────────────────────────────────────
// 向导跑在登录之前，所以这几条通道**不带会话**：门禁换成「本机此刻还没有需要保护的东西」——
// 设 L0 管理密码只在密钥环尚无 admin_wrap 时放行（那时 L0 库里没有任何密文，设密码不是越权）；
// 一旦 admin_wrap 存在，改密码/换发码一律回到 l0:recovery* 的管理员口径，向导只剩「导出这一张卡」。
// 恢复码只在发那一次返回；日志只记指纹（8 位散列）与目录，绝不记密码、绝不记码。
//
// 批次58：向导新增两个**可选**步骤（两个备份路径 / 精炼大模型）。它们同样没有会话，
// 门禁统一用「向导还没走完」这条更硬的本机判据（指针 setupDone !== true）：
// 走完之后 setup:setBackup / setup:llm* 一律拒绝，正规入口回到 backup:*（需管理员）与 llm:*（需管理员）。
const trimStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 向导是否还开着（= 本机首启设置尚未完成）；所有 setup:* 写通道共用这一条 */
function wizardOpen(): boolean {
  return !isSetupComplete(readSetupPointer());
}

/** 精炼引擎草稿：预设厂商（preset）或自定义 OpenAI 兼容端点（name + baseURL），外加模型名与密钥 */
interface LlmSetupDraft {
  preset?: string;
  name?: string;
  baseURL?: string;
  model?: string;
  apiKey?: string;
}

/**
 * 把草稿折算成「如果现在保存，会得到什么配置」——**纯内存**，不落盘。
 * 拨测与保存都走这一条：先测后存，两次算法同一真源，不会出现「测的是 A 存的是 B」。
 * 自定义引擎按 baseURL 复用既有条目（重复点「测试」不会在配置里堆一串同地址副本）。
 */
function llmDraftInto(
  cfg: LlmGatewayConfig,
  draft: LlmSetupDraft,
): { ok: true; cfg: LlmGatewayConfig; id: string; apiKey: string } | { ok: false; error: string } {
  const model = trimStr(draft.model);
  const apiKey = trimStr(draft.apiKey);
  const preset = draft.preset ? LLM_PRESETS.find((p) => p.preset === draft.preset) ?? null : null;
  let id = '';
  let next = cfg;
  if (preset) {
    id = preset.preset;
    if (!cfg.engines.some((e) => e.id === id)) next = mergeLlmConfig(cfg, { add: { preset: id } }).cfg;
    if (!model) return { ok: false, error: '请填写模型名（精炼要指定具体模型，不能留空）' };
  } else {
    const name = trimStr(draft.name);
    const baseURL = trimStr(draft.baseURL);
    if (!name || !baseURL) return { ok: false, error: '自定义引擎请填写名称与 baseURL（OpenAI 兼容地址）' };
    if (!model) return { ok: false, error: '请填写模型名（精炼要指定具体模型，不能留空）' };
    const existing = cfg.engines.find((e) => e.baseURL === baseURL);
    if (existing) {
      id = existing.id;
      next = mergeLlmConfig(cfg, { engines: [{ id, name }] }).cfg;
    } else {
      const before = new Set(cfg.engines.map((e) => e.id));
      next = mergeLlmConfig(cfg, { add: { name, baseURL, model } }).cfg;
      id = next.engines.find((e) => !before.has(e.id))?.id ?? '';
    }
    if (!id) return { ok: false, error: '无法登记自定义引擎：请检查 baseURL 是否合法' };
  }
  // 模型名与（预设时允许改的）地址：预设引擎的 baseURL 以预设为准，用户只改模型
  next = mergeLlmConfig(next, { engines: [{ id, model }] }).cfg;
  const eng = next.engines.find((e) => e.id === id);
  if (eng?.needsKey && !apiKey) return { ok: false, error: '该厂商需要 API Key：请填写后再测试' };
  return { ok: true, cfg: next, id, apiKey };
}

function registerSetupIpc(vault: L0Vault, staticPort: number): void {
  handleIpc(IPC.setupState, async () => {
    const pointer = readSetupPointer();
    const paths = pointer ? resolveLibraryPaths(pointer) : LIB_PATHS;
    // 密钥环读不动（损坏）时按「没设过密码」如实回显，让向导给出真实下一步，而不是把用户卡死
    const vaultStatus = await vault.status().catch(() => null);
    const recovery = await vault.recoveryStatus().catch(() => null);
    const backupCfg = loadBackupConfig();
    const llmView = llmEngineViews(loadLlmConfig(USER_DATA), loadLlmKeys(USER_DATA));
    return {
      ok: true,
      setup_done: isSetupComplete(pointer),
      dirs_set: hasLibraryDirs(pointer),
      ledger_dir: paths.ledgerDir,
      l0_dir: paths.l0Dir,
      same_dir: samePath(paths.ledgerDir, paths.l0Dir),
      ledger_file: libraryFileState(paths.ledgerDir, LEDGER_FILE_NAME),
      l0_file: libraryFileState(paths.l0Dir, L0_FILE_NAME),
      has_admin_password: Boolean(vaultStatus?.has_admin_wrap),
      write_unlocked: Boolean(vaultStatus?.write_unlocked),
      has_recovery: Boolean(recovery?.has_recovery),
      card_pending: Boolean(pendingRecoveryCard),
      card_exported: recoveryCardExported,
      fingerprint: pendingRecoveryCard?.fingerprint ?? recovery?.fingerprint ?? '',
      // ── 批次58 新增两步的回显（可选步骤也要如实回显，页面不能自己猜「做没做」）──
      backup: {
        ledger_dir: backupCfg.ledgerDir ?? '',
        l0_dir: backupCfg.l0Dir ?? '',
        shared_dir: backupCfg.dir ?? '',
        default_dir: join(USER_DATA, 'backups'),
        enabled: backupCfg.enabled,
        hour: backupCfg.hour,
        minute: backupCfg.minute,
        keep_count: backupCfg.keepCount,
      },
      llm: {
        usable: Boolean(llmGateway),
        skipped: pointer?.llmSkipped === true,
        engines: llmView.engines.map((e) => ({
          id: e.id, name: e.name, model: e.model, enabled: e.enabled,
          keySet: e.keySet, lastProbeOk: e.lastProbeOk, lastLatencyMs: e.lastLatencyMs,
        })),
        presets: llmView.presets,
      },
    };
  });

  /**
   * 改选两库位置（向导里唯一的「选错了想重来」出口）：重跑第一段对话框 → 写指针 → 重启。
   * 只改位置，不动文件（下一轮启动的 `adoptLibraryFilesIntoPlace` 负责把库补送到新目录，不删源）。
   */
  handleIpc(IPC.setupReselectDirs, async () => {
    const pointer = readSetupPointer();
    const dirs = await chooseLibraryDirs(pointer?.root ?? USER_DATA);
    if (!dirs) return { ok: false, canceled: true, error: '未选择目录：保持原位置不变' };
    const next: DataRootPointer = {
      ...(pointer ?? { version: DATA_ROOT_POINTER_VERSION, root: USER_DATA, updatedAt: '' }),
      ledgerDir: dirs.ledgerDir, l0Dir: dirs.l0Dir,
    };
    if (!persistPointer(next)) return { ok: false, error: '无法写入数据位置指针：请检查该目录是否可写' };
    actionLog('dataRoot', 'setup:dirs-set', { ledgerDir: dirs.ledgerDir, l0Dir: dirs.l0Dir, reselect: true });
    try {
      app.relaunch();
    } catch (e) {
      console.error('[setup] relaunch failed', e);
    }
    app.exit(0);
    return { ok: true, relaunch: true };
  });

  /** 首启设 L0 管理密码：一次建好 DEK + 密码包 + 恢复码包，码只在这里出现一次 */
  handleIpc(IPC.setupSetL0Password, async (_e, password?: string) => {
    if (password !== undefined && typeof password !== 'string') {
      return { ok: false, error: '管理密码必须是字符串' };
    }
    if ((await vault.status().catch(() => null))?.has_admin_wrap) {
      actionLog('dataRoot', 'setup:set-password-denied', { reason: 'already_set' }, { level: 'warn' });
      return { ok: false, error: '本机已设过 L0 管理密码：请在「安全」页用恢复码找回，向导不再改密码' };
    }
    try {
      const issued = await vault.initL0WithRecovery({ password: password ?? '', admin_user_id: 'setup:first-run' });
      actionLog('kernel', 'l0:recovery-issued', { op: 'init', fingerprint: issued.fingerprint, user: 'setup:first-run' });
      actionLog('dataRoot', 'setup:l0-password-set', { fingerprint: issued.fingerprint });
      return { ok: true, ...issueRecoveryCard(issued) };
    } catch (e) { return l0Fail(e); }
  });

  /**
   * 密码已设但恢复卡没导出就重启（码明文只给过一次，本进程已经没有了）：
   * 用管理密码当场解锁 → 换发一张**新**码 → 立刻锁回去。旧码随之作废，不留下「旧卡还能用」的窗口。
   */
  handleIpc(IPC.setupRegenCode, async (_e, password?: string) => {
    if ((await vault.status().catch(() => null))?.has_admin_wrap !== true) {
      return { ok: false, error: '尚未设置 L0 管理密码：请先完成上一步' };
    }
    try {
      await vault.unlockWrite({ password: password ?? '', admin_user_id: 'setup:first-run' });
      const issued = await vault.rotateRecoveryCode({ admin_user_id: 'setup:first-run' });
      await vault.lockWrite({ admin_user_id: 'setup:first-run' });
      actionLog('kernel', 'l0:recovery-issued', { op: 'rotate', fingerprint: issued.fingerprint, user: 'setup:first-run' });
      return { ok: true, ...issueRecoveryCard(issued) };
    } catch (e) {
      void vault.lockWrite({ admin_user_id: 'setup:first-run' }).catch(() => undefined);
      return l0Fail(e);
    }
  });

  /** 导出恢复卡：与批次37-G 同一段实现（原生另存为，日志只有文件名/字节/指纹） */
  handleIpc(IPC.setupExportCard, async () => exportPendingRecoveryCard('setup:first-run'));

  /**
   * 批次58 可选步骤①：为某一组备份挑目录（记忆库组 / 原数据库组）。
   * 只回目录、不落配置——用户在页面上还可能改主意，真正落盘统一走 setup:setBackup。
   * 校验用与数据根同一真源（绝对路径、拒 UNC/相对、可写探针），不另立一套判据。
   */
  handleIpc(IPC.setupChooseBackupDir, async (_e, group?: string) => {
    if (!wizardOpen()) return { ok: false, error: '首启设置已完成：备份位置请到「记忆库」页修改' };
    const g = group === 'l0' ? 'l0' : 'ledger';
    const cfg = loadBackupConfig();
    const current = (g === 'ledger' ? cfg.ledgerDir : cfg.l0Dir) || cfg.dir || join(USER_DATA, 'backups');
    const pick = await dialog.showOpenDialog({
      title: g === 'ledger' ? '选择记忆库备份目录' : '选择原数据库备份目录',
      defaultPath: existsSync(current) ? current : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true, error: '未选择目录：保持原设置不变' };
    const v = validateDataRootPath(pick.filePaths[0]);
    if (!v.ok) return { ok: false, error: v.error };
    const w = ensureDirWritable(v.root);
    if (!w.ok) return { ok: false, error: `${v.root}\n${w.error}` };
    return { ok: true, group: g, dir: v.root };
  });

  /**
   * 批次58 可选步骤①落盘：两组备份目录 + 是否开启定时自动备份。
   * 空字符串 = 清空该组（回落到共用 dir / 默认目录），不是一个「空路径」。
   * 警告不阻断：备份目录与库同目录、或落在数据根里时如实提示「事故时会一起没」，但用户有权这么选。
   */
  handleIpc(IPC.setupSetBackup, async (_e, patch?: { ledgerDir?: unknown; l0Dir?: unknown; enabled?: unknown }) => {
    if (!wizardOpen()) return { ok: false, error: '首启设置已完成：备份位置请到「记忆库」页修改' };
    const cfg = loadBackupConfig();
    const warnings: string[] = [];
    const next = { ...cfg };
    for (const key of ['ledgerDir', 'l0Dir'] as const) {
      if (patch?.[key] === undefined) continue;
      const raw = trimStr(patch[key]);
      if (!raw) { delete next[key]; continue; }
      const v = validateDataRootPath(raw);
      if (!v.ok) return { ok: false, error: `${key === 'ledgerDir' ? '记忆库' : '原数据库'}备份目录不可用：${v.error}` };
      const w = ensureDirWritable(v.root);
      if (!w.ok) return { ok: false, error: `${key === 'ledgerDir' ? '记忆库' : '原数据库'}备份目录不可写：${w.error}` };
      (next as Record<string, unknown>)[key] = v.root;
      const libDir = key === 'ledgerDir' ? LIB_PATHS.ledgerDir : LIB_PATHS.l0Dir;
      if (samePath(v.root, libDir)) warnings.push(`${key === 'ledgerDir' ? '记忆库' : '原数据库'}备份与库在同一目录：同一次事故里会一起没`);
      else if (samePath(v.root, USER_DATA)) warnings.push('备份目录就是数据根：整个目录出问题时备份也跟着没');
    }
    if (typeof patch?.enabled === 'boolean') next.enabled = patch.enabled;
    // 设了任一备份目录就默认把定时备份打开（否则「设了路径」等于没设，用户以为已在备份）
    if ((next.ledgerDir || next.l0Dir) && typeof patch?.enabled !== 'boolean') next.enabled = true;
    try {
      saveBackupConfig(next);
    } catch (e) {
      return { ok: false, error: `备份设置没保存：${String((e as Error)?.message ?? e)}` };
    }
    actionLog('dataRoot', 'setup:backup-set', {
      ledgerDir: next.ledgerDir ?? '', l0Dir: next.l0Dir ?? '', enabled: next.enabled,
      hour: next.hour, minute: next.minute, keep: next.keepCount,
    });
    return {
      ok: true,
      warnings,
      backup: {
        ledger_dir: next.ledgerDir ?? '', l0_dir: next.l0Dir ?? '', shared_dir: next.dir ?? '',
        enabled: next.enabled, hour: next.hour, minute: next.minute, keep_count: next.keepCount,
      },
    };
  });

  /**
   * 批次58 可选步骤②拨测：**不落盘**，只回答「这个厂商 + 这个模型 + 这把密钥此刻连通吗」。
   * 与参数页的 llm:test 同一条 testEngine，因此向导说「通」和页面说「通」是同一件事。
   */
  handleIpc(IPC.setupLlmTest, async (_e, draft?: LlmSetupDraft) => {
    if (!wizardOpen()) return { ok: false, error: '首启设置已完成：模型请在参数页配置' };
    const built = llmDraftInto(loadLlmConfig(USER_DATA), draft ?? {});
    if (!built.ok) return { ok: false, error: built.error };
    const r = await testEngine(built.cfg, { [built.id]: built.apiKey }, built.id);
    const eng = built.cfg.engines.find((e) => e.id === built.id);
    actionLog('llm', 'setup-test', { engine: built.id, model: r.model ?? '', ok: r.ok, latencyMs: r.latencyMs ?? 0, ...(r.error ? { error: r.error } : {}) });
    return { ok: r.ok, model: r.model, latencyMs: r.latencyMs, error: r.error, engine: { id: built.id, name: eng?.name ?? '', model: eng?.model ?? '' } };
  });

  /**
   * 批次58 可选步骤②保存：**先在主进程再拨测一次**，通过才落盘并启用。
   * 为什么再测一次：页面上的「测试通过」只是几秒前的一次回执，不能当作写盘许可；
   * 主进程自己测过才写，「拨测通过才算已添加」这条口径不靠渲染层自觉。
   */
  handleIpc(IPC.setupLlmSave, async (_e, draft?: LlmSetupDraft) => {
    if (!wizardOpen()) return { ok: false, error: '首启设置已完成：模型请在参数页配置' };
    const built = llmDraftInto(loadLlmConfig(USER_DATA), draft ?? {});
    if (!built.ok) return { ok: false, error: built.error };
    const probe = await testEngine(built.cfg, { [built.id]: built.apiKey }, built.id);
    if (!probe.ok) {
      actionLog('llm', 'setup-save-rejected', { engine: built.id, ok: false, ...(probe.error ? { error: probe.error } : {}) }, { level: 'warn' });
      return { ok: false, error: `连通性测试未通过，未保存：${probe.error ?? '未知原因'}`, probe };
    }
    const enabledCfg = mergeLlmConfig(built.cfg, { engines: [{ id: built.id, enabled: true }] }).cfg;
    const finalCfg = applyProbeResult(enabledCfg, built.id, probe);
    try {
      saveLlmConfig(USER_DATA, finalCfg);
      if (built.apiKey) saveLlmKey(USER_DATA, built.id, built.apiKey); // 密钥本体不进日志
    } catch (e) {
      return { ok: false, error: `模型配置没保存：${String((e as Error)?.message ?? e)}` };
    }
    llmGateway = loadLlmGateway(USER_DATA);
    const eng = finalCfg.engines.find((e) => e.id === built.id);
    actionLog('llm', 'setup-config-saved', {
      engine: built.id, name: eng?.name ?? '', model: eng?.model ?? '',
      latencyMs: probe.latencyMs ?? 0, usable: Boolean(llmGateway),
    });
    return {
      ok: true,
      engine: { id: built.id, name: eng?.name ?? '', model: eng?.model ?? '' },
      latencyMs: probe.latencyMs,
      usable: Boolean(llmGateway),
    };
  });

  /** 明确跳过精炼模型：只落一个标记（进度卡显示「已跳过」），门禁不变——这一步本来就是可选 */
  handleIpc(IPC.setupSkipLlm, async () => {
    if (!wizardOpen()) return { ok: false, error: '首启设置已完成' };
    const pointer = readSetupPointer();
    const next: DataRootPointer = {
      ...(pointer ?? { version: DATA_ROOT_POINTER_VERSION, root: USER_DATA, updatedAt: '' }),
      ...(LIB_PATHS.ledgerDir ? { ledgerDir: LIB_PATHS.ledgerDir } : {}),
      ...(LIB_PATHS.l0Dir ? { l0Dir: LIB_PATHS.l0Dir } : {}),
      llmSkipped: true,
    };
    if (!persistPointer(next)) return { ok: false, error: '无法写入数据位置指针：请检查该目录是否可写' };
    actionLog('dataRoot', 'setup:llm-skipped', { usable: Boolean(llmGateway) }, { level: 'warn' });
    return { ok: true, skipped: true };
  });

  /**
   * 走完向导：只有「两库位置已定 + 备份位置至少一处 + 密码已设 + 本次真导出过一张卡」才落 setupDone。
   * 备份是**必选**（用户 2026-11-10 拍板）：不设备份的机器上两库只有一份，坏一次就没了，
   * 所以这条闸门放在主进程，页面把按钮点亮也没用。精炼模型仍可选，不在此列。
   * 落不了指针就如实报错——下次启动照样被向导拦住，绝不假装配置成功。
   */
  handleIpc(IPC.setupFinish, async () => {
    const pointer = readSetupPointer();
    const status = await vault.status().catch(() => null);
    if (!status?.has_admin_wrap) return { ok: false, error: '还没设置 L0 管理密码：这一步不能跳' };
    const backupCfg = loadBackupConfig();
    if (!trimStr(backupCfg.ledgerDir) && !trimStr(backupCfg.l0Dir)) {
      return { ok: false, error: '备份位置还没设置：这一步不能跳（至少给记忆库或原数据库选一处备份目录）' };
    }
    if (!recoveryCardExported || !pendingRecoveryCard) {
      return { ok: false, error: '恢复卡还没导出：没有这张卡，忘记管理密码时 L0 原文就找不回来' };
    }
    const next: DataRootPointer = {
      ...(pointer ?? { version: DATA_ROOT_POINTER_VERSION, root: USER_DATA, updatedAt: '' }),
      ledgerDir: LIB_PATHS.ledgerDir,
      l0Dir: LIB_PATHS.l0Dir,
      setupDone: true,
    };
    if (!persistPointer(next)) return { ok: false, error: '无法写入数据位置指针（首启设置没保存）：请检查该目录是否可写后重试' };
    actionLog('dataRoot', 'setup:done', {
      ledgerDir: LIB_PATHS.ledgerDir, l0Dir: LIB_PATHS.l0Dir, fingerprint: pendingRecoveryCard.fingerprint,
      // 批次58：精炼模型是可选项，走完时如实记下用户是「配了」「明确跳过」还是「压根没碰」
      llm: llmGateway ? 'configured' : (pointer?.llmSkipped ? 'skipped' : 'untouched'),
      backupEnabled: loadBackupConfig().enabled,
    });
    // 由主进程给下一步地址：端口参数只有它知道，页面自己拼会漏掉 backend/agentBackend
    return { ok: true, next_url: mainWindowUrl(staticPort, false) };
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
  // 批次37-B：两个库各有自己的目录（首启向导写进指针）；没走过向导的老指针 = 都跟随数据根，
  // 这是「兼容读取」而不是「绕过向导」——向导门禁见 prepareDataRoot / setup:state
  {
    const p = DATA_ROOT_POINTER ? readDataRootPointer(DATA_ROOT_POINTER) : { status: 'missing' as const };
    LIB_PATHS = p.status === 'ok'
      ? resolveLibraryPaths(p.pointer)
      : {
        root: USER_DATA, ledgerDir: USER_DATA, l0Dir: USER_DATA,
        ledger: join(USER_DATA, LEDGER_FILE_NAME), l0: join(USER_DATA, L0_FILE_NAME),
        keyring: join(USER_DATA, L0_KEYRING_FILE_NAME), audit: join(USER_DATA, AUDIT_FILE_NAME),
      };
  }
  DB_PATH = LIB_PATHS.ledger;
  L0_DB_PATH = LIB_PATHS.l0;
  AUDIT_PATH = LIB_PATHS.audit;
  L0_KEYRING_PATH = join(LIB_PATHS.l0Dir, L0_KEYRING_FILE_NAME);
  COLLECTOR_CURSOR_FILE = join(USER_DATA, 'collector-cursor.json');
  MAIN_LOG = join(USER_DATA, 'main.log');
  BACKUP_CFG_PATH = join(USER_DATA, 'backup-config.json');
  // 第一轮个人记忆：独立文件，与 memories.db.json / 审计账本分开（不扩 Memory 主表）
  personalStoreRef = new FilePersonalStore(join(USER_DATA, 'personal-memory.db.json'));
  // 动作日志（批次7）：先于迁移/服务启动初始化，保证启动期动作也有落盘
  initActionLog({ file: join(USER_DATA, 'actions.log') });
  actionLog('app', 'bootstrap:start', { root: USER_DATA });
  // 数据根迁移必须在 FileStorage/服务启动前完成（无在途写）：只复制白名单、不覆盖、不删源
  const dataRootMigration = applyDataRootMigration();
  const legacyDbImported = importLegacyDbDir();
  // 批次37-B：库文件必须落在指针指定的目录（migrateFrom 的数据是上一步才进数据根的，所以核对只能放这里）
  adoptLibraryFilesIntoPlace();
  // 批次37-A：L0 原数据库必须在 FileStorage 之前就绪 —— 写记忆时信封要能立刻搬家。
  // 读不动（结构损坏）时：原件已由 l0Store 改名 *.corrupt 保留，本次按空库继续，但必须把
  // 「原件在哪 / 哪些行会断链」写进主日志与动作日志，绝不静默开空库（与记忆库 D3 同口径）。
  try {
    l0Store = new FileL0BlobStore(L0_DB_PATH);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    void mlog('storage:l0-corrupt-notice', { path: L0_DB_PATH, error: msg });
    actionLog('kernel', 'l0:store-corrupt', { path: L0_DB_PATH, error: msg }, { level: 'error' });
    l0Store = new FileL0BlobStore(L0_DB_PATH); // 原件已改名隔离，重试即得到空库（不再抛）
  }
  if (l0Store.readOnly) {
    void mlog('storage:l0-readonly', { path: L0_DB_PATH, lockedBy: l0Store.lockedBy ?? null });
  }
  storage = new FileStorage(DB_PATH, { l0: l0Store, auditPath: AUDIT_PATH });
  // 上次损坏已隔离 → 本次是空库：必须让用户知道原件位置，不能静默开空库
  const corruptNotice = storage.takeCorruptionNotice();
  if (corruptNotice) void mlog('storage:corrupt-notice', corruptNotice);
  // 批次41-A 存量迁移闸门：库里还压着历史审计时（本机实测 11,666 行 / 2.9 MiB），先按项目不变量
  // 「批量改写账本前先备份」做一次备份，备成了才把它们搬进 audit.jsonl 并清空库里那格。
  // 备份没做成 → 本次不搬，历史审计原样留在库里（读与查照旧），绝不无备份动用户的账本；
  // 只读镜像（写锁被别的进程持有）同样不搬 —— 那是写方的账本，等持有写锁的进程自己搬。
  {
    const pending = storage.auditStats.legacy_rows_in_ledger;
    if (pending > 0 && storage.auditStats.readonly) {
      void mlog('bootstrap:audit-migrate-deferred', { legacy_rows: pending, reason: 'readonly' });
    } else if (pending > 0) {
      try {
        const dir = await backupBeforeKernelChange('audit-log-split', 'audit:log-backup');
        const moved = storage.migrateLegacyAudit();
        void mlog('bootstrap:audit-migrated', { rows: moved, to: AUDIT_PATH, backup_dir: dir });
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        void mlog('bootstrap:audit-migrate-skipped', { legacy_rows: pending, error: msg });
        actionLog('kernel', 'audit:log-migrate-skipped', { legacy_rows: pending, error: msg }, { level: 'warn' });
      }
    }
  }
  // 批次41-A：审计搬出主库后，「账本在哪 / 多少行 / 有没有读不动的行」必须每次启动都留痕——
  // 审计是追责用的，一个静默空账本比一个报错的账本危险得多。
  {
    const a = storage.auditStats;
    void mlog('bootstrap:audit-log', {
      path: a.path, rows: a.rows, bytes: a.bytes, archive_files: a.archive_files,
      archived_rows: a.archived_rows, skipped_lines: a.skipped_lines,
      legacy_rows_in_ledger: a.legacy_rows_in_ledger, readonly: a.readonly,
    });
    actionLog('kernel', 'audit:log-open', {
      path: a.path, rows: a.rows, bytes: a.bytes, archive_files: a.archive_files,
      archived_rows: a.archived_rows, skipped_lines: a.skipped_lines, readonly: a.readonly,
    });
    if (a.migrated_rows > 0) {
      actionLog('kernel', 'audit:log-migrated', { migrated_rows: a.migrated_rows, to: a.path });
    }
    if (a.skipped_lines > 0) {
      actionLog('kernel', 'audit:log-bad-lines', { path: a.path, skipped_lines: a.skipped_lines }, { level: 'warn' });
    }
    if (a.corruption) {
      actionLog('kernel', 'audit:log-corrupt', a.corruption, { level: 'error' });
    }
  }
  // 批次45-A1 单一租户真源：数据根级 tenant.json（0600）。采集器 / webhook / MCP 引导账户统一读它，
  // 不再各自写死三元组（首建 = 规范缺省 u1/t1/e1，与存量账本一致）；损坏 fail-fast 阻断启动。
  const tenantTriple = loadOrCreateTenant(USER_DATA);
  void mlog('bootstrap:tenant-source', { file: join(USER_DATA, 'tenant.json'), ...tenantTriple });
  actionLog('app', 'bootstrap:tenant-source', { user_id: tenantTriple.user_id, team_id: tenantTriple.team_id, enterprise_id: tenantTriple.enterprise_id });
  // 第二轮 owner 口径：登录账号 → 内核账号显式绑定（env 真源；损坏 = 明确告警 + 保持空表，
  // 绝不猜映射：未绑定的个人条目仅本机可见，agent 不召回）。
  try {
    personalOwnerBindings = parsePersonalOwnerBindings(process.env.MAM_PERSONAL_OWNER_BINDINGS);
    actionLog('app', 'bootstrap:personal-owner-bindings', { count: personalOwnerBindings.length, kernel_user_id: tenantTriple.user_id });
  } catch (e) {
    personalOwnerBindings = [];
    const msg = String((e as Error)?.message ?? e);
    void mlog('bootstrap:personal-owner-bindings-bad', { error: msg });
    actionLog('app', 'bootstrap:personal-owner-bindings-bad', { error: msg }, { level: 'error' });
  }

  // 批次42-B 云端同步中枢：主进程 pglite 落盘（数据根 sync-hub/，跨端同机中枢——桌面/Web/CLI 同源）。
  // 建表幂等；init 失败不阻断启动（同步是增量能力，ROADMAP 批次42 总边界），置 null + 日志，
  // sync:* handler 如实报「中枢未就绪」，绝不假装可用。
  //
  // B4（批次B类）：SYNC_HUB_PG_URL 设置 = 接远端共享 Postgres 中枢（多机前提，标准 PG 方言，pglite/pg 双后端同构）；
  //   未设置则沿用单机 pglite 落盘——现状行为零变化。远端模式 init 失败 = 连接/建表失败，明确报
  //   sync-hub-remote-fail，**绝不静默退回本地 pglite**（fail-fast，避免远端配置下悄悄丢到本地库）。
  // B1（批次B类）：SYNC_MULTI_TENANT=1 + tenant.json 规范三元组 = 中枢层跨机团队硬过滤（fail-closed）；
  //   远端共享中枢被多机共用时，伪造 team_id 的越权读写在 push/pull/reconcile 入口即拒。
  {
    const hubDir = join(USER_DATA, 'sync-hub');
    const syncHubPgUrl = process.env.SYNC_HUB_PG_URL?.trim() || undefined;
    const syncMultiTenant = process.env.SYNC_MULTI_TENANT === '1' || process.env.SYNC_MULTI_TENANT === 'true';
    const syncHubOpts = {
      pgUrl: syncHubPgUrl,
      canonicalTenant: {
        team_id: tenantTriple.team_id,
        enterprise_id: tenantTriple.enterprise_id,
        user_id: tenantTriple.user_id,
      },
      multiTenant: syncMultiTenant,
    };
    try {
      const hub = syncHubPgUrl
        ? new PgSyncHub(undefined, syncHubOpts) // B4 远端：dataDir 无意义，走 pgUrl 后端
        : new PgSyncHub(hubDir, syncHubOpts);   // 默认：单机 pglite 落盘
      await hub.init();
      syncHub = hub;
      void mlog('bootstrap:sync-hub', { dir: hubDir, remote: !!syncHubPgUrl, multiTenant: syncMultiTenant, team_id: tenantTriple.team_id });
      actionLog('app', 'bootstrap:sync-hub', { dir: hubDir, remote: !!syncHubPgUrl, multiTenant: syncMultiTenant, team_id: tenantTriple.team_id });
    } catch (e) {
      syncHub = null;
      const err = String((e as Error)?.message ?? e);
      const tag = syncHubPgUrl ? 'sync-hub-remote-fail' : 'sync-hub-fail';
      void mlog(tag, { dir: hubDir, pgUrl: syncHubPgUrl ? '(set)' : '(unset)', multiTenant: syncMultiTenant, error: err });
      actionLog('app', tag, { dir: hubDir, pgUrl: syncHubPgUrl ? '(set)' : '(unset)', multiTenant: syncMultiTenant, error: err }, { level: 'error' });
    }
  }

  // 批次45-A2 存量租户归一：把历史行的 team_id/enterprise_id 重盖成 tenant.json 规范值（user_id 保留），
  // 幂等（已归一 mismatched=0 零写盘）、逐行审计。沿用批次41-A 审计迁移口径：改写前先备份
  //（备份失败即本次不迁，绝不无备份动用户的账本）；只读镜像同样不迁——等持有写锁的进程自己迁。
  {
    const target = { team_id: tenantTriple.team_id, enterprise_id: tenantTriple.enterprise_id };
    const preview = await scanRowsForTenantNormalize(storage, target);
    if (preview.mismatched > 0 && storage.auditStats.readonly) {
      void mlog('bootstrap:tenant-normalize-deferred', { mismatched: preview.mismatched, reason: 'readonly' });
    } else if (preview.mismatched > 0) {
      try {
        const dir = await backupBeforeKernelChange('tenant-normalize', 'ledger:tenant-backup');
        const now = Date.now();
        const report = await normalizeTenantFields({
          storage, target, admin_user_id: tenantTriple.user_id,
          request_id: `req_tenant_norm_${now}`, now, backup_confirmed: true,
        });
        void mlog('bootstrap:tenant-normalized', {
          mismatched: preview.mismatched, normalized: report.normalized, failed: report.failed,
          by_field: report.by_field, by_user: report.by_user, to: dir,
        });
        actionLog('kernel', 'ledger:tenant-normalized', {
          total: report.total, mismatched: report.mismatched, normalized: report.normalized,
          failed: report.failed, tombstones: report.tombstones, target, backup_dir: dir,
        });
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        void mlog('bootstrap:tenant-normalize-skipped', { mismatched: preview.mismatched, error: msg });
        actionLog('kernel', 'ledger:tenant-normalize-skipped', { mismatched: preview.mismatched, error: msg }, { level: 'warn' });
      }
    } else {
      void mlog('bootstrap:tenant-normalize-clean', { total: preview.total, target });
    }
  }
  void mlog('bootstrap:data-root', {
    root: USER_DATA,
    defaultRoot: DEFAULT_DATA_ROOT,
    isDefault: !!DEFAULT_DATA_ROOT && samePath(USER_DATA, DEFAULT_DATA_ROOT),
    pointer: DATA_ROOT_POINTER,
    pointerWriteError: dataRootPointerWriteError,
    l0Path: L0_DB_PATH,
    l0ReadOnly: l0Store.readOnly,
    l0Count: await l0Store.count(),
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
  registerShellIpc();
  registerBackupIpc();
  registerDataRootIpc();
  registerPersonalIpc({
    kernelUserId: tenantTriple.user_id,
    bindings: personalOwnerBindings,
    sync: syncHub ? { push: (m, f) => syncHub!.push(m, f) } : undefined,
  });
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

  // preload 只在主 frame 执行（webPreferences.preload），overview.html 内嵌 <iframe> 拿不到
  // window.__ELECTRON__/window.api 属预期行为：子页面统一走 desktop/hostBridge.ts 的消息桥，
  // 由顶层窗口代理 storage.*/hostScan.* 等能力。session.registerPreloadScript 对子 frame 无效，勿再尝试。

  // 批次45-B1/B2 成员/API 密钥域模型：文件化成员库 userData/members.json（0600）。
  // 构造时缺文件即落一份**真实空表**（{ members: [], api_keys: [] }）——§9 欠账的表从第一天起就真实存在；
  // 损坏 fail-fast（与 mcp-tokens.json 同口径）。45-B2 起 home 账号域经 ServerOptions.memberStore 单向同步进本库。
  const memberStore = new FileMemberStore(join(USER_DATA, 'members.json'));
  void mlog('bootstrap:member-store-ready', { file: join(USER_DATA, 'members.json') });
  actionLog('app', 'bootstrap:member-store-ready', { file: 'members.json' });

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
    // 第一轮个人记忆：HTTP 数据面与 IPC 数据面共用同一独立存储实例
    personalStore: personalStoreRef ?? undefined,
    // 第二轮：owner 口径（内核 account.user_id + 显式绑定）+ 同一 PgSyncHub 真实同步通道
    personalKernelUserId: tenantTriple.user_id,
    personalOwnerBindings: personalOwnerBindings,
    personalSyncHub: syncHub ?? undefined,
    // 批次45-B2：home 账号 → 内核 Member 单向同步（注册/角色/团队变更 + 启动对账）
    memberStore,
    onLog: (scope, action, detail) => { actionLog(scope, action, detail); },
  });
  // 登录会话真源：敏感 IPC（数据位置/备份/安全）用 getSessionContext 校验管理员
  homeServerRef = home;
  home.listen(MIRROR_PORT, '127.0.0.1').on('error', (e) => { void mlog('bootstrap:home-listen-error', String(e?.message ?? e)); });

  // L0 密钥环（§4.4）：DEK 只在主进程内存；管理/授权密码只以 PBKDF2 包裹 DEK 落盘。
  // 启动即作废上次未消费的授权（连续性已断）并清空内存密钥，写密钥需管理员重新解锁。
  const l0KeyringFile = L0_KEYRING_PATH;
  await cleanupTempFiles(l0KeyringFile);
  const l0Vault = new L0Vault({
    keyring: createL0KeyringStore(l0KeyringFile),
    locks: createHomeLockStore(() => homeServerRef),
    audit: storage,
    storage,
    form: 'desktop',
  });
  await l0Vault.onAppRestart();
  // 进程内向量索引提前建：清库/重判/按 L0 重建三条改写路径都要同步摘除或刷新向量，
  // 而它们注册在下面的 IPC 段里（采集器共用这一个索引，声明原先在采集区，随批次37-E 上移）。
  const collectorVector = new JsVectorBackend();
  // S5 / D6：MCP 写入兜底队列（L0 写密钥锁定期间暂存）。两个 MCP 端口共用同一实例，
  // 任务窗只读摘要；未注入文件实现 → 进程内队列，重启即清空（如实标注）。
  const mcpPendingStore: PendingStore = new MemoryPendingStore();
  registerL0Ipc(l0Vault, collectorVector, mcpPendingStore);
  // 批次37-B：首启向导通道（登录之前用，不带会话）
  registerSetupIpc(l0Vault, staticPort);
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

  // 批次45-A1 的 tenantTriple 装配已上移至存量归一块之前（两个批次共用同一真源）。

  // MCP 两端口都要求令牌：HTTP 走 Authorization/x-mcp-token，TCP 走 initialize params.token。
  // 令牌只落 userData/mcp-token.txt（0600），用户把它配置给 Agent；日志只记路径，绝不记明文。
  const mcpToken = loadOrCreateMcpToken();
  const mcpTokenFile = join(USER_DATA, 'mcp-token.txt');
  void mlog('bootstrap:mcp-token-ready', { file: mcpTokenFile });
  // 批次41-U：「令牌就绪」此前只在 main.log，日志页（读 actions.log）查不到；补双写。
  // 值只有文件路径，与 mlog 同一份载荷——令牌明文绝不进任何日志。
  actionLog('app', 'bootstrap:mcp-token-ready', { file: mcpTokenFile });
  // 客户端接入面板（批次15）：令牌就绪后才能生成片段/一键写入
  registerMcpClientsIpc(mcpToken);
  // LLM 精炼网关（批次31）：配置/密钥就绪后内核写路径才能产出 L2–L6；未配置时保持 stub 口径
  llmGateway = loadLlmGateway(USER_DATA);
  await refreshProxyAccounting();
  void mlog('bootstrap:llm-gateway', { usable: !!llmGateway });
  registerLlmIpc();
  // 批次39：写入只落 L0+L1，深层由这条后台队列补炼（存量启动即入队，幂等；引擎没就绪就先排着不判死）
  registerRefineIpc();
  void startRefineQueue(collectorVector);

  // D6-2：启动自动建共享项目 P-shared（若注册表无则建；只读镜像/无写权限时静默跳过，绝不阻碍启动）
  await ensureSharedProject(storage);

  // D6-4 令牌代理：文件化受限令牌库 userData/mcp-tokens.json（0600；缺库 = 空库，引导令牌兜底 admin）。
  // 库损坏 fail-fast（抛错阻断启动，绝不静默清空既有授权）；TCP 与 HTTP 共用同一实例。
  const tokenStore = new FileTokenStore(join(USER_DATA, 'mcp-tokens.json'));

  // 批次45-B1 成员库装配已上移至 home server 创建之前（45-B2 同步注入）；此处不再重复创建。

  // 45-A1：引导账户三元组来自租户真源（缺省 u1/t1/e1，行为等价；is_admin=true = 本机属主，D6-3 口径不变）
  const mcpBootstrapAccount = {
    ...tenantTriple, is_admin: true as const, scope_project_ids: ['*'],
  };

  const mcp = runMcpServer({ storage, port: MCP_PORT, token: mcpToken, l0: l0Vault, tokenStore, memberStore, account: mcpBootstrapAccount, pending: mcpPendingStore, personal: personalStoreRef ?? undefined });
  mcp.ready
    .then((p) => { void mlog('bootstrap:mcp-listening', { port: p }); })
    .catch((e) => { void mlog('bootstrap:mcp-listen-error', String((e as Error)?.message ?? e)); });

  // 标准 MCP streamable-http（DSH dsh-mcp-client 走这条路连记忆库；POST /mcp → initialize/tools/list/tools/call）
  // 批次33-C：同一端口另开 GET /recall/<一次性 id> = 聊天里「展开明细」链接指向的本机明细页（真折叠），只记命中与否，不记 id 与正文。
  const mcpHttp = runMcpHttpServer({
    storage, port: MCP_HTTP_PORT, token: mcpToken, l0: l0Vault, tokenStore, memberStore, account: mcpBootstrapAccount,
    pending: mcpPendingStore,
    personal: personalStoreRef ?? undefined,
    // 批次41-R：同一条也落 actions.log（批次34 对 llm:* 的同一口径）——日志页读的是 actions.log，
    // 只写 main.log 等于「明细页有没有被点开过」对用户不可见。值只有 ok/miss，无 id、无正文。
    onViewDetail: (outcome) => {
      void mlog('mcp:recall_detail_view', { outcome });
      actionLog('mcp', 'recall_detail_view', { outcome });
    },
  });
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
        { storage, vector: webhookVector, account: tenantTriple, request_id: `req_wh_${Date.now()}`, now: Date.now(), l0: l0Vault },
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

  // 批次44-A：交接独立采集守护（daemon 只扫描+暂存，永不碰账本——collectDaemon.ts 头注口径）。
  // 桌面端是唯一写者（持 L0 写密钥）：逐条 coreWrite（dedup 幂等兜底重复），分片全成功才删除。
  const drainDaemonPending = async (why: string): Promise<void> => {
    try {
      const r = await drainCollectPending({
        pendingDir: join(USER_DATA, DAEMON_DIR_NAME, PENDING_DIR_NAME),
        write: async (it) => {
          await coreWrite(
            {
              content: it.content,
              category: (it.category as Category) ?? 'context',
              project_id: 'P1',
              source_agent: it.agent,
              session_id: undefined,
            },
            { storage, vector: collectorVector, account: tenantTriple, request_id: `req_daemon_${Date.now()}`, now: Date.now(), l0: l0Vault },
          );
        },
      });
      if (r.files > 0 || r.errors.length > 0) {
        void mlog('collector:daemon-drain', { why, files: r.files, written: r.written, failed: r.failedFiles.length });
        if (r.errors.length > 0) {
          actionLog('collector', 'daemon-drain-error', { why, errors: r.errors.slice(0, 3) }, { level: 'warn' });
        }
      }
    } catch (e) {
      void mlog('collector:daemon-drain-error', { why, error: String((e as Error)?.message ?? e) });
    }
  };

  // 首扫：等窗口 ready-to-show 后延迟触发一次（避免启动即抢 IO 卡住首屏）；
  // 之后由 reconciler 每 5min 自动对账，单轮最多 COLLECTOR_MAX_PER_ROUND 条。
  const startFirstScan = () => {
    void mlog('collector:first-scan:scheduled', { delayMs: COLLECTOR_FIRST_SCAN_DELAY_MS, maxPerRound: COLLECTOR_MAX_PER_ROUND });
    setTimeout(() => {
      void mlog('collector:first-scan:start');
      reconciler.runOnce()
        .then((s) => {
          void mlog('collector:first-scan:done', { collected: s.collected, deduped: s.deduped, roleSkipped: s.roleSkipped, skipped: s.skipped.length });
          void drainDaemonPending('first-scan');
        })
        .catch((e) => void mlog('collector:first-scan:error', String((e as Error)?.message ?? e)));
    }, COLLECTOR_FIRST_SCAN_DELAY_MS);
  };

  // 探测到的已安装 agent（宿主真扫 + 接入流程回填），用于扩展采集源白名单
  // 缺省覆盖 Qoder CN / Trae / Zcode / Cursor / Gemini / Qwen 等已知会话日志位置
  let detectedAgentNames: string[] = [];
  const buildSources = () => defaultAgentSources({ agents: detectedAgentNames.length > 0 ? detectedAgentNames : undefined });
  // source 用函数形式：每轮现取游标与 agent 白名单，保证增量续采与动态扩展都生效
  let lastApply: { written: number; filtered: number; failed: number; failed_l0_locked: number; ts: number } | null = null;
  const reconciler = createReconciler({
    intervalMs: COLLECTOR_INTERVAL_MS, // §5.1 预设 5min
    source: () => ({
      sources: buildSources(),
      cursor: collectorCursor,
      seenHashes: collectorSeen,
      maxItemsPerRun: COLLECTOR_MAX_PER_ROUND, // 单轮上限 50 条，防大批量灌入卡死事件循环
    }),
    runOnStart: false,
    // 批次41-D（P1-12）：失败退避参数 + 记账回调（只落原因码，绝不落正文）
    backoffCapMs: COLLECTOR_BACKOFF_CAP_MS,
    maxConsecutiveFails: COLLECTOR_MAX_CONSECUTIVE_FAILS,
    onRoundFail: (info) => {
      // L0 写密钥锁定等长障时不再每 5min 空转刷屏：退避间隔递增、封顶 2h
      void mlog('collector:backoff', { fails: info.fails, delayMs: info.delayMs, reason: info.reason, capMs: COLLECTOR_BACKOFF_CAP_MS });
      actionLog('collector', 'backoff', { fails: info.fails, delayMs: info.delayMs, reason: info.reason }, { level: 'warn' });
    },
    onAutoRetryStopped: (info) => {
      void mlog('collector:backoff-auto-stopped', { fails: info.fails, reason: info.reason, manualOnly: true });
      actionLog('collector', 'backoff-auto-stopped', { fails: info.fails, reason: info.reason }, { level: 'error' });
    },
    onRecover: (info) => {
      void mlog('collector:backoff-recovered', { prevFails: info.prevFails });
      actionLog('collector', 'backoff-recovered', { prevFails: info.prevFails });
    },
    onScan: async (scan: ScanResult) => {
      // 扫描阶段会把新指纹写进 seenHashes；失败时整体回滚，避免残留“已见”导致下轮跳过
      const seenBefore = new Set(collectorSeen);
      // 一批写入只落盘一次（L0→L6 逐条 coreWrite 期间不逐次同步写盘），finally 统一 commit
      storage.beginBatch?.();
      // 批次39：本批真正落库的 mem_id —— 提交成功后进后台补炼队列（采集器仍然不炼深层，写入保持只落 L0+L1）
      const writtenIds: string[] = [];
      let applied: { written: number; filtered: number; failed: number; failed_l0_locked: number } | null = null;
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
              { storage, vector: collectorVector, account: tenantTriple, request_id: `req_col_${Date.now()}`, now: Date.now(), l0: l0Vault },
            );
            if (r.mem_id) writtenIds.push(r.mem_id);
            return { mem_id: r.mem_id, dedup: r.dedup };
          },          audit: async (rec) => {
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
      lastApply = applied ? { ...applied, ts: Date.now() } : null;
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
        // 批次39：本批新行入后台补炼队列（只在整批提交成功后入队，失败的批不入队——否则会把没落库的 id 排进去）
        if (writtenIds.length > 0 && refineQueueDir) {
          try {
            const rows: Memory[] = [];
            for (const id of writtenIds) {
              const m = await storage.getMemory(id);
              if (m) rows.push(m);
            }
            const { state: next, report } = enqueueRows(loadRefineQueue(refineQueueDir), rows);
            saveRefineQueue(refineQueueDir, next);
            if (report.added > 0) actionLog('kernel', 'refine:enqueue-collected', { written: writtenIds.length, ...report });
          } catch (e) {
            actionLog('kernel', 'refine:enqueue-collected-fail', { error: String((e as Error)?.message ?? e) }, { level: 'error' });
          }
        }
      } else {
        collectorSeen = seenBefore;
        if (applied !== null && applied.failed > 0) {
          // 批次41-W：单独报「其中多少是写密钥锁定」——这条决定了下一步是输密码还是查写入 bug
          void mlog('collector:cursor-hold', {
            failed: applied.failed, failed_l0_locked: applied.failed_l0_locked,
            collected: scan.collected, reason: applied.failed_l0_locked > 0 ? 'l0_locked' : 'write_failed',
          });
        }
      }

      if (scan.collected > 0 || (applied?.written ?? 0) > 0) {
        console.log(`[collector] period done: collected=${scan.collected} written=${applied?.written ?? 0}${applied && applied.filtered > 0 ? ` filtered=${applied.filtered}` : ''}${applied && applied.failed > 0 ? ` failed=${applied.failed}` : ''} ${scan.deduped ? `deduped=${scan.deduped}` : ''}${scan.roleSkipped ? ` roleSkipped=${scan.roleSkipped}` : ''}`);
      }
      if (scan.roleSkipped > 0) {
        // 批次35 采集口角色白名单（缺省只采 user）挡下的条数——被拦的不是丢失，是口径
        void mlog('collector:role-gate', { roleSkipped: scan.roleSkipped, collected: scan.collected, deduped: scan.deduped });
      }
      if (scan.skipped.length > 0) {
        for (const s of scan.skipped) console.log(`[collector] ${s}`);
      }
      // 批次41-D（P1-12）：本轮没推进（L0 写密钥锁定 / apply 或 commit 失败 / 有写失败）→ 抛出让 reconciler 计为失败并退避。
      // 正常推进（canAdvance）则不抛，reconciler 侧退避归零。原因只带码不带正文。
      // 批次41-W：l0_locked 优先于 write_failed——同为「有写失败」，但前者是用户输密码就能解的长障，
      // 混成一个码就等于把提示入口藏起来了（退避日志与 collector:status 都按这个原因码走）。
      if (!canAdvance) {
        const reason = applied === null ? 'apply_failed'
          : !committed ? 'commit_failed'
            : applied.failed_l0_locked > 0 ? 'l0_locked'
              : applied.failed > 0 ? 'write_failed'
                : 'not_advanced';
        throw new Error(`collector:round-not-advanced(${reason})`);
      }
    },
  });

  handleIpc(IPC.collectorStatus, () => {
    const last = reconciler.last;
    return {
      ok: true,
      running: !reconciler.stopped,
      intervalMs: reconciler.intervalMs,
      last: last ? { collected: last.collected, deduped: last.deduped, roleSkipped: last.roleSkipped, skipped: last.skipped, ts: last.ts } : null,
      // 批次41-D：失败退避状态（连续失败轮数 + 是否已因达上限停自动重试；UI 显示「上次失败原因 + 手动重跑」）
      consecutiveFails: reconciler.consecutiveFails,
      autoRetryStopped: reconciler.autoRetryStopped,
      // 批次35：清空重采进度（本轮入库/质量门拦下）+ 追采是否在跑
      apply: lastApply,
      // 批次41-W：最近一轮是不是「L0 写密钥没解锁」——这是用户输管理密码就能解的障，
      // 页面据此直接给解锁入口，而不是只报 failed=N 让用户猜。只有布尔与计数，无正文。
      l0_locked_writes: lastApply !== null && lastApply.failed_l0_locked > 0,
      recollecting: recollectInFlight,
    };
  });
  // 19.9 接入成功立即对账：不等 5min 周期，接入后马上读新 agent 的会话日志
  handleIpc(IPC.collectorTriggerNow, async (_e, agentNames?: string[]) => {
    // 把 detector/接入流程探测到的 agent 并入白名单，再触发一轮采集
    if (agentNames && agentNames.length > 0) {
      detectedAgentNames = [...new Set([...detectedAgentNames, ...agentNames])];
    }
    const r = await reconciler.runOnce();
    // 批次41-D：手动重跑也按成败口径回显——reconciler 失败时给合成占位 skipped[0]='采集异常: …'，据此区分「跑成功」与「没推进」
    const advanced = !(r.skipped[0] ?? '').startsWith('采集异常');
    return {
      ok: true,
      advanced,
      consecutiveFails: reconciler.consecutiveFails,
      autoRetryStopped: reconciler.autoRetryStopped,
      collected: r.collected,
      deduped: r.deduped,
      roleSkipped: r.roleSkipped,
      skipped: r.skipped,
      ts: r.ts,
    };
  });

  // ── 批次35：记忆库清空重采（用户拍板「库内内容全部删除，按新入库规则重新拉取」）──────
  // 收紧质量门只能挡住**以后**的写入，救不回已经落库的助手自述/过程旁白——那批噪声是旧采集口径
  // （助手消息照采）灌进来的，唯一诚实的做法是整库清空 + 采集游标归零 + 立即按新规则追采。
  // 顺序固定：备份 → 清空 → 清游标 → 追采。备份失败一律拒绝清空（不可逆操作不留裸奔窗口）。
  let recollectInFlight = false;

  const resetCollectorCursors = async (): Promise<{ ok: boolean; error?: string }> => {
    collectorCursor = {};
    collectorSeen = new Set<string>();
    try {
      await mkdir(USER_DATA, { recursive: true });
      await writeFile(
        collectorCursorFile,
        JSON.stringify({ cursor: {}, seen: [], updatedAt: new Date().toISOString() }),
        'utf8',
      );
      return { ok: true };
    } catch (e) {
      // 内存游标已归零、文件没写进去：如实回显，重启后会退回旧游标（可能漏采），不假装成功
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
  };

  /** 清空后连续补采到「本轮采不到新消息」或轮次上限；单轮上限仍是 COLLECTOR_MAX_PER_ROUND。 */
  const runRecollectCatchUp = async (): Promise<void> => {
    recollectInFlight = true;
    let rounds = 0;
    let items = 0;
    try {
      while (rounds < RECOLLECT_MAX_ROUNDS) {
        const s = await reconciler.runOnce();
        rounds++;
        items += s.collected;
        if (s.collected === 0) break;
        await new Promise((resolve) => setTimeout(resolve, RECOLLECT_ROUND_GAP_MS));
      }
      void mlog('collector:recollect-done', {
        rounds, items, exhausted: rounds >= RECOLLECT_MAX_ROUNDS,
        written: lastApply?.written ?? 0, filtered: lastApply?.filtered ?? 0,
      });
      void drainDaemonPending('recollect');
    } catch (e) {
      void mlog('collector:recollect-error', { rounds, error: String((e as Error)?.message ?? e) });
    } finally {
      recollectInFlight = false;
    }
  };

  handleIpc(IPC.ledgerResetPreview, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.ledgerResetPreview);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      return {
        ok: true,
        preview: await scanLedgerForReset(storage),
        collector: { sourceCount: buildSources().length, recollecting: recollectInFlight, maxPerRound: COLLECTOR_MAX_PER_ROUND },
      };
    } catch (e) { return l0Fail(e); }
  });

  handleIpc(IPC.ledgerResetRecollect, async (_e, confirmText?: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.ledgerResetRecollect);
    if (!gate.ok) return { ok: false, error: gate.error };
    // 二次确认口令：清空不可逆，必须逐字输入 RESET（UI 也要求手输，不接受默认值）
    if ((confirmText ?? '').trim().toUpperCase() !== 'RESET') {
      actionLog('kernel', 'ledger:reset-rejected', { reason: 'confirm_text', user: gate.ctx.user_id });
      return { ok: false, error: '未输入确认口令 RESET，已取消（清空不可逆）' };
    }
    let backupDir: string;
    try {
      backupDir = await backupBeforeKernelChange('ledger-reset', 'ledger:reset-backup');
      if (existsSync(collectorCursorFile)) {
        await copyFile(collectorCursorFile, join(backupDir, 'collector-cursor.json'));
      }
    } catch (e) {
      const err = String((e as Error)?.message ?? e);
      actionLog('kernel', 'ledger:reset-backup-fail', { error: err }, { level: 'error' });
      return { ok: false, error: `清空前备份失败：${err}` };
    }
    try {
      const now = Date.now();
      const report = await purgeLedger({
        storage, vector: collectorVector, admin_user_id: gate.ctx.user_id,
        request_id: `req_ledger_reset_${now}`, now, backup_confirmed: true,
      });
      const cursorReset = await resetCollectorCursors();
      actionLog('kernel', 'ledger:reset-recollect', {
        total: report.total, purged: report.purged, failed: report.failed,
        with_l0_cipher: report.with_l0_cipher, llm_refined: report.llm_refined,
        cursor_reset: cursorReset.ok, ...(cursorReset.ok ? {} : { cursor_error: cursorReset.error }),
        dir: backupDir,
      });
      // 批次41-C：清空后队列里全是幽灵（行都删了），对账摘除；随后追采会重新入队活行
      void reconcileRefineQueueDir('ledger-reset');
      // 追采放后台：IPC 立即返回回执，页面靠 collector:status 观察进度，不等几分钟
      void runRecollectCatchUp();
      return {
        ok: true, report, backup_dir: backupDir,
        cursor_reset: cursorReset.ok, cursor_error: cursorReset.error,
        recollecting: true,
      };
    } catch (e) { return l0Fail(e); }
  });

  // 批次36-C：存量按当前质量门重判。与「清空重采」的区别——只删按新口径本不该入库的行，
  // 保留行的正文/向量/采集游标都不动，判定只喂 content_l1，因此不需要 L0 写密钥、不调 LLM。
  handleIpc(IPC.rulesRejudgePreview, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.rulesRejudgePreview);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      return { ok: true, preview: await scanRowsForRejudge(storage) };
    } catch (e) { return l0Fail(e); }
  });

  handleIpc(IPC.rulesRejudgeRun, async (_e, confirmText?: string, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.rulesRejudgeRun);
    if (!gate.ok) return { ok: false, error: gate.error };
    // 二次确认口令：删除不可逆，必须逐字输入 REJUDGE（与整库清空的 RESET 区分开）
    if ((confirmText ?? '').trim().toUpperCase() !== 'REJUDGE') {
      actionLog('kernel', 'rules:rejudge-rejected', { reason: 'confirm_text', user: gate.ctx.user_id });
      return { ok: false, error: '未输入确认口令 REJUDGE，已取消（重判会删行，不可逆）' };
    }
    let backupDir: string;
    try {
      backupDir = await backupBeforeKernelChange('rules-rejudge', 'rules:rejudge-backup');
    } catch (e) {
      const err = String((e as Error)?.message ?? e);
      actionLog('kernel', 'rules:rejudge-backup-fail', { error: err }, { level: 'error' });
      return { ok: false, error: `重判前备份失败：${err}` };
    }
    try {
      const now = Date.now();
      const report = await rejudgeRows({
        storage, vector: collectorVector, admin_user_id: gate.ctx.user_id,
        request_id: `req_rejudge_${now}`, now, backup_confirmed: true,
      });
      actionLog('kernel', 'rules:rejudge-run', {
        gate_version: report.gate_version, total: report.total, purge: report.purge,
        purged: report.purged, restamped: report.restamped,
        skipped_protected: report.skipped_protected, skipped_no_l1: report.skipped_no_l1,
        with_l0_cipher: report.with_l0_cipher,
        failed: report.failed, dir: backupDir,
      });
      // 批次41-C：重判删掉的行在队列里即成幽灵，按「当前未删行」对账摘除（放行行不动）
      void reconcileRefineQueueDir('rules-rejudge');
      return { ok: true, report, backup_dir: backupDir };
    } catch (e) { return l0Fail(e); }
  });

  // 批次41-T：存量补齐缺失的 sha256 / 向量。`sha256` 随提交 `843282c`（2026-10-31）才引入，
  // 之前的历史行行上就是空的——本机实测 533 行缺 sha256、1 行缺 embedding。代价是有边界的：
  // 缺向量的行语义召回恒 0 分；缺指纹的行在云端同步的每日全量对账里会被列进 missing（批次42 的前置事实）。
  // **不设逐字口令**：本通道不删行、不改正文、不动层级/version/updated_at，只把两个空字段填上，
  // 与 REJUDGE / RESET / REBUILD（都会删或重造内容）不同类；但批量改写账本前必须先备份这条不变量照守。
  handleIpc(IPC.ledgerFieldsPreview, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.ledgerFieldsPreview);
    if (!gate.ok) return { ok: false, error: gate.error };
    try {
      return { ok: true, preview: await scanRowsForBackfill(storage) };
    } catch (e) { return l0Fail(e); }
  });

  handleIpc(IPC.ledgerFieldsBackfill, async (_e, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.ledgerFieldsBackfill);
    if (!gate.ok) return { ok: false, error: gate.error };
    let backupDir: string;
    try {
      backupDir = await backupBeforeKernelChange('field-backfill', 'ledger:fields-backup');
    } catch (e) {
      const err = String((e as Error)?.message ?? e);
      actionLog('kernel', 'ledger:fields-backup-fail', { error: err }, { level: 'error' });
      return { ok: false, error: `回填前备份失败：${err}` };
    }
    try {
      const now = Date.now();
      const report = await backfillMissingFields({
        storage, vector: collectorVector, admin_user_id: gate.ctx.user_id,
        request_id: `req_fields_${now}`, now, backup_confirmed: true,
      });
      actionLog('kernel', 'ledger:fields-backfill', {
        total: report.total, fillable_rows: report.fillable_rows,
        sha256_filled: report.sha256_filled, embedding_filled: report.embedding_filled,
        indexed: report.indexed, protected_rows: report.protected_rows,
        unfillable_sha256: report.unfillable_sha256, unfillable_embedding: report.unfillable_embedding,
        failed: report.failed, dir: backupDir,
      });
      return { ok: true, report, backup_dir: backupDir };
    } catch (e) { return l0Fail(e); }
  });

  // 批次42-B：云端同步中枢 sync:* 通道。上行/下行/对账/冲突列表/审计游标需会话；
  // 人工裁决（sync:resolve）需管理员（§42-B 口径：裁决是管理动作）。team_id 由渲染层
  // kernelAccount 传入（45-A1 已归一为 tenant.json 规范真值；主进程校验非空，不校验来源——
  // 信任边界 = 本机渲染层，与 storage:* 通道一致）。
  const syncHubReady = () => syncHub !== null;
  handleIpc(IPC.syncPush, async (_e, mem?: unknown, form?: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.syncPush);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    if (!mem || typeof mem !== 'object') return { ok: false, error: 'sync:push 需要记忆行对象' };
    try {
      const r = await syncHub!.push(mem as Memory, (typeof form === 'string' ? form : 'desktop') as Form);
      return { ok: true, result: r };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.syncPull, async (_e, scope?: unknown, since?: unknown, form?: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.syncPull);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    const sc = (scope ?? {}) as { team_id?: unknown; user_id?: unknown };
    if (typeof sc.team_id !== 'string' || !sc.team_id) return { ok: false, error: 'sync:pull 需要 team_id（渲染层 kernelAccount 规范三元组）' };
    try {
      const r = await syncHub!.pull(
        { team_id: sc.team_id, user_id: typeof sc.user_id === 'string' ? sc.user_id : undefined },
        Number(since) || 0,
        (typeof form === 'string' ? form : 'desktop') as Form,
      );
      return { ok: true, items: r.items, cursor: r.cursor };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.syncReconcile, async (_e, scope?: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.syncReconcile);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    const sc = (scope ?? {}) as { team_id?: unknown };
    if (typeof sc.team_id !== 'string' || !sc.team_id) return { ok: false, error: 'sync:reconcile 需要 team_id' };
    try {
      const r = await syncHub!.reconcile({ team_id: sc.team_id });
      return { ok: true, items: r.items, losers: r.losers, missing_local: r.missing_local };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.syncConflicts, async (_e, teamId?: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.syncConflicts);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    try {
      const conflicts = await syncHub!.listConflicts(typeof teamId === 'string' && teamId ? teamId : undefined);
      return { ok: true, conflicts };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.syncResolve, async (_e, conflictId?: unknown, winner?: unknown, sessionId?: string) => {
    const gate = requireAdmin(sessionId, IPC.syncResolve);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    if (typeof conflictId !== 'string' || !conflictId) return { ok: false, error: 'sync:resolve 需要 conflict_id' };
    if (winner !== 'local' && winner !== 'remote') return { ok: false, error: "sync:resolve winner 只能是 'local' | 'remote'" };
    try {
      await syncHub!.resolve(conflictId, winner);
      actionLog('kernel', 'sync:resolve', { conflict_id: conflictId, winner, by: gate.ctx.user_id });
      return { ok: true };
    } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.syncCursor, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.syncCursor);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    try { return { ok: true, cursor: await syncHub!.getCursor() }; } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.syncAuditCount, async (_e, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.syncAuditCount);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    try { return { ok: true, count: await syncHub!.auditCount() }; } catch (e) { return l0Fail(e); }
  });
  handleIpc(IPC.syncAuditsFrom, async (_e, start?: unknown, sessionId?: string) => {
    const gate = requireSession(sessionId, IPC.syncAuditsFrom);
    if (!gate.ok) return { ok: false, code: gate.code ?? 'E_AUTH_SESSION', error: gate.error };
    if (!syncHubReady()) return { ok: false, code: 'E_NOT_IMPLEMENTED', error: '同步中枢未就绪（sync-hub 初始化失败，见 actions.log）' };
    try {
      const audits = await syncHub!.auditsFrom(Number(start) || 0);
      return { ok: true, audits };
    } catch (e) { return l0Fail(e); }
  });

  console.log(`[collector] 会话采集器已创建（§5.1 周期 ${COLLECTOR_INTERVAL_MS / 1000}s，预设 5min）`);
  void mlog('bootstrap:collector-created', { intervalMs: COLLECTOR_INTERVAL_MS });

  // ── 统一周期调度（批次48 A23.2）：单 tick 驱动四个 cron 任务 ────────────────────
  // 旧实现（批次4 起）：setTimeout(10min) + setInterval(6h) 只跑 runForgettingCycle，
  // 该周期把「层迁移 + 到龄归档 + 合并摘要 + 每周冷压缩」塞在同一轮里。
  // 新实现：同一批内核函数按 cron 拆成四个任务（decay / verdict_reminder / self_growth / archive），
  // 由**一个** 60s tick 统一评估到期；旧固定 interval 已整体删除（不存在两套调度器并跑）。
  //
  // 等价迁移（逐项说清）：
  //   · decay   ← 旧周期的「层迁移 + 合并摘要 + 每周冷压缩」。现在每日 02:00 执行（13.3 口径，
  //     旧的 6h 频率按调度规格收口；weeklyCompress 仍按 7 天窗口判定，不受频率变化影响）。
  //   · archive ← 旧周期里的 autoArchiveDays 段。现在每月 1 日 04:00 单独执行；decay 不再传
  //     autoArchiveDays → 同一 tick 内绝不会两处归档（无双跑）。
  //   · 漏跑补跑：到期判定 = 「上次真实 schedule_run 记录的 next_due_at」。应用关闭期间错过的
  //     时间点在启动后首个 tick 立即补跑一次；补跑写完新的 next_due_at 后不会在同一周期重复。
  //   · 开关：growth:v1 快照的 schedule 四项（decay 恒开 R5）。用户停用某项 → 到期只推进内存中
  //     的下次到期，不写运行审计；页面据「无 schedule_run 记录」显示未运行，不伪造已执行。
  //   · MAM_FORGETTING_DISABLED=1 仍只停 decay/archive（旧语义）；MAM_SCHEDULE_DISABLED=1 停整个 tick。
  //   · 每条真实执行（含 skipped/error）都写 action='schedule_run' 审计，detail 含
  //     task / host / expr / tz_offset_min / trigger / started_at / duration_ms / status / result / next_due_at。
  const SCHEDULE_HOST = 'electron-main';
  const SCHEDULE_TICK_MS = Number(process.env.MAM_SCHEDULE_TICK_MS) || 60_000;
  const SCHEDULE_FIRST_DELAY_MS = Number(
    process.env.MAM_SCHEDULE_FIRST_DELAY_MS || process.env.MAM_FORGETTING_FIRST_DELAY_MS,
  ) || 60_000;
  // 固定时区偏移（分钟，东为正）。Asia/Shanghai = +480；不读系统时区/夏令时表，调度计算是纯函数。
  const SCHEDULE_TZ_OFFSET_MIN = -new Date().getTimezoneOffset();
  const SCHEDULE_DISABLED = process.env.MAM_SCHEDULE_DISABLED === '1';
  const FORGETTING_DISABLED = process.env.MAM_FORGETTING_DISABLED === '1';

  type TaskOutcome = { status: 'ok' | 'skipped' | 'error'; result?: Record<string, unknown>; error?: string };

  /** decay：层迁移 + 合并摘要 + 每周冷压缩（**不带 autoArchiveDays**，归档归 archive 任务） */
  const runDecayTask = async (): Promise<TaskOutcome> => {
    const now = Date.now();
    const prefs = forgettingPrefsFromSnapshot(await storage.listMemories({}));
    const gcAudits = await storage.queryAudit({ action: 'gc' });
    const lastCompress = Math.max(
      0, ...gcAudits.filter((a) => a.detail?.weeklyCompress === true).map((a) => a.ts),
    );
    const weeklyCompress = now - lastCompress >= 7 * 24 * 3600_000;
    storage.beginBatch?.();
    try {
      const report = await runForgettingCycle(storage, now, {
        enabled: prefs.enabled, weeklyCompress, vector: collectorVector,
        halfLifeDays: prefs.halfLifeDays,
        exemptAll: prefs.exemptAll,
      });
      void mlog('forgetting:cycle:done', { why: 'cron', prefs, weeklyCompress, ...report });
      actionLog('kernel', 'forgetting:cycle:done', { why: 'cron', prefs, weeklyCompress, ...report });
      const skipped = !prefs.enabled ? 'auto_policy_disabled'
        : prefs.exemptAll ? 'global_importance_locked' : null;
      return {
        status: skipped ? 'skipped' : 'ok',
        result: { ...report, weeklyCompress, skipped_reason: skipped, enabled: prefs.enabled },
      };
    } finally {
      storage.commitBatch();
    }
  };

  /** archive：只做到龄归档（与 decay 拆开，避免同一轮重复执行） */
  const runArchiveTask = async (): Promise<TaskOutcome> => {
    const now = Date.now();
    const prefs = forgettingPrefsFromSnapshot(await storage.listMemories({}));
    if (prefs.exemptAll) return { status: 'skipped', result: { reason: 'global_importance_locked' } };
    if (typeof prefs.autoArchiveDays !== 'number' || prefs.autoArchiveDays <= 0) {
      return { status: 'skipped', result: { reason: 'retention_not_configured' } };
    }
    storage.beginBatch?.();
    try {
      const archived = await archiveAgedMemories(storage, now, { autoArchiveDays: prefs.autoArchiveDays });
      if (archived > 0) {
        await storage.appendAudit({
          request_id: `req_${ulid(now)}`, action: 'archive', form: 'desktop', project_id: 'P_SYSTEM',
          ts: now, detail: { archived, source: 'schedule', threshold_days: prefs.autoArchiveDays },
        });
      }
      return { status: 'ok', result: { archived, threshold_days: prefs.autoArchiveDays } };
    } finally {
      storage.commitBatch();
    }
  };

  /** verdict_reminder：真实查一次待裁决冲突数（中枢未装配 → 如实 skipped，不伪造提醒） */
  const runVerdictReminderTask = async (): Promise<TaskOutcome> => {
    if (!syncHub) return { status: 'skipped', result: { reason: 'sync_hub_unavailable' } };
    try {
      const conflicts = await syncHub.listConflicts(tenantTriple.team_id);
      return { status: 'ok', result: { team_id: tenantTriple.team_id, pending_conflicts: conflicts.length } };
    } catch (e) {
      return { status: 'error', error: String((e as Error)?.message ?? e) };
    }
  };

  /**
   * self_growth：跑真实回归（目标函数 = 写入期合并/不合并的 F1，门槛见 core/regression.ts）。
   * 三种结果都如实落账：insufficient_samples / weight_regression(not_adopted) / weight_tuned(adopted)，
   * schedule_run 的 status 同步区分「样本不足 / 未达门槛 / 已采纳」。
   */
  const runSelfGrowthTask = async (): Promise<TaskOutcome> => {
    const now = Date.now();
    const result = await runGrowthRegression(storage, {
      now, requestId: regressionRequestId(now), form: 'desktop',
      enterpriseId: tenantTriple.enterprise_id, teamId: tenantTriple.team_id,
    });
    if (result.status === 'insufficient_samples') {
      return {
        status: 'skipped',
        result: { reason: 'insufficient_samples', counts: result.counts, accumulating: true },
      };
    }
    if (result.status === 'not_adopted') {
      return {
        status: 'skipped',
        result: {
          reason: result.reason, not_adopted: true, counts: result.counts,
          before_f1: result.before.test.f1, after_f1: result.after.test.f1,
        },
      };
    }
    return {
      status: 'ok',
      result: {
        adopted: true, counts: result.counts,
        before_f1: result.before.test.f1, after_f1: result.after.test.f1,
      },
    };
  };

  const scheduleRunners: Record<ScheduleKey, () => Promise<TaskOutcome>> = {
    decay: runDecayTask,
    verdict_reminder: runVerdictReminderTask,
    self_growth: runSelfGrowthTask,
    archive: runArchiveTask,
  };

  // 调度态只放内存：启动时从真实 schedule_run 审计恢复，运行后更新并落审计。
  /** 某任务的下次到期（毫秒）；无记录 = 立即到期（首跑/补跑） */
  const nextDueByTask = new Map<ScheduleKey, number>();
  const lastRunByTask = new Map<ScheduleKey, number>();
  let scheduleReady: Promise<void> | null = null;
  let tickBusy = false;

  const bootstrapScheduleState = async (): Promise<void> => {
    try {
      const rows = await storage.queryAudit({ action: 'schedule_run' });
      for (const row of rows) {
        const d = row.detail as { task?: unknown; next_due_at?: unknown };
        if (typeof d?.task !== 'string') continue;
        const task = SCHEDULE_TASKS.find((t) => t.key === d.task);
        if (!task) continue;
        if (row.ts <= (lastRunByTask.get(task.key) ?? 0)) continue;
        lastRunByTask.set(task.key, row.ts);
        const next = typeof d.next_due_at === 'number' && Number.isFinite(d.next_due_at)
          ? d.next_due_at
          : (nextDue(task.expr, row.ts, SCHEDULE_TZ_OFFSET_MIN) ?? row.ts + 24 * 3600_000);
        nextDueByTask.set(task.key, next);
      }
    } catch (e) {
      void mlog('schedule:bootstrap-error', { error: String((e as Error)?.message ?? e) });
    }
    const now = Date.now();
    for (const t of SCHEDULE_TASKS) if (!nextDueByTask.has(t.key)) nextDueByTask.set(t.key, now);
  };
  const ensureScheduleReady = (): Promise<void> => (scheduleReady ??= bootstrapScheduleState());

  const runScheduledTask = async (task: ScheduleTaskSpec, trigger: 'first' | 'cron' | 'catch_up'): Promise<void> => {
    const startedAt = Date.now();
    let outcome: TaskOutcome;
    try {
      outcome = await scheduleRunners[task.key]();
    } catch (e) {
      outcome = { status: 'error', error: String((e as Error)?.message ?? e) };
    }
    const finishedAt = Date.now();
    const next = nextDue(task.expr, finishedAt, SCHEDULE_TZ_OFFSET_MIN) ?? finishedAt + 24 * 3600_000;
    lastRunByTask.set(task.key, finishedAt);
    nextDueByTask.set(task.key, next);
    const detail = {
      task: task.key, host: SCHEDULE_HOST, expr: task.expr, tz_offset_min: SCHEDULE_TZ_OFFSET_MIN,
      trigger, started_at: startedAt, duration_ms: finishedAt - startedAt,
      status: outcome.status, result: outcome.result ?? {}, error: outcome.error ?? null,
      next_due_at: next,
    };
    try {
      await storage.appendAudit({
        request_id: `req_${ulid(finishedAt)}`, action: 'schedule_run', form: 'desktop',
        project_id: 'P_SYSTEM', ts: finishedAt, detail,
      });
    } catch (e) {
      // 审计写盘失败：内存态仍前进（避免每分钟重跑），但必须留痕，页面会继续显示旧记录
      void mlog('schedule:audit-error', { task: task.key, error: String((e as Error)?.message ?? e) });
      actionLog('kernel', 'schedule:audit-error', { task: task.key, error: String((e as Error)?.message ?? e) }, { level: 'error' });
    }
    void mlog('schedule:run', detail);
    actionLog('kernel', 'schedule:run', detail, outcome.status === 'error' ? { level: 'error' } : undefined);
  };

  const runScheduleTick = async (why: string): Promise<void> => {
    if (tickBusy) {
      void mlog('schedule:tick-skip', { why, reason: 'busy' });
      return;
    }
    tickBusy = true;
    try {
      await ensureScheduleReady();
      const now = Date.now();
      const due = SCHEDULE_TASKS.filter((t) => (nextDueByTask.get(t.key) ?? now) <= now);
      if (due.length === 0) return;
      // 只有真有到期任务时才读一次 growth:v1 快照（避免每 60s 全库扫描）
      const cfg = growthConfigFromLedger(await storage.listMemories({}));
      for (const task of due) {
        // 旧环境变量语义：只停遗忘相关两项；其余任务照常
        if (FORGETTING_DISABLED && (task.key === 'decay' || task.key === 'archive')) {
          nextDueByTask.set(task.key, nextDue(task.expr, now, SCHEDULE_TZ_OFFSET_MIN) ?? now + 24 * 3600_000);
          continue;
        }
        // 用户停用（decay 恒开）：只推进下次到期，不写运行审计（页面显示「未运行」而非伪造）
        if (task.key !== 'decay' && !cfg.schedule[task.key]) {
          nextDueByTask.set(task.key, nextDue(task.expr, now, SCHEDULE_TZ_OFFSET_MIN) ?? now + 24 * 3600_000);
          void mlog('schedule:task-disabled', { task: task.key, next_due_at: nextDueByTask.get(task.key) });
          continue;
        }
        const scheduledAt = nextDueByTask.get(task.key) ?? now;
        const hasRun = lastRunByTask.has(task.key);
        const trigger: 'first' | 'cron' | 'catch_up' = !hasRun ? 'first'
          : (now - scheduledAt >= 10 * 60_000 ? 'catch_up' : 'cron');
        await runScheduledTask(task, trigger);
      }
    } catch (e) {
      const err = String((e as Error)?.message ?? e);
      void mlog('schedule:tick-error', { why, error: err });
      actionLog('kernel', 'schedule:tick-error', { why, error: err }, { level: 'error' });
    } finally {
      tickBusy = false;
    }
  };

  if (SCHEDULE_DISABLED) {
    void mlog('schedule:scheduler-disabled', { reason: 'MAM_SCHEDULE_DISABLED=1' });
  } else {
    void ensureScheduleReady();
    setTimeout(() => {
      void runScheduleTick('first');
      setInterval(() => void runScheduleTick('interval'), SCHEDULE_TICK_MS);
    }, SCHEDULE_FIRST_DELAY_MS);
    void mlog('bootstrap:schedule-created', {
      host: SCHEDULE_HOST, tickMs: SCHEDULE_TICK_MS, firstDelayMs: SCHEDULE_FIRST_DELAY_MS,
      tzOffsetMin: SCHEDULE_TZ_OFFSET_MIN, tasks: SCHEDULE_TASKS.map((t) => t.key),
    });
  }
  if (FORGETTING_DISABLED) {
    void mlog('forgetting:scheduler-disabled', { reason: 'MAM_FORGETTING_DISABLED=1' });
  }

  // 批次43-A：§3.4 每日全量对账调度 —— reconcile(hub, local, {team_id}) 补本地缺的行 +
  // 指纹校验（integrity_issues 只如实报，绝不静默覆盖已有行）。中枢未装配（sync-hub init
  // 失败）时跳过：没有远端可对账，不伪造对账回执。引擎侧 sync_reconcile 审计由 hub 落账。
  const SYNC_RECONCILE_INTERVAL_MS = Number(process.env.MAM_SYNC_RECONCILE_INTERVAL_MS) || 24 * 3600_000;
  const SYNC_RECONCILE_FIRST_DELAY_MS = Number(process.env.MAM_SYNC_RECONCILE_FIRST_DELAY_MS) || 10 * 60_000;
  const runSyncReconcileScheduled = async (why: string): Promise<void> => {
    if (!syncHub) return;
    try {
      const r = await syncReconcileEngine(syncHub, storage, { team_id: tenantTriple.team_id, user_id: tenantTriple.user_id });
      void mlog('sync:reconcile-scheduled', { why, backfilled: r.backfilled, integrity_issues: r.integrity_issues });
      actionLog('kernel', 'sync:reconcile-scheduled', {
        why, backfilled: r.backfilled, integrity_issues: r.integrity_issues,
      }, r.integrity_issues.length > 0 ? { level: 'warn' } : undefined);
    } catch (err) {
      const e = String((err as Error)?.message ?? err);
      void mlog('sync:reconcile-scheduled:error', { why, error: e });
      actionLog('kernel', 'sync:reconcile-scheduled:error', { why, error: e }, { level: 'error' });
    }
  };
  if (process.env.MAM_SYNC_RECONCILE_DISABLED === '1') {
    void mlog('sync:reconcile-scheduler-disabled', { reason: 'MAM_SYNC_RECONCILE_DISABLED=1' });
  } else {
    setTimeout(() => {
      void runSyncReconcileScheduled('first');
      setInterval(() => void runSyncReconcileScheduled('interval'), SYNC_RECONCILE_INTERVAL_MS);
    }, SYNC_RECONCILE_FIRST_DELAY_MS);
    void mlog('bootstrap:sync-reconcile-scheduled', {
      firstDelayMs: SYNC_RECONCILE_FIRST_DELAY_MS, intervalMs: SYNC_RECONCILE_INTERVAL_MS,
      hubReady: syncHub !== null,
    });
  }

  // 所有 IPC 注册完毕：preload 声明了但没注册的 channel = 渲染层死桥；宁可启动失败也不静默
  const missing = missingChannels(registeredIpcChannels);
  if (missing.length > 0) throw new Error(`IPC 注册缺失: ${missing.join(', ')}`);

  // 首启向导页尚未纳入自绘标题栏（它自己就是独立页面，本轮不改它），因此只在工作台窗口上去掉系统标题栏。
  const wizardFirst = isWizardIncomplete();
  // 批次48 S10：顶部只有壳层自绘的一条标题栏；系统只保留三个窗口按钮覆盖在右侧
  const shellChrome = {
    titleBarStyle: 'hidden' as const,
    titleBarOverlay: {
      ...(nativeTheme.shouldUseDarkColors ? TITLEBAR_DARK : TITLEBAR_LIGHT),
      height: TITLEBAR_HEIGHT,
    },
  };
  let win: BrowserWindow | null = null;
  try {
    win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: '多Agent记忆助手',
      ...(wizardFirst ? {} : shellChrome),
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
  } catch (e) {
    // 批次41-E（P1-6）：主窗口创建失败不能再静默 return——否则进程存活并持有单实例锁，
    // 用户表现为「双击没反应」，只能杀进程恢复。这里显式报错并退出。
    const winFailMsg = String((e as Error)?.message ?? e);
    void mlog('bootstrap:window-failed', winFailMsg);
    // 补一条动作日志（此前只进 main.log，动作日志查不到）——只带原因与日志路径，不带窗口内容
    actionLog('app', 'bootstrap:window-failed', { error: winFailMsg, logPath: MAIN_LOG }, { level: 'error' });
    dialog.showErrorBox(
      '主窗口创建失败',
      `应用启动失败，无法创建主窗口，正在退出。\n原因：${winFailMsg}\n日志：${MAIN_LOG}`,
    );
    app.quit();
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

  // 顶部默认菜单删除后：应用内快捷键由主进程统一捕获，再交给壳层渲染层执行动作。
  // 这样焦点落在中心区 iframe 页面里时，F5/F9/F1/Ctrl+F/Ctrl+K 也不会因壳层收不到 keydown 而失效。
  // 复制/粘贴/全选不在此拦截，仍由 Chromium 原生编辑命令处理。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.alt || input.shift) return;
    const key = input.key.toLowerCase();
    let action: ShellShortcut | null = null;
    if (key === 'f5') action = 'refresh';
    else if (key === 'f9') action = 'security';
    else if (key === 'f1') action = 'help';
    else if ((input.control || input.meta) && (key === 'f' || key === 'k')) action = 'search';
    if (!action) return;
    event.preventDefault();
    win?.webContents.send(SHELL_SHORTCUT_CHANNEL, action);
  });

  // 显式传端口：?backend= 供 mirrorClient 走 home server，?agentBackend= 供 useBackendMirror 走 agentOnboard server
  // 批次37-B：首启向导没走完（两库位置 / L0 管理密码 / 恢复卡导出）就先进 setup.html。
  // 门禁判据在主进程（指针里的 setupDone），页面只是载体——绕过页面也进不了数据面，各条 IPC 各有闸门。
  // （wizardFirst 在创建窗口前已算好：决定是否启用自绘标题栏。）
  actionLog('dataRoot', wizardFirst ? 'setup:wizard-open' : 'setup:wizard-skipped', {
    ledgerDir: LIB_PATHS.ledgerDir, l0Dir: LIB_PATHS.l0Dir,
  });
  void win.loadURL(mainWindowUrl(staticPort, wizardFirst));

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
  app.on('before-quit', () => {
    void l0VaultRef?.onExit().catch(() => undefined);
    // 批次42-D：中枢优雅关闭——pglite 需显式 close 才保证 WASM 存储层完整刷盘；
    // close 失败只忽略（退出路径绝不阻断），中枢本身是衍生镜像（真源在各端账本，可 syncUp 重建）。
    void syncHub?.close().catch(() => undefined);
  });
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
    // 批次48 S10：删除 Electron 默认应用菜单（File/Edit/View/Window 那条）。
    // 不再自建中文菜单顶替：顶部只保留壳层自绘的一条标题栏与 Ribbon。
    // 复制/粘贴/全选仍由 Chromium 原生编辑命令处理；F5/Ctrl+F/Ctrl+K/F1/F9 由壳层渲染层接管。
    Menu.setApplicationMenu(null);
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
