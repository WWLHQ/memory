// 用户反馈页（REQ-006 / P9）T4 编排
import { useState } from 'react';
import { SEED_FEEDBACKS } from './seed.ts';
import { composeRecord, statShare, trustDelta, validateDraft } from './logic.ts';
import { useFeedbackMirror } from './useFeedbackMirror.ts';
import { FeedbackForm } from './FeedbackForm.tsx';
import { StatCards } from './StatCards.tsx';
import { useToast } from './useToast.tsx';
import type { FeedbackDraft, FeedbackRecord } from './types.ts';

export function FeedbackPage() {
  const [draft, setDraft] = useState<FeedbackDraft>({ memory_id: '', action: 'confirm', rating: 3, comment: '' });
  const [records, setRecords] = useState<FeedbackRecord[]>(SEED_FEEDBACKS);
  const { node: toast, show } = useToast();
  const mirror = useFeedbackMirror();

  const stats = statShare(records);
  const v = validateDraft(draft);

  const handleSubmit = () => {
    if (v.error) {
      show(v.error);
      return;
    }
    const seq = records.length + 1;
    const rec = composeRecord(draft, seq, 'req_fb_seed');
    setRecords([rec, ...records]);
    mirror.audit('feedback', rec, 'req_fb_seed'); // G6 safe-noop
    const delta = trustDelta(draft.action);
    show(
      draft.action === 'disputed'
        ? '已转 P7 冲突裁决队列（disputed）'
        : `反馈已记录：trust_delta ${delta >= 0 ? '+' : ''}${delta}（17.4）`,
    );
    setDraft({ memory_id: '', action: 'confirm', rating: 3, comment: '' });
  };

  return (
    <div className="wrap" data-testid="feedback-page">
      <h1>💬 用户反馈页 <span className="badge p2">REQ-006 · P9</span></h1>
      <div className="sub">13.7 反馈表单 + 7.1/7.2 统计 · 数据本地种子为真相</div>
      <FeedbackForm draft={draft} onChange={setDraft} onSubmit={handleSubmit} />
      {v.warning && <div className="note" data-testid="fb-warning">⚠ {v.warning}</div>}
      <StatCards stats={stats} />
      {toast}
    </div>
  );
}
