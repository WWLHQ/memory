// P2-8 §3.4：结果页「这次模式选对了吗？」👍/👎，👎 需选原因后提交。
// 写入走 coreSubmitModeFeedback（真写 mode_feedback 审计）；7.2 样本池接线属 P2-9，未拍板前如实标注。
import { useState } from 'react';
import type { ModeBannerData } from './types.ts';
import { modeName } from './logic.ts';
import { coreSubmitModeFeedback, MODE_FEEDBACK_REASONS, type ModeFeedbackReason, type ModeFeedbackVerdict } from './coreModeFeedback.ts';

interface Props {
  data: ModeBannerData;
  onToast: (msg: string) => void;
}

export function ModeFeedbackCard({ data, onToast }: Props) {
  const [verdict, setVerdict] = useState<ModeFeedbackVerdict | null>(null);
  const [reason, setReason] = useState<ModeFeedbackReason>(MODE_FEEDBACK_REASONS[0]);
  const [saving, setSaving] = useState(false);

  const observedAuto = data.dispatch?.applied === 'auto';
  const shownMode = observedAuto ? '自动' : modeName(data.mode);
  const source = data.dispatch?.source === 'manual' ? '用户指定' : '自动分流';

  const submit = async (v: ModeFeedbackVerdict, r?: ModeFeedbackReason) => {
    setSaving(true);
    const outcome = await coreSubmitModeFeedback({
      request_id: data.request_id,
      mode: observedAuto ? 'auto' : data.mode,
      verdict: v,
      reason: r,
      source: data.dispatch?.source === 'manual' ? 'manual' : 'auto',
    });
    setSaving(false);
    if (outcome.ok) {
      setVerdict(v);
      onToast(v === 'up' ? '已记录：这次模式选对了。' : `已记录：模式选错（${r ?? '未填原因'}）。`);
    } else {
      onToast(`模式反馈未能写入审计：${outcome.error}`);
    }
  };

  return (
    <div className="ret-modefb" data-testid="mode-feedback">
      <span className="ret-modefb-q">这次模式选对了吗？（生效：{shownMode} · {source}）</span>
      <button
        type="button"
        className={`ret-pill${verdict === 'up' ? ' active' : ''}`}
        data-testid="mode-fb-up"
        disabled={saving}
        onClick={() => void submit('up')}
      >
        👍 对
      </button>
      <button
        type="button"
        className={`ret-pill${verdict === 'down' ? ' active' : ''}`}
        data-testid="mode-fb-down"
        disabled={saving}
        onClick={() => setVerdict('down')}
      >
        👎 不对
      </button>
      {verdict === 'down' && (
        <>
          <select
            data-testid="mode-fb-reason"
            aria-label="不对的原因"
            value={reason}
            onChange={(e) => setReason(e.target.value as ModeFeedbackReason)}
          >
            {MODE_FEEDBACK_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            type="button"
            className="ret-btn"
            data-testid="mode-fb-submit"
            disabled={saving}
            onClick={() => void submit('down', reason)}
          >
            提交原因
          </button>
        </>
      )}
      <span className="ret-note">反馈写入审计账本；7.2 样本池接线待 P2-9 拍板。</span>
    </div>
  );
}
