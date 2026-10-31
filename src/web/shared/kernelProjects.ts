// 项目 ID 真源（批次27 P2-7）：真实项目从内核账本派生（与 MCP list_projects 同口径），
// 页面不再各自硬编码 'P1'；账本为空时回落 DEFAULT_PROJECT_ID（写入占位，首写后即成为真实项目）。
import { getKernelStorage } from '../kernel.ts';

export const DEFAULT_PROJECT_ID = 'P1';

/** 账本里真实存在的项目 ID（去重、稳定序；空账本 → 空数组，不造数据） */
export async function listProjectIds(): Promise<string[]> {
  const all = await getKernelStorage().listMemories({});
  const ids = all
    .map((m) => m.project_id)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  return [...new Set(ids)];
}
