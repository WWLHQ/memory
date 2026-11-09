// 功能导航栏底部的「层级刻度」（批次53 定义 / 批次55 改数据源）：L0–L6 七档的真实计数。
//
// 批次55 口径变更：不再自己二次调用 storage.listMemories + storage.browse(L1–L6)，
// 改为复用「概览页 getHomeFeed」同一次真实账本读取派生的 strata 计数。
// 这样层级刻度与中心区四卡、导航角标看到的是同一份快照，避免会话/刷新时序造成
// 一侧成功、另一侧报「需要登录操作」。读失败时整块如实报错，绝不拿 0 或演示数字代替。
//
// 口径：
//   · L0 = 账本里有 L0 原文的记忆条数（has_l0 / 行上信封 / 行上明文三者并集，与 l0Split.decide 同源）；
//   · L1–L6 = deriveLayerGraph 中「该层有非空内容」的去重记忆数；
//   · 短名（密文/脱敏/摘要/要点/场景/边界/索引）按定稿图，内核正式层名保留在 fullName/title。

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

export interface StrataRowView {
  layer: StrataLayerId;
  label: string;
  fullName: string;
  color: string;
  /** null = 该层计数缺失/非法（≠ 该层为 0） */
  count: number | null;
}

export interface StrataScaleView {
  rows: StrataRowView[];
  failed: StrataLayerId[];
  kernelMode: 'host' | 'browser';
  loadedAt: number;
}

/** 批次55：概览快照中层级刻度真正需要的字段（避免壳层反向依赖 Home 实现细节）。 */
export interface StrataSnapshotLike {
  strata: { layer: string; count: number }[] | null;
  kernelMode: 'host' | 'browser';
  loadedAt: number;
  storageError: string | null;
}

/**
 * 由概览页同一次真实账本读取生成刻度视图。
 * - storageError 或 strata=null → 整块 error，不渲染任何行；
 * - 某层缺失 / 计数非法 → 该层显示「读取失败」而不是 0。
 */
export function strataViewFromOverview(snapshot: StrataSnapshotLike | null): DockResult<StrataScaleView> {
  if (!snapshot) return { status: 'error', detail: '账本读取中…' };
  if (snapshot.storageError || !snapshot.strata) {
    return { status: 'error', detail: `账本读取失败：${snapshot.storageError ?? '未拿到分层计数'}` };
  }
  const counts = new Map<string, number>();
  for (const s of snapshot.strata) {
    if (typeof s.count === 'number' && Number.isFinite(s.count) && s.count >= 0) counts.set(s.layer, Math.floor(s.count));
  }
  const failed: StrataLayerId[] = [];
  const rows: StrataRowView[] = STRATA_LAYERS.map((s) => {
    const count = counts.get(s.layer) ?? null;
    if (count === null) failed.push(s.layer);
    return { ...s, count };
  });
  return {
    status: 'ok',
    view: {
      rows,
      failed,
      kernelMode: snapshot.kernelMode,
      loadedAt: snapshot.loadedAt,
    },
  };
}
