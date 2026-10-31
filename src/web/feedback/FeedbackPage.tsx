// 用户反馈页（REQ-006 / P9）T4 编排
// 提交走内核 ma._feedback（17.4 trust_delta 内核计算：confirm +0.1 / reject −0.05 / disputed 挂 9.7 裁决）。
// 历史记录：挂载从内核审计账本读取真实反馈记录（无种子兜底；空库即空列表）。
import { useEffect, useState } from 'react';
import { composeRecord, statShare, validateDraft } from './logic.ts';
import { useFeedbackMirror } from './useFeedbackMirror.ts';
import { coreSubmitFeedback, coreLoadFeedbackRecords } from './coreFeedback.ts';
import { FeedbackForm } from './FeedbackForm.tsx';
import { StatCards } from './StatCards.tsx';
import { useToast } from './useToast.tsx';
import type { FeedbackDraft, FeedbackRecord } from './types.ts';

export function FeedbackPage() {
  const [draft, setDraft] = useState<FeedbackDraft>({ memory_id: '', action: 'confirm', rating: 3, comment: '' });
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const { node: toast, show } = useToast();
  const mirror = useFeedbackMirror();

  // 挂载回填：内核审计账本中的真实反馈记录
  useEffect(() => {
    let alive = true;
    coreLoadFeedbackRecords()
      .then((list) => { if (alive) setRecords(list); })
      .catch(() => {}); // 内核不可达 → 保持空列表（safe-noop 语义）
    return () => { alive = false; };
  }, []);

  const stats = statShare(records);
  const v = validateDraft(draft);

  const handleSubmit = async () => {
    if (v.error) {
      show(v.error);
      return;
    }
    // 内核执行 17.4（confirm +0.1 / reject −0.05 / disputed 挂裁决），trust_delta 以内核为准
    const out = await coreSubmitFeedback(draft);
    if (!out.ok) {
      show('内核未找到该记忆，反馈未记录');
      return;
    }
    const rec = composeRecord(draft, out.request_id);
    setRecords([rec, ...records]);
    mirror.audit('feedback', rec, out.request_id); // G6 safe-noop
    const delta = out.trust_delta;
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
      <div className="sub">13.7 反馈表单 + 7.1/7.2 统计 · 提交经内核 17.4（trust_delta 内核计算）</div>
      <FeedbackForm draft={draft} onChange={setDraft} onSubmit={handleSubmit} />
      {v.warning && <div className="note" data-testid="fb-warning">⚠ {v.warning}</div>}
      <StatCards stats={stats} />
      {toast}
    </div>
  );
}
