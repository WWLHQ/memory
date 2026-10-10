// 写入页（REQ-006 / P2）接真内核：ma.write（六类 + 查重短路嫁接 + 审计）
// module singleton：SEED_EXISTING 灌入内核 InMemoryStorage，提交相似内容真实触发 merged。
import type { Memory, Category as CoreCategory } from '../../core/memagent/types.ts';
import { createMemAgent } from '../../core/memagent/agent.ts';
import { FakeLlmProvider } from '../../core/memagent/llm.ts';
import { InMemoryStorage } from '../../core/memagent/storage.ts';
import { JsVectorBackend } from '../../core/memagent/vector.ts';
import { SEED_EXISTING } from './seed.ts';
import type { MemoryCategory } from './types.ts';

/** 页面六类（§P2）→ 内核六类（17.6） */
const CATEGORY_MAP: Record<MemoryCategory, CoreCategory> = {
  decision: 'decision',
  pitfall: 'pitfall',
  preference: 'preference',
  fact: 'fact',
  project: 'decision',   // 工作项目 → 决策档
  feedback: 'insight',   // 反馈 → 洞察档
};

let agentP: Promise<import('../../core/memagent/types.ts').MemAgent> | null = null;

function getAgent(): Promise<import('../../core/memagent/types.ts').MemAgent> {
  if (!agentP) {
    agentP = (async () => {
      const ma = createMemAgent({
        form: 'web', account: { user_id: 'u_demo', team_id: 't_demo', enterprise_id: 'e_demo' },
        llm: new FakeLlmProvider(), vector: new JsVectorBackend(), storage: new InMemoryStorage(),
      });
      for (const e of SEED_EXISTING) {
        const m: Partial<Memory> & Pick<Memory, 'content' | 'category' | 'project_id'> = {
          mem_id: e.id,
          project_id: 'p1',
          content: e.content,
          category: 'fact',
          layer: 'L3',
        };
        await ma._seedMemory(m);
      }
      return ma;
    })();
  }
  return agentP;
}

export interface CoreWriteOutcome {
  mem_id: string;
  dedup_action: 'create' | 'merge' | 'overwrite' | 'keep';
  sim: number;
  request_id: string;
}

/** 提交写入：内核 write（查重 new/merged/duplicated）→ 页面回执语义映射 */
export async function coreWrite(
  input: { content: string; category: MemoryCategory; project_id: string; session_id?: string; source?: string },
): Promise<CoreWriteOutcome> {
  const ma = await getAgent();
  const r = await ma.write({
    content: input.content,
    category: CATEGORY_MAP[input.category],
    project_id: input.project_id,
    session_id: input.session_id,
    source_agent: input.source,
  });
  return {
    mem_id: r.mem_id,
    // 内核三态 → 页面回执四态：new=create / merged=merge / duplicated=keep
    dedup_action: r.dedup.action === 'new' ? 'create' : r.dedup.action === 'merged' ? 'merge' : 'keep',
    sim: r.dedup.sim,
    request_id: r.audit.request_id,
  };
}
