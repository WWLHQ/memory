// 写入页（REQ-006 / P2）表单（T3）
// 字段与顺序照定稿：正文 → 类别 → 来源 → 标签 → session_id → project_id；
// 正文带 300 字 L1 上限计数（超出仍可写入，但 L1 会被内核截断）；project_id 只读必填（R2）。
import type { MemoryCategory, MemoryDraft, SourceKind } from './types.ts';
import { CATEGORY_PREVIEW, TAG_SUGGESTIONS } from './spec.ts';
import { L1_CHAR_LIMIT } from './logic.ts';
import { needsRefine, validateDraft } from './logic.ts';

const CATEGORIES: MemoryCategory[] = ['decision', 'pitfall', 'preference', 'fact', 'project', 'feedback'];
const SOURCES: SourceKind[] = ['conversation', 'api', 'mcp'];

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  decision: '决策', pitfall: '踩坑', preference: '偏好',
  fact: '事实', project: '项目', feedback: '反馈',
};
const SOURCE_LABEL: Record<SourceKind, string> = {
  conversation: '会话', api: 'API', mcp: 'MCP',
};

export function WriteForm({
  draft,
  onChange,
  onSubmit,
  onReset,
}: {
  draft: MemoryDraft;
  onChange: (d: MemoryDraft) => void;
  onSubmit: () => void;
  onReset?: () => void;
}) {
  const v = validateDraft(draft);
  const refine = needsRefine(draft.content);
  const preview = CATEGORY_PREVIEW[draft.category];
  const chars = draft.content.length;
  const over = chars > L1_CHAR_LIMIT;

  const setTags = (raw: string) =>
    onChange({ ...draft, tags: raw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean) });
  const addTag = (t: string) => {
    if (!draft.tags.includes(t)) onChange({ ...draft, tags: [...draft.tags, t] });
  };

  return (
    <div className="p0-card" data-testid="write-form">
      <div className="p0-hd">
        <h3>写入表单</h3>
        <span className="p0-sub">单条写入 · 查重与落库由内核 ma.write 执行</span>
      </div>

      <div className="p0-form">
        <div className="p0-frow p0-fcol">
          <label>
            正文（L1 脱敏原文）*
            <span className={`p0-count${over ? ' over' : ''}`} data-testid="char-count">
              {chars} / {L1_CHAR_LIMIT}
            </span>
          </label>
          <textarea
            className="p0-ta"
            data-testid="f-content"
            value={draft.content}
            placeholder="写入要记忆的内容…"
            onChange={(e) => onChange({ ...draft, content: e.target.value })}
          />
          <div className="p0-note">
            300 字为界面建议上限；内核 L1 规格当前不限长，超出仍会完整写入（L2 摘要按 300 字生成）。
            {refine && <span data-testid="refine-hint"> 将清洗脱敏为 L1；未接入 LLM 时 L2–L6 暂不生成。</span>}
          </div>
        </div>

        <div className="p0-frow">
          <label>类别</label>
          <select
            className="p0-in"
            data-testid="f-category"
            value={draft.category}
            onChange={(e) => onChange({ ...draft, category: e.target.value as MemoryCategory })}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}（{c}）</option>)}
          </select>
          <div className="p0-note" data-testid="cat-preview">
            默认半衰期 {preview.halfLifeDays} 天 · 归档 {preview.archive} · 合并 {preview.merge}
          </div>
        </div>

        <div className="p0-frow">
          <label>来源</label>
          <select
            className="p0-in"
            data-testid="f-source"
            value={draft.source}
            onChange={(e) => onChange({ ...draft, source: e.target.value as SourceKind })}
          >
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}（{s}）</option>)}
          </select>
        </div>

        <div className="p0-frow p0-fcol">
          <label>标签</label>
          <input
            className="p0-in"
            data-testid="f-tags"
            value={draft.tags.join(', ')}
            placeholder="逗号/空格分隔"
            onChange={(e) => setTags(e.target.value)}
          />
          <div className="p0-note">参与 L6 关键词；内核按上限截取。</div>
          <div className="tags-input" data-testid="tag-suggest">
            {TAG_SUGGESTIONS.filter((t) => !draft.tags.includes(t)).slice(0, 8).map((t) => (
              <span className="pill" key={t} data-testid={`suggest-${t}`} onClick={() => addTag(t)}>{t}</span>
            ))}
          </div>
        </div>

        <div className="p0-frow">
          <label>session_id</label>
          <input
            className="p0-in"
            data-testid="f-session"
            value={draft.session_id}
            onChange={(e) => onChange({ ...draft, session_id: e.target.value })}
          />
          <div className="p0-note">全局继承，可清空。</div>
        </div>

        <div className="p0-frow">
          <label>project_id</label>
          <input
            className="p0-in readonly"
            data-testid="f-project"
            value={draft.project_id}
            readOnly
          />
          <span className="p0-tag info">只读 · 全局注入（R2）</span>
          {!draft.project_id && <span className="err">project_id 缺失，禁止提交</span>}
        </div>
      </div>

      {v.errors.length > 0 && (
        <div className="err" data-testid="form-errors">{v.errors.join('；')}</div>
      )}

      <div className="p0-row-actions">
        <button
          type="button"
          className="p0-btn primary"
          data-testid="submit"
          disabled={!v.ok}
          onClick={onSubmit}
        >
          写入记忆
        </button>
        {onReset && (
          <button type="button" className="p0-btn" onClick={onReset}>清空</button>
        )}
        <span className="p0-note">被拒不会乐观成功：回执只展示内核真实返回的 request_id 与原因。</span>
      </div>
    </div>
  );
}
