// 层级管理页每层内的记忆表格（带可拖拽表头列宽）
// 复用最核心的拖拽逻辑，列定义与 MemoryTable 保持一致，宽度独立持久化到 localStorage。
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { MemoryRecord } from './types.ts';
import type { LayerId } from './MemoryLayeredPage.tsx';
import { decayClass } from './logic.ts';
import { fmtLayerGen } from '../shared/layerTime.ts';

/** 列标题 + 默认宽度（px） */
const COLS = [
  { key: 'id',     label: 'ID',       defW: 110 },
  { key: 'source', label: '来源',     defW: 72 },
  { key: 'content',label: '层内容',   defW: 200 },
  { key: 'type',   label: '类型',     defW: 72 },
  { key: 'tags',   label: '标签',     defW: 80 },
  { key: 'imp',    label: '重要度',   defW: 48 },
  { key: 'conf',   label: '置信',     defW: 48 },
  { key: 'access', label: '访问/强化',defW: 56 },
  { key: 'mark',   label: '标记',     defW: 38 },
  { key: 'temp',   label: '温度',     defW: 50 },
  { key: 'status', label: '状态',     defW: 60 },
  { key: 'merge',  label: '合并谱系', defW: 60 },
  { key: 'time',   label: '创建/更新',defW: 72 },
] as const;

function sourceLabel(src: string | undefined): string {
  if (!src || src === 'manual') return '—';
  if (src === 'webhook') return '⚡Webhook';
  if (src === 'mcp') return '🔌MCP';
  return `📡${src}`;
}

const COL_RESIZE_BASE = 'layer-table-widths';

function loadWidths(layerId: string): number[] {
  if (typeof localStorage === 'undefined') return COLS.map((c) => c.defW);
  try {
    const raw = localStorage.getItem(`${COL_RESIZE_BASE}-${layerId}`);
    if (!raw) return COLS.map((c) => c.defW);
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr)) return COLS.map((c) => c.defW);
    return arr.map((v, i) => (Number.isFinite(v) && v >= 40 ? v : COLS[i].defW));
  } catch {
    return COLS.map((c) => c.defW);
  }
}
function saveWidths(layerId: string, w: number[]): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(`${COL_RESIZE_BASE}-${layerId}`, JSON.stringify(w)); } catch { /* silent */ }
}

function Pct({ v }: { v: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return <span style={{ fontSize: 11 }}>{pct}%</span>;
}
function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('zh-CN'); } catch { return iso; }
}

export function LayerMemoryTable({
  layerId,
  memories,
  layerContent,
  selectedId,
  onSelect,
}: {
  layerId: LayerId;
  memories: MemoryRecord[];
  /** layerContent[layerId][memId] = 该层内容字符串 | null */
  layerContent: Record<string, string | null>;
  selectedId?: string | null;
  onSelect?: (memId: string, layer: LayerId) => void;
}) {
  const [colW, setColW] = useState<number[]>(() => loadWidths(layerId));
  const colWRef = useRef(colW);
  colWRef.current = colW; // 始终同步最新宽度
  const rs = useRef<{ col: number; sx: number; sw: number } | null>(null);

  const onMouseDown = (col: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rs.current = { col, sx: e.clientX, sw: colW[col] };
    const onMove = (ev: MouseEvent) => {
      const r = rs.current;
      if (!r) return;
      const next = Math.max(40, Math.round(r.sw + (ev.clientX - r.sx)));
      setColW((w) => w.map((v, i) => (i === r.col ? next : v)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      rs.current = null;
      // 直接读 ref 确保拿到最新宽度后落盘
      saveWidths(layerId, colWRef.current);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const thW = (i: number): CSSProperties => ({ width: colW[i], minWidth: colW[i], flex: `0 0 ${colW[i]}px` });

  return (
    <table className="layer-table" data-testid={`${layerId}-table`}>
      <thead>
        <tr>
          {COLS.map((col, i) => (
            <th key={col.key} style={thW(i)} data-testid={`${layerId}-th-${i}`}>
              <span className="layer-th-label">{col.label}</span>
              <span
                className="layer-col-resize"
                data-testid={`${layerId}-resize-${i}`}
                onMouseDown={(e) => onMouseDown(i, e)}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {memories.length === 0 ? (
          <tr><td colSpan={COLS.length} style={{ textAlign: 'center', color: 'var(--dim)', padding: 20 }}>该层暂无数据</td></tr>
        ) : memories.map((m) => {
          const content = layerContent[m.id] ?? '';
          const isSelected = selectedId === m.id;
          const temp = decayClass(m);
          return (
            <tr
              key={`${m.id}-${layerId}`}
              className={`lrow${m.pinned ? ' pinned' : ''}${isSelected ? ' sel' : ''}`}
              data-testid={`lrow-${m.id}`}
              data-layer={layerId}
              onClick={() => onSelect?.(m.id, layerId)}
            >
              <td className="lmid">{m.id}</td>
              <td style={{ fontSize: 11 }}>{sourceLabel(m.source_agent)}</td>
              <td className="lcontent" title={content}>
                {content ? content.slice(0, 80) + (content.length > 80 ? '…' : '') : <span className="ldim">该层暂无内容</span>}
              </td>
              <td><span className="pill">{m.type}</span></td>
              <td className="ltags">
                {m.tags.length === 0 ? <span className="ldim">—</span> : m.tags.slice(0, 2).map((t) => (
                  <span className="pill" key={t}>{t}</span>
                ))}
                {m.tags.length > 2 && <span className="ldim">+{m.tags.length - 2}</span>}
              </td>
              <td><Pct v={m.importance} /></td>
              <td><Pct v={m.confidence} /></td>
              <td style={{ fontSize: 11 }}>{m.access_count} / {m.reinforce_count}</td>
              <td className="lmark">
                {m.pinned && <span title="已置顶">📌</span>}
                {m.locked && <span title="已锁定">🔒</span>}
                {m.archived && <span title="已归档">🗄️</span>}
                {m.refined_by === 'stub' && <span className="lref" title="未接入 LLM，仅 L1 脱敏原文">未精炼</span>}
                {m.refined_by === 'llm_partial' && <span className="lref" title="LLM 精炼中途失败：部分层级是真实 LLM 产物，其余缺失（批次27 P2-4 诚实标注）">部分精炼</span>}
                {!m.pinned && !m.locked && !m.archived && m.refined_by !== 'stub' && m.refined_by !== 'llm_partial' && <span className="ldim">—</span>}
              </td>
              <td><span className={`ltemp ${temp}`}>{temp}</span></td>
              <td><span className="lstatus">{m.status}</span></td>
              <td style={{ fontSize: 11 }}>
                {m.merged_from ? `合并自 ${m.merged_from.length} 条` : '—'}
              </td>
              <td className="ltime">
                <div className="ldim">{fmtDate(m.created_at)}</div>
                <div className="ldim">↻ {fmtDate(m.updated_at)}</div>
                <div className="ldim" data-testid={`layer-gen-at-${m.id}`}>{fmtLayerGen(m.layers_generated_at, 'date')}</div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
