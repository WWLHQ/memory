// 用户反馈页（REQ-006 / P9）接真内核：提交走 ma._feedback（17.4 trust_delta 内核计算）
// module singleton：SEED_OPTIONS 灌入内核，confirm/reject/disputed 真实改记忆置信并写审计。
import type { Memory } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import type { MemAgent } from '../../core/memagent/types.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_OPTIONS } from './seed.ts';
import type { FeedbackDraft } from './types.ts';

let agentP: Promise<MemAgent> | null = null;

function getAgent(): Promise<MemAgent> {
  if (!agentP) {
    agentP = (async () => {
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage: new InMemoryStorage(),
      });
      for (const o of SEED_OPTIONS) {
        const m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'> = {
          mem_id: o.id,
          project_id: 'P1',
          content: o.summary,
          category: o.id === 'mem_011' ? 'preference' : 'fact',
          layer: 'L2',
          confidence: 0.6, // 反馈前基线（17.4 confirm/reject 在此之上增减）
        };
        await ma._seedMemory(m);
      }
      return ma;
    })();
  }
  return agentP;
}

export interface FeedbackOutcome {
  ok: boolean;
  /** 内核计算的 trust_delta（confirm +0.1 / reject −0.05 / disputed 0） */
  trust_delta: number;
  request_id: string;
  /** 操作后的记忆置信（回显用） */
  confidence?: number;
}

/** 提交反馈：内核 17.4 规则执行（confirm +0.1 / reject −0.05 / disputed 挂 9.7 裁决） */
export async function coreSubmitFeedback(d: FeedbackDraft): Promise<FeedbackOutcome> {
  const ma = await getAgent();
  const r = await ma._feedback(d.memory_id, d.action);
  if (!r.ok) return { ok: false, trust_delta: 0, request_id: r.request_id };
  return { ok: true, trust_delta: r.trust_delta, request_id: r.request_id, confidence: r.mem?.confidence };
}
