// 命令面板（v5 重设计）：Ctrl+K 打开，是原菜单栏 + Ribbon 全量命令的唯一常驻入口。
// 诚实口径与壳层一致：禁用项置灰并写明原因；不过滤时按分组顺序全量展示。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.tsx';
import { PALETTE_GROUPS, type PaletteItem } from './views.ts';

interface CommandPaletteProps {
  open: boolean;
  items: PaletteItem[];
  onClose: () => void;
}

export function CommandPalette({ open, items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 打开时重置输入与选中，并聚焦输入框
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSel(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // 关键词过滤：标签、描述、分组都参与匹配；拼音不做（程序未接线，不伪造）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      `${it.label} ${it.desc ?? ''} ${it.group}`.toLowerCase().includes(q));
  }, [items, query]);

  // 分组聚合：保持 PALETTE_GROUPS 顺序，只渲染有命中项的分组
  const grouped = useMemo(() => {
    const out: { group: string; items: PaletteItem[] }[] = [];
    for (const g of PALETTE_GROUPS) {
      const list = filtered.filter((it) => it.group === g);
      if (list.length) out.push({ group: g, items: list });
    }
    // 过滤关键词可能命中不在预设分组的条目（防御：契约要求全部条目都带分组）
    const known = new Set<string>(PALETTE_GROUPS);
    const rest = filtered.filter((it) => !known.has(it.group));
    for (const it of rest) {
      const bucket = out.find((b) => b.group === it.group);
      if (bucket) bucket.items.push(it);
      else out.push({ group: it.group, items: [it] });
    }
    return out;
  }, [filtered]);

  const flat = useMemo(() => grouped.flatMap((b) => b.items), [grouped]);

  // 选中项滚入可视区
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    // jsdom 未实现 scrollIntoView，用可选调用兜底（真浏览器里生效）
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const runAt = (idx: number) => {
    const item = flat[idx];
    if (!item || item.disabled) return;
    onClose();
    item.run?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, flat.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); runAt(sel); return; }
  };

  let idx = -1;

  return (
    <div
      className="pal-mask"
      data-testid="shell-palette"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div className="pal-box" role="dialog" aria-label="命令面板">
        <div className="pal-input">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSel(0); }}
            placeholder="搜索页面或命令…"
            spellCheck={false}
            aria-label="搜索命令"
          />
          <span className="pal-esc">Esc 关闭</span>
        </div>
        <div className="pal-list" ref={listRef}>
          {flat.length === 0 && <div className="pal-empty">没有匹配的页面或命令。</div>}
          {grouped.map((b) => (
            <div key={b.group}>
              <div className="pal-group">{b.group}</div>
              {b.items.map((it) => {
                idx += 1;
                const my = idx;
                return (
                  <div
                    key={it.id}
                    data-idx={my}
                    role="option"
                    aria-selected={my === sel}
                    aria-disabled={it.disabled || undefined}
                    className={`pal-row${my === sel ? ' sel' : ''}${it.disabled ? ' disabled' : ''}`}
                    title={it.disabled ? it.reason : it.label}
                    onPointerMove={() => setSel(my)}
                    onClick={() => runAt(my)}
                  >
                    <span className="pic"><Icon name={it.icon} size={13} /></span>
                    <span className="plabel">{it.label}</span>
                    {it.desc && <span className="pdesc">{it.desc}</span>}
                    {it.disabled && it.reason && <span className="pal-reason">{it.reason}</span>}
                    {it.kbd && !it.disabled && <span className="pkbd">{it.kbd}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
