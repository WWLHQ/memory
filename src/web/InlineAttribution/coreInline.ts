// 内联标识演示页（REQ-004 / T10）接真内核：干预反馈走 ma._feedback（confirm +0.1 /
// reject −0.05 / disputed 挂 9.7），记忆实体 seed 进内核（对话标记的 memory_id 真实存在）。
import type { MemAgent } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';

interface InlineCtx {
  ma: MemAgent;
  storage: InMemoryStorage;
}

let ctxP: Promise<InlineCtx> | null = null;

function getCtx(): Promise<InlineCtx> {
  if (!ctxP) {
    ctxP = (async () => {
      const storage = new InMemoryStorage();
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'U1', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage,
      });
      // 对话标记引用的记忆实体（mem_id 与演示标记一致，反馈真命中）
      await ma._seedMemory({ mem_id: 'mem_005', content: '约束：API 响应时间 < 200ms（10.3 性能验收）', category: 'constraint', project_id: 'P1', decay_class: 'cold', confidence: 0.6 });
      await ma._seedMemory({ mem_id: 'mem_009', content: '2025-07-05：选 FastAPI 而非 Django（性能优先，10.x 决策记录）', category: 'decision', project_id: 'P1', decay_class: 'hot', confidence: 0.6 });
      await ma._seedMemory({ mem_id: 'mem_021', content: 'L2 摘要：当前 FastAPI 版本与连接池配置（45 天）', category: 'context', project_id: 'P1', decay_class: 'warm', confidence: 0.6 });
      await ma._seedMemory({ mem_id: 'mem_030', content: '新结论：本次会话识别的优化点（自动写入）', category: 'fact', project_id: 'P1', confidence: 0.6 });
      return { ma, storage };
    })();
  }
  return ctxP;
}

/** 干预反馈真写内核：confirm +0.1 / reject −0.05（钳 0.05）/ disputed 挂 9.7 裁决队列 */
export async function coreInlineFeedback(
  memory_id: string, action: 'confirm' | 'reject' | 'disputed',
): Promise<{ ok: boolean; trust_delta: number; request_id: string }> {
  const { ma } = await getCtx();
  const r = await ma._feedback(memory_id, action);
  return { ok: r.ok, trust_delta: r.trust_delta, request_id: r.request_id };
}

/** 内核审计累计（memory_op 含 feedback，detail.op=kind） */
export async function coreInlineAuditCount(): Promise<number> {
  const { storage } = await getCtx();
  return (await storage.queryAudit({ action: 'memory_op' })).length;
}
