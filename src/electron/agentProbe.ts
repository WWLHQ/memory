// 主进程 Agent 健康定时拨测 + 真实熔断状态机 + 慢计算缓存（原子任务 B）。
// 拨测目标：本机 5 个服务端口（AgentOnboard/Mirror/MCP/Webhook/MCP-HTTP）。
// 每 60s 一轮；每 5 分钟落 1 条 agent_probe 汇总审计（只读观测，不刷爆账本）。
// 慢计算（写入率 / 校验异常）每 5 分钟重算一次并缓存，避免每次 monitor:stats 调用全量扫描。
// 红线：全部来自真实数据源，绝不为「有数字」硬填；无样本时由渲染层诚实显示空态。
import net from 'node:net';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileStorage } from '../core/memagent/fileStorage.ts';

const PROBE_INTERVAL_MS = 60_000;
const WINDOW_MS = 5 * 60_000;
const CIRCUIT_OPEN_STREAK = 5; // 连续全失败轮次 → OPEN
const HALF_OPEN_MS = 60_000;
const SLOW_COMPUTE_MS = 5 * 60_000;

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface MonitorStats {
  agent: {
    /** 窗口内连通样本占比（0-100）；无样本为 null */
    connectivityRate: number | null;
    circuit: CircuitState;
    /** 成功连接的平均耗时（ms）；无样本为 null */
    avgLatencyMs: number | null;
    probedAt: number | null;
    windowSamples: number;
  };
  writeRate: { rate: number | null; success: number; filtered: number; failed: number; since: number } | null;
  /** 全量内容指纹核对：与落盘 sha256 不一致的条数（持久问题，非 24h 窗口） */
  checksumFail: number | null;
}

interface ProbeDeps {
  storage: FileStorage;
  ledgerDir: string;
  ports: number[];
}

let deps: ProbeDeps | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let round = 0;
let samples: { at: number; ok: boolean; latencyMs: number }[] = [];
let circuit: CircuitState = 'CLOSED';
let failStreak = 0;
let openSince = 0;
let cacheWriteRate: MonitorStats['writeRate'] = null;
let cacheChecksum: number | null = null;
let lastSlow = 0;

/** TCP 探活单个端口（本机）：连上即 ok，记录墙钟耗时；不可达/超时即失败 */
function probePort(port: number, timeoutMs = 2000): Promise<{ ok: boolean; latencyMs: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;
    const sock = net.connect(port, '127.0.0.1');
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* noop */ }
      resolve({ ok, latencyMs: Date.now() - start });
    };
    sock.on('connect', () => finish(true));
    sock.on('error', () => finish(false));
    sock.setTimeout(timeoutMs, () => finish(false));
  });
}

/** 纯函数：熔断状态机下一步（便于单测；不依赖模块级可变状态） */
export function nextCircuitState(
  prev: CircuitState,
  prevStreak: number,
  allFail: boolean,
  now: number,
  prevOpenSince: number,
): { circuit: CircuitState; failStreak: number; openSince: number } {
  if (prev === 'CLOSED') {
    if (allFail) {
      const streak = prevStreak + 1;
      if (streak >= CIRCUIT_OPEN_STREAK) return { circuit: 'OPEN', failStreak: streak, openSince: now };
      return { circuit: 'CLOSED', failStreak: streak, openSince: prevOpenSince };
    }
    return { circuit: 'CLOSED', failStreak: 0, openSince: prevOpenSince };
  }
  if (prev === 'OPEN') {
    if (now - prevOpenSince >= HALF_OPEN_MS) return { circuit: 'HALF_OPEN', failStreak: prevStreak, openSince: prevOpenSince };
    return { circuit: 'OPEN', failStreak: prevStreak, openSince: prevOpenSince };
  }
  // HALF_OPEN：任一端口恢复即闭合，否则重新打开
  if (!allFail) return { circuit: 'CLOSED', failStreak: 0, openSince: prevOpenSince };
  return { circuit: 'OPEN', failStreak: prevStreak, openSince: now };
}

/**
 * 24h 写入成功率（2026-11-15 用户拍板方案 1：分母剔除质量门过滤）。
 * 口径：写入成功率 = 成功落盘 /（成功落盘 + 真失败）。
 *   · 成功落盘 = 普通 write 审计；
 *   · 质量门拦截（detail.action='filtered_l0_to_l1'）= 内核按设计主动拒绝噪声/过短内容，
 *     属于正确行为而非失败，**不计入分母**（只作为 filtered 计数旁证展示）；
 *   · 真失败 = 审计里显式标了 error / ok=false 的写入（当前 0 条 → 成功率 100%）。
 * 无任何写入尝试（success=failed=0）→ null，由渲染层显「暂无数据」，不伪造 100%。
 */
/**
 * 纯函数：把 write 审计行按「成功落盘 / 质量门过滤 / 真失败」三分类（便于单测，零 IO）。
 * 方案 1 口径：质量门过滤不算失败，不进成功率分母。
 */
export function classifyWriteRows(
  rows: { detail?: unknown }[],
): { success: number; filtered: number; failed: number; rate: number | null } {
  let success = 0, filtered = 0, failed = 0;
  for (const r of rows) {
    const d = r.detail as { action?: unknown; error?: unknown; ok?: unknown } | undefined;
    if (d?.action === 'filtered_l0_to_l1') { filtered++; continue; }
    if (d && (d.error !== undefined || d.ok === false)) { failed++; continue; }
    success++;
  }
  const denom = success + failed;
  return { success, filtered, failed, rate: denom > 0 ? Math.round((success / denom) * 100) : null };
}

async function computeWriteRate(): Promise<NonNullable<MonitorStats['writeRate']>> {
  const since = Date.now() - 24 * 3600 * 1000;
  const rows = await deps!.storage.queryAudit({ action: 'write', since });
  return { ...classifyWriteRows(rows), since };
}

/** 全量内容指纹核对：逐条对内存 content 重算 sha256 与落盘 sha256 比对，不一致即校验异常 */
function computeChecksumFail(): number {
  const p = join(deps!.ledgerDir, 'memories.db.json');
  if (!existsSync(p)) return 0;
  try {
    const db = JSON.parse(readFileSync(p, 'utf8'));
    const mems: unknown[] = Array.isArray(db.memories) ? db.memories : Object.values(db.memories ?? {});
    let fail = 0;
    for (const m of mems) {
      const mem = m as { content?: unknown; sha256?: unknown };
      if (typeof mem?.content === 'string' && typeof mem?.sha256 === 'string') {
        const h = createHash('sha256').update(mem.content, 'utf8').digest('hex');
        if (h !== mem.sha256) fail++;
      }
    }
    return fail;
  } catch {
    return 0;
  }
}

async function ensureSlow(): Promise<void> {
  const now = Date.now();
  if (now - lastSlow >= SLOW_COMPUTE_MS || cacheWriteRate === null) {
    cacheWriteRate = await computeWriteRate();
    cacheChecksum = computeChecksumFail();
    lastSlow = now;
  }
}

async function tick(): Promise<void> {
  if (!deps) return;
  const now = Date.now();
  const results = await Promise.all(deps.ports.map((p) => probePort(p)));
  const allFail = results.length > 0 && results.every((r) => !r.ok);
  for (const r of results) samples.push({ at: now, ok: r.ok, latencyMs: r.latencyMs });
  samples = samples.filter((s) => now - s.at <= WINDOW_MS);
  const next = nextCircuitState(circuit, failStreak, allFail, now, openSince);
  circuit = next.circuit;
  failStreak = next.failStreak;
  openSince = next.openSince;
  await ensureSlow();
  round++;
  if (round % 5 === 0) await persistProbe(now);
}

async function persistProbe(now: number): Promise<void> {
  if (!deps) return;
  const s = getMonitorStats();
  try {
    await deps.storage.appendAudit({
      request_id: `req_probe_${now.toString(36)}`,
      action: 'agent_probe',
      ts: now,
      project_id: 'P1',
      detail: {
        connectivityRate: s.agent.connectivityRate,
        circuit: s.agent.circuit,
        avgLatencyMs: s.agent.avgLatencyMs,
        writeRate: s.writeRate,
        checksumFail: s.checksumFail,
        windowSamples: s.agent.windowSamples,
      },
    } as never);
  } catch {
    /* 落审计失败不阻断拨测 */
  }
}

export function getMonitorStats(): MonitorStats {
  const now = Date.now();
  const win = samples.filter((s) => now - s.at <= WINDOW_MS);
  const ok = win.filter((s) => s.ok);
  const rate = win.length > 0 ? Math.round((ok.length / win.length) * 100) : null;
  const avg = ok.length > 0 ? Math.round(ok.reduce((a, b) => a + b.latencyMs, 0) / ok.length) : null;
  return {
    agent: {
      connectivityRate: rate,
      circuit,
      avgLatencyMs: avg,
      probedAt: win.length ? Math.max(...win.map((s) => s.at)) : null,
      windowSamples: win.length,
    },
    writeRate: cacheWriteRate,
    checksumFail: cacheChecksum,
  };
}

export function initAgentProbe(d: ProbeDeps): void {
  if (deps) return;
  deps = d;
  void ensureSlow().then(() => {
    if (!timer) {
      timer = setInterval(() => { void tick(); }, PROBE_INTERVAL_MS);
      timer.unref?.();
    }
  });
}
