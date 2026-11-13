// L1–L6 / L0 面板真实数据（S7）：只在中心页为「分层 L1–L6」或「L0 密文」时显示的壳层条。
//
// 与中心真实页面同源：L1–L6 计数来自 storage.browse(Ln) 的「该层有内容」的记忆数；
// 某层读取失败显示「读取失败」而不是 0（0 只在真的读到且没有内容时出现）；L0 只读保险库状态。

import type { L0VaultStatus, Layer } from '../../core/memagent/types.ts';
import { hostCapability } from '../../desktop/hostBridge.ts';
import { coreBrowse, coreListMemories } from '../memory/coreMemoryOps.ts';
import type { DockResult } from './dock.ts';
import { loadL0Status, loadL0Write, type L0WriteView } from './statusbar.ts';

export const PANEL_LAYERS = ['L6', 'L5', 'L4', 'L3', 'L2', 'L1'] as const;
export type PanelLayer = typeof PANEL_LAYERS[number];

export interface LayerCount {
  layer: PanelLayer;
  /** null = 该层读取失败（≠ 该层为 0） */
  count: number | null;
}

export interface LayerPanelView {
  /** 账本记忆条数（storage.listMemories 真实结果） */
  total: number;
  layers: LayerCount[];
  failed: PanelLayer[];
  l0: DockResult<L0VaultStatus>;
  /** 写锁（能不能写）—— 成员可读；与上面的管理口径分开 */
  l0Write: DockResult<L0WriteView>;
  /** host = 本机账本；browser = 进程内内存账本（非本机库），必须标明避免把 0 读成「全库没有」 */
  kernelMode: 'host' | 'browser';
  loadedAt: number;
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

/** 一层内部：只要有非空内容就计入（与中心层级页 hasContent 口径一致） */
function countWithContent(rows: { mem_id: string; content: string }[]): number {
  const ids = new Set<string>();
  for (const r of rows) if (r.content && r.content.trim().length > 0) ids.add(r.mem_id);
  return ids.size;
}

export async function loadLayerPanel(): Promise<DockResult<LayerPanelView>> {
  let total: number;
  try {
    total = (await coreListMemories()).length;
  } catch (e) {
    return { status: 'error', detail: `账本读取失败：${errText(e)}` };
  }

  const results = await Promise.allSettled(PANEL_LAYERS.map((l: PanelLayer) => coreBrowse(l as Layer)));
  const layers: LayerCount[] = [];
  const failed: PanelLayer[] = [];
  results.forEach((r, i) => {
    const layer = PANEL_LAYERS[i];
    // 全部项目都失败时 coreBrowse 返回 null：这是「读不到」，不是「该层 0 条」
    if (r.status === 'rejected' || !r.value) {
      layers.push({ layer, count: null });
      failed.push(layer);
      return;
    }
    layers.push({ layer, count: countWithContent(r.value.rows) });
  });

  return {
    status: 'ok',
    view: {
      total,
      layers,
      failed,
      l0: await loadL0Status(),
      l0Write: await loadL0Write(),
      kernelMode: hostCapability() === 'none' ? 'browser' : 'host',
      loadedAt: Date.now(),
    },
  };
}
