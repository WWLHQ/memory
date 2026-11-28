// DSH（DeepSeek Harness）profile 接入 · node 层（2026-11-27 批次 B，仅 Electron 主进程使用）。
// 背景：批次28-B 曾假定 DSH「无独立 MCP 配置面、随宿主 Qoder 下发」。2026-11-26 实机推翻——
// DSH 桌面端把 MCP 客户端与插件都写在自己的 profile 目录（~/.dsh/profiles/<name>/）：
//   · cordis.patch.yml  插件行 + MCP 客户端行（YAML 数组，`- id:` 与 `- insert:` 两种形态）
//   · package.json      dependencies + dsh.profile.bundles（插件要登记在这里才会被加载）
// 所以一键接入 = ① 幂等并入 memagent MCP 行；② 把折叠卡插件**复制**进 profile 的 node_modules
// 并登记到 package.json。复制而非 link：仓库一挪就是悬空链接，插件静默失效（2026-11-26 事故）。
// 本文件不引 YAML 依赖：patch 结构固定且简单，文本级改写更可控（只碰本服务条目，用户其它行原样保留）。
import {
  copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync,
  renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import type { McpWireState } from '../agentOnboard/mcpClients.ts';

/** 缺省 profile 名（DSH 桌面端用 desktop；用户也可 --profile 起别的） */
export const DSH_PROFILE_DEFAULT = 'desktop';
/** profile 里 MCP 客户端行的 id（与 DSH 既有写法一致） */
export const DSH_MCP_ROW_ID = 'memagent-mcp';
export const DSH_MCP_SERVER_NAME = 'memagent';
export const DSH_MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client';
/** 折叠卡插件包名（本地私有包，不发布 npm） */
export const DSH_RECALL_CARD_PKG = '@local/memagent-recall-card';
/** 插件在 profile 里的稳定落地目录（相对 profile 根）：先复制到这里，再从这里装进 node_modules。
 *  不放 node_modules 里面，是因为 pnpm 不接受「file: 依赖指向自己 node_modules 内」的写法。 */
export const DSH_PLUGIN_VENDOR_REL = join('vendor', 'memagent-recall-card');
/** 插件在 profile package.json 里的依赖写法：指向 profile 内的稳定副本，
 *  仓库挪走/删除都不影响（旧写法 link: 指向仓库，2026-11-26 因此静默失效）。 */
export const DSH_RECALL_CARD_DEP = `file:./${DSH_PLUGIN_VENDOR_REL.replace(/\\/g, '/')}`;
/** 插件源目录（相对应用资源目录 / 仓库根） */
export const DSH_PLUGIN_SOURCE_RELATIVE = join('dsh-plugins', 'memagent-recall-card');
/** 显式身份头（与其它客户端同一真源；DSH 的审计首段是 dsh-mcp-client） */
export const DSH_CLIENT_HEADER = 'X-Memagent-Client';
export const DSH_CLIENT_ID = 'deepseek-harness';

/** 单个文件读写上限（cordis.patch.yml 正常几 KB，超过即视为异常） */
const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
/** 每个配置文件保留的备份份数（备份含明文令牌，不能无限累积） */
const MAX_BACKUPS_PER_CONFIG = 3;

export interface DshProfileLocation {
  profile: string;
  /** profile 真实目录 */
  dir: string;
  /** cordis.patch.yml 真实路径 */
  patchPath: string;
  /** profile package.json 真实路径 */
  packagePath: string;
  /** 展示用路径（~ 开头） */
  displayDir: string;
}

export function resolveDshProfile(home = homedir(), profile = DSH_PROFILE_DEFAULT): DshProfileLocation {
  const dir = join(home, '.dsh', 'profiles', profile);
  return {
    profile, dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    packagePath: join(dir, 'package.json'),
    displayDir: `~/.dsh/profiles/${profile}`,
  };
}

// ── 文本工具 ────────────────────────────────────────────────────────────────

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function indentOf(line: string): number {
  const m = /^[ ]*/.exec(line);
  return m ? m[0].length : 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) {
    return t.slice(1, -1);
  }
  return t;
}

/** 端点归一：去引号、去尾斜杠（`http://x/mcp` 与 `http://x/mcp/` 视为同一个端点） */
function normalizeEndpoint(v: string): string {
  return unquote(v).replace(/\/+$/, '');
}

/** 把条目正文压成一行做正则提取：YAML 会把长值折行（如 Authorization: Bearer + 缩进的令牌），
 *  折行会让逐行正则漏掉令牌，先合并连续空白再匹配。 */
function flatten(lines: string[]): string {
  return lines.join('\n').replace(/\r?\n\s+/g, ' ');
}

function readText(path: string): { text: string | null; error?: string } {
  try {
    const text = readFileSync(path, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) return { text: null, error: '配置文件超过 4 MiB，拒绝读取/写入' };
    return { text };
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return { text: null };
    return { text: null, error: String((e as Error)?.message ?? e) };
  }
}

function pruneBackups(path: string): void {
  try {
    const base = basename(path);
    const stale = readdirSync(dirname(path))
      .filter((f) => f.startsWith(`${base}.bak-`))
      .sort()
      .reverse()
      .slice(MAX_BACKUPS_PER_CONFIG);
    for (const f of stale) rmSync(join(dirname(path), f), { force: true });
  } catch {
    /* 清理失败不影响本次写入 */
  }
}

/** 备份 + 临时文件 + rename 原子替换（与 mcpClients 的写入路径同口径，此处自带一份以避开循环依赖） */
function writeFileAtomic(
  path: string, text: string, now: number,
): { ok: true; backupPath?: string } | { ok: false; error: string } {
  const existed = existsSync(path);
  let backupPath: string | undefined;
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (existed) {
      const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
      backupPath = `${path}.bak-${stamp}`;
      copyFileSync(path, backupPath);
    }
    writeFileSync(tmp, text, 'utf8');
    renameSync(tmp, path);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* 已不存在或被占用：忽略 */ }
    return { ok: false, error: `写入失败：${String((e as Error)?.message ?? e)}` };
  }
  pruneBackups(path);
  return { ok: true, ...(backupPath ? { backupPath } : {}) };
}

// ── cordis.patch.yml：memagent 行的定位与重写 ────────────────────────────────

export interface DshPatchPlan {
  yaml: string;
  changed: boolean;
  /** inserted=新加了一行；updated=已有行被改写（含删掉遗留的 fold 头）；unchanged=完全一致；conflict=指向别的端点，拒绝覆盖 */
  action: 'inserted' | 'updated' | 'unchanged' | 'conflict';
  foundUrl?: string;
}

interface EntryRange {
  start: number;
  /** 不含（条目最后一行的下一行） */
  end: number;
  /** `- id:` 这一行 `-` 的缩进 */
  indent: number;
}

/** 定位 memagent 条目：从 `- id: memagent-mcp` 起，到下一个缩进不大于它的非空行为止 */
function findEntry(lines: string[]): EntryRange | null {
  const re = new RegExp(`^\\s*-\\s+id:\\s*${escapeRe(DSH_MCP_ROW_ID)}\\s*$`);
  const start = lines.findIndex((l) => re.test(l));
  if (start === -1) return null;
  const indent = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') { end++; continue; }
    if (indentOf(line) <= indent) break;
    end++;
  }
  // 尾随空行属于后面的内容，不并进条目
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  return { start, end, indent };
}

interface InsertBlock {
  start: number;
  /** 不含 */
  end: number;
  /** 块内子条目的缩进（没有子条目时按 4 空格） */
  entryIndent: number;
}

/** 定位 `- insert:` 块（DSH 用它把第三方插件行插进配置） */
function findInsertBlock(lines: string[]): InsertBlock | null {
  const start = lines.findIndex((l) => /^-\s+insert:\s*$/.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') { end++; continue; }
    if (indentOf(line) === 0 && /^-\s/.test(line)) break;
    end++;
  }
  while (end > start + 1 && lines[end - 1].trim() === '') end--;
  const firstChild = lines.slice(start + 1, end).find((l) => /^\s*-\s/.test(l));
  return { start, end, entryIndent: firstChild ? indentOf(firstChild) : 4 };
}

/** 生成 memagent 条目（不含 X-Memagent-Render: fold —— DSH 渲染不了 HTML 折叠，2026-11-26 代码级定论） */
function renderMcpEntryLines(entryIndent: number, endpoint: string, token: string): string[] {
  const p0 = ' '.repeat(entryIndent);
  const p2 = ' '.repeat(entryIndent + 2);
  const p4 = ' '.repeat(entryIndent + 4);
  const p6 = ' '.repeat(entryIndent + 6);
  return [
    `${p0}- id: ${DSH_MCP_ROW_ID}`,
    `${p2}name: '${DSH_MCP_PLUGIN_NAME}'`,
    `${p2}config:`,
    `${p4}serverName: ${DSH_MCP_SERVER_NAME}`,
    `${p4}transport: streamable-http`,
    `${p4}url: ${endpoint}`,
    `${p4}headers:`,
    `${p6}Authorization: Bearer ${token}`,
    `${p6}${DSH_CLIENT_HEADER}: ${DSH_CLIENT_ID}`,
    `${p4}failOnStartupError: false`,
  ];
}

/**
 * 纯函数：把 memagent 行幂等并入 cordis.patch.yml 文本。
 *  · 已有该行 → 原地整块重写（顺带删掉遗留的 fold 头 / 折行的旧令牌写法）；
 *  · 有 `- insert:` 块但没该行 → 追加到该块末尾（不另起一个 insert）；
 *  · 都没有 → 文件末尾追加新的 `- insert:` 块。
 *  · 已有行的 url 指向别的端点 → conflict，原文一字不改（拒绝覆盖别人的配置）。
 */
export function planDshPatch(existing: string | null, opts: { token: string; endpoint: string }): DshPatchPlan {
  const endpoint = opts.endpoint;
  const token = opts.token.trim();
  const source = existing ?? '';
  const eol = detectEol(source);
  const lines = source.length === 0 ? [] : source.replace(/\r?\n$/, '').split(/\r?\n/);
  const finish = (out: string[]): string => `${out.join(eol)}${eol}`;

  const entry = findEntry(lines);
  if (entry) {
    const current = lines.slice(entry.start, entry.end);
    const flat = flatten(current);
    const foundUrl = /\burl:\s*(\S+)/.exec(flat)?.[1];
    if (foundUrl !== undefined && normalizeEndpoint(foundUrl) !== normalizeEndpoint(endpoint)) {
      return { yaml: source, changed: false, action: 'conflict', foundUrl: unquote(foundUrl) };
    }
    const next = renderMcpEntryLines(entry.indent, endpoint, token);
    if (current.length === next.length && current.every((l, i) => l === next[i])) {
      return { yaml: source, changed: false, action: 'unchanged' };
    }
    const out = [...lines.slice(0, entry.start), ...next, ...lines.slice(entry.end)];
    return { yaml: finish(out), changed: true, action: 'updated' };
  }

  const block = findInsertBlock(lines);
  const next = renderMcpEntryLines(block ? block.entryIndent : 4, endpoint, token);
  if (block) {
    const out = [...lines.slice(0, block.end), ...next, ...lines.slice(block.end)];
    return { yaml: finish(out), changed: true, action: 'inserted' };
  }
  const lead = lines.length > 0 ? [''] : [];
  const header = `# MultiAgent Memory MCP（${DSH_MCP_SERVER_NAME}）：${endpoint}，Bearer 令牌见数据根 mcp-token.txt（轮换后重跑一键接入即同步）`;
  return { yaml: finish([...lines, ...lead, header, '- insert:', ...next]), changed: true, action: 'inserted' };
}

// ── profile package.json：登记插件 ──────────────────────────────────────────

export interface DshPackagePlan {
  json: string;
  changed: boolean;
  error?: string;
}

/** 纯函数：把折叠卡插件登记进 profile package.json 的 dependencies 与 dsh.profile.bundles。
 *  只增/只改本插件这一项；其它依赖、bundles 顺序与其它字段原样保留。 */
export function planDshPackage(existing: string | null): DshPackagePlan {
  const text = existing ?? '';
  let parsed: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      const v = JSON.parse(text) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { json: text, changed: false, error: 'package.json 顶层不是对象' };
      parsed = v as Record<string, unknown>;
    } catch (e) {
      return { json: text, changed: false, error: `package.json 无法解析：${String((e as Error)?.message ?? e)}` };
    }
  }
  const before = JSON.stringify(parsed);
  const depsRaw = parsed.dependencies;
  const deps = depsRaw && typeof depsRaw === 'object' && !Array.isArray(depsRaw)
    ? { ...(depsRaw as Record<string, unknown>) } : {};
  deps[DSH_RECALL_CARD_PKG] = DSH_RECALL_CARD_DEP;
  parsed.dependencies = deps;
  const dshRaw = parsed.dsh;
  const dsh = dshRaw && typeof dshRaw === 'object' && !Array.isArray(dshRaw)
    ? { ...(dshRaw as Record<string, unknown>) } : {};
  const profileRaw = dsh.profile;
  const profile = profileRaw && typeof profileRaw === 'object' && !Array.isArray(profileRaw)
    ? { ...(profileRaw as Record<string, unknown>) } : {};
  const bundles = Array.isArray(profile.bundles) ? [...profile.bundles] : [];
  if (!bundles.includes(DSH_RECALL_CARD_PKG)) bundles.push(DSH_RECALL_CARD_PKG);
  profile.bundles = bundles;
  dsh.profile = profile;
  parsed.dsh = dsh;
  const changed = JSON.stringify(parsed) !== before;
  return { json: `${JSON.stringify(parsed, null, 2)}\n`, changed };
}

// ── 插件复制（复制而非 link） ───────────────────────────────────────────────

export interface DshPluginInstall {
  ok: boolean;
  changed: boolean;
  /** DSH 实际加载的位置（profile 内 node_modules/@local/memagent-recall-card） */
  path: string;
  /** profile 内的稳定副本（package.json 的 file: 依赖指向它） */
  vendorPath: string;
  files: number;
  error?: string;
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** 删掉目标：链接只删链接本身（绝不顺着 link 删到仓库里去），普通目录整棵删 */
function removePath(path: string): void {
  if (!existsSync(path) && !isLink(path)) return;
  if (isLink(path)) { unlinkSync(path); return; }
  rmSync(path, { recursive: true, force: true });
}

function listFiles(root: string, base = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(root, name);
    const st = lstatSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, base));
    else if (st.isFile()) out.push(relative(base, full).split('\\').join('/'));
  }
  return out.sort();
}

/** 目录内容一致（文件名集合 + 逐字节；目标是链接一律视为不一致，强制换成真实副本） */
function dirContentEqual(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b) || isLink(b)) return false;
  const want = listFiles(a);
  const have = listFiles(b);
  if (have.length !== want.length) return false;
  if (have.some((f, i) => f !== want[i])) return false;
  try {
    return want.every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
  } catch {
    return false;
  }
}

/**
 * 把插件源目录复制进 profile（幂等：内容一致就不动）。
 * 两段落地：源 → profile/vendor/…（package.json 的 file: 依赖指向这里，仓库挪走也不影响）
 *          → profile/node_modules/@local/…（DSH 实际从这里加载）。
 * 绝不 link 回仓库：仓库一挪就是悬空链接，插件静默不加载（2026-11-26 实机事故）。
 */
export function installRecallCard(loc: DshProfileLocation, sourceDir: string): DshPluginInstall {
  const vendorPath = join(loc.dir, DSH_PLUGIN_VENDOR_REL);
  const target = join(loc.dir, 'node_modules', '@local', 'memagent-recall-card');
  if (!existsSync(join(sourceDir, 'package.json')) || !existsSync(join(sourceDir, 'client.js'))) {
    return {
      ok: false, changed: false, path: target, vendorPath, files: 0,
      error: `插件源目录不完整（缺 package.json 或 client.js）：${sourceDir}`,
    };
  }
  try {
    let changed = false;
    // ① 源 → profile/vendor（package.json 的 file: 依赖指向这里，仓库挪走也不影响）
    if (!dirContentEqual(sourceDir, vendorPath)) {
      mkdirSync(dirname(vendorPath), { recursive: true });
      removePath(vendorPath);
      cpSync(sourceDir, vendorPath, {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src),
      });
      changed = true;
    }
    // ② vendor → node_modules（DSH 实际从这里加载；目标若是旧 junction，只删链接本身）
    if (!dirContentEqual(vendorPath, target)) {
      mkdirSync(dirname(target), { recursive: true });
      removePath(target);
      cpSync(vendorPath, target, {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src),
      });
      changed = true;
    }
    return { ok: true, changed, path: target, vendorPath, files: listFiles(vendorPath).length };
  } catch (e) {
    return {
      ok: false, changed: false, path: target, vendorPath, files: 0,
      error: `复制插件失败：${String((e as Error)?.message ?? e)}`,
    };
  }
}

/** 插件源目录候选：打包后优先 resources，开发/未打包回落到仓库根 */
export function resolveRecallCardSource(candidates?: string[]): string | null {
  const list = candidates ?? defaultRecallCardCandidates();
  for (const dir of list) {
    if (dir && existsSync(join(dir, 'package.json'))) return dir;
  }
  return null;
}

function defaultRecallCardCandidates(): string[] {
  const out: string[] = [];
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) out.push(join(resources, DSH_PLUGIN_SOURCE_RELATIVE));
  out.push(join(process.cwd(), DSH_PLUGIN_SOURCE_RELATIVE));
  const execPath = process.execPath;
  if (execPath) out.push(join(dirname(execPath), DSH_PLUGIN_SOURCE_RELATIVE));
  return out;
}

// ── 一键接入 / 状态探测 ────────────────────────────────────────────────────

export interface DshWireOptions {
  home?: string;
  profile?: string;
  endpoint: string;
  token: string;
  /** 插件源目录；缺省按 resources → 仓库根 顺序自动找 */
  pluginSourceDir?: string;
  now?: number;
}

export interface DshWireResult {
  ok: boolean;
  changed: boolean;
  profileDir: string;
  patchPath: string;
  backupPath?: string;
  action?: DshPatchPlan['action'];
  plugin?: DshPluginInstall;
  error?: string;
}

/**
 * 一键接入：写 MCP 行 + 复制折叠卡插件 + 登记 package.json。
 * 顺序刻意是「先 MCP 行，后插件」：插件失败不影响 MCP 能连（卡片没了但记忆库还能召回），
 * 失败原因如实放进 plugin.error，绝不假装插件装好了。
 */
export function wireDshProfile(opts: DshWireOptions): DshWireResult {
  const loc = resolveDshProfile(opts.home ?? homedir(), opts.profile ?? DSH_PROFILE_DEFAULT);
  if (!existsSync(loc.dir)) {
    return {
      ok: false, changed: false, profileDir: loc.dir, patchPath: loc.patchPath,
      error: `未找到 DSH profile 目录（${loc.displayDir}）——请先启动一次 deepseek harness 桌面端再接入`,
    };
  }
  const read = readText(loc.patchPath);
  if (read.error) return { ok: false, changed: false, profileDir: loc.dir, patchPath: loc.patchPath, error: read.error };

  const plan = planDshPatch(read.text, { token: opts.token, endpoint: opts.endpoint });
  if (plan.action === 'conflict') {
    return {
      ok: false, changed: false, profileDir: loc.dir, patchPath: loc.patchPath, action: 'conflict',
      error: `同名条目指向其它端点（${plan.foundUrl ?? '未填写'}），拒绝覆盖`,
    };
  }

  let changed = false;
  let backupPath: string | undefined;
  if (plan.changed) {
    const w = writeFileAtomic(loc.patchPath, plan.yaml, opts.now ?? Date.now());
    if (!w.ok) return { ok: false, changed: false, profileDir: loc.dir, patchPath: loc.patchPath, error: w.error };
    changed = true;
    backupPath = w.backupPath;
  }

  const sourceDir = opts.pluginSourceDir ?? resolveRecallCardSource();
  let plugin: DshPluginInstall;
  if (!sourceDir) {
    plugin = {
      ok: false, changed: false, path: join(loc.dir, 'node_modules', '@local', 'memagent-recall-card'),
      vendorPath: join(loc.dir, DSH_PLUGIN_VENDOR_REL), files: 0,
      error: '未找到折叠卡插件源目录（dsh-plugins/memagent-recall-card）——MCP 行已写入，但卡片不会出现',
    };
  } else {
    plugin = installRecallCard(loc, sourceDir);
    if (plugin.ok) {
      const pkgRead = readText(loc.packagePath);
      if (pkgRead.error) {
        plugin = { ...plugin, ok: false, error: `插件已复制，但 profile package.json 读取失败：${pkgRead.error}` };
      } else {
        const pp = planDshPackage(pkgRead.text);
        if (pp.error) {
          plugin = { ...plugin, ok: false, error: `插件已复制，但 profile package.json 无法登记：${pp.error}` };
        } else if (pp.changed) {
          const w = writeFileAtomic(loc.packagePath, pp.json, opts.now ?? Date.now());
          if (!w.ok) {
            plugin = { ...plugin, ok: false, error: `插件已复制，但 package.json 写入失败：${w.error}` };
          } else {
            changed = true;
            plugin = { ...plugin, changed: true };
            if (!backupPath) backupPath = w.backupPath;
          }
        }
      }
    }
  }

  return {
    ok: true, changed, profileDir: loc.dir, patchPath: loc.patchPath,
    ...(backupPath ? { backupPath } : {}),
    action: plan.action,
    plugin,
  };
}

export interface DshProfileProbe {
  state: McpWireState;
  profileDir: string;
  patchPath: string;
  displayPath: string;
  hasAuth: boolean;
  foundUrl?: string;
  /** 配置里还留着 X-Memagent-Render: fold（DSH 渲染不了，应清掉） */
  hasFoldHeader?: boolean;
  /** 折叠卡插件是否已装进该 profile 的 node_modules */
  pluginInstalled: boolean;
  error?: string;
  note?: string;
}

/** 只读探测：按真实文件内容判定 DSH 接入状态（七态契约不变，不返回令牌） */
export function probeDshProfile(opts: {
  home?: string; profile?: string; endpoint: string; currentToken?: string;
}): DshProfileProbe {
  const loc = resolveDshProfile(opts.home ?? homedir(), opts.profile ?? DSH_PROFILE_DEFAULT);
  const pluginInstalled = existsSync(join(loc.dir, 'node_modules', '@local', 'memagent-recall-card', 'client.js'));
  const base = {
    profileDir: loc.dir,
    patchPath: loc.patchPath,
    displayPath: `${loc.displayDir}/cordis.patch.yml`,
    hasAuth: false,
    pluginInstalled,
  };
  if (!existsSync(loc.patchPath)) return { ...base, state: 'no_config' };
  const read = readText(loc.patchPath);
  if (read.error) return { ...base, state: 'invalid', error: read.error };
  const lines = (read.text ?? '').replace(/\r?\n$/, '').split(/\r?\n/);
  const entry = findEntry(lines);
  if (!entry) return { ...base, state: 'missing_entry' };
  const flat = flatten(lines.slice(entry.start, entry.end));
  const foundUrl = /\burl:\s*(\S+)/.exec(flat)?.[1];
  if (foundUrl !== undefined && normalizeEndpoint(foundUrl) !== normalizeEndpoint(opts.endpoint)) {
    return { ...base, state: 'conflict', foundUrl: unquote(foundUrl) };
  }
  const auth = /Authorization:\s*Bearer\s+(\S+)/.exec(flat)?.[1];
  if (auth === undefined) return { ...base, state: 'missing_auth', hasAuth: false };
  const hasFoldHeader = /X-Memagent-Render:\s*fold/i.test(flat);
  if (opts.currentToken && auth.trim() !== opts.currentToken.trim()) {
    return {
      ...base, state: 'missing_auth', hasAuth: true,
      ...(hasFoldHeader ? { hasFoldHeader } : {}),
      note: '配置中的令牌与当前 mcp-token.txt 不一致（可能已轮换），一键适配可自动补齐',
    };
  }
  return {
    ...base, state: 'wired', hasAuth: true,
    ...(hasFoldHeader
      ? { hasFoldHeader, note: '配置里还留着 X-Memagent-Render: fold —— DSH 渲染不了 HTML 折叠（2026-11-26 代码级定论），一键接入会删掉它' }
      : {}),
  };
}
