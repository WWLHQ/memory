// 宿主钩子自动注入框架（2026-11-23 · 原子任务 24a）
//
// 目标：安装/启动后，把「已确认可用」的钩子脚本自动注入到本机已确认宿主的 settings.json，
//       不再依赖用户手工把 .mjs 放进数据根、再手工加 hooks 条目。
//
// 设计红线（延续 recallHard.ts 的失败锁与「绝不伪造数据」）：
//   1. 只注入注册表里、且源脚本真实存在的钩子；脚本缺失绝不在宿主配置里写死路径。
//   2. 按 tag 幂等 upsert：已装且指向正确路径 → 不重写（保留宿主外部改动）；路径变了 → 重写。
//   3. 只按 tag 摘除/追加本框架管的条目，别人的钩子、其它事件、顶层键逐字保留。
//   4. 宿主配置坏 JSON → 拒绝改写（不猜、不覆盖用户文件）。
//   5. 写后回读校验：写盘成功 ≠ 内容还在（2026-11-16 实测宿主会用内存旧配置盖回）。
//   6. 宿主探测：只对「已确认支持 hooks 协议」的宿主注入；配置不存在/无 hooks 段一律跳过，禁盲写。
//   7. 本模块是纯 IO 编排 + 纯函数，不接 main.ts 启动链路（接线是 24b，需单独确认）。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureStableHookScript, type StableHookScriptDeps } from './recallHookScript.ts';

/** 宿主事件名（与 WorkBuddy / Claude Code settings.json 的 hooks 键一致）。 */
export type HookEvent = 'UserPromptSubmit' | 'Stop';

/**
 * 钩子注册表——五个钩子的唯一真源。
 * force_recall 由 recallHard.ts 单独管（已有 A 开关/UI），本框架从 v1 起也纳管它，
 * 但通过同一 tag 幂等，不会与 recallHard 的条目重复（见 mergeAllHostHooks 去重）。
 */
export interface HostHookSpec {
  /** 稳定副本文件名 = 幂等识别 tag（含 .mjs，唯一） */
  tag: string;
  /** 注入到宿主的哪个事件 */
  event: HookEvent;
  /** 钩子超时（秒） */
  timeout: number;
  /** 职责人话（日志/UI，不进宿主配置） */
  role: string;
  /** 是否默认随注入启用（false = 需显式 opt-in） */
  defaultOn: boolean;
}

export const HOST_HOOK_REGISTRY: readonly HostHookSpec[] = [
  { tag: 'force_recall.mjs', event: 'UserPromptSubmit', timeout: 5, role: '首步强制召回', defaultOn: true },
  { tag: 'session_review_patch.mjs', event: 'UserPromptSubmit', timeout: 5, role: '复盘补漏（提问前）', defaultOn: true },
  { tag: 'session_review.mjs', event: 'Stop', timeout: 10, role: '复盘沉淀闸门（收尾）', defaultOn: true },
  { tag: 'auto_feedback.mjs', event: 'Stop', timeout: 10, role: '自动反馈采集', defaultOn: false },
  { tag: 'fold_card_check.mjs', event: 'Stop', timeout: 10, role: '召回折叠卡合规', defaultOn: true },
] as const;

/** 宿主探测结论：只认已确认支持 hooks 协议的宿主。 */
export interface HookCapableHost {
  id: string;
  settingsPath: string;
  /** 配置文件是否已存在且有 hooks 对象（=已确认宿主，允许注入） */
  confirmed: boolean;
  reason: string;
}

export interface HostProbeDeps {
  exists?: (p: string) => boolean;
  readText?: (p: string) => string;
  home?: () => string;
}

/**
 * 探测本机已确认宿主。当前只实现 WorkBuddy（高可行性，hooks 协议已验证）。
 * Claude Code / CodeBuddy 的 settings.json 存在但无 hooks 段、事件 schema 未验证 → 明确标 unconfirmed，
 * 绝不盲写；Qoder / OpenCode 无确认协议 → 不进候选。
 */
export function probeHookHosts(deps: HostProbeDeps = {}): HookCapableHost[] {
  const exists = deps.exists ?? ((p: string) => existsSync(p));
  const readText = deps.readText ?? ((p: string) => readFileSync(p, 'utf8'));
  const home = deps.home ?? (() => process.env.USERPROFILE || process.env.HOME || '');
  const candidates: { id: string; rel: string }[] = [
    { id: 'workbuddy', rel: '.workbuddy/settings.json' },
    { id: 'claude-code', rel: '.claude/settings.json' },
    { id: 'codebuddy', rel: '.codebuddy/settings.json' },
  ];
  const out: HookCapableHost[] = [];
  for (const c of candidates) {
    const settingsPath = join(home(), c.rel);
    if (!exists(settingsPath)) {
      out.push({ id: c.id, settingsPath, confirmed: false, reason: '配置文件不存在' });
      continue;
    }
    let hasHooks = false;
    try {
      const j = JSON.parse(readText(settingsPath)) as Record<string, unknown>;
      hasHooks = !!j.hooks && typeof j.hooks === 'object' && !Array.isArray(j.hooks);
    } catch {
      out.push({ id: c.id, settingsPath, confirmed: false, reason: '配置不是合法 JSON' });
      continue;
    }
    // 只有 WorkBuddy 的 hooks 事件 schema 已验证；其它宿主即便有 hooks 段也先标未确认。
    if (c.id === 'workbuddy' && hasHooks) {
      out.push({ id: c.id, settingsPath, confirmed: true, reason: 'WorkBuddy hooks 协议已验证' });
    } else if (hasHooks) {
      out.push({ id: c.id, settingsPath, confirmed: false, reason: 'hooks 事件 schema 未验证，暂不注入' });
    } else {
      out.push({ id: c.id, settingsPath, confirmed: false, reason: '无 hooks 段' });
    }
  }
  return out;
}

/** 把宿主配置里含某 tag 的 command 条目摘出来（逐字符串找，兼容路径含空格与 JSON 二次转义）。 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') { out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out); return; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) collectStrings(v, out); }
}

function entryHasTag(entry: unknown, tag: string): boolean {
  const strs: string[] = [];
  collectStrings(entry, strs);
  return strs.some((s) => s.includes(tag));
}

/** 从某条 command 里取出钩子脚本路径（优先引号内整段，兼容空格路径）。 */
export function extractTagPath(cmd: string, tag: string): string | null {
  const quoted = cmd.match(new RegExp(`["']([^"']*${escapeRe(tag)})["']`, 'i'));
  if (quoted) return quoted[1];
  const bare = cmd.match(new RegExp(`([^\\s"',}]*${escapeRe(tag)})`, 'i'));
  return bare ? bare[1] : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 路径归一：反斜杠→斜杠并小写，便于开发态/打包态等同比较。 */
function normPath(p: string): string {
  return p.replace(/\\\\/g, '\\').replace(/\\/g, '/').toLowerCase();
}

export interface MergeResult {
  config: Record<string, unknown>;
  /** 本次实际改写：新增/路径修正/移除的 tag 列表 */
  changedTags: string[];
  /** 幂等：已装且路径正确的 tag */
  keptTags: string[];
}

/**
 * 按注册表幂等合并宿主 hooks。
 * @param current 宿主当前配置对象
 * @param enabled tag→是否启用（缺省用注册表 defaultOn）
 * @param scriptPath tag→稳定副本绝对路径
 */
export function mergeAllHostHooks(
  current: Record<string, unknown>,
  enabled: Record<string, boolean>,
  scriptPath: (tag: string) => string,
): MergeResult {
  const next = { ...current };
  const rawHooks = current.hooks && typeof current.hooks === 'object' && !Array.isArray(current.hooks)
    ? current.hooks as Record<string, unknown> : {};
  const hooks: Record<string, unknown[]> = {};
  for (const [ev, arr] of Object.entries(rawHooks)) {
    hooks[ev] = Array.isArray(arr) ? [...arr] as unknown[] : [];
  }
  const changedTags: string[] = [];
  const keptTags: string[] = [];
  const allTags = new Set(HOST_HOOK_REGISTRY.map((s) => s.tag));

  for (const spec of HOST_HOOK_REGISTRY) {
    const ev = spec.event;
    const list = hooks[ev] ?? (hooks[ev] = []);
    const on = enabled[spec.tag] ?? spec.defaultOn;
    const want = normPath(scriptPath(spec.tag));

    // 找本 tag 已装的条目（可能多个，全部收敛成一个）
    const installed = list.filter((e) => entryHasTag(e, spec.tag));
    const installedPath = (() => {
      for (const e of installed) {
        const strs: string[] = [];
        collectStrings(e, strs);
        for (const s of strs) {
          const p = extractTagPath(s, spec.tag);
          if (p) return p;
        }
      }
      return null;
    })();

    // 先摘掉所有本 tag 条目
    const kept = list.filter((e) => !entryHasTag(e, spec.tag));
    if (on) {
      if (installedPath !== null && normPath(installedPath) === want && installed.length === 1) {
        // 已装且路径正确且无重复 → 原样放回，不重写
        kept.push(...installed);
        keptTags.push(spec.tag);
      } else {
        // 缺失 / 路径变了 / 有重复 → 重写为唯一正确条目
        kept.push({ hooks: [{ type: 'command', command: `node "${scriptPath(spec.tag).replace(/\\/g, '/')}"`, timeout: spec.timeout }] });
        changedTags.push(spec.tag);
      }
    } else if (installed.length > 0) {
      changedTags.push(spec.tag); // 显式停用 → 摘除
    }
    hooks[ev] = kept;
  }

  // 清掉空事件数组（不留空壳）；但保留本框架不管理的事件（PreToolUse 等）
  for (const ev of Object.keys(hooks)) {
    if (hooks[ev].length === 0) delete hooks[ev];
  }
  // 二次去重：万一宿主原本在两个事件里都塞了同一 tag，另一个事件里的残留也要清。
  for (const ev of Object.keys(hooks)) {
    hooks[ev] = hooks[ev].filter((entry) => {
      const strs: string[] = [];
      collectStrings(entry, strs);
      return !strs.some((s) => [...allTags].some((t) => s.includes(t) && !eventMatchesTag(ev, t)));
    });
    if (hooks[ev].length === 0) delete hooks[ev];
  }

  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return { config: next, changedTags, keptTags };
}

function eventMatchesTag(ev: string, tag: string): boolean {
  const spec = HOST_HOOK_REGISTRY.find((s) => s.tag === tag);
  return !!spec && spec.event === ev;
}

/** 真值：宿主配置里实际装了哪些 tag（含路径），供回读校验与 state 显示。 */
export function installedHookTags(current: Record<string, unknown> | null): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!current) return out;
  const hooks = current.hooks as Record<string, unknown> | undefined;
  if (!hooks || typeof hooks !== 'object') return out;
  for (const [ev, arr] of Object.entries(hooks)) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      const strs: string[] = [];
      collectStrings(entry, strs);
      for (const s of strs) {
        for (const spec of HOST_HOOK_REGISTRY) {
          if (!s.includes(spec.tag)) continue;
          // 只认注册到该事件的 tag（防串事件误判）
          if (spec.event !== ev) continue;
          const p = extractTagPath(s, spec.tag);
          if (!out.has(spec.tag)) out.set(spec.tag, p);
        }
      }
    }
  }
  return out;
}

export interface StageResult {
  tag: string;
  path: string;
  copied: boolean;
  degraded: boolean;
  note: string;
}

/** 把注册表中所有源脚本稳定化到数据根；返回每个 tag 的最终路径与状态。 */
export function stageAllHookScripts(
  sourceDirFor: (tag: string) => string,
  dataDir: string,
  deps?: StableHookScriptDeps,
): StageResult[] {
  return HOST_HOOK_REGISTRY.map((spec) => {
    const r = ensureStableHookScript(sourceDirFor(spec.tag), dataDir, deps ?? {}, spec.tag);
    return { tag: spec.tag, path: r.path, copied: r.copied, degraded: r.degraded, note: r.note };
  });
}

async function readJsonSafe(path: string): Promise<{ obj: Record<string, unknown> | null; bad: boolean }> {
  if (!existsSync(path)) return { obj: null, bad: false };
  try {
    return { obj: JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>, bad: false };
  } catch {
    return { obj: null, bad: true };
  }
}

export interface InjectResult {
  ok: boolean;
  error?: string;
  host: string;
  changedTags: string[];
  keptTags: string[];
  /** 写后回读不通过（宿主覆盖）的 tag */
  notLanded: string[];
  rewrote: boolean;
}

/**
 * 对一个已确认宿主执行注入：读配置 → 稳定化脚本 → 幂等合并 → 写盘（带 .bak） → 回读校验。
 * 坏 JSON / 未确认宿主 / 源脚本缺失 → 拒绝或跳过，绝不盲写。
 */
export async function injectHooksIntoHost(opts: {
  host: HookCapableHost;
  sourceDirFor: (tag: string) => string;
  dataDir: string;
  enabled?: Record<string, boolean>;
  deps?: StableHookScriptDeps;
  log?: (action: string, detail: Record<string, unknown>) => void;
}): Promise<InjectResult> {
  const { host, sourceDirFor, dataDir, enabled = {} } = opts;
  if (!host.confirmed) {
    return { ok: false, error: `宿主未确认（${host.reason}），拒绝注入`, host: host.id, changedTags: [], keptTags: [], notLanded: [], rewrote: false };
  }
  const { obj: current, bad } = await readJsonSafe(host.settingsPath);
  if (bad) {
    return { ok: false, error: '宿主配置不是合法 JSON，拒绝改写', host: host.id, changedTags: [], keptTags: [], notLanded: [], rewrote: false };
  }

  // 稳定化所有脚本；降级（源不存在）的 tag 从本轮注入中剔除，不写死路径。
  const staged = stageAllHookScripts(sourceDirFor, dataDir, opts.deps);
  const usable = new Map<string, string>();
  const degraded: string[] = [];
  for (const s of staged) {
    if (s.degraded) degraded.push(s.tag);
    else usable.set(s.tag, s.path);
  }
  const effectiveEnabled = { ...enabled };
  for (const tag of degraded) effectiveEnabled[tag] = false; // 源不存在 → 强制停用，绝不写死路径

  const merged = mergeAllHostHooks(current ?? {}, effectiveEnabled, (tag) => usable.get(tag) ?? '');
  const output = JSON.stringify(merged.config, null, 2) + '\n';
  const before = current ? JSON.stringify(current) : null;
  if (before === JSON.stringify(merged.config)) {
    // 幂等：无需写盘
    return { ok: true, host: host.id, changedTags: [], keptTags: merged.keptTags, notLanded: [], rewrote: false };
  }

  try {
    await mkdir(host.settingsPath.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
    if (existsSync(host.settingsPath)) {
      await writeFile(`${host.settingsPath}.bak`, await readFile(host.settingsPath, 'utf8'), 'utf8');
    }
    await writeFile(host.settingsPath, output, 'utf8');
  } catch (e) {
    return {
      ok: false, error: `宿主配置写入失败：${String((e as Error)?.message ?? e).slice(0, 120)}`,
      host: host.id, changedTags: [], keptTags: [], notLanded: [], rewrote: false,
    };
  }
  opts.log?.('host-hook:inject', { host: host.id, changed: merged.changedTags, degraded });

  // 写后回读：逐 tag 校验路径是否落盘（宿主可能用内存旧配置盖回）
  const reread = await readJsonSafe(host.settingsPath);
  const landed = installedHookTags(reread.obj);
  const notLanded: string[] = [];
  for (const tag of merged.changedTags) {
    const want = usable.get(tag);
    const got = landed.get(tag);
    if (!want || !got || normPath(got) !== normPath(want)) notLanded.push(tag);
  }
  if (notLanded.length) {
    opts.log?.('host-hook:not-landed', { host: host.id, tags: notLanded });
  }
  return {
    ok: true, host: host.id, changedTags: merged.changedTags, keptTags: merged.keptTags,
    notLanded, rewrote: true,
  };
}
