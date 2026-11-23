// 原子任务24B · 启动时宿主钩子自动注入的编排层（main.ts bootstrap 调用）。
//
// 安全边界：
//   1. 由配置 host_hook_autoinject 显式开启（默认 false）——安装后不会静默改写用户宿主配置。
//   2. 只注入 probeHookHosts 判为 confirmed 的宿主（当前只有 WorkBuddy，hooks 协议已验证）。
//   3. 源脚本从打包资源/仓库源码解析，稳定化到数据根后再写宿主配置，路径统一不绑安装目录。
//   4. 任何失败只记日志、不 throw、不阻断启动；hooks 不热加载，改写了由 state 提示需重启宿主。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  probeHookHosts, injectHooksIntoHost, type InjectResult, type HookCapableHost,
} from './hostHookInject.ts';

/** 源脚本目录解析：打包态 = __dirname/recall-hard/；开发态 = 仓库 src/electron/host-hooks/。 */
export function resolveHostHookSourceDir(dirname: string, exists: (p: string) => boolean = (p) => existsSync(p)): {
  dir: string; sourceDirFor: (tag: string) => string;
} {
  const packed = join(dirname, 'recall-hard');
  const dev = join(dirname, '..', '..', 'src', 'electron', 'host-hooks');
  const dir = exists(packed) ? packed : dev;
  return { dir, sourceDirFor: (tag: string) => join(dir, tag) };
}

export interface AutoInjectDeps {
  dataDir: string;
  /** 主进程 __dirname（解析打包/开发态源目录） */
  dirname: string;
  exists?: (p: string) => boolean;
  probe?: () => HookCapableHost[];
  inject?: (opts: Parameters<typeof injectHooksIntoHost>[0]) => Promise<InjectResult>;
  log?: (action: string, detail: Record<string, unknown>) => void;
}

export interface AutoInjectSummary {
  enabled: boolean;
  hostsProbed: number;
  confirmedHosts: string[];
  results: { host: string; ok: boolean; changedTags: string[]; notLanded: string[]; error?: string }[];
  sourceDir: string;
  error?: string;
}

/** 编排：探测 → 逐已确认宿主注入 → 汇总。enabled=false 时只返回摘要、零写盘。 */
export async function runHostHookAutoInject(deps: AutoInjectDeps): Promise<AutoInjectSummary> {
  const { dir } = resolveHostHookSourceDir(deps.dirname, deps.exists);
  const empty: AutoInjectSummary = { enabled: false, hostsProbed: 0, confirmedHosts: [], results: [], sourceDir: dir };
  try {
    const hosts = (deps.probe ?? probeHookHosts)();
    const confirmed = hosts.filter((h) => h.confirmed);
    const summary: AutoInjectSummary = {
      enabled: true, hostsProbed: hosts.length, confirmedHosts: confirmed.map((h) => h.id),
      results: [], sourceDir: dir,
    };
    if (confirmed.length === 0) {
      deps.log?.('host-hook:no-confirmed-host', { probed: hosts.map((h) => ({ id: h.id, reason: h.reason })) });
      return summary;
    }
    const injectFn = deps.inject ?? injectHooksIntoHost;
    const { sourceDirFor } = resolveHostHookSourceDir(deps.dirname, deps.exists);
    for (const host of confirmed) {
      try {
        const r = await injectFn({
          host, sourceDirFor, dataDir: deps.dataDir,
          log: deps.log,
        });
        summary.results.push({
          host: host.id, ok: r.ok, changedTags: r.changedTags, notLanded: r.notLanded, error: r.error,
        });
        deps.log?.('host-hook:auto-inject-result', {
          host: host.id, ok: r.ok, changed: r.changedTags, kept: r.keptTags, notLanded: r.notLanded,
        });
      } catch (e) {
        // 单宿主失败不影响其它宿主，更不阻断启动
        summary.results.push({ host: host.id, ok: false, changedTags: [], notLanded: [], error: String((e as Error)?.message ?? e).slice(0, 120) });
        deps.log?.('host-hook:auto-inject-error', { host: host.id, error: String((e as Error)?.message ?? e).slice(0, 160) });
      }
    }
    return summary;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 160);
    deps.log?.('host-hook:auto-inject-fatal', { error: msg });
    return { ...empty, enabled: true, error: msg };
  }
}
