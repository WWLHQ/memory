// Agent 接入真实拨测（Phase C2）：以「本机安装痕迹」为唯一真相。
// node-only：复用主进程 detectLocalAgents（CLI/安装目录/开始菜单/配置/注册表五路安装证据）。
// ⚠ 不缓存扫描结果：用户卸载/断开 Agent 后立即点「测通」必须看到失败，不得滞留 CONNECTED。
import { detectLocalAgents } from '../electron/agentDetect.ts';
import type { AgentProbe, ProbeResult } from './service.ts';

export interface HostAgentProbeOptions {
  /** 可注入探测实现（测试注入 fake；缺省走真实 detectLocalAgents） */
  detect?: typeof detectLocalAgents;
}

/**
 * 宿主真实拨测：一次调用扫描一次，回答多家。
 * 返回 Map 覆盖所有入参 agent（未命中 → ok:false + 可读原因），服务层无需再补缺省。
 */
export function createHostAgentProbe(options: HostAgentProbeOptions = {}): AgentProbe {
  const detect = options.detect ?? detectLocalAgents;
  return (agentNames: string[]): Map<string, ProbeResult> => {
    const out = new Map<string, ProbeResult>();
    let found: ReturnType<typeof detectLocalAgents>['found'];
    try {
      found = detect().found;
    } catch (e) {
      const reason = `本机探测失败：${(e as Error)?.message ?? String(e)}`;
      for (const n of agentNames) out.set(n, { ok: false, reason });
      return out;
    }
    for (const name of agentNames) {
      const key = name.trim().toLowerCase();
      const hit = found.find((f) => f.agent.trim().toLowerCase() === key);
      out.set(name, hit
        ? { ok: true, reason: `命中安装证据（${hit.via}）：${hit.source}`, evidence: hit.source }
        : { ok: false, reason: `未检测到「${name}」的本机安装痕迹（CLI/安装目录/开始菜单/配置/注册表均未命中）` });
    }
    return out;
  };
}
