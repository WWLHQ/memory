// 写入页表单（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write 写入表单面板）：
// af-panel(af-ph h3 写入表单 + hint 实算 token) → af-pb：内容 textarea 88px → af-formgrid
// （类别/来源 Agent/session_id 只读/project_id 可修改）→ 标签联想 pill → 写入行（af-btn pri + 快路径 note）。
// 字段语义与内核契约不变；提示行全部实算（estimateTokens + checkL0ToL1Quality v3 单一真源），不抄设计稿样值。
// ⚠ 禁止注入演示数据：内容框为空、无预置标签。
import type { MemoryCategory, MemoryDraft, SourceKind } from './types.ts';
import { estimateTokens, needsRefine, suggestTagsFromContent, validateDraft } from './logic.ts';
import { checkL0ToL1Quality } from '../../core/memagent/qualityGate.ts';
import { MIN_MEANINGFUL_WITHOUT_FACTS, meaningfulLength } from '../../core/memagent/layerRules.ts';

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
}: {
  draft: MemoryDraft;
  onChange: (d: MemoryDraft) => void;
  onSubmit: () => void;
}) {
  const v = validateDraft(draft);
  const refine = needsRefine(draft.content);
  const gate = checkL0ToL1Quality(draft.content);
  const meaningful = meaningfulLength(draft.content);

  const addTag = (t: string) => {
    if (!draft.tags.includes(t)) onChange({ ...draft, tags: [...draft.tags, t] });
  };
  const removeTag = (t: string) => onChange({ ...draft, tags: draft.tags.filter((x) => x !== t) });
  const suggestions = suggestTagsFromContent(draft.content, draft.tags);

  // hint 口径对齐设计稿「≈38 tokens · 有效字 ≥30 或含硬事实/技术证据」，数字全部实算
  const gateHint = draft.content.trim().length === 0
    ? `有效字 ≥${MIN_MEANINGFUL_WITHOUT_FACTS} 或含硬事实/技术证据`
    : gate.ok
      ? meaningful < MIN_MEANINGFUL_WITHOUT_FACTS
        ? '含硬事实/具体技术信息 · 豁免字数门槛'
        : `有效字 ${meaningful} · 过质量门`
      : `将被质量门拦截 · ${gate.code}`;

  return (
    <section className="af-panel" data-testid="write-form">
      <div className="af-ph">
        <h3>写入表单</h3>
        <span className="hint">≈{estimateTokens(draft.content)} tokens · {gateHint}</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 12 }}>
        <div className="af-field">
          内容
          <textarea
            className="af-textarea af-ta88"
            data-testid="f-content"
            value={draft.content}
            placeholder="写入要记忆的内容…"
            onChange={(e) => onChange({ ...draft, content: e.target.value })}
          />
          {refine && <span className="af-note" data-testid="refine-hint">将清洗脱敏为 L1；未接入 LLM 时 L2–L6 暂不生成。</span>}
        </div>

        <div className="af-formgrid">
          <div className="af-field">
            类别
            <select
              className="af-select"
              data-testid="f-category"
              value={draft.category}
              onChange={(e) => onChange({ ...draft, category: e.target.value as MemoryCategory })}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}（{c}）</option>)}
            </select>
          </div>
          <div className="af-field">
            来源 Agent
            <select
              className="af-select"
              data-testid="f-source"
              value={draft.source}
              onChange={(e) => onChange({ ...draft, source: e.target.value as SourceKind })}
            >
              {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}（{s}）</option>)}
            </select>
          </div>
          <div className="af-field">
            session_id（必填 · 只读）
            <input className="af-input af-mono" data-testid="f-session" value={draft.session_id} readOnly />
          </div>
          <div className="af-field">
            project_id（必填 · 可修改）
            <input
              className="af-input"
              data-testid="f-project"
              value={draft.project_id}
              placeholder="如 P1"
              onChange={(e) => onChange({ ...draft, project_id: e.target.value })}
            />
          </div>
        </div>

        <div className="af-field">
          标签联想
          <div className="af-row">
            {draft.tags.map((t) => (
              <button type="button" className="af-pill" key={t} title="点击移除" onClick={() => removeTag(t)}>{t}</button>
            ))}
            {suggestions.map((t) => (
              <button type="button" className="af-pill" key={t} data-testid={`suggest-${t}`} onClick={() => addTag(t)}>{t}</button>
            ))}
            {(draft.tags.length > 0 || suggestions.length > 0) && (
              <span className="af-note">点击采纳 · 脱敏在 L1 自动执行</span>
            )}
          </div>
          {suggestions.length === 0 && draft.tags.length === 0 && (
            <div className="af-note" data-testid="tags-empty">
              输入包含技术名词的内容后，候选标签会按出现顺序出现在这里（本地提取 · 需点击确认）。
            </div>
          )}
        </div>

        {v.errors.length > 0 && (
          <div className="af-red" data-testid="form-errors">{v.errors.join('；')}</div>
        )}

        <div className="af-row">
          <button
            type="button"
            className="af-btn pri"
            data-testid="submit"
            disabled={!v.ok}
            onClick={onSubmit}
          >
            写入记忆
          </button>
          <span className="af-note">写入快路径：L0 封存 + 脱敏 L1 落库即返回，深层后台炼</span>
        </div>
      </div>
    </section>
  );
}
