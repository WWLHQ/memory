// MCP 读工具编排（批次44-D5-1）：list_memories / get_memory。
// TCP(8202) 与 HTTP(8204) 共用同一份项目定位、过滤、排序、分页与字段裁剪逻辑，避免两端漂移。
//
// 红线：对外只返回白名单摘要字段——绝不携带 content_l0_enc / content_orig / has_l0 等 L0 材料；
// L0 原文只能通过授权连续会话（browse/decrypt）查阅。所有项目均经 projectInScope 校验。
import { projectInScope } from './mcpAuth.ts';
import { McpToolError, projectInfosFromMemories, resolveProjectId } from './mcpRecall.ts';
import { CATEGORIES, isCategory, type Memory, type StorageBackend } from './types.ts';

const DECAY_CLASSES = ['hot', 'warm', 'cold', 'archived', 'dormant'];
const SNIPPET_MAX = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** 对外可见的记忆摘要（白名单字段；可选字段为 undefined 时 JSON 序列化自动省略） */
export interface MemoryView {
  mem_id: string;
  project_id: string;
  category: string;
  layer: string;
  decay_class: string;
  pinned: boolean;
  locked: boolean;
  created_at: number;
  updated_at?: number;
  importance?: number;
  confidence?: number;
  access_count?: number;
  created_by_agent?: string;
  tags?: string[];
  /** content_l1（脱敏层）优先，取前 200 字；不含 L0 密文 */
  snippet: string;
}

export function toMemoryView(m: Memory): MemoryView {
  return {
    mem_id: m.mem_id,
    project_id: m.project_id,
    category: m.category,
    layer: m.layer,
    decay_class: m.decay_class,
    pinned: m.pinned,
    locked: m.locked,
    created_at: m.created_at,
    updated_at: m.updated_at,
    importance: m.importance,
    confidence: m.confidence,
    access_count: m.access_count,
    created_by_agent: m.created_by_agent,
    tags: m.tags ? [...m.tags] : undefined,
    snippet: String(m.content_l1 ?? m.content ?? '').slice(0, SNIPPET_MAX),
  };
}

function optionalString(v: unknown, name: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new McpToolError(`list_memories.${name} 须为字符串`);
  return v.trim() || undefined;
}

function optionalInt(v: unknown, name: string, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new McpToolError(`list_memories.${name} 须为 ${min}–${max} 的整数`);
  }
  return v;
}

export interface ListMemoriesResult {
  ok: true;
  project_id: string;
  resolved_from: 'explicit' | 'single_project';
  total: number;
  offset: number;
  limit: number;
  items: MemoryView[];
}

/**
 * 清单盘点（治理用，非语义检索）：按条件过滤 → 最近活动倒序 → 分页 → 裁剪。
 * 省略 project_id 时只在**令牌可见项目**内自动定位唯一项目（0/多项目明确报错，不猜）。
 */
export async function runListMemoriesTool(
  storage: StorageBackend,
  args: Record<string, unknown>,
  scope?: string[],
): Promise<ListMemoriesResult> {
  const infos = projectInfosFromMemories(await storage.listMemories({}))
    .filter((p) => projectInScope(scope, p.project_id));
  const { project_id, resolved_from } = resolveProjectId(infos, args.project_id);
  if (!projectInScope(scope, project_id)) {
    throw new McpToolError(`当前 MCP 令牌作用域不含项目 ${project_id}（scope 校验）`);
  }

  const category = args.category;
  if (category !== undefined && (typeof category !== 'string' || !isCategory(category))) {
    throw new McpToolError(`list_memories.category 非法：${String(category)}（允许：${CATEGORIES.join('/')}）`);
  }
  const decayClass = args.decay_class;
  if (decayClass !== undefined && (typeof decayClass !== 'string' || !DECAY_CLASSES.includes(decayClass))) {
    throw new McpToolError(`list_memories.decay_class 非法：${String(decayClass)}（允许：${DECAY_CLASSES.join('/')}）`);
  }
  const sourceAgent = optionalString(args.source_agent, 'source_agent');
  const tag = optionalString(args.tag, 'tag');
  const updatedSince = optionalInt(args.updated_since, 'updated_since', 0, Number.MAX_SAFE_INTEGER);
  const limit = optionalInt(args.limit, 'limit', 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
  const offset = optionalInt(args.offset, 'offset', 0, Number.MAX_SAFE_INTEGER) ?? 0;

  let mems = (await storage.listMemories({ project_id })).filter((m) => !m.deleted);
  if (category !== undefined) mems = mems.filter((m) => m.category === category);
  if (decayClass !== undefined) mems = mems.filter((m) => m.decay_class === decayClass);
  if (sourceAgent !== undefined) mems = mems.filter((m) => m.created_by_agent === sourceAgent);
  if (tag !== undefined) mems = mems.filter((m) => (m.tags ?? []).includes(tag!));
  if (updatedSince !== undefined) {
    mems = mems.filter((m) => (m.updated_at ?? m.created_at ?? 0) >= updatedSince!);
  }
  mems.sort((a, b) =>
    (b.updated_at ?? b.created_at ?? 0) - (a.updated_at ?? a.created_at ?? 0)
    || b.mem_id.localeCompare(a.mem_id),
  );

  const total = mems.length;
  return {
    ok: true,
    project_id,
    resolved_from,
    total,
    offset,
    limit,
    items: mems.slice(offset, offset + limit).map(toMemoryView),
  };
}

export type GetMemoryResult =
  | { ok: true; item: MemoryView }
  | { ok: false; item: null; reason: string };

/** 精确读单条：不存在如实回 ok:false，越界项目拒绝（不泄任何 L0 材料） */
export async function runGetMemoryTool(
  storage: StorageBackend,
  args: Record<string, unknown>,
  scope?: string[],
): Promise<GetMemoryResult> {
  const id = args.mem_id;
  if (!id || typeof id !== 'string' || !id.trim()) {
    throw new McpToolError('get_memory.mem_id 必填且须为非空字符串');
  }
  const m = await storage.getMemory(id.trim());
  if (!m || m.deleted) return { ok: false, item: null, reason: '记忆不存在' };
  if (!projectInScope(scope, m.project_id)) {
    throw new McpToolError(`当前 MCP 令牌作用域不含项目 ${m.project_id}（scope 校验）`);
  }
  return { ok: true, item: toMemoryView(m) };
}
