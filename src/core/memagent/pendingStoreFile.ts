// 文件落盘实现（node-only）：pending 队列持久化到 <dir>/pending-<id>.json。
// 仅桌面主进程 / MCP server 引用，绝不进入浏览器构建图（避免 node:fs 被 web 打包）。
import { mkdir, writeFile, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { PendingStore, PendingWrite } from './pendingWrites.ts';

/**
 * 落盘 pending 队列（与 external-source/.../ops/pending/*.json 同形态）。
 * 进程重启后仍在（L0 写密钥同时也被清空，条目保持 pending 直到下次解锁再重放——绝不自动伪造密文）。
 */
export class FilePendingStore implements PendingStore {
  constructor(private readonly dir: string) {}

  private pathOf(id: string): string {
    return join(this.dir, `pending-${id}.json`);
  }

  async enqueue(item: PendingWrite): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathOf(item.id), JSON.stringify(item, null, 2), 'utf8');
  }

  async list(): Promise<PendingWrite[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const items: PendingWrite[] = [];
    for (const name of names) {
      if (!name.startsWith('pending-') || !name.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(this.dir, name), 'utf8');
        const obj = JSON.parse(raw) as PendingWrite;
        if (obj && obj.status === 'pending') items.push(obj);
      } catch {
        // 损坏 / 半写文件：忽略，不阻断重放
      }
    }
    items.sort((a, b) => a.created_at - b.created_at);
    return items;
  }

  async remove(id: string): Promise<void> {
    try {
      await unlink(this.pathOf(id));
    } catch {
      // 已删除：幂等
    }
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }
}
