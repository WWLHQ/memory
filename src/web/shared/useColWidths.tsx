// 表头列宽拖拽与固化（批次24）：记忆库 / 日志记录 / 审计日志三张表共用同一实现。
// 宽度按 storageKey 固化到 localStorage —— 用户调一次，刷新、重登、切页后仍保持；不落服务端、不进审计。
// 单列最小 30px；持久化内容损坏或版本不匹配（列数变化）时逐项回退默认宽度，绝不留下 0 宽列。
import { useCallback, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

export const MIN_COL_WIDTH = 30;

/** 读取固化列宽；缺项/非法项（<30 或非数字）回退默认值，长度始终对齐 defaults */
export function loadColWidths(storageKey: string, defaults: readonly number[]): number[] {
  if (typeof localStorage === 'undefined') return [...defaults];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [...defaults];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [...defaults];
    return Array.from({ length: defaults.length }, (_, i) => {
      const v = Number(arr[i]);
      return Number.isFinite(v) && v >= MIN_COL_WIDTH ? v : defaults[i];
    });
  } catch {
    return [...defaults];
  }
}

export function saveColWidths(storageKey: string, widths: readonly number[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    /* 隐私模式/配额不足 → 本次会话内仍可用，只是不持久化 */
  }
}

export interface ColWidths {
  /** 当前列宽（下标即列序号） */
  widths: number[];
  /** 表头把手 mousedown：开始拖拽，松手即固化 */
  startResize: (col: number, e: MouseEvent) => void;
  /** 恢复默认列宽（并清掉固化值） */
  reset: () => void;
  /** 是否仍为默认宽度（决定是否显示「恢复默认」入口） */
  isDefault: boolean;
}

export function useColWidths(storageKey: string, defaults: readonly number[]): ColWidths {
  const [widths, setWidths] = useState<number[]>(() => loadColWidths(storageKey, defaults));
  const dragging = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const startResize = useCallback(
    (col: number, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging.current = { col, startX: e.clientX, startW: widths[col] };
      const onMove = (ev: globalThis.MouseEvent) => {
        const r = dragging.current;
        if (!r) return;
        const next = Math.max(MIN_COL_WIDTH, Math.round(r.startW + (ev.clientX - r.startX)));
        setWidths((w) => w.map((v, i) => (i === r.col ? next : v)));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        dragging.current = null;
        setWidths((w) => {
          saveColWidths(storageKey, w);
          return w;
        });
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [widths, storageKey],
  );

  const reset = useCallback(() => {
    saveColWidths(storageKey, []);
    setWidths([...defaults]);
  }, [defaults, storageKey]);

  const isDefault = widths.length === defaults.length && widths.every((v, i) => v === defaults[i]);

  return { widths, startResize, reset, isDefault };
}

/** 表头把手（三张表共用；样式见 shared/theme.css 的 .col-fixed） */
export function ColResizeHandle({ col, onCol }: { col: number; onCol: (col: number, e: MouseEvent) => void }) {
  return (
    <span
      className="col-resize"
      data-testid={`col-resize-${col}`}
      title="拖动调整列宽（自动固化，重登后仍保持）"
      onMouseDown={(e) => onCol(col, e)}
    />
  );
}
