// 宿主真扫 · node IO 层（仅 Electron 主进程使用）：
//  · 复用 src/desktop/hostScan.ts 的纯匹配函数（matchAgentsFromProcesses/Mcp/ConfigFiles/merge）
//  · 三路信号源，各路独立自检、互不牵连：
//      proc   = 进程枚举（Windows tasklist（wmic 兜底）/ Unix ps）—— 受沙箱/杀软限制时可能失败
//      mcp    = 注册表/配置探测（保守存在性）
//      config = agent 配置文件路径探测（纯 fs，零 spawn，最稳）
// 渲染层经 preload window.api.hostScan.run() 调 scanHost()；纯浏览器无此能力 → 降级内核 discover 并标注「本地模拟」。
// esbuild bundle 时本文件 platform=node，node:child_process / node:os / node:fs 保持外部依赖。

import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  matchAgentsFromProcesses,
  matchAgentsFromMcp,
  matchAgentsFromConfigFiles,
  mergeHostAgents,
  type HostScanResult,
} from '../desktop/hostScan.ts';

/** 解析 tasklist /fo csv /nh 输出（纯函数，可单测）：每行首个引号字段即映像名 */
export function parseTasklistCsv(out: string): string[] {
  const names: string[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^"([^"]+)"/);
    if (m) names.push(m[1]);
  }
  return names;
}

/** 解析 wmic process get Name /format:json 输出（纯函数，老 Windows 兜底路径）。
 *  兼容两种已知形态：{"Node":[{"Property":[{"Name":"Name","VALUE":"a.exe"}]}]}
 *  与 {"Node":[{"Name":"a.exe"}]}；坏 JSON/空 → 空数组。 */
export function parseWmicJson(out: string): string[] {
  const start = out.indexOf('{');
  if (start < 0) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(out.slice(start));
  } catch {
    return [];
  }
  const nodes = (raw as { Node?: unknown[] })?.Node;
  if (!Array.isArray(nodes)) return [];
  const names: string[] = [];
  for (const node of nodes) {
    const n = (node ?? {}) as { Name?: unknown; Property?: unknown };
    // 形态②：node 直接带 Name
    if (typeof n.Name === 'string' && n.Name) {
      names.push(n.Name);
      continue;
    }
    // 形态①：Property 包装——键值对数组，Name 为键、VALUE 为值
    if (Array.isArray(n.Property)) {
      for (const prop of n.Property) {
        const p = (prop ?? {}) as { Name?: unknown; VALUE?: unknown };
        if (p.Name === 'Name' && typeof p.VALUE === 'string' && p.VALUE) names.push(p.VALUE);
      }
    }
  }
  return names;
}

/** 枚举真实进程名（仅桌面壳主进程调用）：
 *  Windows 用 tasklist /fo csv /nh（所有版本自带；wmic 在 Win11 24H2+/26200+ 已被移除，仅作兜底）；
 *  Unix 用 ps -eo comm=。返回 {names, err}——失败时 err 真实原因（如 EBUSY 受限）上抛 UI。 */
export function listProcessNames(): { names: string[]; err: string | null } {
  const p = platform();
  try {
    if (p === 'win32') {
      try {
        const out = execFileSync('tasklist', ['/fo', 'csv', '/nh'], {
          timeout: 5000, encoding: 'utf8',
        });
        const names = parseTasklistCsv(out);
        if (names.length > 0) return { names, err: null };
      } catch (e) {
        // tasklist 失败（受限环境/杀软）→ 落到 wmic 兜底
        const tasklistErr = (e as { code?: string }).code ?? String(e);
        try {
          const out = execFileSync('wmic', ['process', 'get', 'Name', '/format:json'], {
            timeout: 5000, encoding: 'utf8',
          });
          const names = parseWmicJson(out);
          if (names.length > 0) return { names, err: null };
        } catch {
          return { names: [], err: `tasklist/wmic 均失败: ${tasklistErr}` };
        }
      }
      return { names: [], err: 'tasklist/wmic 均无输出' };
    }
    // Linux/mac：ps -eo comm 取进程名
    const out = execFileSync('ps', ['-eo', 'comm='], { timeout: 5000, encoding: 'utf8' });
    return { names: out.split('\n').map((s) => s.trim()).filter(Boolean), err: null };
  } catch (e) {
    return { names: [], err: `${(e as { code?: string }).code ?? 'ERR'}: ps 失败` };
  }
}

/** 探测 MCP 注册表配置（宿主真扫第二路证据；失败返回空，不阻塞主流程） */
export function detectMcpEntries(): { entries: string[]; err: string | null } {
  const p = platform();
  try {
    if (p === 'win32') {
      const out = execFileSync('cmd', ['/c', 'reg', 'query', 'HKCU\\SOFTWARE\\Classes\\Local Settings\\MUTEX'], {
        timeout: 3000, encoding: 'utf8', stdio: 'pipe',
      });
      return { entries: out.length > 0 ? ['registry'] : [], err: null };
    }
    return { entries: [], err: null };
  } catch (e) {
    return { entries: [], err: `${(e as { code?: string }).code ?? 'ERR'}: reg 失败` };
  }
}

/** agent 配置文件候选（相对 homedir；纯 fs 探测，不 spawn，最稳） */
const CONFIG_CANDIDATES = [
  '.claude.json', '.claude', '.codex', '.cursor',
  '.config/claude', '.config/codex', '.config/cursor',
  'Library/Application Support/Claude', 'Library/Application Support/Code/User/settings.json',
];

/** 探测 agent 配置文件（第三路信号，纯 fs）——spawn 被拦截时仍能给出真实证据 */
export function detectConfigFiles(): { files: string[]; err: string | null } {
  try {
    const home = homedir();
    const files = CONFIG_CANDIDATES.map((rel) => join(home, rel)).filter((p) => existsSync(p));
    return { files, err: null };
  } catch (e) {
    return { files: [], err: String((e as Error)?.message ?? e) };
  }
}

/** 主进程入口：真实扫描 → 返回与 UI 同构的 HostScanResult（无命中 → found 空数组，绝不造假） */
export function scanHost(): HostScanResult {
  const proc = listProcessNames();
  const mcp = detectMcpEntries();
  const cfg = detectConfigFiles();
  const found = mergeHostAgents(
    matchAgentsFromProcesses(proc.names),
    matchAgentsFromMcp(mcp.entries),
    matchAgentsFromConfigFiles(cfg.files),
  );
  return {
    found,
    evidence: {
      processNames: [...new Set(proc.names)].slice(0, 200),
      configFiles: cfg.files,
    },
    platform: platform(),
    // ok = 至少一路真实信号源成功（进程枚举在受限环境失败时，config 路仍可支撑）
    ok: proc.names.length > 0 || cfg.files.length > 0,
    scannedAt: Date.now(),
    probes: {
      proc: proc.err ? `失败(${proc.err})` : `成功(${proc.names.length} 进程)`,
      mcp: mcp.err ? `失败(${mcp.err})` : `成功(${mcp.entries.length} 项)`,
      config: cfg.err ? `失败(${cfg.err})` : `成功(${cfg.files.length} 配置)`,
    },
  };
}
