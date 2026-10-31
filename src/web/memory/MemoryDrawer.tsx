// 记忆管理页详情/编辑抽屉（T5）
// 仅 content 可内联编辑（9.5：MEMORY.md 手动增删改）；importance/confidence 只读展示（17.4 程序通道控制：
// confirm/reject trust_delta、9.7 裁决、P4 生命周期调参面板才是规格允许的调整入口），用户不可直接拖动。
// 编辑保存 → 写回真实账本（coreUpdateContent：version+1 + memory_op 审计）。
// G4：locked 记忆内容只读（先解锁才能编辑）。
// 「记忆存储位置」：诚实标注这条记忆落在哪里（桌面 = 主进程 FileStorage 真实路径 / 浏览器 = 内存态）。
import { useEffect, useState } from 'react';
import type { MemoryRecord, MemoryStoreLocation } from './types.ts';
import { decayClass } from './logic.ts';
import { openMemoryFile } from './coreMemoryOps.ts';

// 时间一律转本地时区展示，账本里的 UTC ISO 不直接给用户看。
const localTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-CN') : '—');

function locLabel(loc: MemoryStoreLocation | null): string {
  if (!loc) return '加载中…';
  switch (loc.kind) {
    case 'file':
      return `本机账本 · ${loc.path}`;
    case 'memory':
      return '浏览器内存态（未落盘，刷新即失）';
    default:
      return '账本位置未知（IPC 不可用）';
  }
}

export function MemoryDrawer({
  rec,
  location,
  onClose,
  onSave,
}: {
  rec: MemoryRecord;
  /** 账本位置（来自 coreMemoryOps.storageLocation；诚实标注，非演示） */
  location: MemoryStoreLocation | null;
  onClose: () => void;
  onSave: (next: MemoryRecord) => void;
}) {
  const temp = decayClass(rec);
  const [draft, setDraft] = useState(rec.content);
  const [saving, setSaving] = useState(false);
  const [openState, setOpenState] = useState<{ busy: boolean; msg: string | null }>({ busy: false, msg: null });

  // 切换记忆时重置草稿
  useEffect(() => { setDraft(rec.content); setOpenState({ busy: false, msg: null }); }, [rec.id, rec.content]);

  const dirty = draft !== rec.content;
  const editable = !rec.locked;

  async function save() {
    if (!dirty || !editable || saving) return;
    setSaving(true);
    try {
      await onSave({ ...rec, content: draft });
    } finally {
      setSaving(false);
    }
  }

  // 打开记忆文件：导出为独立 .json 并在 OS 默认查看器/编辑器中打开（桌面专属）
  async function openFile() {
    if (openState.busy) return;
    setOpenState({ busy: true, msg: null });
    const r = await openMemoryFile(rec.id);
    if (r.ok) {
      setOpenState({ busy: false, msg: `已打开文件：${r.path}` });
    } else {
      setOpenState({ busy: false, msg: `无法打开文件：${r.error}` });
    }
  }

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
        <b>创建 / 更新</b><span>{localTime(rec.created_at)} / {localTime(rec.updated_at)}</span>
        <b>层级生成</b><span data-testid="drawer-layer-gen-at">
          {rec.layers_generated_at ? localTime(rec.layers_generated_at) : '未记录（批次24 之前的历史行）'}
        </span>
        <b>存储位置</b>
        <span data-testid="store-location" style={{ wordBreak: 'break-all' }}>
          {locLabel(location)}
        </span>
      </div>

      <div className="row" style={{ marginTop: 10, justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          className="btn primary"
          data-testid="open-memory-file"
          disabled={openState.busy}
          onClick={() => void openFile()}
        >
          {openState.busy ? '正在打开…' : '📂 打开记忆文件'}
        </button>
        {openState.msg && (
          <span data-testid="open-file-msg" style={{ fontSize: 11, color: 'var(--dim)', wordBreak: 'break-all' }}>
            {openState.msg}
          </span>
        )}
      </div>

      <div className="section-title">
        内联编辑（写回本机账本）
        {rec.locked && <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>🔒 已锁定 · 只读，先解锁才能编辑</span>}
      </div>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', margin: '6px 0 2px' }}>内容</label>
      <textarea
        data-testid="edit-content"
        value={draft}
        rows={5}
        readOnly={!editable}
        style={{
          width: '100%', background: 'var(--panel2)', color: 'var(--txt)',
          border: '1px solid var(--line)', borderRadius: 8, padding: 8,
          opacity: editable ? 1 : 0.7, cursor: editable ? 'text' : 'not-allowed',
        }}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--dim)' }}>
          {dirty ? '有未保存修改' : '已保存的内容 = 账本真实内容'}
        </span>
        <button
          type="button"
          className="btn primary"
          data-testid="drawer-save"
          disabled={!dirty || !editable || saving}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存修改'}
        </button>
      </div>
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
