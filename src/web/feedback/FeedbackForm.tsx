// P9-T3 反馈表单（13.7）
import type { FeedbackDraft, FeedbackAction } from './types.ts';
import { CTX, SEED_OPTIONS } from './seed.ts';

interface Props {
  draft: FeedbackDraft;
  onChange: (next: FeedbackDraft) => void;
  onSubmit: () => void;
}

export function FeedbackForm({ draft, onChange, onSubmit }: Props) {
  const selected = SEED_OPTIONS.find((o) => o.id === draft.memory_id);
  return (
    <div className="card" data-testid="feedback-form">
      <b>反馈表单（13.7）</b>

      <div className="row">
        <label style={{ width: 90 }}>memory_id *</label>
        <select
          data-testid="f-memory"
          value={draft.memory_id}
          onChange={(e) => onChange({ ...draft, memory_id: e.target.value })}
        >
          <option value="">— 请选择 —</option>
          {SEED_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.id}</option>)}
        </select>
        {selected && <span className="dim" data-testid="memory-summary">{selected.summary}</span>}
      </div>

      <div className="row">
        <label style={{ width: 90 }}>动作</label>
        {(['confirm', 'reject', 'disputed'] as FeedbackAction[]).map((a) => (
          <label key={a} style={{ cursor: 'pointer' }}>
            <input
              type="radio" name="fb-action" checked={draft.action === a}
              data-testid={`action-${a}`}
              onChange={() => onChange({ ...draft, action: a })}
            />{' '}
            {a === 'confirm' ? '确认' : a === 'reject' ? '拒绝' : '有争议'}
          </label>
        ))}
        {draft.action === 'disputed' && (
          <span className="status deprecated" data-testid="disputed-hint">将进入 P7 冲突裁决队列</span>
        )}
      </div>

      <div className="row">
        <label style={{ width: 90 }}>评分</label>
        {[1, 2, 3, 4, 5].map((n) => (
          <span
            key={n}
            role="button"
            data-testid={`star-${n}`}
            style={{ cursor: 'pointer', fontSize: 18, color: n <= draft.rating ? '#ffd166' : '#5b6675' }}
            onClick={() => onChange({ ...draft, rating: n })}
          >
            ★
          </span>
        ))}
        <span className="dim">{draft.rating}/5</span>
      </div>

      <div className="row">
        <label style={{ width: 90, alignSelf: 'flex-start' }}>原因</label>
        <textarea
          data-testid="f-comment"
          rows={2}
          value={draft.comment}
          placeholder="reject 建议填写原因（喂 7.2 自生长）"
          style={{ flex: 1, background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}
          onChange={(e) => onChange({ ...draft, comment: e.target.value })}
        />
      </div>

      <div className="row" data-testid="injected-ctx">
        <label style={{ width: 90 }}>注入（R1）</label>
        <span className="mid">{CTX.user_id}</span>
        <span className="mid">{CTX.enterprise_id}</span>
        <span className="dim">— 全局注入，禁手填</span>
      </div>

      <div className="row">
        <button type="button" className="btn primary" data-testid="fb-submit" onClick={onSubmit}>提交反馈</button>
      </div>
    </div>
  );
}
