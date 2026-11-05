// 写入页（REQ-006 / P2）接真内核：ma.write（六类 + 查重短路嫁接 + 审计）
// module singleton：共享 storage（桌面 Electron 下桥接到主进程 FileStorage 真实账本，与记忆管理页同源）。
// ⚠ 禁止注入演示/种子数据：写入页只反映真实账本；查重由内核真实判定。
import type { Category as CoreCategory } from '../../core/memagent/types.ts';
import type { StorageBackend } from '../../core/memagent/types.ts';
import { getKernel, getKernelStorage } from '../kernel.ts';
import type { MemoryCategory } from './types.ts';
import type { ExistingMemory } from './types.ts';

/** 页面六类（§P2）→ 内核六类（17.6） */
const CATEGORY_MAP: Record<MemoryCategory, CoreCategory> = {
  decision: 'decision',
  pitfall: 'pitfall',
  preference: 'preference',
  fact: 'fact',
  project: 'decision',   // 工作项目 → 决策档
  feedback: 'insight',   // 反馈 → 洞察档
};

/** 共享 storage（与全部页面同源：桌面 Electron 下都桥接到主进程 FileStorage 同一账本） */
function getStorage(): StorageBackend {
  return getKernelStorage();
}

function getAgent(): Promise<import('../../core/memagent/types.ts').MemAgent> {
  return Promise.resolve(getKernel());
}

export interface CoreWriteOutcome {
  mem_id: string;
  /**
   * 内核动作映射（阶段5-E / B10 收敛为内核真实结果的单一真源）：
   * create（new）/ graft（grafted 分支嫁接新建）/ keep（duplicated）/ filtered（L0→L1 质量门拦截）。
   * 旧类型还挂着 merge / overwrite 两种内核从不产出的「用户三模式」值，会诱导出永不命中的 UI 分支，已删除。
   */
  dedup_action: 'create' | 'graft' | 'keep' | 'filtered';
  sim: number;
  request_id: string;
  /** 真实产出的精炼层（未接入 LLM 时仅 content_l1） */
  layers?: Record<string, string>;
  refined_by?: 'stub' | 'llm' | 'llm_partial';
}

/** 提交写入：内核 write（逐层查重 new/grafted/duplicated/filtered）→ 页面回执语义映射 */
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
    // new=create / grafted=graft（新建并嫁接到既有记忆）/ duplicated=keep / filtered=filtered（未入库）
    dedup_action: r.dedup.action === 'new' ? 'create' : r.dedup.action === 'grafted' ? 'graft' : r.dedup.action === 'duplicated' ? 'keep' : 'filtered',
    sim: r.dedup.sim,
    request_id: r.audit.request_id,
    layers: r.layers,
    refined_by: r.refined_by,
  };
}

/**
 * 查重候选 = 真实账本既有记忆（无种子兜底；桌面 = FileStorage 持久库 / 浏览器 = 内存态）。
 * 未接入 LLM 时记忆主内容即 L1（脱敏原文），同样参与查重；候选只用已脱敏内容，不暴露原文。
 */
export async function coreListExisting(): Promise<ExistingMemory[]> {
  await getAgent();
  const mems = await getStorage().listMemories({});
  return mems
    .filter((m) => !m.merged_into && Boolean(m.content))
    .map((m) => ({ id: m.mem_id, content: m.content }));
}
