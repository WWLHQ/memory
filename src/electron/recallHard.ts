// 批次62 UI 开关 · 主进程控制器：A 宿主钩子 / B 内置网关 / C 严格门禁 三层统一编排。
// 原则：配置（用户意图）落数据根 recall-hard-config.json；运行态一律读**真值**——
//   A 读宿主 settings.json 里是否真有本钩子条目；B 读网关 handle 是否真在跑；C 读服务端当前门禁值。
// 绝不拿配置冒充运行态（AGENTS §0「绝不伪造数据」）。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  DEFAULT_RECALL_HARD_CONFIG, RECALL_HARD_CONFIG_FILE,
  normalizeRecallHardConfig, recallHardBaseUrl, validRecallUpstream,
  type RecallHardConfig,
} from '../shared/recallHardConfig.ts';
import { startRecallGateway, type RecallGatewayHandle } from './recallGateway.ts';

export const RECALL_HARD_HOOK_TAG = 'force_recall.mjs';

export interface RecallHardControllerOptions {
  /** 数据根（USER_DATA） */
  dataDir: string;
  /** 钩子脚本绝对路径：开发态指向仓库 .codebuddy/hooks，打包态指向 resources/recall-hard/.codebuddy/hooks */
  hookScript: string;
  /** 宿主级 settings.json 绝对路径（默认 ~/.workbuddy/settings.json，与批次62 安装一致） */
  hostSettingsPath?: string;
  /** 8204 MCP 令牌（主进程持有，不落配置） */
  mcpToken?: string;
  mcpUrl?: string;
  /** 审计/动作日志（只记层名与开关，不记上游地址与密钥） */
  log?: (action: string, detail: Record<string, unknown>) => void;
}

export interface RecallHardState {
  ok: boolean;
  error?: string;
  config: RecallHardConfig;
  a: {
    enabled: boolean; installed: boolean; hostPath: string; hookScript: string;
    /** 钩子脚本文件是否真的存在：不存在时「已启用」是假的，必须让用户看见。 */
    scriptExists: boolean;
    note: string; needsRestart: boolean;
  };
  b: { enabled: boolean; running: boolean; port: number; upstream: string; baseUrl: string; error?: string };
  c: { enabled: boolean; effective: boolean };
}

function defaultHostSettingsPath(): string {
  return join(homedir(), '.workbuddy', 'settings.json');
}

async function readJsonFile(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try { return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; }
  catch { return null; }
}

/** 只摘除本钩子（按 force_recall.mjs 标记），其余 UserPromptSubmit 条目与其它顶层键逐字保留。 */
export function mergeHostHooks(current: Record<string, unknown>, enabled: boolean, hookCommand: string): Record<string, unknown> {
  const next = { ...current };
  const rawHooks = current.hooks && typeof current.hooks === 'object' && !Array.isArray(current.hooks)
    ? current.hooks as Record<string, unknown> : {};
  const hooks = { ...rawHooks };
  const ups = Array.isArray(hooks.UserPromptSubmit) ? [...hooks.UserPromptSubmit] as unknown[] : [];
  const kept = ups.filter((entry) => !JSON.stringify(entry).includes(RECALL_HARD_HOOK_TAG));
  if (enabled) {
    kept.push({ hooks: [{ type: 'command', command: hookCommand, timeout: 5 }] });
  }
  if (kept.length) hooks.UserPromptSubmit = kept;
  else delete hooks.UserPromptSubmit;
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

/** 真值：宿主配置里是否装着本钩子。 */
export function hostHookInstalled(current: Record<string, unknown> | null): boolean {
  if (!current) return false;
  const hooks = current.hooks as Record<string, unknown> | undefined;
  const ups = hooks && Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];
  return ups.some((entry) => JSON.stringify(entry).includes(RECALL_HARD_HOOK_TAG));
}

export class RecallHardController {
  private readonly opts: RecallHardControllerOptions;
  private readonly configPath: string;
  private readonly hostPath: string;
  private config: RecallHardConfig = { ...DEFAULT_RECALL_HARD_CONFIG };
  private gateway: RecallGatewayHandle | null = null;
  private gatewayError: string | null = null;
  /** 本次运行内 A 是否被改动过：hooks 不热加载，只有改过才提示「需重启宿主」。 */
  private aTouchedSinceBoot = false;
  /** C：服务端每次 tools/call 前调这个 getter，切换即时生效、无需重启。 */
  private cEffective = DEFAULT_RECALL_HARD_CONFIG.c_strict_gate;

  constructor(opts: RecallHardControllerOptions) {
    this.opts = opts;
    this.configPath = join(opts.dataDir, RECALL_HARD_CONFIG_FILE);
    this.hostPath = opts.hostSettingsPath ?? defaultHostSettingsPath();
  }

  cStrict = (): boolean => this.cEffective;

  private hookCommand(): string {
    return `node "${this.opts.hookScript.replace(/\\/g, '/')}"`;
  }

  private scriptExists(): boolean {
    return existsSync(this.opts.hookScript);
  }

  private async loadConfig(): Promise<RecallHardConfig> {
    const raw = await readJsonFile(this.configPath);
    const cfg = normalizeRecallHardConfig(raw);
    // 逃生开关：启动时 env=0 强制退回批次47 旧行为；之后 UI 仍可再开。
    if (process.env.MAM_STRICT_RECALL_GATE === '0' && !raw) cfg.c_strict_gate = false;
    return cfg;
  }

  private async saveConfig(cfg: RecallHardConfig): Promise<void> {
    await mkdir(this.opts.dataDir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  }

  private async setHostHook(enabled: boolean): Promise<{ installed: boolean; note: string }> {
    const current = await readJsonFile(this.hostPath);
    if (current === null && existsSync(this.hostPath)) {
      return { installed: false, note: '宿主配置不是合法 JSON，拒绝改写' };
    }
    const merged = mergeHostHooks(current ?? {}, enabled, this.hookCommand());
    const output = JSON.stringify(merged, null, 2) + '\n';
    try {
      if (existsSync(this.hostPath)) {
        await writeFile(`${this.hostPath}.bak`, await readFile(this.hostPath, 'utf8'), 'utf8');
      }
      await writeFile(this.hostPath, output, 'utf8');
    } catch (e) {
      return { installed: hostHookInstalled(current), note: `宿主配置写入失败：${String((e as Error)?.message ?? e).slice(0, 120)}` };
    }
    this.opts.log?.('recall-hard:a-hook', { enabled, host: this.hostPath });
    return {
      installed: enabled,
      note: enabled
        ? `宿主钩子已写入配置 · 路径 ${this.hostPath}`
        : '宿主钩子已摘除 · 其它钩子保留',
    };
  }

  private async syncGateway(enabled: boolean): Promise<void> {
    this.gatewayError = null;
    if (!enabled) {
      if (this.gateway) { await this.gateway.stop(); this.gateway = null; }
      return;
    }
    const { b_port, b_upstream } = this.config;
    if (!validRecallUpstream(b_upstream)) {
      if (this.gateway) { await this.gateway.stop(); this.gateway = null; }
      this.gatewayError = '启用前必须先填写上游地址（http/https 绝对地址）';
      return;
    }
    // 端口或上游变了 → 先停再起，避免旧进程占着旧口径。
    if (this.gateway && (this.gateway.port !== b_port || this.gateway.upstream !== b_upstream)) {
      await this.gateway.stop(); this.gateway = null;
    }
    if (this.gateway) return;
    try {
      this.gateway = await startRecallGateway({
        port: b_port, upstream: b_upstream,
        mcpToken: this.opts.mcpToken, mcpUrl: this.opts.mcpUrl,
      });
      this.opts.log?.('recall-hard:b-gateway', { enabled: true, port: b_port });
    } catch (e) {
      this.gatewayError = String((e as Error)?.message ?? e).slice(0, 160);
    }
  }

  /** 启动恢复：读配置 → 让三层运行态与用户意图对齐。单项失败不阻断其它层。 */
  async init(): Promise<void> {
    this.config = await this.loadConfig();
    this.cEffective = this.config.c_strict_gate;
    // A 只在「意图与真值不一致」时才写宿主配置，避免每次启动都重写并覆盖外部改动。
    // 脚本不存在时绝不写死配置（写了宿主每轮都会执行失败）——保持现状并留日志，由 UI 如实显示。
    if (this.config.a_hook && !this.scriptExists()) {
      this.opts.log?.('recall-hard:a-hook-script-missing', { script: this.opts.hookScript });
    } else {
      const current = await readJsonFile(this.hostPath);
      if (hostHookInstalled(current) !== this.config.a_hook) {
        await this.setHostHook(this.config.a_hook);
      }
    }
    await this.syncGateway(this.config.b_gateway);
  }

  async state(): Promise<RecallHardState> {
    const installed = hostHookInstalled(await readJsonFile(this.hostPath));
    const scriptExists = this.scriptExists();
    return {
      ok: true,
      config: { ...this.config },
      a: {
        enabled: this.config.a_hook,
        installed,
        hostPath: this.hostPath,
        hookScript: this.opts.hookScript,
        scriptExists,
        note: !scriptExists
          ? `钩子脚本不存在：${this.opts.hookScript}`
          : installed
            ? `宿主钩子已写入配置 · 路径 ${this.hostPath}`
            : '宿主钩子已摘除 · 其它钩子保留',
        needsRestart: this.aTouchedSinceBoot, // hooks 不热加载：本次运行内改过 A 才需重启宿主
      },
      b: {
        enabled: this.config.b_gateway,
        running: this.gateway !== null,
        port: this.config.b_port,
        upstream: this.config.b_upstream,
        baseUrl: recallHardBaseUrl(this.config.b_port),
        error: this.gatewayError ?? undefined,
      },
      c: { enabled: this.config.c_strict_gate, effective: this.cEffective },
    };
  }

  /** 应用一次 UI 提交：先校验 → 落盘 → 逐层 reconcile → 回执最新真值。 */
  async apply(patch: Partial<RecallHardConfig>): Promise<RecallHardState> {
    const next = { ...this.config, ...patch };
    if (next.b_gateway && !validRecallUpstream(next.b_upstream)) {
      return { ...(await this.state()), ok: false, error: '请先填写上游地址再启用 B（http/https 绝对地址）' };
    }
    if (next.a_hook && !this.scriptExists()) {
      return { ...(await this.state()), ok: false, error: `钩子脚本不存在，无法启用 A：${this.opts.hookScript}` };
    }
    const aChanged = next.a_hook !== this.config.a_hook;
    const bChanged = next.b_gateway !== this.config.b_gateway
      || next.b_port !== this.config.b_port || next.b_upstream !== this.config.b_upstream;
    const cChanged = next.c_strict_gate !== this.config.c_strict_gate;
    this.config = next;
    await this.saveConfig(next);

    if (aChanged) { await this.setHostHook(next.a_hook); this.aTouchedSinceBoot = true; }
    if (bChanged) await this.syncGateway(next.b_gateway);
    else if (next.b_gateway && this.gatewayError) await this.syncGateway(true);
    if (cChanged) {
      this.cEffective = next.c_strict_gate;
      this.opts.log?.('recall-hard:c-gate', { enabled: next.c_strict_gate });
    }
    return this.state();
  }

  async stop(): Promise<void> {
    if (this.gateway) { await this.gateway.stop(); this.gateway = null; }
  }
}
