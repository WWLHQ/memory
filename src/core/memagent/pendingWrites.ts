// 落盘兜底队列（A3 §4.4.4 / 批次44-D4）
//
// 目的：L0 写密钥「锁屏/休眠/退出/重启/手动锁定」期间（writeDek 不在内存），write_memory 原本会
// 直接抛 E_L0_LOCKED 丢失本次内容。本模块让写入不再丢：锁定时先入 pending 队列，待写密钥解锁后由
// flush 原样重放落库。落盘形态对齐 external-source/.../ops/pending/*.json（<stamp>-<rand>.json + status）。
//
// 分层：
//   · 本文件：纯逻辑 + 内存实现 + 接口（不依赖 node:fs，可被浏览器端 agent.ts 安全引用）
//   · pendingStoreFile.ts：node-only 的文件落盘实现（仅桌面/MCP server 引用）
import { ulid } from './ulid.ts';
import type { MemReq } from './types.ts';

/** write_memory 的扩展打分旋钮（与 memories.ts parseWriteKnobs 的返回形态一致） */
export type WriteKnobs = Pick<
  { importance?: number; confidence?: number; half_life_days?: number; tags?: string[] },
  'importance' | 'confidence' | 'half_life_days' | 'tags'
>;

/** 一条待重放的写入（落盘 JSON 的同形态） */
export interface PendingWrite extends MemReq, WriteKnobs {
  id: string;
  status: 'pending';
  created_at: number;
}

/** 待重放队列的存储端口（内存 / 文件 两种实现） */
export interface PendingStore {
  enqueue(item: PendingWrite): Promise<void>;
  list(): Promise<PendingWrite[]>;
  remove(id: string): Promise<void>;
  count(): Promise<number>;
}

/** 内存实现（单元测试 / 无持久化要求的场景；默认兜底） */
export class MemoryPendingStore implements PendingStore {
  private items: PendingWrite[] = [];
  async enqueue(item: PendingWrite): Promise<void> {
    this.items.push(item);
  }
  async list(): Promise<PendingWrite[]> {
    return [...this.items];
  }
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
  }
  async count(): Promise<number> {
    return this.items.length;
  }
}

/**
 * pending 队列编排：enqueue（锁定时暂存）→ flush（解锁后重放）。
 * flush 按 created_at 升序逐条重放，成功即移除；仍被锁或出错则保留待下次重放。
 */
export class PendingWrites {
  constructor(private readonly store: PendingStore) {}

  /** 入队一条写入；返回 pending_id（供回执与重放排障） */
  async enqueue(req: MemReq & WriteKnobs): Promise<string> {
    const item: PendingWrite = {
      ...req,
      id: `pend_${ulid()}`,
      status: 'pending',
      created_at: Date.now(),
    };
    await this.store.enqueue(item);
    return item.id;
  }

  async count(): Promise<number> {
    return this.store.count();
  }

  /**
   * 重放所有 pending：解锁后调用，writeFn 即内核 write。
   * 仍锁定（E_L0_LOCKED）或任何错误 → 该条保留、failed 计数，不影响其它条目。
   * 队列为空 → 直接短路返回，零开销。
   */
  async flush(writeFn: (req: MemReq & WriteKnobs) => Promise<unknown>): Promise<{ flushed: number; failed: number }> {
    if ((await this.store.count()) === 0) return { flushed: 0, failed: 0 };
    const items = await this.store.list();
    let flushed = 0;
    let failed = 0;
    for (const it of items) {
      try {
        await writeFn(it);
        await this.store.remove(it.id);
        flushed += 1;
      } catch {
        failed += 1;
      }
    }
    return { flushed, failed };
  }
}
