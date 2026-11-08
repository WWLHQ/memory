// 宿主桥（iframe 场景）：把 preload 能力透传给概览页 iframe 内的子页面。
//
// 背景（真实缺陷）：Electron 的 preload 只在**主 frame** 执行，iframe 内的页面拿不到
// window.api / window.__ELECTRON__，导致：
//   · 宿主真扫被误判为「非桌面壳环境」而降级内核模拟；
//   · 主页面的 storage IPC 同样不可用 → 真实账本读不到（显示空）。
//
// 方案：概览页等**顶层窗口**（有 preload）安装消息监听，代理 storage.* / hostScan.run；
// iframe 内页面通过 postMessage 请求。纯渲染层实现，不改 Electron 安全配置。
// 同源静态服务下 iframe 可读 window.parent；非同源/浏览器环境请求最终失败 → 调用方诚实降级。

import { ulid } from '../core/memagent/ulid.ts';

const REQ = '__memagent_host_req__';
const RES = '__memagent_host_res__';
const RETRY_MS = 250;
const MAX_RETRY = 12;
/** 同一请求 id 的去重窗口：客户端重发只是探测父窗口就绪，绝不能重复执行原生副作用 */
const DEDUPE_TTL_MS = 10_000;

export type HostMethod =
  | 'storage:putMemory' | 'storage:getMemory' | 'storage:listMemories'
  | 'storage:deleteMemory' | 'storage:appendAudit' | 'storage:queryAudit'
  | 'storage:createProject' | 'storage:getProject' | 'storage:listProjects'
  | 'storage:location'
  | 'storage:openMemoryFile'
  | 'hostScan:run'
  | 'hostAgentDetect:run'
  | 'hostAgentDetect:config'
  | 'tenant:get'
  /** 第一轮个人记忆本机闭环：独立存储单一数据面（owner 由主进程按会话解析） */
  | 'personal:invoke'
  | 'mcp:clients'
  | 'mcp:clientSnippet'
  | 'mcp:clientWire'
  | 'collector:triggerNow'
  | 'collector:status'
  | 'backup:getConfig'
  | 'backup:saveConfig'
  | 'backup:chooseDir'
  | 'backup:runNow'
  | 'backup:list'
  | 'dataRoot:get'
  | 'dataRoot:open'
  | 'dataRoot:change'
  | 'dataRoot:restoreDefault'
  | 'log:write'
  | 'log:tail'
  | 'l0:status' | 'l0:setup' | 'l0:changePassword' | 'l0:requestAccess'
  | 'l0:listRequests' | 'l0:listGrants' | 'l0:grant' | 'l0:deny' | 'l0:revoke'
  | 'l0:unlock' | 'l0:heartbeat' | 'l0:lock' | 'l0:writeUnlock' | 'l0:writeLock'
  | 'l0:seal' | 'l0:decrypt' | 'l0:sessionInfo' | 'l0:migrate' | 'l0:blobs'
  /** S5 / D6：MCP 写入兜底队列只读摘要（不含正文与密钥材料） */
  | 'l0:pendingWrites'
  | 'l0:splitPreview' | 'l0:splitRun'
  | 'l0:rebuildPreview' | 'l0:rebuildRun'
  | 'l0:recoveryStatus' | 'l0:recoveryInit' | 'l0:recoveryIssue' | 'l0:recover' | 'l0:recoveryExport'
  | 'setup:state' | 'setup:reselectDirs' | 'setup:setL0Password' | 'setup:regenCode' | 'setup:exportCard' | 'setup:finish'
  | 'legacy:scan' | 'legacy:demote'
  | 'ledger:resetPreview' | 'ledger:resetRecollect'
  | 'rules:rejudgePreview' | 'rules:rejudgeRun'
  /** 批次41-T：存量补齐缺失的 sha256 / 向量（只补元数据，不删行、不改正文） */
  | 'ledger:fieldsPreview' | 'ledger:fieldsBackfill'
  | 'refine:state' | 'refine:setEnabled' | 'refine:backfill' | 'refine:retryFailed' | 'refine:setCap'
  /** 批次42-B：云端同步中枢（主进程 PgSyncHub 代理） */
  | 'sync:push' | 'sync:pull' | 'sync:reconcile' | 'sync:conflicts' | 'sync:resolve'
  | 'sync:cursor' | 'sync:auditCount' | 'sync:auditsFrom'
  | 'llm:config' | 'llm:configSet' | 'llm:test' | 'llm:refine'
  /** 批次48 A31：厂商余额视图（需会话）/ 独立 billing 凭据（仅管理员） */
  | 'llm:billing' | 'llm:billingKey';

/** 扁平 channel → preload 暴露的嵌套对象方法（window.api[ns][fn]） */
const CHANNEL_TO_NATIVE: Record<HostMethod, [string, string]> = {
  'storage:putMemory': ['storage', 'putMemory'],
  'storage:getMemory': ['storage', 'getMemory'],
  'storage:listMemories': ['storage', 'listMemories'],
  'storage:deleteMemory': ['storage', 'deleteMemory'],
  'storage:appendAudit': ['storage', 'appendAudit'],
  'storage:queryAudit': ['storage', 'queryAudit'],
  'storage:createProject': ['storage', 'createProject'],
  'storage:getProject': ['storage', 'getProject'],
  'storage:listProjects': ['storage', 'listProjects'],
  'storage:location': ['storage', 'location'],
  'storage:openMemoryFile': ['storage', 'openMemoryFile'],
  'hostScan:run': ['hostScan', 'run'],
  'hostAgentDetect:run': ['hostAgentDetect', 'run'],
  'hostAgentDetect:config': ['hostAgentDetect', 'config'],
  'tenant:get': ['tenant', 'get'],
  'personal:invoke': ['personal', 'invoke'],
  'mcp:clients': ['mcpClients', 'list'],
  'mcp:clientSnippet': ['mcpClients', 'snippet'],
  'mcp:clientWire': ['mcpClients', 'wire'],
  'collector:triggerNow': ['collector', 'triggerNow'],
  'collector:status': ['collector', 'status'],
  'backup:getConfig': ['backup', 'getConfig'],
  'backup:saveConfig': ['backup', 'saveConfig'],
  'backup:chooseDir': ['backup', 'chooseDir'],
  'backup:runNow': ['backup', 'runNow'],
  'backup:list': ['backup', 'list'],
  'dataRoot:get': ['dataRoot', 'get'],
  'dataRoot:open': ['dataRoot', 'open'],
  'dataRoot:change': ['dataRoot', 'change'],
  'dataRoot:restoreDefault': ['dataRoot', 'restoreDefault'],
  'log:write': ['log', 'write'],
  'log:tail': ['log', 'tail'],
  'l0:status': ['l0', 'status'],
  'l0:setup': ['l0', 'setup'],
  'l0:changePassword': ['l0', 'changePassword'],
  'l0:requestAccess': ['l0', 'requestAccess'],
  'l0:listRequests': ['l0', 'listRequests'],
  'l0:listGrants': ['l0', 'listGrants'],
  'l0:grant': ['l0', 'grant'],
  'l0:deny': ['l0', 'deny'],
  'l0:revoke': ['l0', 'revoke'],
  'l0:unlock': ['l0', 'unlock'],
  'l0:heartbeat': ['l0', 'heartbeat'],
  'l0:lock': ['l0', 'lock'],
  'l0:writeUnlock': ['l0', 'writeUnlock'],
  'l0:writeLock': ['l0', 'writeLock'],
  'l0:seal': ['l0', 'seal'],
  'l0:decrypt': ['l0', 'decrypt'],
  'l0:sessionInfo': ['l0', 'sessionInfo'],
  'l0:migrate': ['l0', 'migrate'],
  'l0:blobs': ['l0', 'blobs'],
  'l0:pendingWrites': ['l0', 'pendingWrites'],
  'l0:splitPreview': ['l0', 'splitPreview'],
  'l0:splitRun': ['l0', 'splitRun'],
  'l0:rebuildPreview': ['l0', 'rebuildPreview'],
  'l0:rebuildRun': ['l0', 'rebuildRun'],
  'l0:recoveryStatus': ['l0', 'recoveryStatus'],
  'l0:recoveryInit': ['l0', 'recoveryInit'],
  'l0:recoveryIssue': ['l0', 'recoveryIssue'],
  'l0:recover': ['l0', 'recover'],
  'l0:recoveryExport': ['l0', 'recoveryExport'],
  'setup:state': ['setup', 'state'],
  'setup:reselectDirs': ['setup', 'reselectDirs'],
  'setup:setL0Password': ['setup', 'setL0Password'],
  'setup:regenCode': ['setup', 'regenCode'],
  'setup:exportCard': ['setup', 'exportCard'],
  'setup:finish': ['setup', 'finish'],
  'legacy:scan': ['legacy', 'scan'],
  'legacy:demote': ['legacy', 'demote'],
  'ledger:resetPreview': ['ledgerReset', 'preview'],
  'ledger:resetRecollect': ['ledgerReset', 'run'],
  'rules:rejudgePreview': ['rulesRejudge', 'preview'],
  'rules:rejudgeRun': ['rulesRejudge', 'run'],
  'ledger:fieldsPreview': ['ledgerFields', 'preview'],
  'ledger:fieldsBackfill': ['ledgerFields', 'run'],
  'refine:state': ['refineQueue', 'state'],
  'refine:setEnabled': ['refineQueue', 'setEnabled'],
  'refine:backfill': ['refineQueue', 'backfill'],
  'refine:retryFailed': ['refineQueue', 'retryFailed'],
  'refine:setCap': ['refineQueue', 'setCap'],
  'sync:push': ['sync', 'push'],
  'sync:pull': ['sync', 'pull'],
  'sync:reconcile': ['sync', 'reconcile'],
  'sync:conflicts': ['sync', 'conflicts'],
  'sync:resolve': ['sync', 'resolve'],
  'sync:cursor': ['sync', 'cursor'],
  'sync:auditCount': ['sync', 'auditCount'],
  'sync:auditsFrom': ['sync', 'auditsFrom'],
  'llm:config': ['llm', 'config'],
  'llm:configSet': ['llm', 'setConfig'],
  'llm:test': ['llm', 'test'],
  'llm:refine': ['llm', 'refine'],
  'llm:billing': ['llm', 'billing'],
  'llm:billingKey': ['llm', 'setBillingKey'],
};

/** 顶层窗口是否具备原生 preload 能力 */
function hasNativeApi(): boolean {
  return typeof window !== 'undefined' && window.__ELECTRON__ === true && !!window.api;
}

export interface HostLogOptions {
  level?: 'info' | 'warn' | 'error';
  requestId?: string;
}

/**
 * 渲染层动作日志（批次7）：顶层经 preload 直写，iframe 经父窗口桥转发；浏览器环境静默。
 * 直接走 log:write 通道（不走 hostCall），避免「记录日志」本身再触发日志造成递归。
 */
export function hostLog(scope: string, action: string, detail?: unknown, opts?: HostLogOptions): void {
  try {
    const payload = [scope, action, detail, opts] as unknown[];
    if (hasNativeApi()) {
      const api = window.api as unknown as { log?: { write?: (...a: unknown[]) => void } };
      api.log?.write?.(...payload);
      return;
    }
    if (isEmbedded()) {
      window.parent.postMessage({ [REQ]: { id: ulid(), method: 'log:write', args: payload } }, window.location.origin);
    }
  } catch {
    /* 日志绝不打断业务 */
  }
}

const ALLOWED_METHODS = new Set<string>(Object.keys(CHANNEL_TO_NATIVE));

/** 观测类通道：调用本身不写 host 日志，避免「看日志」把日志刷屏 */
const QUIET_METHODS = new Set<HostMethod>(['log:write', 'log:tail']);

/** 已执行请求的去重表（key → 结果 Promise），防止 iframe 重试触发重复副作用 */
const recentCalls = new Map<string, { at: number; result: Promise<unknown> }>();

/**
 * 批次27 P3-5：去重键 = id + method + args。只用 id 的话，iframe 里可预测/撞车的 id
 * 会在 TTL 窗口内劫持（或被劫持）另一条不相干调用的缓存结果；同 id 重试仍是
 * 同 method + 同 args，去重语义不变。
 */
function dedupeKey(id: string, method: HostMethod, args: unknown[]): string {
  let argsKey: string;
  try {
    argsKey = JSON.stringify(args);
  } catch {
    argsKey = '<unserializable>';
  }
  return `${id}\u0000${method}\u0000${argsKey}`;
}

function executeOnce(id: string, method: HostMethod, args: unknown[]): Promise<unknown> {
  const now = Date.now();
  for (const [k, v] of recentCalls) if (now - v.at > DEDUPE_TTL_MS) recentCalls.delete(k);
  const key = dedupeKey(id, method, args);
  const hit = recentCalls.get(key);
  if (hit) return hit.result;
  const result = Promise.resolve().then(() => callNative(method, args));
  result.catch(() => { /* 由请求方消费错误；这里只防止未处理拒绝 */ });
  recentCalls.set(key, { at: now, result });
  return result;
}

/**
 * 处理一条 iframe → 顶层桥请求。
 * 只接受同源（非 opaque）来源、已知 channel、数组参数；回包 targetOrigin 固定为请求来源，绝不用 '*'。
 * 导出以便单测直接驱动（避免重复 import 遗留多个 window 监听器）。
 */
export function handleBridgeMessage(e: MessageEvent): void {
  const ownOrigin = window.location.origin;
  if (!ownOrigin || ownOrigin === 'null' || e.origin !== ownOrigin) return;
  if (!hasNativeApi()) return;
  const d = e.data as { [REQ]?: { id: string; method: HostMethod; args: unknown[] } } | null;
  const req = d?.[REQ];
  if (!req || typeof req !== 'object') return;
  if (typeof req.id !== 'string' || !req.id) return;
  if (!ALLOWED_METHODS.has(req.method)) return;
  if (!Array.isArray(req.args)) return;
  const source = e.source as WindowProxy | null;
  if (!source || typeof source.postMessage !== 'function') return;

  executeOnce(req.id, req.method, req.args)
    .then((data) => source.postMessage({ [RES]: { id: req.id, ok: true, data } }, e.origin))
    .catch((err) => source.postMessage({ [RES]: { id: req.id, ok: false, error: String((err as Error)?.message ?? err) } }, e.origin));
}

/** 父窗口是否具备原生 preload 能力（bridge 场景下检查父窗口） */
function parentHasNativeApi(): boolean {
  try {
    const p = window.parent;
    if (!p || p === window) return false;
    return (p as unknown as { __ELECTRON__?: boolean }).__ELECTRON__ === true
      && !!(p as unknown as { api?: unknown }).api;
  } catch {
    return false; // 跨源访问抛错 → 无能力
  }
}

/** 是否运行在同源 iframe 中（有可代理的父窗口） */
export function isEmbedded(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== null && window.parent !== window;
  } catch {
    return false; // 跨源访问抛错 → 非同源 iframe
  }
}

let installed = false;

/**
 * 安装宿主桥监听（仅顶层窗口生效，幂等）。
 * 页面入口只要 import 本模块即会自动触发（storage.ts / coreOnboard.ts 都依赖它）。
 */
export function installHostBridge(): void {
  if (installed || typeof window === 'undefined' || isEmbedded()) return;
  installed = true;
  window.addEventListener('message', handleBridgeMessage);
}

/** 走原生 preload（顶层窗口）直调 window.api[ns][fn] */
async function callNative<T>(method: HostMethod, args: unknown[]): Promise<T> {
  const [ns, fn] = CHANNEL_TO_NATIVE[method];
  const api = window.api as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
  const target = api?.[ns]?.[fn];
  if (typeof target !== 'function') throw new Error(`宿主能力缺失: window.api.${ns}.${fn}`);
  return (await target.apply(api[ns], args)) as T;
}

/** 走 iframe 消息桥（子 frame）：父窗口未就绪时按退避重试，最终失败由调用方降级 */
async function callViaParent<T>(method: HostMethod, args: unknown[]): Promise<T> {
  if (!ALLOWED_METHODS.has(method)) throw new Error(`未知宿主能力: ${method}`);
  const id = ulid();
  const parentOrigin = window.location.origin;
  return new Promise<T>((resolve, reject) => {
    let wait = 0;
    let settled = false;
    const onMsg = (e: MessageEvent) => {
      if (settled || e.origin !== parentOrigin) return;
      if (e.source && e.source !== window.parent) return;
      const res = (e.data as { [RES]?: { id: string; ok: boolean; data?: unknown; error?: string } } | null)?.[RES];
      if (!res || res.id !== id) return;
      settled = true;
      window.removeEventListener('message', onMsg);
      window.clearInterval(timer);
      if (res.ok) resolve(res.data as T);
      else reject(new Error(res.error ?? 'host bridge call failed'));
    };
    window.addEventListener('message', onMsg);
    const post = () => window.parent.postMessage({ [REQ]: { id, method, args } }, parentOrigin);
    const timer = window.setInterval(() => {
      wait += 1;
      if (wait >= MAX_RETRY) {
        settled = true;
        window.clearInterval(timer);
        window.removeEventListener('message', onMsg);
        reject(new Error('宿主桥不可达（父窗口未安装桥或非同源）'));
        return;
      }
      post();
    }, RETRY_MS);
    post();
  });
}

/**
 * 统一宿主调用：顶层走原生 preload；同源 iframe 走消息桥；浏览器环境直接抛错（调用方诚实降级）。
 * 每次调用都留一行 host 日志（动作名/通道/耗时/错误），便于按方法名排查「点了没反应」。
 */
export async function hostCall<T>(method: HostMethod, args: unknown[] = []): Promise<T> {
  const started = Date.now();
  const via = hasNativeApi() ? 'native' : isEmbedded() ? 'bridge' : 'none';
  if (via === 'none') {
    if (!QUIET_METHODS.has(method)) hostLog('host', method, { via, error: '宿主能力不可用（非桌面壳环境）' }, { level: 'warn' });
    throw new Error('宿主能力不可用（非桌面壳环境）');
  }
  try {
    const result = via === 'native'
      ? await callNative<T>(method, args)
      : await callViaParent<T>(method, args);
    if (!QUIET_METHODS.has(method)) hostLog('host', method, { via, ms: Date.now() - started });
    return result;
  } catch (e) {
    if (!QUIET_METHODS.has(method)) {
      hostLog('host', method, { via, ms: Date.now() - started, error: String((e as Error)?.message ?? e) }, { level: 'error' });
    }
    throw e;
  }
}

/** 能力探测（供 UI 诚实标注：native / bridge / none）
 *  bridge 仅在父窗口确实具备原生 preload 时返回，否则降级 none。 */
export function hostCapability(): 'native' | 'bridge' | 'none' {
  if (hasNativeApi()) return 'native';
  if (isEmbedded() && parentHasNativeApi()) return 'bridge';
  return 'none';
}

// 模块加载即安装（顶层窗口；iframe 内自动跳过）
installHostBridge();
