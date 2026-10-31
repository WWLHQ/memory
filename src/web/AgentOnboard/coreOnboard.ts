// AgentOnboard 接入页接真内核：一键接入第 4 段「测通并写审计」走 ma.discover
// （desktop 口径：宿主本机扫描 mcp/proc/hb 全信号，auto_bind 审计内核真写）。
// 宿主真扫（discover 真实化）：Electron 下经 window.api.hostScan.run() 读主进程真实进程表/MCP；
// 纯浏览器无此能力 → 降级内核 discover 并标注「数据来源：内核模拟」（非真实，UI 据此打徽标）。
import type { MemAgent, StorageBackend, AuditRecord, Memory } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import type { HostScanResult } from '../../desktop/hostScan.ts';
import type { Gain } from '../../types/agentOnboard.ts';

interface OnboardCtx {
  ma: MemAgent;
  storage: StorageBackend;
}

function getCtx(): OnboardCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

export interface DiscoveredAgentUi {
  name: string;
  signal: string;
  bound: boolean;
  /** 宿主真扫命中时携带真实指纹徽标（内核模拟降级时缺省） */
  badge?: 'p0' | 'p1' | 'p2' | 'p3';
  label?: string;
  /** 数据来源：host=宿主真扫 / kernel=内核模拟降级 */
  source?: 'host' | 'kernel';
}

/** 内核 discover（desktop：mcp/proc/hb 全信号）→ 自动绑定 + auto_bind 审计内核真写 */
export async function coreDiscover(): Promise<{
  agents: DiscoveredAgentUi[];
  skipped: string[];
}> {
  const { ma } = await getCtx();
  const r = await ma.discover({ form: 'desktop', signals: ['mcp', 'proc', 'hb'] });
  return { agents: r.agents, skipped: r.skipped };
}

/**
 * 宿主真扫（discover 真实化）：Electron 下走主进程真实扫描；浏览器降级到内核 discover。
 * 返回的 source 可溯源（真实进程名 / mcp 标识 / 配置文件 / 内核模拟占位），UI 据此打「数据来源」徽标。
 * ok=false 时降级内核模拟；reason 给出真实降级原因（如进程枚举被沙箱拦截 EBUSY），供 UI 诚实展示。
 */
export async function coreHostDiscover(): Promise<{
  agents: DiscoveredAgentUi[];
  /** 数据来源（UI 徽标）：'host'=宿主真扫，'kernel'=内核模拟降级 */
  source: 'host' | 'kernel';
  ok: boolean;
  /** 真实降级原因（宿主扫描不可用时的具体原因） */
  reason?: string;
}> {
  // 能力探测：native=顶层 preload 直连；bridge=概览页 iframe 内经宿主桥；none=浏览器无宿主能力
  const cap = hostCapability();
  if (cap !== 'none') {
    let reason: string | undefined;
    try {
      const res = await hostCall<HostScanResult>('hostScan:run');
      if (res.ok) {
        // 真实命中：found 即真实 agent；无命中（空数组）也如实返回（绝不造假）
        const agents = res.found.map((f) => ({
          name: f.name, badge: f.badge, label: f.label,
          signal: `${f.signal} · ${f.source}`, bound: true, source: 'host' as const,
        }));
        return { agents, source: 'host', ok: true };
      }
      const failed = res.probes
        ? Object.entries(res.probes).filter(([, v]) => v.startsWith('失败')).map(([k, v]) => `${k}=${v}`)
        : [];
      reason = `宿主扫描无数据（${failed.join('; ') || '所有信号源为空'}）`;
    } catch (e) {
      reason = `宿主扫描异常: ${(e as Error)?.message ?? String(e)}`;
    }
    const r = await coreDiscover();
    return {
      agents: r.agents.map((a) => ({ ...a, source: 'kernel' as const })),
      source: 'kernel', ok: false, reason,
    };
  }
  // 降级：内核 discover（占位口径，但审计 auto_bind 真写）
  const r = await coreDiscover();
  return {
    agents: r.agents.map((a) => ({ ...a, source: 'kernel' as const })),
    source: 'kernel', ok: false,
    reason: '非桌面壳环境（浏览器无法读本机进程，请用桌面应用）',
  };
}

// ---------- 效果证据四卡（真实可算，来自内核账本） ----------

/** 2.4.1 全量召回预算（token）：payload 相对该基线的节省比例 */
const FULL_BUDGET = 1500;

function asRecord(detail: unknown): Record<string, unknown> {
  return (detail && typeof detail === 'object' ? detail : {}) as Record<string, unknown>;
}

/**
 * 效果证据四卡（纯函数）：首页与接入页共用同一口径，全部来自内核审计/记忆账本。
 *  · Token 节省：recall 审计 payload_tokens vs 1500 全量预算（2.4.1）
 *  · 效率提升：跨会话召回次数与累计命中条数（recall.detail.hits）
 *  · 跨 Agent 复用：记忆主表条数 + 共享 project_id 域数（19.4）
 *  · 模型成本：llm_proxy/llm_fallback 审计次数与实际花费（19.8）
 * 账本为空 → 显「—」并说明「暂无账本」，绝不回退示例数字。
 */
export function computeOnboardGains(audits: AuditRecord[], memories: Memory[]): Gain[] {
  const recalls = audits.filter((a) => a.action === 'recall');
  const payloads = recalls
    .map((a) => Number(asRecord(a.detail).payload_tokens))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const hitsSum = recalls.reduce((s, a) => {
    const h = Number(asRecord(a.detail).hits ?? 0);
    return Number.isFinite(h) ? s + h : s;
  }, 0);
  const proxies = audits.filter((a) => a.action === 'llm_proxy' || a.action === 'llm_fallback');
  const costSum = proxies.reduce((s, a) => {
    const c = Number(asRecord(a.detail).cost ?? 0);
    return Number.isFinite(c) ? s + c : s;
  }, 0);
  const projects = new Set(memories.map((m) => m.project_id)).size;

  const g1: Gain = payloads.length > 0
    ? (() => {
        const avg = payloads.reduce((s, n) => s + n, 0) / payloads.length;
        const savedPct = Math.max(0, Math.round((1 - avg / FULL_BUDGET) * 100));
        return {
          icon: '🪙', title: 'Token 节省', big: `-${savedPct}%`,
          desc: `本周期 <b>${payloads.length} 次召回</b> · 平均 payload <b>${Math.round(avg)}/${FULL_BUDGET}</b>；极简 ≤600t、次模式 ≤200t 占位符注入同样生效`,
          src: '内核账本·实时（2.4.1 预算）',
        };
      })()
    : { icon: '🪙', title: 'Token 节省', big: '—', desc: '暂无召回账本 · 发起召回后自动累计', src: '内核账本·实时（2.4.1 预算）' };

  const g2: Gain = recalls.length > 0
    ? {
        icon: '⚡', title: '效率提升', big: `${hitsSum} 次命中`,
        desc: `跨会话召回 <b>${recalls.length} 次</b> · 累计命中 <b>${hitsSum} 条</b>记忆（踩坑/决策免重复交代）`,
        src: '内核账本·实时（9.1 / 9.3 / 9.4）',
      }
    : { icon: '⚡', title: '效率提升', big: '—', desc: '暂无召回账本 · 发起召回后自动累计', src: '内核账本·实时（9.1 / 9.3 / 9.4）' };

  const g3: Gain = memories.length > 0
    ? {
        icon: '🔁', title: '跨 Agent 复用', big: `${memories.length} 条 · ${projects} 域`,
        desc: `project_id 共享域（19.4）：一次沉淀，多端命中 · 当前 <b>${projects} 个共享项目</b>`,
        src: '内核账本·实时（19.4）',
      }
    : { icon: '🔁', title: '跨 Agent 复用', big: '—', desc: '暂无记忆账本 · 写入记忆后自动累计', src: '内核账本·实时（19.4）' };

  const g4: Gain = proxies.length > 0
    ? {
        icon: '💸', title: '模型成本节省（反代理 19.8）', big: `${proxies.length} 次 · ¥${costSum.toFixed(2)}`,
        desc: '自动选择<b>先免费、后低价</b> · 次数与花费来自内核 llm_proxy/llm_fallback 审计（19.8）',
        src: '内核账本·实时（19.8 proxy_select_mode=auto）',
      }
    : { icon: '💸', title: '模型成本节省（反代理 19.8）', big: '—', desc: '暂无代理调用账本 · 反代理调用后自动累计', src: '内核账本·实时（19.8 proxy_select_mode=auto）' };

  return [g1, g2, g3, g4];
}

/** 从 storage 读账本后计算效果证据四卡（接入页/测试沿用；首页走 getHomeFeed 的同口径纯函数） */
export async function getOnboardGains(storage: StorageBackend): Promise<Gain[]> {
  const [audits, memories] = await Promise.all([
    storage.queryAudit({}),
    storage.listMemories({}),
  ]);
  return computeOnboardGains(audits, memories);
}

/** 未加载/账本不可达时的四卡占位（全「—」，真实语义：账本为空） */
export function emptyOnboardGains(): Gain[] {
  return [
    { icon: '🪙', title: 'Token 节省', big: '—', desc: '暂无召回账本 · 发起召回后自动累计', src: '内核账本·实时（2.4.1 预算）' },
    { icon: '⚡', title: '效率提升', big: '—', desc: '暂无召回账本 · 发起召回后自动累计', src: '内核账本·实时（9.1 / 9.3 / 9.4）' },
    { icon: '🔁', title: '跨 Agent 复用', big: '—', desc: '暂无记忆账本 · 写入记忆后自动累计', src: '内核账本·实时（19.4）' },
    { icon: '💸', title: '模型成本节省（反代理 19.8）', big: '—', desc: '暂无代理调用账本 · 反代理调用后自动累计', src: '内核账本·实时（19.8 proxy_select_mode=auto）' },
  ];
}

/**
 * 注入预览（真实可算）：按卡片 top_k=5 取内核账本记忆，tokens ≈ 内容字符数/4 估算。
 * 账本为空 → null（UI 显示诚实空态，不再硬编码"5 条 / 780 tokens"演示数字）。
 */
export async function getOnboardInjectPreview(storage: StorageBackend): Promise<{ count: number; tokens: number } | null> {
  const mems = await storage.listMemories({});
  if (mems.length === 0) return null;
  const top = mems.slice(0, 5); // 对齐卡片 recall top_k=5 默认值
  const chars = top.reduce((s, m) => s + m.content.length, 0);
  return { count: top.length, tokens: Math.max(1, Math.round(chars / 4)) };
}
