// MCP 召回工具编排（批次11/13/29/32/33）：项目自动定位 / 列表 / 提示行与明细组装 / 按客户端能力选档位。
// 两条传输（HTTP 8204、TCP 8202）共用；所有数字来自 storage 真实账本与 recall 审计。
import type { MemAgent, Memory, ProjectRecord, RecallMode, RecallResult, Scene, StorageBackend } from './types.ts';
import { findParamsSnapshot } from './paramsSnapshot.ts';
import { projectInScope, DEFAULT_MCP_ACCOUNT, type McpAccount } from './mcpAuth.ts';
import { RECALL_DETAIL_TTL_MS } from './recallDetailTickets.ts';
import {
  buildRecallCompactMarkdown, buildRecallDetailPage, buildRecallHint, buildRecallMarkdown,
  normalizeUnitPrice, rollupRecalls,
  type RecallMoney, type RecallRollup,
} from './recallInsight.ts';

/** 批次32-C：聊天窗口明细档位（HTML 折叠 / 纯 Markdown 四小节 / 短摘要 + 按需展开） */
export type RecallDisplayMode = 'html-details' | 'markdown-full' | 'markdown-compact';

/** 批次41-Q：白名单——首段命中即给 HTML <details> 折叠档。
 *  `qoder` = Qoder CN IDE/CLI 自报名（批次13 实测渲染过折叠块）；
 *  `qoder-desktop-mcp-host` = Qoder Desktop 的 MCP 宿主自报名（本机 2026-11-04 实测 recall 审计里
 *  出现的就是这一条，原先「精确等于 `qoder`」的判据把它挡在门外 → `html-details` 档在该机从未生效，
 *  见 AGENTS §1.1 / §9 批次29 校正）。
 *  fail-safe：其余客户端一律不走 HTML 档——DSH 两次实测都不渲染 `<details>`（批次29 2026-10-31 截图
 *  + 批次33 2026-11-01 09:33 实机复读，标签原样露成文本，其「点开才看明细」改用本机明细页链接 33-C）；
 *  dsh-mcp-client / zcode / 无 clientInfo 的 TCP / `unknown` 同理。
 *  批次41-X 补 `qoder-cn`：显式身份头 `X-Memagent-Client` 的值取**配方 id**（Qoder 即 `qoder-cn`），
 *  与原先的自报名 `qoder-desktop-mcp-host` 是两个口径。不加进来就等于重演批次41-S 方案 A——
 *  为消除串号把 Qoder 宿主自己打回 `markdown-compact`，丢掉已实机证实的气泡折叠档
 *  （用户口径「能内联就内联，做不到才用 HTML 页兜底」）。 */
const HTML_DETAILS_CLIENT_IDS = new Set(['qoder', 'qoder-cn', 'qoder-desktop-mcp-host']);

export function clientSupportsHtmlDetails(client?: string): boolean {
  if (!client) return false;
  const name = client.split('/')[0].trim().toLowerCase();
  return HTML_DETAILS_CLIENT_IDS.has(name);
}

/** 参数快照专用项目（pinned preference，非用户项目；不参与项目定位/列表） */
const INTERNAL_PROJECT = 'P_SYSTEM';

/** 参数校验类错误 → JSON-RPC -32602；其余异常由传输层按 -32000 处理 */
export class McpToolError extends Error {
  readonly code: number;
  constructor(message: string, code = -32602) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
  }
}

export interface ProjectInfo {
  project_id: string;
  memories: number;
  last_activity: number;
}

export interface ResolvedProject {
  project_id: string;
  resolved_from: 'explicit' | 'single_project';
}

/** 项目列表：排除内部参数项目、合并影子与墓碑；按最近活动倒序（确定性） */
export function projectInfosFromMemories(mems: Memory[]): ProjectInfo[] {
  const map = new Map<string, ProjectInfo>();
  for (const m of mems) {
    if (!m.project_id || m.project_id === INTERNAL_PROJECT || m.deleted || m.merged_into) continue;
    const ts = m.updated_at ?? m.created_at ?? 0;
    const cur = map.get(m.project_id);
    if (cur) {
      cur.memories++;
      cur.last_activity = Math.max(cur.last_activity, ts);
    } else {
      map.set(m.project_id, { project_id: m.project_id, memories: 1, last_activity: ts });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.last_activity - a.last_activity || a.project_id.localeCompare(b.project_id),
  );
}

/** 显式 project_id 优先；否则账本唯一项目自动定位；0/多项目 → 明确报错（不猜） */
export function resolveProjectId(infos: ProjectInfo[], explicit: unknown): ResolvedProject {
  if (typeof explicit === 'string' && explicit.trim()) {
    return { project_id: explicit.trim(), resolved_from: 'explicit' };
  }
  if (explicit !== undefined && explicit !== null && typeof explicit !== 'string') {
    throw new McpToolError('project_id 必须是字符串');
  }
  if (infos.length === 1) return { project_id: infos[0].project_id, resolved_from: 'single_project' };
  if (infos.length === 0) {
    throw new McpToolError('未提供 project_id，且账本暂无记忆：请先写入一条记忆，或显式传入 project_id（可调用 list_projects 查看）');
  }
  const preview = infos.slice(0, 5).map((p) => p.project_id).join('、');
  throw new McpToolError(
    `未提供 project_id，且账本有 ${infos.length} 个项目：${preview}${infos.length > 5 ? ' 等' : ''}。`
    + '请先询问用户，或调用 list_projects 后显式传入 project_id。',
  );
}

export interface RecallToolPayload extends RecallResult {
  project_id: string;
  resolved_from: ResolvedProject['resolved_from'];
  display: {
    line: string;
    money: RecallMoney | null;
    rollup: RecallRollup;
    /** 批次13：折叠明细（<details> 四段，summary = line）；客户端不渲染 HTML 时回退 line */
    markdown: string;
    /** 批次32-C：本次 markdown 是哪一档（HTML 折叠 / 纯 Markdown 明细 / 摘要 + 明细链接），UI 与测试据此核对口径 */
    mode: RecallDisplayMode;
    /**
     * 批次33-C：一次性本机明细页的完整可点地址（http://127.0.0.1:<端口>/recall/<随机 id>）。
     * 仅默认收起档下发；TCP 8202（无端口概念）与 HTML 折叠档为 null，聊天侧退回文字指引。
     */
    detail_url: string | null;
  };
}

/**
 * 明细页签发口（批次33-C，由 HTTP 传输提供）：默认收起档给聊天窗口一个**可点链接**，
 * 页面本身是真 HTML（能折叠），绕开「客户端不渲染 <details>」的限制。
 * TTL 单一真源 = RECALL_DETAIL_TTL_MS：服务端须用默认 TTL 构造票据表，页面里写的「多少分钟内有效」才与实际一致。
 */
export interface RecallDetailTicketsPort {
  issue(payload: string, now?: number): { id: string; expiresAt: number };
}

export interface RecallToolDetailOpts {
  tickets: RecallDetailTicketsPort;
  /** 明细页基址（含协议与端口），如 http://127.0.0.1:8204 */
  base: string;
}

export interface RecallToolOutput {
  /** 工具结果对象（HTTP structuredContent / TCP result） */
  payload: RecallToolPayload;
  /** 聊天窗口提示行（HTTP content[0]；Agent 须原样回显） */
  text: string;
}

async function readPricingAndRollup(
  storage: StorageBackend, now: number,
): Promise<{ price: number | null; rollup: RecallRollup }> {
  const [mems, audits] = await Promise.all([
    storage.listMemories({}),
    storage.queryAudit({ action: 'recall' }),
  ]);
  const price = normalizeUnitPrice(findParamsSnapshot(mems)?.cfg?.cost_cny_per_mtok);
  return { price, rollup: rollupRecalls(audits, now) };
}

/** 执行 recall_memory：解析项目 → 内核召回 → 组装提示（含本次/今日/全部金额）
 *  client：调用方标识（批次15），落 recall 审计，便于按 Agent 核验是否真的检索。
 *  detail（批次33-C）：HTTP 传输提供明细页签发口时，默认收起档附带一个可点的本机明细页链接。 */
export async function runRecallTool(
  ma: MemAgent,
  storage: StorageBackend,
  args: Record<string, unknown>,
  now?: number,
  client?: string,
  account: McpAccount = DEFAULT_MCP_ACCOUNT,
  detail?: RecallToolDetailOpts,
): Promise<RecallToolOutput> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) throw new McpToolError('recall_memory.query 必填且不能为空（传入用户问题/关键词）');

  // 批次44-D5-4：scope/session_id 参数校验（MCP 层给 -32602，内核再兜一层）
  const viewScope = args.scope === undefined ? 'project' : args.scope;
  if (viewScope !== 'project' && viewScope !== 'session') {
    throw new McpToolError(`recall_memory.scope 非法：${String(viewScope)}（允许：project/session）`);
  }
  let sessionId: string | undefined;
  if (args.session_id !== undefined) {
    if (typeof args.session_id !== 'string' || !args.session_id.trim()) {
      throw new McpToolError('recall_memory.session_id 须为非空字符串');
    }
    sessionId = args.session_id.trim();
  }
  if (viewScope === 'session' && !sessionId) {
    throw new McpToolError('recall_memory.scope=session 时 session_id 必填且须为非空字符串');
  }
  if (viewScope === 'session' && args.top_k !== undefined) {
    const n = Number(args.top_k);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new McpToolError('recall_memory.top_k 须为 1–10 的整数（scope=session 时为最近 N 条上限）');
    }
  }

  const infos = projectInfosFromMemories(await storage.listMemories({}));
  const project = resolveProjectId(infos, args.project_id);
  // 三池可见性门禁（D6-2）：shared 恒可见 / user 仅 owner 或 admin / archive 仅 admin / general 按令牌 scope 列表
  if (!projectInScope(account, project.project_id)) {
    throw new McpToolError(`当前 MCP 令牌作用域不含项目 ${project.project_id}（三池可见性校验，D6-2）`);
  }
  const recall = await ma.recall({
    project_id: project.project_id,
    query,
    top_k: args.top_k === undefined ? 5 : Number(args.top_k),
    scene: (args.scene as Scene) ?? 'default',
    mode: (args.mode as RecallMode) ?? null,
    client,
    // 批次44-D5-4：scope=project 时两个字段均为 undefined/缺省，项目召回路径行为完全不变
    scope: viewScope,
    session_id: sessionId,
  });
  // 累计口径必须包含本次召回：时钟取召回完成之后（召回审计的 ts 不晚于此刻）
  const stamp = now ?? Date.now();
  const { price, rollup } = await readPricingAndRollup(storage, stamp);
  const hint = buildRecallHint(recall, rollup, price);
  const mode = recallDisplayMode(client, detailRequested(args));
  let detailUrl: string | null = null;
  let markdown: string;
  if (mode === 'html-details') {
    markdown = buildRecallMarkdown(recall, hint, price, { htmlDetails: true });
  } else if (mode === 'markdown-full') {
    markdown = buildRecallMarkdown(recall, hint, price, { htmlDetails: false });
  } else if (detail) {
    // 批次33-C「默认收起 + 点击展开」：明细正文渲染成本机一次性页面（客户端不渲染 HTML 也能点），
    // 聊天侧只留两行摘要 + 链接。页面写的有效期 = 签发时钟 + RECALL_DETAIL_TTL_MS，与票据表默认 TTL 同一常量。
    const page = buildRecallDetailPage(recall, hint, price, {
      project_id: project.project_id,
      query,
      client,
      issuedAt: stamp,
      expiresAt: stamp + RECALL_DETAIL_TTL_MS,
    });
    const ticket = detail.tickets.issue(page, stamp);
    detailUrl = `${detail.base}/recall/${ticket.id}`;
    markdown = buildRecallCompactMarkdown(hint, detailUrl);
  } else {
    markdown = buildRecallCompactMarkdown(hint);
  }
  return {
    payload: {
      ...recall,
      project_id: project.project_id,
      resolved_from: project.resolved_from,
      display: { line: hint.line, money: hint.money, rollup: hint.rollup, markdown, mode, detail_url: detailUrl },
    },
    text: hint.line,
  };
}

/** detail 参数只认布尔；其它类型如实报错（不静默当 false，避免用户点了展开却拿到摘要） */
function detailRequested(args: Record<string, unknown>): boolean {
  const v = args.detail;
  if (v === undefined || v === null) return false;
  if (typeof v !== 'boolean') throw new McpToolError('recall_memory.detail 必须是布尔值（true=要四段明细）');
  return v;
}

/**
 * 档位判定（批次32-C，用户拍板「DSH 里记忆库信息要折叠，点开才看明细」）：
 * 实测能渲染 <details> 的客户端仍给 HTML 折叠版（点开即看，无需二次调用）；
 * 其余客户端（DSH 只渲染 Markdown，没有可点击折叠控件）默认一行摘要，明细靠 detail=true 再取。
 */
export function recallDisplayMode(client: string | undefined, detail: boolean): RecallDisplayMode {
  if (clientSupportsHtmlDetails(client)) return 'html-details';
  return detail ? 'markdown-full' : 'markdown-compact';
}

/** 执行 list_projects（D6-2 三池）：合并「注册表项目 + 记忆反推的隐式项目」，统一应用三池可见性。
 *  - 注册表项目：含显式 create_project 建立的（可能尚无记忆），按创建时间兜底 last_activity；
 *  - 隐式项目：记忆里出现但注册表没有的项目（按 general 兜底）；
 *  - 可见性：shared 恒可见 / user 仅 owner 或 admin / archive 仅 admin / general 按令牌 scope 列表。
 *  空账本 → 空数组（不造数据）。 */
export async function runListProjectsTool(
  storage: StorageBackend,
  account: McpAccount,
): Promise<{ projects: ProjectInfo[]; total: number }> {
  // 注册表项目（可能尚无记忆）
  let registry: ProjectRecord[] = [];
  try {
    registry = await storage.listProjects();
  } catch {
    registry = [];
  }
  // 记忆反推的隐式项目
  const implicit = projectInfosFromMemories(await storage.listMemories({}));
  const byId = new Map<string, ProjectInfo>();
  for (const rec of registry) {
    if (!projectInScope(account, rec.project_id)) continue;
    byId.set(rec.project_id, {
      project_id: rec.project_id,
      memories: 0,
      last_activity: rec.created_at ?? 0,
    });
  }
  for (const info of implicit) {
    if (!projectInScope(account, info.project_id)) continue;
    const cur = byId.get(info.project_id);
    if (cur) {
      cur.memories += info.memories;
      cur.last_activity = Math.max(cur.last_activity, info.last_activity);
    } else {
      byId.set(info.project_id, { ...info });
    }
  }
  const projects = [...byId.values()].sort(
    (a, b) => b.last_activity - a.last_activity || a.project_id.localeCompare(b.project_id),
  );
  return { projects, total: projects.length };
}

/** D6-2：启动自动建共享项目——若注册表无 P-shared 则建（只读镜像/无写权限时静默跳过，绝不阻碍启动）。 */
export async function ensureSharedProject(storage: StorageBackend): Promise<void> {
  try {
    const existing = await storage.getProject('P-shared');
    if (!existing) {
      await storage.createProject({ project_id: 'P-shared', kind: 'shared', created_by: 'bootstrap' });
    }
  } catch {
    // 只读镜像或创建失败：共享池缺省不阻断主流程
  }
}
