// 批次33-C：召回明细页的一次性访问票据（id → 已渲染的明细 HTML）。
// 为什么要它：DSH 等客户端只渲染 Markdown、不渲染 <details>（2026-11-01 实测：折叠标签原样露出），
// 聊天气泡里做不出「点黑三角展开」。改为摘要行给一个本机链接，点开是本进程 8204 端口上的真 HTML 页（可折叠）。
// 安全边界：id 由 16 字节随机数生成（base64url，不可枚举）；默认 30 分钟过期；条数封顶并淘汰最早条目；
// URL 里不带 MCP 令牌（令牌仍是机器级凭据，绝不下发到聊天窗口）；页面只由回环端口的 GET /recall/<id> 读取。
import { randomBytes } from 'node:crypto';

export const RECALL_DETAIL_TTL_MS = 30 * 60 * 1000;
export const RECALL_DETAIL_MAX_TICKETS = 200;

export interface RecallDetailTicket<T> {
  payload: T;
  expiresAt: number;
}

/** 进程内票据表（不落盘：明细正文不进数据根，过期即随内存释放） */
export class RecallDetailTickets<T = string> {
  private readonly map = new Map<string, RecallDetailTicket<T>>();

  constructor(
    private readonly ttlMs: number = RECALL_DETAIL_TTL_MS,
    private readonly maxTickets: number = RECALL_DETAIL_MAX_TICKETS,
  ) {}

  /** 签发：返回不可猜的 id 与过期时刻（页面文案与 404 判定都以此为准） */
  issue(payload: T, now: number = Date.now()): { id: string; expiresAt: number } {
    this.evict(now);
    const id = randomBytes(16).toString('base64url');
    const expiresAt = now + this.ttlMs;
    this.map.set(id, { payload, expiresAt });
    return { id, expiresAt };
  }

  /** 读取：过期条目当场回收；未知/过期 id → null（由调用方给诚实 404） */
  take(id: string, now: number = Date.now()): T | null {
    const hit = this.map.get(id);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.map.delete(id);
      return null;
    }
    return hit.payload;
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  /** 先清过期，再按插入顺序淘汰最早条目（Map 迭代序 = 插入序） */
  private evict(now: number): void {
    for (const [id, t] of this.map) {
      if (t.expiresAt <= now) this.map.delete(id);
    }
    while (this.map.size >= this.maxTickets) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
