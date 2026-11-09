// 功能导航栏底部的「层级刻度」（批次53）：L0–L6 七档的真实计数。
//
// 数据面与中心「分层 L1–L6」页同源：storage.listMemories + storage.browse(L1–L6)。
// 口径：
//   · L0 = 账本里有 L0 原文的记忆条数（has_l0 / 行上信封 / 行上明文三者并集，与 l0Split.decide 同源）；
//     未拆库的老行原文还在行上，拆库后行只留 has_l0，两者都算，绝不重复计数。
//   · L1–L6 = 该层「有非空内容」的去重记忆数；browse 失败返回 null，UI 显示「读取失败」而不是 0。
//   · 浏览器内存态标注 kernelMode='browser'，避免把空账本误读成本机库为空。
// 绝不注入演示数字：刻度上的每个数都来自真实账本读取。

import type { Layer, Memory } from '../../core/memagent/types.ts';
import { coreBrowse, getStorage } from '../memory/coreMemoryOps.ts';
import { hostCapability } from '../../desktop/hostBridge.ts';
import type { DockResult } from './dock.ts';

export type StrataLayerId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface StrataLayerSpec {
  layer: StrataLayerId;
  /** 刻度上的短名（按定稿图） */
  label: string;
  /** 内核正式层名，仅用于 title 说明，避免短名掩盖语义 */
  fullName: string;
  color: string;
}

/** 定稿色阶：中性灰 → 青 → 蓝 → 紫 → 粉 → 橙黄。方块本身在浅/深主题下均可见。 */
export const STRATA_LAYERS: readonly StrataLayerSpec[] = [
  { layer: 'L0', label: '密文', fullName: '原始对话（AES-256 密文，仅授权+密码）', color: '#8fa3bc' },
  { layer: 'L1', label: '脱敏', fullName: '清洗脱敏（唯一可进 prompt 的原始形态）', color: '#22d3ee' },
  { layer: 'L2', label: '摘要', fullName: '会话摘要（≤300 字）', color: '#38bdf8' },
  { layer: 'L3', label: '要点', fullName: '得失分析（≤200 字）', color: '#818cf8' },
  { layer: 'L4', label: '场景', fullName: '模式归纳（≤120 字）', color: '#c084fc' },
  { layer: 'L5', label: '边界', fullName: '洞察提炼（≤60 字）', color: '#f472b6' },
  { layer: 'L6', label: '索引', fullName: '投影索引（≤30 词 + relevance）', color: '#fbbf24' },
];

const BROWSE_LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const;

export interface StrataRowView {
  layer: StrataLayerId;
  label: string;
  fullName: string;
  color: string;
  /** null = 该层读取失败（≠ 该层为 0） */
  count: number | null;
}

export interface StrataScaleView {
  rows: StrataRowView[];
  failed: StrataLayerId[];
  kernelMode: 'host' | 'browser';
  loadedAt: number;
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
const text = (s: unknown): string => typeof s === 'string' ? s.trim() : '';

/** 一层内部：只要有非空内容就计入（与中心层级页 hasContent 口径一致） */
function countWithContent(rows: { mem_id: string; content: string }[]): number {
  const ids = new Set<string>();
  for (const r of rows) if (text(r.content).length > 0) ids.add(r.mem_id);
  return ids.size;
}

/** 有 L0 原文的账本行数：拆库后 has_l0，未拆库时原文在行上 */
function hasOriginal(m: Memory): boolean {
  return !!m.has_l0 || text(m.content_l0_enc).length > 0 || text(m.content_orig).length > 0;
}

export async function loadStrataScale(): Promise<DockResult<StrataScaleView>> {
  let memories: Memory[];
  try {
    // 必须读内核原始行：coreListMemories() 映射出的 MemoryRecord 不含 has_l0 / 行上信封字段
    memories = await getStorage().listMemories({});
  } catch (e) {
    return { status: 'error', detail: `账本读取失败：${errText(e)}` };
  }

  const results = await Promise.allSettled(BROWSE_LAYERS.map((l) => coreBrowse(l as Layer)));
  const counts = new Map<StrataLayerId, number | null>();
  const failed: StrataLayerId[] = [];
  results.forEach((r, i) => {
    const layer = BROWSE_LAYERS[i];
    if (r.status === 'rejected' || !r.value) {
      counts.set(layer, null);
      failed.push(layer);
      return;
    }
    counts.set(layer, countWithContent(r.value.rows));
  });
  counts.set('L0', memories.filter(hasOriginal).length);

  return {
    status: 'ok',
    view: {
      rows: STRATA_LAYERS.map((s) => ({ ...s, count: counts.get(s.layer) ?? null })),
      failed,
      kernelMode: hostCapability() === 'none' ? 'browser' : 'host',
      loadedAt: Date.now(),
    },
  };
}
