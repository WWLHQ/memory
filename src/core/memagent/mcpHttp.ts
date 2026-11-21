// 标准 MCP（Model Context Protocol）streamable-http 服务器
// DSH 的 dsh-mcp-client 用标准 MCP 协议（initialize / tools/list / tools/call）连接，
// 而不是我们私有 TCP JSON-RPC。本端点暴露标准 MCP HTTP（POST /mcp，JSON 响应）。
// 复用 MemAgent 内核（storage 共享主进程 FileStorage），四个工具：
//   recall_memory / write_memory / list_projects / get_preferences
// 批次11/12/13：initialize 下发 MCP_INSTRUCTIONS（关键词触发召回 + 回显提示）；recall 结果末块加回显约束；
//         结果块顺序 = [display.line, 完整 JSON, display.markdown（RAG 统计汇总 + 编号依据 + 折叠明细）, 展示要求]；
//         另附 structuredContent（含背景/省量/金额/折叠明细）。
import { createServer as httpCreateServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createMemAgent } from './agent.ts';
import { InMemoryStorage } from './storage.ts';
import { JsVectorBackend } from './vector.ts';
import { FakeLlmProvider } from './llm.ts';
import { ulid } from './ulid.ts';
import { assertMcpToken, tokenFromHeaders, DEFAULT_MCP_ACCOUNT, projectInScope, type McpAccount } from './mcpAuth.ts';
import { resolveAccountFor, type TokenStorePort } from './tokenStore.ts';
import type { MemberStorePort } from './memberStore.ts';
import {
  mcpInstructions, withRecallFirstNotes, RECALL_FIRST_REMINDER,
  RECALL_FIRST_GATE_MSG, RECALL_FIRST_STRICT_GATE_MSG, RECALL_ROUND_GATE_MSG, RECALL_SOURCE_BOUNDARY,
} from './mcpSchema.ts';
import { readLatestHookRoundAt } from './recallHook.ts';
import { runListProjectsTool, runRecallTool, type RecallDisplayMode } from './mcpRecall.ts';
import { RecallDetailTickets } from './recallDetailTickets.ts';
import { buildRecallDetailExpiredPage } from './recallInsight.ts';
import { rejectUntrustedHost } from '../../shared/localOrigin.ts';
import type { StorageBackend, Pref, L0Port, MemReq, WriteResult, AuditRecord } from './types.ts';
import { CATEGORIES, isCategory } from './types.ts';
import { parseWriteKnobs } from './memories.ts';
import { isL0LockedError } from './errors.ts';
import { MemoryPendingStore, type PendingStore, type WriteKnobs } from './pendingWrites.ts';
import type { PersonalMemoryStore } from './personalStore.ts';
import { runGetMemoryTool, runListMemoriesTool } from './mcpReadTools.ts';
import { deleteAllowed, runFeedbackTool, runManageMemoryTool } from './mcpManageTools.ts';
import { runGcReportTool } from './mcpGcTools.ts';
import { runGrowthEvolveTool } from './mcpGrowthTools.ts';
import { runHookStatusTool } from './mcpHookTools.ts';
import { runCreateProjectTool, runMintTokenTool } from './mcpProjectTools.ts';

const PROTOCOL_VERSION = '2025-06-18';

/** 会话上限（防无限增长；超出后淘汰最早建立的会话） */
const MAX_CLIENT_SESSIONS = 256;

/** 截断/压平调用方标识，避免把超长头写进审计 */
export function normalizeClientLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** initialize.params.clientInfo → "name/version"（MCP 客户端自报，最可信） */
export function clientFromInitialize(params: Record<string, unknown>): string | undefined {
  const info = params.clientInfo;
  if (!info || typeof info !== 'object') return undefined;
  const name = (info as { name?: unknown }).name;
  const version = (info as { version?: unknown }).version;
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const label = `${name}${typeof version === 'string' && version.trim() ? `/${version.trim()}` : ''}`;
  return normalizeClientLabel(label);
}

/** User-Agent 兜底识别（客户端不维护会话时仍能区分主流 Agent；识别不出 → unknown） */
export function clientFromUserAgent(ua: string | undefined): string {
  if (!ua) return 'unknown';
  const low = ua.toLowerCase();
  const known: Array<[string, string]> = [
    ['qoder', 'Qoder'], ['claude', 'Claude Code'], ['codex', 'Codex'], ['cursor', 'Cursor'],
    ['gemini', 'Gemini CLI'], ['qwen', 'Qwen Code'], ['trae', 'Trae'], ['workbuddy', 'WorkBuddy'],
    ['zcode', 'Zcode'], ['deepseek', 'DeepSeek Harness'],
  ];
  const hit = known.find(([pattern]) => low.includes(pattern));
  return hit ? `${hit[1]} (UA)` : 'unknown';
}

/**
 * 批次41-S（方案 A）：UA 是否「有辨识度」——能否据它把「同 UA 最近一次 initialize 的自报名」
 * 归给当前这次调用。通用运行时 UA 一律判否：Node/Electron 的 fetch 默认发字面量 `node`，
 * curl、Python-urllib 等也是多客户端共用的运行时标识，凭它们归并身份会把甲客户端的调用
 * 记成乙客户端的自报名（本机 2026-11-04 实测串号，见 AGENTS §9 批次41-S）。
 * 命中下方前缀/相等即判否；含可识别厂商词（见 `clientFromUserAgent`）的一律判是。
 */
export function isIdentifiableUserAgent(ua: string | undefined): boolean {
  if (!ua) return false;
  const low = ua.trim().toLowerCase();
  if (!low) return false;
  // 明确无辨识度的通用运行时 UA：不相等/不前缀命中即视为有辨识度
  if (low === 'node') return false;
  const genericPrefixes = ['curl/', 'python-urllib/', 'wget/', 'go-http-client/', 'okhttp/', 'java/', 'axios/'];
  if (genericPrefixes.some((p) => low.startsWith(p))) return false;
  // 能认出具体客户端的 UA（含厂商词）保留；其余未知 UA 不作跨请求归并依据（fail-safe）
  return clientFromUserAgent(low) !== 'unknown';
}

/**
 * 批次41-S（方案 B）：自报名是否「已知客户端产品」——首段命中下表即认。
 * 用途：允许「UA 是通用运行时串（如 Electron 主进程发出的 `node`）、且不回传 `Mcp-Session-Id`」
 * 的**合法客户端**凭其在 `initialize` 里的自报名保住身份（否则会被 41-S 方案 A 一律降为 `unknown`，
 * 连带丢掉气泡内联折叠档——用户口径「能内联就内联，做不到才用 HTML 页兜底」）。
 * 与方案 A 的区别只在「信什么」：A 只信有辨识度的 UA；B 额外信**已知产品名**这一类自报名。
 * 任意/探测名（`verify-41r` 这种不在表里的）仍判否——既不覆盖别人的记录，也不会被归并出来。
 * 残留（诚实声明）：同一条通用 UA 键上，若已登记某已知产品，则后续「不带会话头、同 UA」的调用
 * 会被归并成那个产品（本机主要就是 Qoder 宿主一家用 `node`，风险有限；彻底消除需客户端回传会话头，属方案 C）。
 */
const TRUSTED_CLIENT_SELF_IDS = new Set([
  'qoder', 'qoder-cn', 'qoder-desktop-mcp-host', 'claude', 'claude-code', 'codex', 'cursor',
  'gemini', 'gemini-cli', 'qwen', 'qwen-code', 'trae', 'trae-cn', 'workbuddy',
  'zcode', 'deepseek', 'deepseek-harness', 'dsh-mcp-client',
]);
export function isTrustedClientSelfName(client: string | undefined): boolean {
  if (!client) return false;
  const seg = client.split('/')[0].trim().toLowerCase();
  return TRUSTED_CLIENT_SELF_IDS.has(seg);
}

/** 批次41-X：显式身份请求头名。一键接入会把本客户端的规范 id 写进这个头，
 *  于是每次调用都自带身份，不再依赖「同 UA 最近一次 initialize 的自报名」归并（41-S 方案 B 的残留串号）。 */
export const MCP_CLIENT_HEADER = 'x-memagent-client';

/** 允许进字符集之外的头值一律不采信（防把控制字符/超长串写进审计）。 */
const CLIENT_HEADER_VALUE_RE = /^[A-Za-z0-9 ._:/@+-]{1,64}$/;

/**
 * 批次41-X（方案 C）：从显式身份头取调用方身份。
 * 与 UA 归并的区别：这是**每次请求自己声明**的，不共用任何键，因此不存在「甲的调用记成乙」。
 * 仍是自报（不是鉴权，鉴权归令牌）：它只影响「这次调用记在谁名下 + 给哪一档展示格式」，
 * 冒充它拿不到额外数据。取不到/非法值 → undefined，交回原有 会话头 → UA → UA 识别 链，绝不因此拒服务。
 */
export function clientFromExplicitHeader(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const label = normalizeClientLabel(value);
  if (!label || !CLIENT_HEADER_VALUE_RE.test(label)) return undefined;
  return label;
}

/** 2026-11-12（T8）能力声明头：客户端显式声明「我的气泡能渲染折叠」。
 *  为什么需要它：白名单只能收**已实测**渲染 `<details>` 的客户端（DSH 两次实测把标签露成文本，
 *  所以默认 fail-safe）；新客户端 / 自研 agent 不可能都等我们去实测一遍 →
 *  由客户端或接入配置自己声明 `X-Memagent-Render: fold`，一次配置即吃到与 Qoder 相同的折叠档。
 *  取值：fold / html / details / 1 / true（逗号分隔多值时任一命中即可），其余值忽略。 */
export const MCP_RENDER_HEADER = 'x-memagent-render';

export function clientDeclaresFold(raw: string | string[] | undefined): boolean {
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof value !== 'string' || !value.trim()) return false;
  return value.split(',').some((part) => {
    const s = part.trim().toLowerCase();
    return s === 'fold' || s === 'html' || s === 'details' || s === '1' || s === 'true';
  });
}

/** C 方案：严格首步召回门禁的显式声明头。
 *  服务端 opts.strictRecallGate 为全局开关（主进程注入），此头让单个客户端/单次请求也能自证要求严格门禁。
 *  取值 strict / 1 / true；其它值忽略（默认关闭，老客户端逐字不变）。 */
export const MCP_STRICT_GATE_HEADER = 'x-memagent-recall-gate';

export function clientDeclaresStrictGate(raw: string | string[] | undefined): boolean {
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof value !== 'string' || !value.trim()) return false;
  return value.split(',').some((part) => {
    const s = part.trim().toLowerCase();
    return s === 'strict' || s === '1' || s === 'true';
  });
}

export interface McpHttpOptions {
  storage?: StorageBackend;
  /** L0 写密钥端口（主进程 L0Vault）；缺省 → 写入诚实报 E_L0_LOCKED */
  l0?: L0Port;
  /** L0-first 拦截标记写入口：质量门拦截条目以 bak_* 键落主 L0 库；缺省 = 旧行为（只写审计） */
  l0Backup?: { put(mem_id: string, blob: import('./l0Store.ts').L0Blob): Promise<void> };
  port?: number;
  host?: string;
  /** 必填：访问令牌（Authorization: Bearer / x-mcp-token） */
  token: string;
  /** 会话租户（客户端不得越过该 user_id）；缺省本机单用户。D6-4 起为**引导令牌**的账户；
   *  库令牌（tokenStore 签发）按各自记录解析账户。 */
  account?: McpAccount;
  /** D6-4 令牌代理：受限令牌库（缺省无库 = 仅引导令牌可用，现状行为不变） */
  tokenStore?: TokenStorePort;
  /** 批次45-B3：成员 API 密钥库（apk_）——鉴权链第三环；缺省未装配 = 仅引导/令牌库可用（现状不变） */
  memberStore?: MemberStorePort;
  /** 请求体上限（字节），缺省 1 MiB */
  maxBodyBytes?: number;
  /**
   * 批次33-C：明细页访问回调（供主进程落一条动作日志，只给命中/未命中，不含 id 与正文）。
   * 缺省不记——内核/审计里没有明细正文，页面内容也绝不写进数据根。
   */
  onViewDetail?: (outcome: 'ok' | 'miss') => void;
  /** 批次44-D4：pending 队列存储端口；缺省内存实现，桌面建议注入 FilePendingStore */
  pending?: PendingStore;
  /** 批次44-D5-2：是否放行 manage_memory(action=delete)；缺省读环境变量 MCP_ALLOW_DELETE=1 */
  allowDelete?: boolean;
  /** 第一轮个人记忆：召回准入读同一独立存储（缺省 = 不追加个人条目，行为不变） */
  personal?: PersonalMemoryStore;
  /**
   * C 方案：严格首步召回门禁全局开关。缺省 false = 批次47 原行为逐字不变
   * （只硬拦写入/治理类工具，读类只软提醒）。开启后，可靠会话未召回时**所有**非 recall 工具都硬拦。
   * 只影响带 Mcp-Session-Id 的可靠会话；无会话头一律不硬拦（防 §9 跨客户端串号误杀）。
   * 批次62 UI 开关：可传**求值函数**，由主进程在每次请求时读当前 UI 设置，切换即时生效、无需重启；
   * 传布尔值时行为与批次62 之前逐字一致（既有测试与老客户端零影响）。
   */
  strictRecallGate?: boolean | (() => boolean);
  /**
   * 强制召回钩子的状态文件绝对路径（recall_hook_status 用）。
   * 缺省走 hookStatusFilePath()；主进程应显式传 join(USER_DATA, HOOK_STATUS_FILE)，
   * 保证 MCP 读的和钩子写的是同一个文件（否则会误报 never_ran）。
   */
  hookStatusFile?: string;
  /**
   * 第四层·轮级放行（2026-11-17 用户明确）：把「是否已召回」从**会话级**收紧到**轮级**。
   * 缺省 false = 会话级（批次47/62 行为逐字不变，既有测试与老客户端零影响）。
   * 开启后：每次用户提问都由钩子账本追加一行，时间为本轮起点；只有当本会话的召回时间
   * **晚于**账本里最近一轮的时间戳时才算「本轮已召回」，否则照样硬拦。
   * 可传求值函数（同 strictRecallGate），由主进程按运行时配置决定。
   */
  roundScopedRecall?: boolean | (() => boolean);
  /**
   * 「钩子账本最近一轮」的时间戳读取器（ms，读不到返回 null）。缺省读本机
   * `recall-hook-log.jsonl` 尾部；单测注入桩函数，避免读到真实用户账本导致结果不稳定。
   */
  latestRoundAt?: () => Promise<number | null>;
}

export interface McpHttpHandle {
  /** 监听就绪后的实际端口（port:0 时由系统分配） */
  ready: Promise<number>;
  stop: () => void;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** 批次47（L2）：受「首步召回」硬门禁约束的写入/治理类工具（读类与 recall 自身不在内）。
 *  可靠会话（带 Mcp-Session-Id）尚未召回即调用它们 → 服务端硬拦；读类只软提醒，不硬拦。 */
const WRITE_GATE_TOOLS = new Set([
  'write_memory', 'manage_memory', 'feedback', 'gc_report', 'create_project', 'mint_token',
]);

/** 结果末块：模型未必读 initialize.instructions，这里再要求一次展示方式。
 *  2026-11-21 用户拍板「禁止用 HTML」：三档一律**零 HTML 标签**——没有 <details>/<summary>/<mark>。
 *  摘要是一整行（2026-11-21 二次拍板压到 2 行宽）：行首 ▶ +「⚙ 模式简称」+「命中 …｜背景 …｜⚡ 省 …t｜💰 ¥…（省 ¥…）｜今日 N 次｜全部 N 次」
 *  + 告警短版内联行尾；金额只留本次、今日/全部只留次数。展开看细节靠客户端气泡折叠卡或用户说「看明细」，服务端不输出任何折叠标签。
 *  三档文案都必须认识行首 ▶ 与 ⚙ 模式段；display.line 单行兜底也带该段。
 *  三档统一要求正文就地标注 [n]（compact 档无编号则不得凭空标）、不得编造编号、不预展开；
 *  2026-11-21 用户二次纠偏：compact 档（WorkBuddy 恒走此档）**只有一行摘要**——没有链接行、没有 📌 提示行，
 *  展开只靠黑三角 ▶ + 客户端气泡折叠卡；文案里不再要求输出/保留任何本机明细页 URL。
 *  判档/白名单逻辑不动，只改文案与 markdown 载体形态。 */
export function recallEchoNote(mode: RecallDisplayMode): string {
  const keep = '数字与金额不得改写、省略或补全。';
  const noRebuild = '不得按「摘要行」的行数自行重建 display.markdown：行首的黑三角 ▶ 与「⚙ 模式简称」段是本次结果的一部分，必须随整段原样输出、不得省略（会话视图无模式段时仍有 ▶）；';
  /** 2026-11-21 用户口径：摘要恒为**一整行**，行首 ▶ 黑三角 + ⚙ 模式，告警内联行尾 */
  const summaryShape = '**一整行**加粗摘要（已压到约 2 行宽）：行首「▶ ⚙ 模式简称」（黑三角 ▶ = 展开标记），接着「🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ ⚡ 省 …t ｜ 💰 ¥…（省 ¥…） ｜ 今日 N 次 ｜ 全部 N 次」（命中用 🎯、背景用 📎，二者一一对应；零命中不标 🎯），告警短版（⚠ …）内联在行尾；金额只留本次、今日/全部只留次数';
  const noHtml = '**文本里不要输出任何 HTML 标签**（折叠标签、高亮标签等一律不用）：黑三角 ▶ 只是纯文本标记，真正的折叠展开由客户端气泡卡承载；';
  const bubbleCard = '【富媒体宿主回显·卡片即回显】WorkBuddy / CodeBuddy 桌面端等能渲染组件卡片的宿主：'
    + '本次召回回显**只用一张默认收起的折叠卡承载**，回答里**不要再原样输出那行 `⚙ 模式 …` 文本摘要**（红框位置由卡片独占，文本行与卡片二选一、绝不并存）。'
    + '用宿主提供的组件/折叠面板工具渲染这张卡，**卡片放在回答末尾的召回回显区**（不要插在正文中间）：'
    + '**卡片标题压成 2 行、不要大黑三角 ▶、用小箭头（▸/▾）标示可展开，箭头要放大到清晰可见**（默认小箭头太小看不清）；'
    + '**标题固定排成两行，各项分区明确**：第一行 = 模式简称 ｜ 🎯 命中 N 条 (Nt) ｜ 📎 背景 N 条 (Nt) ｜ **⚡ 省 …t（省量/token 节省放第一行末尾）**；第二行 = 💰 ¥…（省 ¥…）｜ 今日 N 次 ｜ 全部 N 次，**在「全部 N 次」后面紧跟灰色小字「点击查阅详细内容」**（不要另起一行、不要放在省量后）；各项取自 display.line 并去掉行首 ▶；'
    + '**卡片之后不要再输出任何文字**——不写「卡片已作为会话最后一条内容输出」这类括注/说明，卡片必须是本次回答的最后一条内容；'
    + '**富媒体宿主另有结构化字段 display.card（非 null 时）**：含 titleLine1 / titleLine2 / hint / summary / background / hits / basis / warnings，**直接按这些字段渲染卡片，不要自己从 display.line 拆字符串、也不要重算数字**；display.card 为 null 时才退回按 display.line 渲染。'
    + '**卡片 hits 每条含 feedback_hint（反馈入口提示）与 reinforce_count（累计被用户确认/强化次数，无则不显示）**：把 feedback_hint 里的 N 替换为该条 [n] 编号后逐条渲染；用户按提示回复「N 有用 / N 没用」后，用 feedback 工具提交（明确表态用普通 confirm/reject；agent 自己采信了 [n] 也可在同轮提交一次 implicit=true 的弱信号，幂等去重、不会重复计分）。'
    + '**支持会话按钮的宿主（WorkBuddy / CodeBuddy 桌面端）应把反馈提示升级为交互按钮**：每条命中渲染「N 有用 ↗」「N 没用 ↗」小按钮，点击经宿主 sendPrompt 类机制把该文案作为用户消息发出（Agent 收到后调 feedback 提交，幂等去重）；无按钮能力的宿主保留文字提示，不要伪造按钮。'
    + '**展开后必须能同时查到汇总与明细**：顶部放「📊 本次召回统计汇总」（四行，含 Token 与费用数字）；'
    + '明细按用户指定的固定顺序 📎 项目背景（**逐条独立成行**，每条含类别与正文片段，不压缩成一整段）→ 💠 命中记忆 → 🎯 本次用上的依据（每条含 [n]、层级/相关度、🎯 命中词、正文片段）→ ⚠ 证据不足（仅真有告警时出现，放在最后）；'
    + noHtml + '卡内正文只能取自本次工具返回，不得编造、不得改写数字，也不要在文本里写任何明细页链接。'
    + '宿主没有卡片/折叠面板能力时忽略本条，按纯文本方式输出即可。';
  const citeFull = '正文里采用某条命中记忆作为事实依据时，就地标注 [n]：编号必须与「🎯 本次用上的依据」段一一对应，不得编造编号，hits=0 时不得标注；';
  const citeCompact = '本次摘要行不含 [n] 编号，正文里不要凭空标注编号；要带编号引用就让用户说「看明细」，用同一 query 再调用一次并置 detail=true，按那次返回的「🎯 本次用上的依据」编号就地标注 [n]，不得编造编号；';
  if (mode === 'html-details') {
    return '【展示要求】本次是可折叠档：把上一条 display.markdown 整段原样输出到最终回答末尾。'
      + `摘要行以黑三角 ▶ 开头（${summaryShape}），`
      + '其后依次是「📊 本次召回统计汇总」、「🎯 本次用上的依据」[n] 编号列表，以及 📎 项目背景 / 💠 命中记忆 / ⚡ Token 用量 / 💰 省钱与费用四段加粗标题平铺（告警段仅在真有告警时出现）。'
      + noRebuild + citeFull + bubbleCard
      + '不要替用户预先展开明细、不要给回答添加 HTML 标签、不要自行补写命中条目或明细。'
      + '若客户端不能承载气泡折叠卡，改为单独一行原样输出 display.line（以 ▶ 开头的提示行，有模式时随后是 ⚙ 模式简称，不得省略）；两种情况均适用：' + keep
      + RECALL_SOURCE_BOUNDARY;
  }
  if (mode === 'markdown-full') {
    return '【展示要求】本次是 detail=true 的明细返回：把上一条 display.markdown 整段原样输出到最终回答末尾，不要给回答添加任何 HTML 标签。'
      + `结构是${summaryShape} +「📊 本次召回统计汇总」+「🎯 本次用上的依据」[n] 编号列表 + 📎 项目背景 / 💠 命中记忆 / ⚡ Token 用量 / 💰 省钱与费用四个加粗小节。`
      + noRebuild + citeFull + bubbleCard + '禁止自行补写或预先展开明细。' + keep + RECALL_SOURCE_BOUNDARY;
  }
  return '【展示要求】本次按「默认收起 + 点击展开」下发——**富媒体宿主与纯文本宿主二选一，绝不并存**：'
    + bubbleCard
    + '【纯文本宿主回退】宿主确实没有组件卡片/折叠面板能力时，才把上一条 display.markdown 单行原样输出到回答末尾的召回回显区——'
    + `它**只有一整行摘要**（${summaryShape}），没有第二行、没有明细页链接、也没有任何提示语，输出的文本必须与此完全一致，不要多加一行；`
    + '有组件能力的宿主不要走这条回退、更不要同时输出文本行与卡片。'
    + citeCompact
    + '禁止自行补写命中条目、项目背景、Token 或费用明细，禁止编造 URL 或明细页链接，也禁止替用户预先展开（不要因为觉得『这样更完整』而调用 detail=true）。'
    + '只有用户在聊天里明确要看明细时，才用同一个 query 再调用 recall_memory 并置 detail=true，然后按明细档展示。'
    + keep + RECALL_SOURCE_BOUNDARY;
}

/** 启动标准 MCP streamable-http 服务器 */
export function runMcpHttpServer(opts: McpHttpOptions): McpHttpHandle {
  const { port = 8204, host = '127.0.0.1', maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = opts;
  const token = assertMcpToken(opts.token);
  const account = opts.account ?? DEFAULT_MCP_ACCOUNT;
  const storage = opts.storage ?? new InMemoryStorage();
  // 批次44-D5-2：delete 门禁在启动时定一次，两端同判据（显式注入 > 环境变量）
  const allowDelete = opts.allowDelete ?? deleteAllowed();
  const ma = createMemAgent({
    form: 'desktop',
    account,
    // 显式 stub 装配点：MCP HTTP 写入只落 L1
    llm: new FakeLlmProvider(),
    vector: new JsVectorBackend(),
    storage,
    l0: opts.l0,
    l0Backup: opts.l0Backup,
    // 批次44-D4：写入落盘兜底队列（缺省内存；桌面可注入文件实现持久化）
    pending: opts.pending ?? new MemoryPendingStore(),
    // 第一轮个人记忆召回准入（缺省 = 不追加，行为不变）
    personal: opts.personal,
  });

  /** 会话 → 调用方（批次15：initialize.clientInfo 自报）；客户端不维护会话时用 UA 兜底 */
  const clientBySession = new Map<string, string>();
  /**
   * 批次47（L2）+ 第四层（2026-11-17）：会话 → **最近一次调用 recall_memory 的时间戳**。
   * 只跟踪「带 Mcp-Session-Id 的可靠会话」——会话身份由服务端在 initialize 时签发并关联（协议级，不依赖客户端配置），
   * 因此对标准 MCP 客户端身份可靠；不带会话头的 UA 兜底请求一律按「不可靠」处理（只软提醒、不硬拦，防 §9 串号误杀）。
   *
   * 为什么从布尔改成时间戳：布尔是会话级口径——一次召回就把整个会话解锁，之后每一轮都放行，
   * 硬拦截等于形同虚设。存时间戳才能和「钩子账本里最近一轮的起点」比大小，判出「本轮有没有召回」。
   */
  const recallAtBySession = new Map<string, number>();
  /** 轮级开关（可传求值函数，与 strictRecallGate 同法） */
  const roundScoped = (): boolean => {
    const v = opts.roundScopedRecall;
    return typeof v === 'function' ? v() === true : v === true;
  };
  /**
   * 读「钩子账本里最近一轮」的起点（ms）。
   * 刻意**不做缓存**：只读文件尾部 8KB 本身很便宜，而缓存会带来一个更糟的失败模式——
   * 新一轮刚开始时读到上一轮的旧时间戳 → 把「本轮没召回」误判成「已召回」，门禁又形同虚设。
   * 读不到（没装钩子 / 文件被删 / 解析失败）返回 null，调用方退回会话级。
   */
  const currentRoundAt = async (): Promise<number | null> => {
    try {
      const raw = await (opts.latestRoundAt ?? readLatestHookRoundAt)();
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    } catch {
      return null; // 读盘故障 → 退回会话级，绝不因为读不到账本就把工具全锁死
    }
  };
  /**
   * 批次47（L3-b）：会话 → 是否已发生过任意 tools/call（用于算「首调合规率」）。
   * 同样只跟踪可靠会话（带 sid）；不可靠会话按 UA 兜底无法可靠归因，session_id 记 'ua-fallback' 且仅作观察。
   */
  const calledBySession = new Map<string, boolean>();
  /** UA → 最近一次 initialize 的调用方（部分客户端每次请求不带 Mcp-Session-Id） */
  const clientByUa = new Map<string, string>();
  /**
   * 批次33-C：默认收起档的一次性明细页票据（id → 已渲染 HTML）。
   * 只在内存里，30 分钟过期、上限 200 条；不落数据根、不进审计，明细正文不外泄到 URL。
   */
  const detailTickets = new RecallDetailTickets<string>();
  /** 实际监听端口（port:0 时由系统分配）——明细页基址与 Host 校验都以它为准 */
  let servedPort = port;
  const detailBase = () => `http://${host}:${servedPort}`;
  const remember = (map: Map<string, string>, key: string, value: string) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > MAX_CLIENT_SESSIONS) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };

  /** 执行单个 MCP 工具调用（tools/call 的参数 name + arguments）；text = 供聊天窗口回显的提示行。
   *  D6-4：acct = 本请求令牌解析出的会话账户（引导令牌 → 引导账户；库令牌 → 各自账户）。 */
  async function callTool(name: string, args: Record<string, unknown>, client: string, acct: McpAccount, renderFold = false): Promise<{ result: unknown; text?: string }> {
    switch (name) {
      case 'recall_memory': {
        const out = await runRecallTool(ma, storage, args, undefined, client, acct, {
          tickets: detailTickets, base: detailBase(), renderFold,
        });
        return { result: out.payload, text: out.text };
      }
      case 'list_projects':
        return { result: await runListProjectsTool(storage, acct) };
      case 'write_memory': {
        const p = args;
        if (!p.content || typeof p.content !== 'string') throw new Error('write_memory.content 必填');
        if (!p.project_id || typeof p.project_id !== 'string') throw new Error('write_memory.project_id 必填');
        // 三池可见性门禁（D6-2）：shared 恒可见 / user 仅 owner 或 admin / archive 仅 admin / general 按令牌 scope 列表
        if (!projectInScope(acct, p.project_id)) {
          throw new Error(`当前 MCP 令牌作用域不含项目 ${p.project_id}（三池可见性校验，D6-2）`);
        }
        // 租户闭包：客户端只能以会话身份写入，禁止冒用其它 user_id
        if (p.user_id !== undefined && String(p.user_id) !== acct.user_id) {
          throw new Error('write_memory.user_id 与会话租户不一致（禁止跨租户写入）');
        }
        const category = p.category ?? 'pitfall';
        if (!isCategory(category)) {
          throw new Error(`write_memory.category 非法：${String(category)}（允许：${CATEGORIES.join('/')}）`);
        }
        // A5（§7.1）：来源 agent 必须显式标识，禁止依赖默认 'mcp'
        const sa = typeof p.source_agent === 'string' ? p.source_agent.trim().toLowerCase() : '';
        if (!sa || sa === 'mcp') {
          throw new Error('write_memory.source_agent 必填且须显式标识来源 agent（禁止依赖默认 mcp，命名见 §7.1）');
        }
        // A4（§2.3）：扩展打分旋钮（可选；未传 → 记录不带该字段，scoreMemory 走默认 0.5）
        const { knobs, error: knobError } = parseWriteKnobs(p);
        if (knobError) throw new Error(knobError);
        const writeReq: MemReq & WriteKnobs = {
          content: p.content,
          category,
          project_id: p.project_id,
          user_id: acct.user_id,
          session_id: p.session_id ? String(p.session_id) : undefined,
          source_agent: sa,
          ...knobs,
        };
        // A3 / 批次44-D4：L0 锁定时不丢——暂存 pending 队列，解锁后自动重放落库。
        // 诚实降级：绝不伪造 mem_id，status=pending 明确表示「未落库」。
        let result: WriteResult;
        try {
          result = await ma.write(writeReq);
        } catch (e) {
          if (!isL0LockedError(e)) throw e;
          const pending_id = await ma.enqueuePending(writeReq);
          return {
            result: {
              status: 'pending',
              pending_id,
              reason: 'E_L0_LOCKED',
              message: 'L0 写密钥未解锁：本次写入已暂存 pending 队列，解锁后自动重放落库。这不是写入成功，请勿据此认为已落库。',
            },
          };
        }
        // 解锁后自动重放：本次写入成功（必然已解锁），顺带清空历史 pending 条目
        const replay = await ma.flushPending();
        return { result: replay.flushed > 0 ? { ...result, replayed_pending: replay.flushed } : result };
      }
      case 'get_write_status': {
        // 批次44-D4：写前探锁 + 解锁态顺带重放历史 pending
        return { result: await ma.getWriteStatus() };
      }
      case 'recall_hook_status': {
        // 钩子健康度自检：读宿主侧钩子写的状态文件（只读本机文件，不碰记忆库）
        return { result: runHookStatusTool({ statusFilePath: opts.hookStatusFile }) };
      }
      case 'list_memories': {
        // 批次44-D5-1：治理盘点（与 TCP 共用 runListMemoriesTool）
        return { result: await runListMemoriesTool(storage, args, acct) };
      }
      case 'get_memory': {
        // 批次44-D5-1：按 mem_id 精确读（与 TCP 共用 runGetMemoryTool）
        return { result: await runGetMemoryTool(storage, args, acct) };
      }
      case 'feedback': {
        // 批次44-D5-2：用户反馈（与 TCP 共用 runFeedbackTool）
        return { result: await runFeedbackTool(ma, storage, args, acct) };
      }
      case 'manage_memory': {
        // 批次44-D5-2：单条生命周期治理（与 TCP 共用 runManageMemoryTool，delete 受同一门禁）
        return { result: await runManageMemoryTool(ma, storage, args, acct, { allowDelete }) };
      }
      case 'gc_report': {
        // 批次44-D5-3：遗忘周期报告（与 TCP 共用 runGcReportTool，默认 dry_run=true）
        // 批次61 GAP-3：同 TCP 端，附只读 Agent 侧聚合
        return { result: await runGcReportTool(ma, args, acct, { storage }) };
      }
      case 'growth_evolve': {
        // 批次 B/C/D：自进化与场景画像（与 TCP 共用 runGrowthEvolveTool；status/profile 只读，adopt/policy 写配置）
        return { result: await runGrowthEvolveTool(storage, args, { form: 'desktop' }) };
      }
      case 'create_project': {
        // D6-5：受管创建项目（管理员专属，与 TCP 共用 runCreateProjectTool）
        return { result: await runCreateProjectTool(storage, args, acct) };
      }
      case 'mint_token': {
        // D6-5：签发受限令牌（管理员专属，与 TCP 共用 runMintTokenTool；明文一次性回显）
        return { result: await runMintTokenTool(opts.tokenStore, args, acct) };
      }
      case 'get_preferences': {
        const p = args;
        if (!p.user_id || typeof p.user_id !== 'string') throw new Error('get_preferences.user_id 必填');
        // 租户闭包：只能读会话身份自己的偏好
        if (String(p.user_id) !== acct.user_id) {
          throw new Error('get_preferences.user_id 与会话租户不一致（禁止跨租户读取）');
        }
        const out: Pref[] = await ma.getPrefs(acct.user_id);
        // structuredContent 必须是 JSON 对象（MCP 规范），数组统一包一层 items
        return { result: { items: out } };
      }
      default:
        throw new Error(`未知工具 ${name}`);
    }
  }

  /**
   * 批次47（L3-b）：合规审计。每次 tools/call 写一条 `mcp_call` 审计，记录会话首调是否命中 recall_memory，
   * 供算「首调合规率」（可靠会话 = 带 Mcp-Session-Id；不可靠会话 session_id 记 'ua-fallback'，仅作观察）。
   * 审计是 observability 而非关键路径：任何失败都吞掉，绝不阻断工具调用本身。
   */
  async function emitMcpCallAudit(
    toolName: string, reliable: boolean, firstCall: boolean, recalledBefore: boolean, sid: string,
    client: string, acct: McpAccount,
    /** 第四层：把「这次按什么口径判的」也写进审计——否则事后无法区分会话级与轮级 */
    round?: { roundScoped: boolean; roundAt: number | null; recallAt: number | null },
  ): Promise<void> {
    try {
      const record: AuditRecord = {
        request_id: ulid(),
        action: 'mcp_call',
        agent: client,
        user_id: acct.user_id,
        ts: Date.now(),
        detail: {
          session_id: reliable ? sid : 'ua-fallback',
          reliable,
          first_call: reliable ? firstCall : false,
          recalled_before: reliable ? recalledBefore : false,
          tool: toolName,
          ...(round?.roundScoped
            ? { round_scoped: true, round_at: round.roundAt, recall_at: round.recallAt }
            : {}),
        },
      };
      await storage.appendAudit(record);
    } catch {
      /* 审计失败吞掉，不影响主流程 */
    }
  }

  /** 处理一个 JSON-RPC 请求对象（MCP 单请求/单响应；不支持批量）
   *  @param incomingSid 本请求携带的 Mcp-Session-Id（空串 = 不带会话头，按 UA 兜底/不可靠处理）
   *  @param renderFold 本请求是否声明了折叠渲染能力（`X-Memagent-Render: fold`，T8）；只影响 recall 档位 */
  async function handleRpc(req: Record<string, unknown>, client: string, acct: McpAccount, incomingSid: string, renderFold = false, strictGate = false): Promise<Record<string, unknown>> {
    const method = String(req.method ?? '');
    const id = ('id' in req ? (req.id as number | string | null | undefined) : null) ?? null;
    const params = (req.params && typeof req.params === 'object' ? req.params : {}) as Record<string, unknown>;
    const base = { jsonrpc: '2.0', id };

    switch (method) {
      case 'initialize':
        return {
          ...base,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'memagent-mcp', version: '1.0.0' },
            // 批次11：MCP 指令下发（关键词触发召回 + 原样回显 display.line + 不编造金额）
            // C 方案：严格门禁开启时追加第 10 条声明；默认关闭 → 与原常量逐字相同。
            instructions: mcpInstructions(strictGate),
          },
        };
      case 'notifications/initialized':
      case 'notifications/cancelled':
        // 通知无响应（JSON-RPC spec：notification 不回包）
        return { jsonrpc: '2.0', id: null, result: {} };
      case 'tools/list':
        // 批次47（L1）：下发带「首步召回」前缀的工具清单，从工具元数据层把召回优先级顶到最高。
        // C 方案：严格门禁开启时，非 recall 工具描述追加「会被硬拦」声明；默认关闭 → 与原清单逐字相同。
        return { ...base, result: { tools: withRecallFirstNotes(strictGate) } };
      case 'tools/call': {
        const name = String(params.name ?? '');
        const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
        // 批次47（L2）：会话门禁。可靠会话（带 Mcp-Session-Id，服务端 initialize 签发并关联）尚未召回即调用
        // 写入/治理类工具 → 硬拦返回 MCP 错误；读类工具未召回只软提醒（追加提示、不拦截，保体验）；
        // 不带会话头的 UA 兜底请求一律按「不可靠」处理——只软提醒、不硬拦，防 §9 跨客户端串号误杀。
        const reliable = Boolean(incomingSid);
        /**
         * 第四层：轮级判定。
         *   会话级（默认）：本会话召回过一次就放行（批次47 原口径）。
         *   轮级（roundScopedRecall）：召回时间必须晚于「钩子账本里最近一轮」的起点。
         * 账本读不到（钩子没装 / 文件被删）→ 退回会话级，不让读盘故障把工具全锁死。
         */
        const recallAt = reliable ? recallAtBySession.get(incomingSid) : undefined;
        const useRound = reliable && roundScoped();
        const roundAt = useRound ? await currentRoundAt() : null;
        const recalled = recallAt !== undefined && (!useRound || roundAt === null || recallAt > roundAt);
        // 批次47（L3-b）：首调合规审计（在标记 called/recalled 之前取快照，确保 first_call / recalled_before 准确）。
        const firstCall = reliable && !calledBySession.has(incomingSid);
        await emitMcpCallAudit(name, reliable, firstCall, recalled, incomingSid, client, acct, {
          roundScoped: useRound,
          roundAt,
          recallAt: recallAt ?? null,
        });
        if (reliable) calledBySession.set(incomingSid, true);
        // C 方案：严格门禁开启时覆盖**所有**非 recall 工具（含原本只软提醒的读类）；
        // recall_memory 自身永远放行，否则会话永远无法解锁（死锁）。默认关闭时判定与批次47 逐字相同。
        if (reliable && !recalled && name !== 'recall_memory'
          && (WRITE_GATE_TOOLS.has(name) || strictGate)) {
          // 轮级判定下「本会话尚未调用」会变成假话（上一轮明明查过）→ 用专用文案，说清是「本轮」没查
          const blockedText = useRound && recallAt !== undefined && roundAt !== null
            ? RECALL_ROUND_GATE_MSG
            : strictGate ? RECALL_FIRST_STRICT_GATE_MSG : RECALL_FIRST_GATE_MSG;
          return {
            ...base,
            result: {
              content: [{ type: 'text', text: blockedText }],
              isError: true,
            },
          };
        }
        // recall 调用即记录本会话的召回时间（仅可靠会话跟踪；不可靠会话无法可靠归因，按软提醒常驻处理）。
        if (name === 'recall_memory' && reliable) {
          recallAtBySession.set(incomingSid, Date.now());
        }
        try {
          const out = await callTool(name, args, client, acct, renderFold);
          // recall 首块 = 提示行（兼容纯文本客户端），随后完整 JSON、折叠明细（批次13）；同时给 structuredContent。
          // 批次12：模型常忽略 initialize.instructions → 结果末块再给一次展示方式硬约束（Qoder 实测必需）。
          const markdown = (out.result as { display?: { markdown?: string } }).display?.markdown;
          const displayMode = ((out.result as { display?: { mode?: RecallDisplayMode } }).display?.mode) ?? 'markdown-compact';
          const content = out.text
            ? [
                { type: 'text', text: out.text },
                { type: 'text', text: JSON.stringify(out.result, null, 2) },
                { type: 'text', text: markdown ?? out.text },
                { type: 'text', text: recallEchoNote(displayMode) },
              ]
            : [{ type: 'text', text: JSON.stringify(out.result, null, 2) }];
          // 批次47（L2）：未召回（任意会话）且非 recall 自身 → 末块追加软提醒，不拦截，保体验。
          // 可靠会话召回后 recalled 变 true 即不再提醒；不可靠会话无法确认召回，常驻软提醒（推动其带会话头）。
          if (!recalled && name !== 'recall_memory') {
            content.push({ type: 'text', text: RECALL_FIRST_REMINDER });
          }
          return {
            ...base,
            result: {
              content,
              structuredContent: out.result,
              isError: false,
            },
          };
        } catch (e) {
          return {
            ...base,
            result: {
              content: [{ type: 'text', text: `错误：${String((e as Error)?.message ?? e)}` }],
              isError: true,
            },
          };
        }
      }
      case 'ping':
        return { ...base, result: {} };
      default:
        return { ...base, error: { code: -32601, message: `method not found: ${method}` } };
    }
  }

  const server = httpCreateServer((req: IncomingMessage, res: ServerResponse) => {
    // MCP 是机器对机器协议：带 Origin 的请求来自浏览器上下文，一律拒绝（防任意网页驱动记忆库）
    if (req.headers.origin !== undefined) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'origin_not_allowed' } }));
      return;
    }
    // 只处理 POST /mcp（精确路径，`/mcpanything` 不再命中）
    const path = (req.url ?? '/').split('?')[0];

    // 批次33-C：GET /recall/<id> = 聊天里「▶ 展开本次召回明细」链接指向的一次性明细页。
    // 为什么可以不带令牌：MCP 令牌是机器级凭据，绝不下进聊天窗口/URL；此处改由 22 字符随机 id + 30 分钟过期把守，
    // 页面只回显这一次召回已经算好的数字（无新查询能力），并按 Host 绑定拒绝 DNS rebinding。
    if (req.method === 'GET' && (path === '/recall' || path.startsWith('/recall/'))) {
      if (rejectUntrustedHost(req, res, [servedPort])) return;
      const id = path.slice('/recall/'.length);
      const html = /^[A-Za-z0-9_-]{16,32}$/.test(id) ? detailTickets.take(id) : null;
      res.writeHead(html ? 200 : 404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      res.end(html ?? buildRecallDetailExpiredPage());
      if (opts.onViewDetail) opts.onViewDetail(html ? 'ok' : 'miss');
      return;
    }

    if (req.method !== 'POST' || path !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    // D6-4：令牌 → 账户按库解析（引导令牌 → 引导账户；库令牌 → 各自 scope/is_admin/user_id；
    // 未配置库时仅引导令牌可用 = 现状行为不变）。解析失败一律 401。
    const reqAccount = resolveAccountFor(tokenFromHeaders(req.headers), {
      serverToken: token, store: opts.tokenStore, bootstrap: account, memberStore: opts.memberStore,
    });
    if (!reqAccount) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'unauthorized: 缺少或无效的 MCP token' } }));
      return;
    }

    let body = '';
    let size = 0;
    let rejected = false;
    req.on('data', (c: Buffer) => {
      if (rejected) return;
      size += c.length;
      if (size > maxBodyBytes) {
        rejected = true;
        // 不销毁连接（保留 keep-alive 语义），继续消费剩余数据但不再累积
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'payload_too_large' } }));
        return;
      }
      body += c.toString('utf8');
    });
    req.on('end', () => {
      if (rejected) return;
      void (async () => {
        try {
          const payload = JSON.parse(body) as Record<string, unknown>;
          const method = String(payload.method ?? '');
          const params = (payload.params && typeof payload.params === 'object' ? payload.params : {}) as Record<string, unknown>;
          const uaHeader = req.headers['user-agent'];
          const ua = typeof uaHeader === 'string' ? uaHeader : undefined;
          const sidHeader = req.headers['mcp-session-id'];
          const incomingSid = typeof sidHeader === 'string' ? sidHeader : '';
          // 批次41-X（方案 C）：显式身份头优先——一键接入写进配置的 X-Memagent-Client 每次请求都带，
          // 不共用 UA/会话这类「别人也会命中」的键，从根上消除 41-S 的跨客户端串号。
          const declaredClient = clientFromExplicitHeader(req.headers[MCP_CLIENT_HEADER]);
          // 2026-11-12（T8）能力声明头：与身份头分开解析、互不覆盖——身份决定「记在谁名下」，能力决定「给哪一档」。
          // 缺省 false，未声明的客户端行为与历史完全一致。
          const renderFold = clientDeclaresFold(req.headers[MCP_RENDER_HEADER]);
          // C 方案：严格门禁 = 服务端全局开关 OR 本次请求显式声明；缺省两者都关，行为逐字不变。
          // 批次62 UI 开关：全局开关支持求值函数，**每次请求**读当前值（切换无需重启）；
          // 传布尔值时与批次62 之前完全等价。
          const globalGate = typeof opts.strictRecallGate === 'function'
            ? opts.strictRecallGate() === true
            : opts.strictRecallGate === true;
          const strictGate = globalGate
            || clientDeclaresStrictGate(req.headers[MCP_STRICT_GATE_HEADER]);
          // 批次15：initialize 时登记调用方并以 Mcp-Session-Id 关联后续 tools/call；
          // 客户端不带会话头时退化为「同 UA 最近一次 initialize」，再退化到 UA 识别。
          if (method === 'initialize') {
            const sid = ulid();
            const selfId = declaredClient ?? clientFromInitialize(params);
            if (selfId) {
              remember(clientBySession, sid, selfId);
              // 批次41-S（方案 B）：有辨识度 UA 才登记；或自报名本身是**已知客户端产品**也登记——
              // 让 Qoder 宿主这类「UA=`node`、不带会话头、但自报 qoder-desktop-mcp-host」的合法客户端
              // 保住气泡折叠档。任意/探测名（不在已知表里）仍不登记，从源头堵住被它抢注。
              // 批次41-X：显式带了身份头的客户端每次请求都自带身份，这条归并路径对它已无意义，
              // 所以不再按它的值去占通用 UA 那条键（那是 41-S 残留串号的来源）。
              const byUa = !declaredClient && ua
                && (isIdentifiableUserAgent(ua) || isTrustedClientSelfName(selfId));
              if (byUa) remember(clientByUa, ua, selfId);
            }
            res.setHeader('Mcp-Session-Id', sid);
          }
          // 取值顺序（批次41-X 起）：显式身份头 → 会话头 → （有辨识度 UA，或该 UA 上登记的自报名是已知产品）
          // 同 UA 最近一次 initialize → UA 识别。通用 UA 上若没登记过已知产品，仍落到 unknown。
          const uaCached = ua ? clientByUa.get(ua) : undefined;
          const client = declaredClient
            ?? clientBySession.get(incomingSid)
            ?? (ua && (isIdentifiableUserAgent(ua) || isTrustedClientSelfName(uaCached)) ? uaCached : undefined)
            ?? clientFromUserAgent(ua);

          const rpcResp = await handleRpc(payload, client, reqAccount, incomingSid, renderFold, strictGate);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rpcResp));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `parse error: ${String((e as Error)?.message ?? e)}` } }));
        }
      })();
    });
  });

  let resolveReady!: (port: number) => void;
  let rejectReady!: (err: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  server.listen(port, host, () => {
    const addr = server.address();
    const actual = addr && typeof addr === 'object' ? addr.port : port;
    servedPort = actual;
    console.log(`[mcp-http] 监听 http://${host}:${actual}/mcp（标准 MCP streamable-http，需 token）`
      + `；明细页 GET http://${host}:${actual}/recall/<一次性 id>（随机 id + 30 分钟过期，无需令牌）`);
    resolveReady(actual);
  });
  server.on('error', (err) => {
    console.error('[mcp-http] 启动失败', err.message);
    rejectReady(err);
  });
  return { ready, stop: () => { server.close(); } };
}
