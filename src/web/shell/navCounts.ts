// 批次54：功能导航角标的真实数据加载器。
//
// 口径：只读真实账本 / 真实接入后端；读不到、后端不可达、结果为 0 一律「不显示角标」，
// 绝不写死参考图里的 1467 / 3 / 3 示例数。参考图只提供信息架构，不提供数据。
import { AgentOnboardClient } from '../../agentOnboard/client.ts';
import { coreListMemories } from '../memory/coreMemoryOps.ts';
import { coreConflicts } from '../dispute/coreDispute.ts';
import { onboardBaseUrl } from '../backend.ts';
import { currentSessionId } from '../shared/session.ts';

export type NavCountId = 'memory-bank' | 'dispute' | 'agent';
export type NavCounts = Partial<Record<NavCountId, number>>;

/** GET /agents 的真实卡片数；后端被显式关闭或不可达时返回 0（调用方不显示角标）。 */
async function realAgentCount(): Promise<number> {
  const base = onboardBaseUrl();
  if (!base) return 0;
  try {
    const client = new AgentOnboardClient(base, globalThis.fetch, () => currentSessionId());
    const cards = await client.getCards();
    return Array.isArray(cards) ? cards.length : 0;
  } catch {
    return 0;
  }
}

/**
 * 三个角标并发读取，任一失败只影响自己：
 * - memory-bank = 内核账本记忆条数（coreListMemories，同源真实账本）
 * - dispute     = 内核真实 pending 冲突队列长度（coreConflicts）
 * - agent       = 接入后端真实 Agent 卡片数（GET /agents）
 */
export async function loadNavCounts(): Promise<NavCounts> {
  const [memories, conflicts, agents] = await Promise.allSettled([
    coreListMemories(),
    coreConflicts(),
    realAgentCount(),
  ]);
  const out: NavCounts = {};
  if (memories.status === 'fulfilled') out['memory-bank'] = memories.value.length;
  if (conflicts.status === 'fulfilled') out.dispute = conflicts.value.length;
  if (agents.status === 'fulfilled') out.agent = agents.value;
  return out;
}
