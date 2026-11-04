// 渲染层 L0 原数据库只读端口（批次37-A）：拆库后 L1–L6 行只带 has_l0，密文信封在**主进程**的 memories.l0.json。
// 内核 browse 需要信封才能解密，因此这里提供一个「只读 + 走 IPC」的 L0BlobStore 门面：
//   · getAll 一次取完（整库查阅不该逐条打 IPC）；通道是 l0:blobs，主进程校验登录会话；
//   · 拿到的仍是密文——解密只在主进程 L0Vault 内发生，本门面不解密、不缓存正文；
//   · 写/删/整库枚举一律显式 E_NOT_IMPLEMENTED：渲染层永远不是 L0 库的写者，绝不假装可写。
import type { L0Blob, L0BlobStore } from '../../core/memagent/l0Store.ts';
import { MemAgentError } from '../../core/memagent/errors.ts';
import { hostCall } from '../../desktop/hostBridge.ts';
import { currentSessionId } from './session.ts';

type BlobsReply = { ok: true; envelopes: Record<string, string> } | { ok: false; error: string };

const noWrite = (what: string): never => {
  throw new MemAgentError('E_NOT_IMPLEMENTED', `L0 原数据库由主进程独占写入，页面侧${what}不可用（批次37）`);
};

/** 单次 IPC 最多带的 id 数（超出分片，避免一次请求把主进程与渲染层同时撑爆） */
const CHUNK = 200;

export class HostL0BlobStore implements L0BlobStore {
  readonly path = '<主进程 L0 原数据库>';
  /** 渲染层侧永远只读：真正的写锁在主进程 FileL0BlobStore 上 */
  readonly readOnly = true;

  async getAll(mem_ids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (let i = 0; i < mem_ids.length; i += CHUNK) {
      const chunk = mem_ids.slice(i, i + CHUNK);
      const res = await hostCall<BlobsReply>('l0:blobs', [chunk, currentSessionId()]);
      if (!res || res.ok !== true) {
        throw new MemAgentError('E_L0_MISSING_BLOB', res?.error ?? 'L0 原数据库通道不可用（宿主桥未就绪）');
      }
      for (const [id, envelope] of Object.entries(res.envelopes)) out.set(id, envelope);
    }
    return out;
  }

  async get(mem_id: string): Promise<L0Blob | null> {
    const found = await this.getAll([mem_id]);
    const envelope = found.get(mem_id);
    return envelope === undefined ? null : { envelope, sealed_at: 0 };
  }

  async put(): Promise<void> { noWrite('写入'); }
  async delete(): Promise<void> { noWrite('删除'); }
  async ids(): Promise<string[]> { return noWrite('整库枚举'); }
  async count(): Promise<number> { return noWrite('计数'); }
  bytes(): number { return 0; } // 页面侧不持有文件：大小由主进程回显，这里不拿估算冒充
  beginBatch(): void { /* 只读门面：无批次可开 */ }
  commitBatch(): void { /* 只读门面：无批次可提交 */ }
  close(): void { /* 只读门面：锁不在本进程 */ }
}
