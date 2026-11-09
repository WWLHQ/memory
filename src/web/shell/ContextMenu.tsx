// 壳层右键菜单（批次49）：表格行 / 导航树 / 标签条 / 检查器共用同一个渲染器。
//
// 口径：
// - 每个可右键区域都渲染真实菜单，绝不出现空菜单，也不用 href="#" 占位；
// - 真正有能力的项绑定真实动作；壳层确实没有能力的项一律禁用，并把原因写在项内与 title 上。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icons.tsx';
import type { IconName } from './views.ts';

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: IconName;
  disabled?: boolean;
  /** 禁用原因（同时作为 title，避免用户点上去没有任何反馈） */
  reason?: string;
  sep?: boolean;
  run?: () => void;
}

export interface ContextMenuState {
  /** 壳层布局坐标（已按 zoom 换算，菜单渲染在 .shell 内） */
  x: number;
  y: number;
  title: string;
  /** testid 后缀：navmenu / tabmenu / inspmenu / rowmenu */
  testId: string;
  items: ContextMenuItem[];
}

export function ContextMenu({ state, onClose }: { state: ContextMenuState | null; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 贴边翻转：菜单在视口右/下边缘会被截断（状态栏右键就在屏幕底部），量完尺寸后回推
  const [shift, setShift] = useState<{ key: ContextMenuState; dx: number; dy: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!state || !el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 6;
    let dx = 0;
    let dy = 0;
    if (r.right > vw - margin) dx = vw - margin - r.right;
    if (r.left + dx < margin) dx = margin - r.left;
    if (r.bottom > vh - margin) dy = vh - margin - r.bottom;
    if (r.top + dy < margin) dy = margin - r.top;
    // 菜单渲染在 .shell 内（CSS zoom 由 .shell 承担）：把视口像素差换回壳层内坐标
    const zoom = el.offsetWidth ? r.width / el.offsetWidth : 1;
    setShift({ key: state, dx: dx / zoom, dy: dy / zoom });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest('.ctx-menu')) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // 滚动会带着菜单离开原位：直接收起，避免出现「浮动在对不上的位置」的假菜单
    const onScroll = () => onClose();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onScroll);
    };
  }, [state, onClose]);

  if (!state) return null;
  // 位移只对当前这次打开生效，换菜单时不带上一份的偏移
  const applied = shift && shift.key === state ? shift : null;
  return (
    <div
      ref={boxRef}
      className="ctx-menu"
      role="menu"
      aria-label={state.title}
      data-testid={`ctx-${state.testId}`}
      style={{ left: state.x + (applied?.dx ?? 0), top: state.y + (applied?.dy ?? 0) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-title">{state.title}</div>
      {state.items.map((item, i) => {
        if (item.sep) return <div className="ctx-sep" key={`sep-${i}`} aria-hidden="true" />;
        return (
          <button
            key={item.id}
            className={`ctx-row${item.disabled ? ' disabled' : ''}`}
            type="button"
            role="menuitem"
            disabled={item.disabled || undefined}
            aria-disabled={item.disabled || undefined}
            title={item.disabled ? (item.reason ?? item.label ?? item.id) : item.label ?? item.id}
            data-testid={`ctx-${state.testId}-${item.id}`}
            onClick={() => {
              if (item.disabled) return;
              item.run?.();
              onClose();
            }}
          >
            <span className="ctx-ic"><Icon name={item.icon ?? 'dot'} size={12} /></span>
            <span className="ctx-label">{item.label ?? item.id}</span>
            {item.disabled && item.reason ? <span className="ctx-reason">{item.reason}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
