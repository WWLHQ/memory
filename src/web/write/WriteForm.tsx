// 写入页（REQ-006 / P2）表单（T3）
// 字段与校验严格对照 §P2；project_id 只读必填（R2）；content 实时 token + ≥500 字精炼提示。
import type { MemoryCategory, MemoryDraft, SourceKind } from './types.ts';
import { CATEGORY_PREVIEW, SEED_TAGS } from './seed.ts';
import { estimateTokens, needsRefine, validateDraft } from './logic.ts';

const CATEGORIES: MemoryCategory[] = ['decision', 'pitfall', 'preference', 'fact', 'project', 'feedback'];
const SOURCES: SourceKind[] = ['conversation', 'api', 'mcp'];

export function WriteForm({
  draft,
  onChange,
  onSubmit,
}: {
  draft: MemoryDraft;
  onChange: (d: MemoryDraft) => void;
  onSubmit: () => void;
}) {
  const v = validateDraft(draft);
  const tokens = estimateTokens(draft.content);
  const refine = needsRefine(draft.content);
  const preview = CATEGORY_PREVIEW[draft.category];

  const setTags = (raw: string) =>
    onChange({ ...draft, tags: raw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean) });
  const addTag = (t: string) => {
    if (!draft.tags.includes(t)) onChange({ ...draft, tags: [...draft.tags, t] });
  };

  return (
    <div className="card" data-testid="write-form">
      <div className="field">
        <label>内容 *<span className="hint">约 {tokens} token</span>
          {refine && <span className="hint" data-testid="refine-hint">将精炼为 L1–L6（2.2）</span>}
        </label>
        <textarea
          data-testid="f-content"
          value={draft.content}
          placeholder="写入要记忆的内容…"
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
        />
      </div>

      <div className="row">
        <div className="field">
          <label>类别（17.6 六类）</label>
          <select
            data-testid="f-category"
            value={draft.category}
            onChange={(e) => onChange({ ...draft, category: e.target.value as MemoryCategory })}
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="preview" data-testid="cat-preview">
            默认半衰期 {preview.halfLifeDays} 天 · 归档 {preview.archive} · 合并 {preview.merge}
          </div>
        </div>

        <div className="field">
          <label>来源</label>
          <select
            data-testid="f-source"
            value={draft.source}
            onChange={(e) => onChange({ ...draft, source: e.target.value as SourceKind })}
          >
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>标签（逗号/空格分隔，可点选联想）</label>
        <input
          data-testid="f-tags"
          value={draft.tags.join(', ')}
          onChange={(e) => setTags(e.target.value)}
        />
        <div className="tags-input" data-testid="tag-suggest">
          {SEED_TAGS.filter((t) => !draft.tags.includes(t)).slice(0, 8).map((t) => (
            <span className="pill" key={t} data-testid={`suggest-${t}`} onClick={() => addTag(t)}>{t}</span>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>session_id（全局继承，可清空）</label>
          <input
            data-testid="f-session"
            value={draft.session_id}
            onChange={(e) => onChange({ ...draft, session_id: e.target.value })}
          />
        </div>
        <div className="field">
          <label>project_id（全局注入，只读必填 R2）</label>
          <input
            className="readonly"
            data-testid="f-project"
            value={draft.project_id}
            readOnly
          />
          {!draft.project_id && <span className="err">project_id 缺失，禁止提交</span>}
        </div>
      </div>

      {v.errors.length > 0 && (
        <div className="err" data-testid="form-errors">{v.errors.join('；')}</div>
      )}

      <div className="actions">
        <button
          type="button"
          className="btn primary"
          data-testid="submit"
          disabled={!v.ok}
          onClick={onSubmit}
        >
          写入记忆
        </button>
      </div>
    </div>
  );
}
