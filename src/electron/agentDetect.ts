// 本机 Agent 检测 · 后续扩展（2026-10-24）· 主进程 node 层（仅 Electron 使用）
// 设计原则：「已安装」以电脑安装痕迹为准（CLI PATH / 安装目录 exe / 开始菜单 / 配置文件 / 注册表卸载项），
//           运行中进程仅作参考（进程可能未装、也可能是临时/绿色版，不能当安装证据）。
//  · detectLocalAgents：五路信号合并——
//      installed（安装证据）：cli（where/which）/ app（安装目录 exe）/ startmenu（开始菜单）/ config（home 配置）/ uninstall（注册表卸载项）
//      running（进程参考）：hostScan 的 proc 路命中（tasklist 枚举）
//  · hostAgentConfig：按 agent 名生成接入配置建议（默认 19.4/19.5 口径）
// esbuild platform=node：node:child_process / node:fs / node:os 保持外部依赖。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { AGENT_FINGERPRINTS } from '../desktop/hostScan.ts';

/** 本机已装 CLI 探测清单（命令名 → agent 指纹名；按 AGENT_FINGERPRINTS 扩展） */
const CLI_PROBES: { cmd: string; agent: string; bin: string[] }[] = [
  { cmd: 'claude', agent: 'Claude Code', bin: ['claude'] },
  { cmd: 'codex', agent: 'Codex', bin: ['codex'] },
  { cmd: 'gemini', agent: 'Gemini CLI', bin: ['gemini', 'gemini-cli'] },
  { cmd: 'qwen', agent: 'Qwen Code', bin: ['qwen', 'qwen-code'] },
  { cmd: 'amp', agent: 'Amp', bin: ['amp'] },
  { cmd: 'iflow', agent: 'iFlow CLI', bin: ['iflow', 'iflow-cli'] },
  { cmd: 'cursor', agent: 'Cursor', bin: ['cursor-agent'] },
  { cmd: 'workbuddy', agent: 'WorkBuddy', bin: ['workbuddy'] },
  { cmd: 'harness', agent: 'deepseek harness', bin: ['deepseek-harness'] },
  // 国内 IDE/Agent（中文名/短名）
  { cmd: 'qoder', agent: 'Qoder CN', bin: ['qoder', 'qoder-cn'] },
  { cmd: 'trae', agent: 'Trae Code CN', bin: ['trae', 'trae-code', 'traecode'] },
  { cmd: 'zcode', agent: 'Zcode', bin: ['zcode', 'z-code', 'zcode-cli'] },
];

/** 桌面端 App 探测清单（agent → 真实可执行名候选 + 安装位置候选 + 会话日志目录；Windows 优先） */
const APP_PROBES: { agent: string; exe: string[]; dirs: string[]; sessions?: string }[] = [
  { agent: 'Claude Code', exe: ['Claude.exe', 'claude.exe'], dirs: ['AppData/Local/Claude', 'AppData/Local/Programs/Claude', 'AppData/Local/Programs/Claude Code'] },
  { agent: 'Gemini CLI', exe: ['gemini.exe'], dirs: ['AppData/Local/Gemini', 'AppData/Local/Programs/Gemini', 'Program Files/Gemini'] },
  { agent: 'Codex', exe: ['codex.exe'], dirs: ['AppData/Local/OpenAI', 'AppData/Local/Programs/Codex', 'Program Files/OpenAI'] },
  { agent: 'Qwen Code', exe: ['qwen.exe'], dirs: ['AppData/Local/Qwen', 'AppData/Local/Programs/Qwen', 'Program Files/Qwen'] },
  { agent: 'Amp', exe: ['amp.exe'], dirs: ['AppData/Local/Amp', 'AppData/Local/Programs/Amp', 'Program Files/Amp'] },
  { agent: 'iFlow CLI', exe: ['iflow.exe'], dirs: ['AppData/Local/iFlow', 'AppData/Local/Programs/iFlow'] },
  { agent: 'Cursor', exe: ['cursor.exe'], dirs: ['AppData/Local/Programs/Cursor', 'AppData/Local/Cursor', 'Program Files/Cursor'] },
  { agent: 'WorkBuddy', exe: ['workbuddy.exe'], dirs: ['AppData/Local/WorkBuddy', 'AppData/Local/Programs/WorkBuddy'] },
  // 自有 P0（DeepSeek Harness）：会话日志目录 ~/.dsh/sessions 存在 = 安装痕迹（DSH 本身即本机正在运行的 Harness）
  { agent: 'deepseek harness', exe: ['DeepSeek Harness.exe', 'deepseek-harness.exe', 'dsh.exe'],
    dirs: ['AppData/Local/Programs/DeepSeek Harness', 'AppData/Local/Programs/DeepSeek', 'Program Files/DeepSeek Harness', 'Program Files (x86)/DeepSeek Harness'],
    sessions: join(homedir(), '.dsh', 'sessions') },
  // 国内 IDE/Agent 桌面端（VS Code fork 惯用安装位置：Program Files/<Product>/）
  { agent: 'Qoder CN', exe: ['qoder.exe'], dirs: ['AppData/Local/Programs/Qoder', 'Program Files/Qoder', 'Program Files/Qoder CN', 'AppData/Local/Qoder'] },
  { agent: 'Trae Code CN', exe: ['trae.exe', 'traecode.exe'], dirs: ['AppData/Local/Programs/Trae', 'Program Files/Trae', 'Program Files/Trae Code', 'AppData/Local/Trae'] },
  { agent: 'Zcode', exe: ['zcode.exe'], dirs: ['AppData/Local/Programs/Zcode', 'Program Files/Zcode', 'Program Files/Z Code', 'AppData/Local/Zcode'] },
];

/** 开始菜单扫描目录（Windows） */
const START_MENU_DIRS = [
  join(homedir(), 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs'),
  join(homedir(), 'AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup'),
];

/** home 下 agent 配置文件候选（与 hostScan.ts CONFIG_CANDIDATES 同源扩展） */
const CONFIG_CANDIDATES = [
  '.claude.json', '.claude', '.codex', '.cursor',
  '.workbuddy', '.gemini', '.qwen', '.amp', '.iflow',
  '.qoder', '.trae', '.zcode',
  '.config/claude', '.config/codex', '.config/cursor',
];

/** Windows 注册表卸载项（HKLM + HKCU，纯 PowerShell 查询，失败不阻塞） */
const UNINSTALL_KEYS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];

export interface LocalAgentFound {
  agent: string;
  /** 安装证据类型（均以电脑安装痕迹为准）：
   *  cli=PATH 命令 / app=安装目录 exe / startmenu=开始菜单快捷方式 / config=home 配置文件 / uninstall=注册表卸载项 */
  via: 'cli' | 'app' | 'startmenu' | 'config' | 'uninstall';
  /** 真实溯源（可执行路径 / 命令 / 配置路径 / 卸载项） */
  source: string;
  version?: string;
  badge: 'p0' | 'p1' | 'p2' | 'p3';
  label: string;
}

export interface AgentConfigSuggestion {
  agent: string;
  /** 接入方法建议（19.2 / 5.2 口径） */
  method: string;
  /** 双通道建议（19.5 默认值：Webhook 主 + API 补偿） */
  chan: { webhook: boolean; api: boolean; recon: string };
  /** 隔离建议（19.4 默认值：project_id 共享 + user_id 偏好） */
  iso: { projShare: boolean; prefCross: boolean };
  /** 工具建议（安全兜底：默认只开只读召回，写入 P2 须用户确认） */
  tools: { recall: { on: boolean; topk: number; scene: string; mode: string }; write: { on: boolean }; pref: { on: boolean } };
}

const fpOf = (name: string) => AGENT_FINGERPRINTS.find((f) => f.name === name);

/** ① CLI 安装探测（where/which PATH 命中 = 已安装证据 + --version） */
function probeCli(): { found: LocalAgentFound[]; probes: Record<string, string> } {
  const found: LocalAgentFound[] = [];
  const probes: Record<string, string> = {};
  const p = platform();
  for (const spec of CLI_PROBES) {
    for (const bin of spec.bin) {
      let out = '';
      try {
        out = p === 'win32'
          ? execFileSync('where', [bin], { timeout: 4000, encoding: 'utf8' }).trim()
          : execFileSync('which', [bin], { timeout: 4000, encoding: 'utf8' }).trim();
      } catch {
        continue;
      }
      const hit = out.split(/\r?\n/).filter(Boolean)[0];
      if (!hit) continue;
      let version: string | undefined;
      try {
        version = execFileSync(bin, ['--version'], { timeout: 4000, encoding: 'utf8', shell: p === 'win32' })
          .trim().split(/\r?\n/)[0].slice(0, 40) || undefined;
      } catch { /* 无版本信息 */ }
      const fp = fpOf(spec.agent);
      found.push({ agent: spec.agent, via: 'cli', source: hit, version, badge: fp?.badge ?? 'p3', label: fp?.label ?? '扩展·P3' });
      probes[spec.cmd] = `cli:${hit}`;
      break;
    }
    probes[spec.cmd] ??= '未安装';
  }
  return { found, probes };
}

/** ② 桌面端 App 安装探测（安装目录 exe + 开始菜单快捷方式；纯 fs，零 spawn） */
function probeApps(): { found: LocalAgentFound[]; probes: Record<string, string> } {
  const found: LocalAgentFound[] = [];
  const probes: Record<string, string> = {};
  const p = platform();
  for (const spec of APP_PROBES) {
    const home = homedir();
    const exeHits: string[] = [];
    for (const dirRel of spec.dirs) {
      for (const exeName of spec.exe) {
        // Windows: 相对 home（AppData/…）或系统盘（Program Files/…）；mac/linux: 相对 home 或 /opt
        const cand = p === 'win32' && dirRel.startsWith('Program Files')
          ? join('C:', dirRel.replace(/^Program Files/, 'Program Files'), exeName)
          : p === 'win32'
            ? join(home, dirRel, exeName)
            : join(home, dirRel, exeName);
        if (existsSync(cand)) exeHits.push(cand);
      }
    }
    // 会话日志目录作为安装痕迹（如 ~/.dsh/sessions）
    const sessHits: string[] = [];
    if (spec.sessions && existsSync(spec.sessions)) sessHits.push(spec.sessions);
    // 开始菜单（仅 Windows；按 agent 可执行名/产品名前缀匹配，4+ 字符避免误伤）
    const menuHits: string[] = [];
    if (p === 'win32') {
      // 匹配词：exe 名（去扩展名）+ agent 名去空格（如 qoder / trae / zcode）
      const menuNames = [
        ...spec.exe.map((e) => e.replace(/\.exe$/i, '').toLowerCase()).filter((n) => n.length >= 4),
        ...spec.agent.toLowerCase().split(/\s+/).filter((n) => n.length >= 4),
      ];
      for (const sm of START_MENU_DIRS) {
        if (!existsSync(sm)) continue;
        for (const d of listDirNames(sm)) {
          const low = d.toLowerCase().replace(/\.(lnk|url)$/i, '');
          if (menuNames.some((n) => low.startsWith(n))) menuHits.push(join(sm, d));
        }
      }
    }
    const src = exeHits[0] ?? menuHits[0] ?? sessHits[0];
    if (src) {
      const fp = fpOf(spec.agent);
      const via: LocalAgentFound['via'] = exeHits.length > 0 ? 'app' : menuHits.length > 0 ? 'startmenu' : 'config';
      found.push({ agent: spec.agent, via, source: src, badge: fp?.badge ?? 'p3', label: fp?.label ?? '扩展·P3' });
      probes[spec.agent] = `${via === 'app' ? 'app' : via === 'startmenu' ? 'startmenu' : 'sessions'}:${src}`;
    } else {
      probes[spec.agent] = '未安装';
    }
  }
  return { found, probes };
}

/** ③ 配置文件探测（home 下 .claude/.codex/.workbuddy 等；安装痕迹证据） */
function probeConfigs(): { found: LocalAgentFound[]; probes: Record<string, string> } {
  const found: LocalAgentFound[] = [];
  const probes: Record<string, string> = {};
  const home = homedir();
  const files = CONFIG_CANDIDATES.map((rel) => join(home, rel)).filter((p) => existsSync(p));
  const lower = files.map((p) => p.replace(/\\/g, '/').toLowerCase());
  for (const fp of AGENT_FINGERPRINTS) {
    if (!fp.configPatterns?.length) continue;
    const hit = lower.find((p) => fp.configPatterns!.some((c) => p.includes(c)));
    if (hit) found.push({ agent: fp.name, via: 'config', source: `config:${hit}`, badge: fp.badge, label: fp.label });
  }
  if (files.length > 0) probes.config = `config:${files.length} 项`;
  return { found, probes };
}

/** ④ 注册表卸载项探测（Windows：HKLM/HKCU Uninstall 全字段；安装痕迹证据）
 *  匹配：DisplayName/DisplayIcon/InstallLocation/UninstallString 任一命中 agent 指纹词
 *  （覆盖中文名 agent 如「Qoder CN」「Trae Code 中国版」） */
function probeUninstall(): { found: LocalAgentFound[]; probes: Record<string, string> } {
  const found: LocalAgentFound[] = [];
  const probes: Record<string, string> = {};
  if (platform() !== 'win32') return { found, probes };
  try {
    const ps = UNINSTALL_KEYS.map((k) =>
      `Get-ItemProperty -Path "${k}\\*" -ErrorAction SilentlyContinue | Select-Object DisplayName,DisplayIcon,InstallLocation,UninstallString | ConvertTo-Json -Compress`
    ).join(' ; ');
    const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
      timeout: 10000, encoding: 'utf8',
    }).trim();
    if (!out || out === 'null') return { found, probes };
    // PowerShell ConvertTo-Json 单对象 → 对象；多对象 → 数组；三段拼接需逐段解析
    const segs = out.split('null').filter((s) => s.trim().length > 0);
    const rows: Array<Record<string, unknown>> = [];
    for (const seg of segs) {
      try {
        const parsed = JSON.parse(seg) as unknown;
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const r of arr) {
          if (r && typeof r === 'object') rows.push(r as Record<string, unknown>);
        }
      } catch { /* 该段解析失败跳过（其余段仍有效） */ }
    }
    // 指纹词：进程模式 + agent 名拆词（如 qoder / trae / zcode）
    const patSets = AGENT_FINGERPRINTS.map((fp) => ({
      fp,
      pats: [
        ...(fp.procPatterns ?? []),
        ...(fp.mcpPatterns ?? []),
        ...fp.name.toLowerCase().split(/\s+/).filter((s) => s.length >= 3),
      ].map((s) => s.toLowerCase()),
    }));
    for (const row of rows) {
      const hay = [row.DisplayName, row.DisplayIcon, row.InstallLocation, row.UninstallString]
        .map((v) => (typeof v === 'string' ? v.toLowerCase() : '')).join(' ');
      if (!hay.trim()) continue;
      for (const { fp, pats } of patSets) {
        const hit = pats.find((s) => hay.includes(s));
        if (hit) {
          found.push({
            agent: fp.name, via: 'uninstall',
            source: `uninstall:${String(row.DisplayName)}${row.InstallLocation ? ` (${String(row.InstallLocation)})` : ''}`,
            badge: fp.badge, label: fp.label,
          });
          probes[fp.name] = `uninstall:${String(row.DisplayName)}`;
        }
      }
    }
    probes.uninstall = `注册表卸载项 ${rows.length} 个（已扫描）`;
  } catch (e) {
    probes.uninstall = `注册表卸载项扫描失败: ${(e as { message?: string }).message ?? String(e)}`;
  }
  return { found, probes };
}

/** ⑤ 运行中进程探测（禁用：按「以电脑安装痕迹为准」原则，仅进程在跑不算安装——
 *  可能是绿色版/临时目录/远程执行，避免误报；保留函数壳供未来需要参考时启用） */
function probeRunning(): Map<string, string> {
  return new Map();
}

/** 列目录文件名（失败 → 空，不阻塞） */
function listDirNames(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}

/** 合并五路安装证据（cli > app > startmenu > uninstall > config，取最强）；不再附加进程参考 */
export function detectLocalAgents(): { found: LocalAgentFound[]; probes: Record<string, string>; err: string | null } {
  const cli = probeCli();
  const app = probeApps();
  const cfg = probeConfigs();
  const uninst = probeUninstall();
  // 进程探测已禁用（probeRunning 恒返回空 Map）：以电脑安装痕迹为准，避免绿色版/临时目录误报
  const running = probeRunning();

  const byName = new Map<string, LocalAgentFound>();
  // 安装证据优先级（越靠前越强，均为「电脑安装痕迹」）
  const RANK: Record<LocalAgentFound['via'], number> = { cli: 0, app: 1, startmenu: 2, uninstall: 3, config: 4 };
  for (const f of [...cli.found, ...app.found, ...uninst.found, ...cfg.found]) {
    const cur = byName.get(f.agent);
    if (!cur || RANK[f.via] < RANK[cur.via]) byName.set(f.agent, f);
  }
  // running 恒为空（进程参考已禁用）：保留循环结构供未来启用
  void running;

  const found = [...byName.values()].sort((a, b) => {
    const ia = AGENT_FINGERPRINTS.findIndex((f) => f.name === a.agent);
    const ib = AGENT_FINGERPRINTS.findIndex((f) => f.name === b.agent);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const probes: Record<string, string> = { ...cli.probes, ...app.probes, ...cfg.probes, ...uninst.probes };
  return { found, probes, err: null };
}

/** 兼容旧调用面：CLI-only 探测（保留给仅关心 PATH 的场景） */
export function detectCliAgents(): { found: LocalAgentFound[]; probes: Record<string, string>; err: string | null } {
  const r = probeCli();
  return { found: r.found, probes: r.probes, err: null };
}

/** 按 agent 名生成接入配置建议（默认值对齐 19.4/19.5；P2 写入需用户确认） */
export function hostAgentConfig(agentName: string): AgentConfigSuggestion {
  const fp = fpOf(agentName);
  const badge = fp?.badge ?? 'p3';
  const isP0P1 = badge === 'p0' || badge === 'p1';
  return {
    agent: agentName,
    method: isP0P1
      ? (agentName === 'deepseek harness' ? 'MCP + Webhook 直连（自有）' : 'MCP 工具 + 会话日志兜底（第三方）')
      : 'MCP（若支持）+ API 拉取兜底（扩展）',
    chan: { webhook: isP0P1, api: true, recon: '5min' },
    iso: { projShare: true, prefCross: true },
    // 安全兜底（19.9 注）：自动绑定默认只开只读召回；P0/P1 写入放行，P2/P3 须用户确认
    tools: {
      recall: { on: true, topk: 5, scene: 'default', mode: '' },
      write: { on: isP0P1 },
      pref: { on: isP0P1 },
    },
  };
}
