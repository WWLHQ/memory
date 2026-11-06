// 统一内核接入口：全部页面共用同一份账本（唯一真相源）。
// - Electron（顶层窗口 / 概览页 iframe）：InMemoryStorage 构造即绑定主进程 SqliteStorage，本模块只做单例收敛；
// - 纯浏览器：本模块持有进程内唯一 InMemoryStorage，页面间不再各持一份空账本。
// 身份不再写死 demo 账号：优先取真实登录（Home 登录成功后 bindTenant 落盘）或主进程按会话下发
// （批次26-B P1-3 syncTenantFromHost，桌面壳内每次页面加载覆盖本地值）；否则用本机规范缺省三元组
// （批次45-A1：与主进程 tenant.json / 采集器·webhook 同源，不再现造 u_<ulid> 本机身份）。
import type {
  Account, Form, L0AdminPort, L0Port, LlmProvider, MemAgent, MemAgentSeedHooks, StorageBackend, VectorBackend,
} from '../core/memagent/types.ts';
import type { L0BlobStore } from '../core/memagent/l0Store.ts';
import { createMemAgent } from '../core/memagent/agent.ts';
import { InMemoryStorage } from '../core/memagent/storage.ts';
import { FakeLlmProvider } from '../core/memagent/llm.ts';
import { JsVectorBackend } from '../core/memagent/vector.ts';
import { ulid } from '../core/memagent/ulid.ts';
import { DEFAULT_TENANT } from '../shared/tenantDefaults.ts';
import { configuredVectorDim } from './models/modelConfig.ts';
import { HostL0Admin, HostL0Port, l0HostAvailable } from './shared/l0Port.ts';
import { HostL0BlobStore } from './shared/l0BlobStore.ts';
import { HostSyncHub } from './shared/syncHub.ts';
import { hostCall, hostCapability } from '../desktop/hostBridge.ts';
import { currentSessionId } from './shared/session.ts';
import { homeBaseUrl } from './backend.ts';
import { HttpStorageBackend } from './httpStorage.ts';
import { createHostLlm, refreshHostLlmSnapshotOnce } from './hostLlm.ts';

const TENANT_KEY = 'mam.tenant.v1';

export interface KernelTenant {
  user_id: string;
  team_id: string;
  enterprise_id: string;
}

let tenantCache: KernelTenant | null = null;

function readPersistedTenant(): KernelTenant | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TENANT_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Partial<KernelTenant>;
    if (!t.user_id || !t.team_id || !t.enterprise_id) return null;
    return { user_id: t.user_id, team_id: t.team_id, enterprise_id: t.enterprise_id };
  } catch {
    return null;
  }
}

function persistTenant(t: KernelTenant): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(TENANT_KEY, JSON.stringify(t)); } catch { /* 隐私模式/配额满：仅内存生效 */ }
}

/** 当前租户身份（首次调用持久化，跨页面/跨重启稳定） */
export function getTenant(): KernelTenant {
  if (tenantCache) return tenantCache;
  const persisted = readPersistedTenant();
  if (persisted) { tenantCache = persisted; return tenantCache; }
  // 批次45-A1 浏览器降级：不再现造 u_<ulid> 本机身份（每台浏览器各造一个 user_id 是账本租户混住的根源），
  // 改用本机规范缺省三元组（与主进程 tenant.json / 采集器·webhook 同源）。
  // 登录 bindTenant / 桌面壳 syncTenantFromHost 仍会用真实身份覆盖——降级值只保证「同一台账本同一套身份」。
  tenantCache = { ...DEFAULT_TENANT };
  persistTenant(tenantCache);
  return tenantCache;
}

/** 登录成功后绑定真实租户（Home 页调用；其余页面下次 getTenant 即生效） */
export function bindTenant(t: Partial<KernelTenant> & Pick<KernelTenant, 'user_id'>): void {
  const base = getTenant();
  tenantCache = {
    user_id: t.user_id,
    team_id: t.team_id ?? base.team_id,
    enterprise_id: t.enterprise_id ?? base.enterprise_id,
  };
  persistTenant(tenantCache);
}

/**
 * 批次26-B P1-3：租户三元组由主进程按会话下发（真源 = home server 会话），渲染层不再自报。
 * 桌面壳内每次页面加载都会用会话真值覆盖 mam.tenant.v1（改 localStorage 冒充租户立即被纠正）；
 * 纯浏览器/未登录/调用失败 = 显式降级：沿用本地身份（仅本机账本生效，不冒充服务端身份）。
 * 成功后重置内核单例：下个 getKernel 用真身份重装配（账本不清空）。
 */
export async function syncTenantFromHost(): Promise<boolean> {
  if (hostCapability() === 'none') return false;
  try {
    const r = await hostCall<{ ok: boolean; tenant?: KernelTenant; error?: string }>('tenant:get', [currentSessionId()]);
    if (!r?.ok || !r.tenant?.user_id || !r.tenant?.team_id || !r.tenant?.enterprise_id) return false;
    tenantCache = { ...r.tenant };
    persistTenant(tenantCache);
    agentSingleton = null;
    return true;
  } catch {
    return false;
  }
}

/** 内核写入用的账号三元组 */
export function kernelAccount(): Account {
  const t = getTenant();
  return { user_id: t.user_id, team_id: t.team_id, enterprise_id: t.enterprise_id };
}

/** 页面形态（端壳）：全部 Web 页为 web；桌面壳内由 Electron 主进程侧判定，渲染层不区分 */
export const KERNEL_FORM: Form = 'web';

let storageSingleton: StorageBackend | null = null;
let inMemorySingleton: InMemoryStorage | null = null;
let storageOverride: StorageBackend | null = null;

/** 测试辅助：强制指定账本后端（jsdom 页面测试 mock 了登录会话时，仍用内存账本而不走 HTTP 数据面） */
export function setKernelStorageForTests(storage: StorageBackend | null): void {
  storageOverride = storage;
  storageSingleton = null;
  agentSingleton = null;
}

/**
 * 批次28-A：全局唯一账本。三态选择——
 * 1. Electron 壳内：InMemoryStorage 构造即绑定主进程 FileStorage（原有 IPC 数据面，不变）；
 * 2. 纯浏览器 + 已有登录会话：HttpStorageBackend 经登录后端 /api/kernel/invoke 直连真实账本
 *    （桌面端持锁时只读镜像，写入得到诚实 E_STORAGE_LOCKED 提示）；
 * 3. 纯浏览器 + 未登录：进程内空账本（登录后 rebuildKernelForDataPlane() 切换）。
 */
export function getKernelStorage(): StorageBackend {
  if (storageOverride) return storageOverride;
  if (!storageSingleton) {
    if (hostCapability() !== 'none' || !currentSessionId()) {
      inMemorySingleton ??= new InMemoryStorage();
      storageSingleton = inMemorySingleton;
    } else {
      storageSingleton = new HttpStorageBackend({ baseUrl: homeBaseUrl() });
    }
  }
  return storageSingleton;
}

/**
 * 批次28-A：登录成功后重建内核数据面 —— 浏览器模式从「进程内空账本」切到
 * 「HTTP 数据面直连真实账本」；桌面壳内调用无害（重新绑定同一 IPC 账本）。
 */
export function rebuildKernelForDataPlane(): void {
  storageSingleton = null;
  agentSingleton = null;
  // 批次31：登录/重建后拉一次网关快照（异步到达；之前写入按 stub 口径只落 L1，诚实）
  void refreshHostLlmSnapshotOnce();
}

let agentSingleton: MemAgent | null = null;

export interface KernelOverrides {
  llm?: LlmProvider;
  vector?: VectorBackend;
}

let l0PortsOverride: { l0?: L0Port; l0Admin?: L0AdminPort; l0Blobs?: L0BlobStore } | null = null;

/** 测试辅助：注入 L0 端口（页面测试用真 L0Vault）；生产代码不得调用 */
export function setKernelL0ForTests(ports: { l0?: L0Port; l0Admin?: L0AdminPort; l0Blobs?: L0BlobStore } | null): void {
  l0PortsOverride = ports;
  agentSingleton = null;
}

/** L0 端口（§4.4）：桌面壳注入主进程 L0Vault 代理；纯浏览器不注入（写/查如实报错） */
function hostL0Ports(): { l0?: L0Port; l0Admin?: L0AdminPort; l0Blobs?: L0BlobStore } {
  if (l0PortsOverride) return { ...l0PortsOverride, ...kernelL0Blobs() };
  if (!l0HostAvailable()) return {};
  return { l0: new HostL0Port(), l0Admin: new HostL0Admin(), l0Blobs: new HostL0BlobStore() };
}

/**
 * 批次37-A：L0 原数据库读口。测试注入的端口若自带读口则尊重它，
 * 否则桌面壳内补一个走 IPC 的只读门面（纯浏览器没有 L0 库，保持 undefined → browse 走遮罩口径）。
 */
function kernelL0Blobs(): { l0Blobs?: L0BlobStore } {
  if (l0PortsOverride?.l0Blobs) return { l0Blobs: l0PortsOverride.l0Blobs };
  return l0HostAvailable() ? { l0Blobs: new HostL0BlobStore() } : {};
}

/** 测试辅助：灌种子记忆走这里（批次27 P3-1：_seedMemory 已移出公开 MemAgent 接口）；页面代码不得调用 */
export function getKernelWithSeed(): MemAgent & MemAgentSeedHooks {
  return getKernel() as MemAgent & MemAgentSeedHooks;
}

/**
 * 批次42-B：同步中枢（桌面壳内经 IPC 代理主进程 PgSyncHub，dataDir=sync-hub/）。
 * 与 L0 端口同一宿主能力判定：纯浏览器不注入 → agent.sync() 如实报 E_NOT_IMPLEMENTED（诚实降级）。
 */
function hostSyncHub(): { hub?: import('../core/memagent/sync.ts').AnySyncHub } {
  if (!l0HostAvailable()) return {};
  return { hub: new HostSyncHub() };
}

/** 全局唯一内核实例；首次调用时的 llm/vector 覆盖生效（模型页等需要自定义路由输入的场景） */
export function getKernel(overrides: KernelOverrides = {}): MemAgent {
  if (!agentSingleton) {
    agentSingleton = createMemAgent({
      form: KERNEL_FORM,
      account: kernelAccount(),
      // LLM 装配点（批次31）：桌面壳内经 IPC 代理主进程网关（Ollama/DeepSeek）；浏览器或网关未配置 → stub 只落 L1
      llm: overrides.llm ?? createHostLlm() ?? new FakeLlmProvider(),
      // 维度取自模型配置页落盘值（Phase C3）：保存的向量维度真实参与内核构造
      vector: overrides.vector ?? new JsVectorBackend(configuredVectorDim()),
      storage: getKernelStorage(),
      ...hostL0Ports(),
      ...hostSyncHub(),
    });
  }
  return agentSingleton;
}

/** 在既有账本上另建内核实例（模型页需要自己的反代理模型表，但账本仍共享） */
export function createKernelOnSameStorage(overrides: KernelOverrides = {}): MemAgent {
  return createMemAgent({
    form: KERNEL_FORM,
    account: kernelAccount(),
    // LLM 装配点（同上）
    llm: overrides.llm ?? createHostLlm() ?? new FakeLlmProvider(),
    vector: overrides.vector ?? new JsVectorBackend(configuredVectorDim()),
    storage: getKernelStorage(),
    ...hostL0Ports(),
    ...hostSyncHub(),
  });
}

/** 模型配置保存后重建全局内核：下次 getKernel 按新维度装配（账本不清空） */
export function rebuildKernelFromModelConfig(): void {
  agentSingleton = null;
}

/** 测试辅助：重置全局内核与账本（用例间隔离；生产代码不得调用） */
export function resetKernelForTests(): void {
  inMemorySingleton?.clearForTests();
  storageSingleton = null;
  inMemorySingleton = null;
  agentSingleton = null;
  l0PortsOverride = null;
  storageOverride = null;
  tenantCache = null; // 45-A1：租户单例一并重置（否则跨用例泄漏，降级持久化断言会拿到被 clear 过的 localStorage）
}

/** 统一 request_id 生成（内核同一 ULID 口径；禁止页面自增计数器冒充） */
export function newRequestId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

// 模块加载即触发一次会话租户同步（桌面壳内用会话真值覆盖本地身份；纯浏览器模式 no-op）
void syncTenantFromHost();
