// Webhook 接收端（§19.3 主通道 / §5.4 SHA-256 幂等保真）
// Agent 经 HTTP POST /ingest 推送会话事件 → L0 加密 → L1–L6 阶梯精炼 → 入记忆库
//
// 设计要点：
//   · 幂等：SHA-256(content + session_id) → hash_index；重复事件自动去重（§5.4）
//   · 双通道：本端为主通道（Webhook）；MCP 为补偿通道（§19.3 5min 对账 + 每日全量补齐）
//   · 审计：每次 ingest 写 'write' 审计 + ingest 来源标记（webhook / mcp）
//
// 端点：
//   POST /ingest          推送会话事件
//   GET  /ingest/status   查询最近 N 条 ingest 状态（5min 对账窗口）
//   GET  /ingest/hash    查询某 hash 是否已收录（幂等查询）
import { createHash } from 'node:crypto';
import type { StorageBackend, Category } from './types.ts';
import { CATEGORIES, isCategory } from './types.ts';

export interface IngestEvent {
  /** 会话原始内容（Agent 会话片段/完整会话） */
  content: string;
  /** 项目 ID（R2 必填） */
  project_id: string;
  /** 会话 ID（幂等键的一部分，§5.4） */
  session_id?: string;
  /** 来源 Agent（webhook / mcp / claude-code / codex …） */
  source_agent?: string;
  /** 记忆类别，缺省 pitfall */
  category?: Category;
  /** 事件时间戳（ISO8601；缺省取服务器当前时间） */
  ts?: string;
}

export interface IngestResult {
  ok: boolean;
  /** 去重状态：new = 新建；grafted = 已入库但分支嫁接到既有记忆（§6.2）；duplicate = 幂等命中未重写 */
  dedup: 'new' | 'grafted' | 'duplicate' | 'error';
  /** 命中的 hash（SHA-256） */
  hash?: string;
  /** 新建记忆的 mem_id */
  mem_id?: string;
  /** L2 摘要预览（仅真实 LLM 精炼时有值；未精炼为 undefined） */
  l2_preview?: string;
  /** 精炼来源：stub = 未接入 LLM（仅 L1） */
  refined_by?: 'stub' | 'llm';
  error?: string;
  ts: string;
}

/** 幂等 hash 索引（内存；持久化可升级为 FileStorage 辅助文件） */
export class HashIndex {
  private hashes = new Map<string, IngestResult>();
  private recent: IngestResult[] = [];

  /** SHA-256(content + session_id) */
  static makeHash(content: string, session_id?: string): string {
    const payload = `${content}|${session_id ?? ''}`;
    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  /** 检查 hash 是否已收录 */
  has(hash: string): boolean {
    return this.hashes.has(hash);
  }

  /** 记录一次 ingest 结果：只有成功结果进入幂等索引（失败必须可重试，不得被缓存吞掉） */
  record(hash: string, result: IngestResult): void {
    if (result.ok && result.dedup !== 'error') this.hashes.set(hash, result);
    this.recent.push(result);
    // 保留最近 200 条（5min 对账窗口，§5.1）
    if (this.recent.length > 200) this.recent.shift();
  }

  /** 最近 N 条（对账用） */
  recentN(n: number): IngestResult[] {
    return this.recent.slice(-n);
  }

  /** 某 hash 的结果（幂等查询） */
  get(hash: string): IngestResult | undefined {
    return this.hashes.get(hash);
  }

  /** 测试用：清空 */
  reset(): void {
    this.hashes.clear();
    this.recent.length = 0;
  }
}

export interface WebhookOptions {
  storage: StorageBackend;
  /** 阶梯精炼（注入 coreWrite 的 L0→L6 管道）；缺省不精炼（降级） */
  refinePipeline?: (input: {
    content: string;
    category: Category;
    project_id: string;
    source_agent?: string;
  }) => Promise<IngestResult>;
  /** hash 索引（缺省新建） */
  hashIndex?: HashIndex;
}

export interface WebhookServer {
  /** 处理一条 ingest 事件（主通道入口） */
  ingest(event: IngestEvent): Promise<IngestResult>;
  /** 查询最近 N 条（5min 对账） */
  recentStatus(n?: number): IngestResult[];
  /** 幂等查询：某 hash 是否已收录 */
  lookupByHash(hash: string): IngestResult | undefined;
  /** 销毁 hash 索引（测试用） */
  close(): void;
}

export function createWebhook(opts: WebhookOptions): WebhookServer {
  const hashIndex = opts.hashIndex ?? new HashIndex();
  const now = () => new Date().toISOString();

  return {
    async ingest(event: IngestEvent): Promise<IngestResult> {
      const ts = event.ts ?? now();
      const hash = HashIndex.makeHash(event.content, event.session_id);

      // 边界校验：外部 JSON 的 category 不可信（coreWrite 前先拒绝，且不占用幂等键）
      if (event.category !== undefined && !isCategory(event.category)) {
        const r: IngestResult = {
          ok: false, dedup: 'error', hash,
          error: `非法 category：${String(event.category)}（允许：${CATEGORIES.join('/')}）`,
          ts,
        };
        hashIndex.record(hash, r); // record 只进 recent，不写幂等索引 → 修正后可重试
        return r;
      }

      // §5.4 幂等：SHA-256 已收录 → 直接返回 duplicate（绝不重写）
      if (hashIndex.has(hash)) {
        const prev = hashIndex.get(hash)!;
        return { ok: true, dedup: 'duplicate', hash, mem_id: prev.mem_id, ts };
      }

      if (!opts.refinePipeline) {
        const r: IngestResult = {
          ok: true, dedup: 'new', hash,
          error: 'refinePipeline 未注入（降级）：L0 明文落库，未加密未精炼',
          ts,
        };
        hashIndex.record(hash, r);
        return r;
      }

      try {
        const result = await opts.refinePipeline({
          content: event.content,
          category: event.category ?? 'pitfall',
          project_id: event.project_id,
          source_agent: event.source_agent,
        });

        const merged: IngestResult = { ...result, hash, ts };
        hashIndex.record(hash, merged);

        // 审计：webhook 来源标记（§4.3 全链路可追溯）
        await opts.storage.appendAudit({
          request_id: `req_wh_${hash.slice(0, 12)}`,
          action: 'write',
          ts: Date.parse(ts),
          project_id: event.project_id,
          detail: {
            source: 'webhook',
            session_id: event.session_id,
            source_agent: event.source_agent,
            dedup: merged.dedup,
            mem_id: merged.mem_id,
          },
        });

        return merged;
      } catch (e) {
        const r: IngestResult = {
          ok: false, dedup: 'error', hash,
          error: String((e as Error)?.message ?? e),
          ts,
        };
        hashIndex.record(hash, r);
        return r;
      }
    },

    recentStatus(n = 20): IngestResult[] {
      return hashIndex.recentN(n);
    },

    lookupByHash(hash: string): IngestResult | undefined {
      return hashIndex.get(hash);
    },

    close(): void {
      hashIndex.reset();
    },
  };
}
