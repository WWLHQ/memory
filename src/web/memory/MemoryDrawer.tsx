// 记忆管理页详情/编辑抽屉（T5）
// 仅 content 可内联编辑（9.5：MEMORY.md 手动增删改）；importance/confidence 只读展示（17.4 程序通道控制：
// confirm/reject trust_delta、9.7 裁决、P4 生命周期调参面板才是规格允许的调整入口），用户不可直接拖动。
import type { MemoryRecord } from './types.ts';
import { decayClass } from './logic.ts';

export function MemoryDrawer({
  rec,
  onClose,
  onSave,
}: {
  rec: MemoryRecord;
  onClose: () => void;
  onSave: (next: MemoryRecord) => void;
}) {
  const temp = decayClass(rec);
  return (
    <div className="drawer" data-testid="memory-drawer">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>记忆详情 · <span className="mid">{rec.id}</span></b>
        <button type="button" className="btn" onClick={onClose} data-testid="drawer-close">关闭</button>
      </div>
      <div className="kv">
        <b>类型</b><span>{rec.type}</span>
        <b>温度 / 状态</b><span>{temp} / {rec.status}</span>
        <b>标记</b><span>
          {rec.pinned && '📌置顶 '}{rec.locked && '🔒锁定 '}{rec.archived && '🗄️归档 '}
          {!rec.pinned && !rec.locked && !rec.archived && '—'}
        </span>
        <b>标签</b><span>{rec.tags.join(', ') || '—'}</span>
        <b>访问 / 强化</b><span>{rec.access_count} / {rec.reinforce_count}</span>
        <b>合并谱系</b><span>{rec.merged_from ? `合并自 ${rec.merged_from.join(', ')}` : '—'}</span>
        <b>创建 / 更新</b><span>{rec.created_at} / {rec.updated_at}</span>
      </div>

      <div className="section-title">内联编辑（本地）</div>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', margin: '6px 0 2px' }}>内容</label>
      <textarea
        data-testid="edit-content"
        defaultValue={rec.content}
        rows={3}
        style={{ width: '100%', background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}
        onChange={(e) => onSave({ ...rec, content: e.target.value, updated_at: new Date().toISOString() })}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>重要度 {Math.round(rec.importance * 100)}%</label>
        <div className="bar" style={{ flex: 1, height: 8, background: 'var(--panel2)', borderRadius: 4, overflow: 'hidden' }}>
          <div data-testid="ro-importance" style={{ width: `${rec.importance * 100}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>置信 {Math.round(rec.confidence * 100)}%</label>
        <div className="bar" style={{ flex: 1, height: 8, background: 'var(--panel2)', borderRadius: 4, overflow: 'hidden' }}>
          <div data-testid="ro-confidence" style={{ width: `${rec.confidence * 100}%`, height: '100%', background: 'var(--ok)' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--dim)' }}>由程序控制（强化/裁决通道），可在生命周期页调参</span>
      </div>
    </div>
  );
}
