// 内联标识演示页（REQ-004 / T10）接真内核：干预反馈走 ma._feedback（confirm +0.1 /
// reject −0.05 / disputed 挂 9.7）。
// 数据真相 = 内核账本（桌面 = 主进程 FileStorage 持久库；浏览器降级 = 内存态）。
// 与记忆库管理页 / 自我净化与生长页一致：禁止注入演示/种子数据 ——
// 反馈只对账本中真实存在的 memory_id 生效；账本无该记忆 → 诚实提示「账本无此记忆」，绝不伪造。
import type { MemAgent } from '../../core/memagent/types.ts';
import type { InMemoryStorage } from '../../core/memagent/storage.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';

interface InlineCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

function getCtx(): InlineCtx {
  return { ma: getKernel(), storage: getKernelStorage() };
}

/** 账本是否含某条记忆（真实校验，防伪造反馈） */
export async function ledgerHasMemory(mem_id: string): Promise<boolean> {
  const { storage } = await getCtx();
  const m = await storage.getMemory(mem_id);
  return m !== null;
}

/** 干预反馈真写内核：confirm +0.1 / reject −0.05（钳 0.05）/ disputed 挂 9.7 裁决队列
 *  诚实口径：账本无该记忆 → ok=false + 明确提示（不伪造成功） */
export async function coreInlineFeedback(
  memory_id: string, action: 'confirm' | 'reject' | 'disputed',
): Promise<{ ok: boolean; trust_delta: number; request_id: string; message?: string }> {
  const has = await ledgerHasMemory(memory_id);
  if (!has) {
    return { ok: false, trust_delta: 0, request_id: '', message: `账本无此记忆 ${memory_id}（真实账本校验）` };
  }
  const { ma } = await getCtx();
  const r = await ma._feedback(memory_id, action);
  return { ok: r.ok, trust_delta: r.trust_delta, request_id: r.request_id };
}

/** 内核审计累计（memory_op 含 feedback，detail.op=kind） */
export async function coreInlineAuditCount(): Promise<number> {
  const { storage } = await getCtx();
  return (await storage.queryAudit({ action: 'memory_op' })).length;
}

/** 真实账本记忆总数（供页面副标题「数据真相 = 内核账本 N 条」展示） */
export async function coreLedgerMemoryCount(): Promise<number> {
  const { storage } = await getCtx();
  return (await storage.listMemories({})).length;
}
