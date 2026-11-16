// MCP 钩子健康度自检（第 13 个工具 `recall_hook_status`）。
//
// 为什么需要它：强制召回钩子（force_recall.mjs）跑在**宿主侧**（CodeBuddy / WorkBuddy 拉起的
// node 子进程），不在本服务进程内。它失败时只往本机状态文件写一条记录 —— Agent 侧完全看不见，
// 用户也只有去参数页点开卡片才看得到。结果就是「钩子坏了没人知道」，本项目历史上已因此反复复发
// （钩子路径少写 `.unpacked`，`exists: False` + `MODULE_NOT_FOUND`，钩子静默失效多日）。
//
// 本工具把状态文件变成 Agent 可主动查询的事实源，关键是那个「查不到」的结论：
//   - 有记录且 ok/empty  → 钩子确实在跑
//   - 有记录但 failed    → 钩子在跑但本轮没生效，必须向用户说明
//   - 没有状态文件       → 钩子**从未跑过**（没装 / 路径写错 / 从没触发），最危险，必须明说
// 绝不把「读不到文件」粉饰成「一切正常」。
import { readFileSync } from 'node:fs';
import { HOOK_STATUS_FILE, hookStatusFilePath } from './recallHook.ts';
import { parseHookRunState, type HookFailReason, type HookRunState } from './recallPrelude.ts';

/** 超过这个时长没有新记录 → 判 stale（钩子可能被卸载或宿主配置被改）。 */
export const HOOK_STATUS_STALE_MS = 12 * 60 * 60 * 1000;

export type HookVerdict = 'ok' | 'empty' | 'failed' | 'stale' | 'never_ran';

export interface HookStatusReport {
  ok: true;
  hook: 'force_recall';
  /** never_ran 是本工具最有价值的结论：状态文件不存在 = 钩子从没跑过 */
  verdict: HookVerdict;
  last_run: HookRunState | null;
  /** 距上次执行多少毫秒；无记录为 null */
  age_ms: number | null;
  status_file: string;
  /** 一句话人话结论，Agent 可直接转述给用户 */
  summary: string;
  /** 给 Agent 的行动指引：什么时候必须向用户说明「本轮钩子没生效」 */
  advice: string;
  /** 读状态文件时出的错（仅诊断用，不含任何令牌或 prompt 正文） */
  probe_error?: string;
}

export interface HookStatusDeps {
  /** 状态文件绝对路径；缺省与钩子同一真源（env 覆盖 > 数据根） */
  statusFilePath?: string;
  /** 读文件注入，便于单测 */
  readText?: (path: string) => string;
  /** 当前时间注入，便于单测 */
  now?: () => number;
}

/** 失败原因中文唯一表（与桌面端 RecallHardCard 的 FAIL_REASON_ZH 同口径）。 */
const REASON_ZH: Record<HookFailReason, string> = {
  empty_input: '没有收到提问内容',
  bad_event: '宿主传入的事件格式不对',
  loopback_guard: 'MCP 地址不是本机回环，按安全规则跳过',
  token_missing: '读不到 MCP 令牌',
  rpc_error: '连不上记忆库服务（MCP 未启动或端口不通）',
  bad_response: '记忆库返回内容无法解析',
  unknown: '未知原因',
};

export function hookReasonZh(reason?: string): string {
  if (!reason) return REASON_ZH.unknown;
  return REASON_ZH[reason as HookFailReason] ?? REASON_ZH.unknown;
}

function fmtTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString('zh-CN', { hour12: false });
}

function fmtAge(ms: number): string {
  if (ms < 60_000) return '不到 1 分钟前';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}

const ADVICE_BAD = '必须如实告知用户「本轮强制召回未生效，我已回退现查」，不要让用户以为记忆库已经检过；同时提示他到桌面端参数页「硬前置召回」核对安装态。';
const ADVICE_GOOD = '钩子工作正常，无需额外提示用户。';

/**
 * 读本机状态文件并给出结论。**任何情况下都不抛**：读不到就是读不到，
 * 用 verdict + probe_error 诚实表达，绝不降级成「正常」。
 */
export function runHookStatusTool(deps: HookStatusDeps = {}): HookStatusReport {
  const path = deps.statusFilePath ?? hookStatusFilePath();
  const readText = deps.readText ?? ((p: string): string => readFileSync(p, 'utf8'));
  const nowMs = deps.now ? deps.now() : Date.now();

  let raw: string | null = null;
  let probeError: string | undefined;
  try {
    raw = readText(path);
  } catch (e) {
    const code = (e as { code?: unknown })?.code;
    // ENOENT 是正常情况（钩子从未跑过），不是错误；其它读失败要留痕但同样不抛。
    if (code !== 'ENOENT') probeError = `读取状态文件失败：${String((e as Error)?.message ?? e).slice(0, 120)}`;
  }

  const state = parseHookRunState(raw);
  if (raw !== null && state === null && !probeError) {
    probeError = '状态文件内容无法解析（可能与当前 schema 不兼容或已损坏）';
  }

  if (!state) {
    const summary = probeError
      ? `没有可信的钩子执行记录：${probeError}。无法确认强制召回是否生效。`
      : '从未记录到钩子执行（状态文件不存在）。说明钩子要么还没安装、要么安装路径写错、要么一次都没触发过——这种情况下「首步强制召回」完全没有生效。';
    return {
      ok: true,
      hook: 'force_recall',
      verdict: 'never_ran',
      last_run: null,
      age_ms: null,
      status_file: path,
      summary,
      advice: ADVICE_BAD,
      ...(probeError ? { probe_error: probeError } : {}),
    };
  }

  const atMs = Date.parse(state.at);
  const age = Number.isNaN(atMs) ? null : Math.max(0, nowMs - atMs);

  if (state.status === 'failed') {
    return {
      ok: true,
      hook: 'force_recall',
      verdict: 'failed',
      last_run: state,
      age_ms: age,
      status_file: path,
      summary: `上次钩子执行失败：${hookReasonZh(state.reason)}（${fmtTime(state.at)}${age === null ? '' : `，${fmtAge(age)}`}）。这一轮的首步强制召回没有生效。`,
      advice: ADVICE_BAD,
    };
  }

  if (age !== null && age > HOOK_STATUS_STALE_MS) {
    return {
      ok: true,
      hook: 'force_recall',
      verdict: 'stale',
      last_run: state,
      age_ms: age,
      status_file: path,
      summary: `上次钩子执行在${fmtAge(age)}（${fmtTime(state.at)}，结果：${state.status === 'ok' ? `注入 ${state.hits} 条` : '零命中'}），此后没有新记录——钩子可能已被卸载、宿主配置被改，或期间根本没有新提问。`,
      advice: ADVICE_BAD,
    };
  }

  if (state.status === 'ok') {
    return {
      ok: true,
      hook: 'force_recall',
      verdict: 'ok',
      last_run: state,
      age_ms: age,
      status_file: path,
      summary: `上次钩子执行成功，注入 ${state.hits} 条记忆（${fmtTime(state.at)}${age === null ? '' : `，${fmtAge(age)}`}）。`,
      advice: ADVICE_GOOD,
    };
  }

  return {
    ok: true,
    hook: 'force_recall',
    verdict: 'empty',
    last_run: state,
    age_ms: age,
    status_file: path,
    summary: `上次钩子执行成功但零命中（${fmtTime(state.at)}${age === null ? '' : `，${fmtAge(age)}`}）——这是钩子正常工作的表现，不代表失败。`,
    advice: ADVICE_GOOD,
  };
}

/** 状态文件名（供主进程拼路径，避免各处重复字面量）。 */
export const HOOK_STATUS_FILENAME = HOOK_STATUS_FILE;
