// 写入页（REQ-006 / P2）表单 · 批次58 定稿版式（只改写入表单 tab）
// 版式照用户确认的效果图：内容 → token/质量门提示 → 类别/来源 agent/标签联想 →
// session_id 只读（页面生成）；project_id 用户可修改（修复轮3），空值仍被校验拦下。字段语义与内核契约不变。
// 提示行全部实算：estimateTokens + 内核 checkL0ToL1Quality（v3 单一真源），不抄效果图样值。
import type { MemoryCategory, MemoryDraft, SourceKind } from './types.ts';
import { estimateTokens, needsRefine, suggestTagsFromContent, validateDraft } from './logic.ts';
import { QUALITY_GATE_VERSION, checkL0ToL1Quality } from '../../core/memagent/qualityGate.ts';
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

  const gateHint = draft.content.trim().length === 0
    ? '等待输入 · 质量门预判随内容实算'
    : gate.ok
      ? meaningful < MIN_MEANINGFUL_WITHOUT_FACTS
        ? '含硬事实/具体技术信息 · 豁免字数门槛'
        : `有效字 ${meaningful} · 过质量门`
      : `将被质量门拦截 · ${gate.code}`;

  return (
    <div className="wf-card" data-testid="write-form">
      <div className="wf-hd">
        <span className="wf-zh">写入表单</span>
        <span className="wf-meta">L0+L1 质量门 v{QUALITY_GATE_VERSION} · 有效字 &lt;{MIN_MEANINGFUL_WITHOUT_FACTS} 且无硬事实即拦</span>
      </div>
      <div className="wf-bd">
        <label className="wf-lbl" htmlFor="wf-content">内容 (L0 原文 · 封存后脱敏生成 L1)</label>
        <textarea
          id="wf-content"
          className="wf-ta"
          data-testid="f-content"
          value={draft.content}
          placeholder="写入要记忆的内容…"
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
        />
        <div className="wf-hint">
          约 {estimateTokens(draft.content)} token · {gateHint}
          {refine && <span data-testid="refine-hint"> 将清洗脱敏为 L1；未接入 LLM 时 L2–L6 暂不生成。</span>}
        </div>

        <div className="wf-row3">
          <div>
            <label className="wf-lbl" htmlFor="wf-category">类别</label>
            <select
              id="wf-category"
              className="wf-in"
              data-testid="f-category"
              value={draft.category}
              onChange={(e) => onChange({ ...draft, category: e.target.value as MemoryCategory })}
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}（{c}）</option>)}
            </select>
          </div>
          <div>
            <label className="wf-lbl" htmlFor="wf-source">来源 agent</label>
            <select
              id="wf-source"
              className="wf-in"
              data-testid="f-source"
              value={draft.source}
              onChange={(e) => onChange({ ...draft, source: e.target.value as SourceKind })}
            >
              {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}（{s}）</option>)}
            </select>
          </div>
          <div className="wf-tags">
            <span className="wf-lbl">标签联想（随内容自动提取 · 不预置词表 · 不经大模型）</span>
            <div className="wf-chips">
              {draft.tags.map((t) => (
                <button type="button" className="wf-chip on" key={t} title="点击移除" onClick={() => removeTag(t)}>{t}</button>
              ))}
              {suggestions.map((t) => (
                <button type="button" className="wf-chip" key={t} data-testid={`suggest-${t}`} onClick={() => addTag(t)}>{t}</button>
              ))}
            </div>
            {suggestions.length === 0 && draft.tags.length === 0 && (
              <div className="wf-note" data-testid="tags-empty">
                输入包含技术名词的内容后，候选标签会按出现顺序出现在这里（本地提取 · 需点击确认）。
              </div>
            )}
          </div>
        </div>

        <div className="wf-row2">
          <div>
            <label className="wf-lbl" htmlFor="wf-session">session_id (必填 · 只读)</label>
            <input id="wf-session" className="wf-in" data-testid="f-session" value={draft.session_id} readOnly />
          </div>
          <div>
            <label className="wf-lbl" htmlFor="wf-project">project_id (必填 · 可修改)</label>
            <input
              id="wf-project"
              className="wf-in"
              data-testid="f-project"
              value={draft.project_id}
              placeholder="如 P1"
              onChange={(e) => onChange({ ...draft, project_id: e.target.value })}
            />
          </div>
        </div>

        {v.errors.length > 0 && (
          <div className="wf-err" data-testid="form-errors">{v.errors.join('；')}</div>
        )}

        <div className="wf-actions">
          <button
            type="button"
            className="wf-btn"
            data-testid="submit"
            disabled={!v.ok}
            onClick={onSubmit}
          >
            写入记忆
          </button>
          <span className="wf-hint">写入必须快 · 不同步调 LLM</span>
        </div>
      </div>
    </div>
  );
}