// 用户反馈页（REQ-006 / P9）T4 编排
// 提交走内核 ma._feedback（17.4 trust_delta 内核计算：confirm +0.1 / reject −0.05 / disputed 挂 9.7 裁决）。
// 历史记录：挂载从内核审计账本读取真实反馈记录（无种子兜底；空库即空列表）。
// 批次63：新增「召回回显」——内核审计 action=recall 真实条目（接入 Agent 经 MCP recall_memory 的调用），
// 字段全真、账本没记的列写明原因、读取失败如实报错、空账本给诚实空态，绝不伪造行。
import { useEffect, useState } from 'react';
import { composeRecord, statShare, validateDraft } from './logic.ts';
import { useFeedbackMirror } from './useFeedbackMirror.ts';
import { coreSubmitFeedback, coreLoadFeedbackRecords, coreLoadRecallEchoes, type RecallEchoRow } from './coreFeedback.ts';
import { FeedbackForm } from './FeedbackForm.tsx';
import { useHostTheme } from '../shared/hostTheme.ts';
import { StatCards } from './StatCards.tsx';
import { useToast } from './useToast.tsx';
import type { FeedbackDraft, FeedbackRecord } from './types.ts';

const clipText = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** token 用量列：真实 injected/saved 组合展示；账本没记 → 写原因，不造假数 */
function tokenText(r: RecallEchoRow): string {
  const parts: string[] = [];
  if (r.injected_tokens !== null) parts.push(`注入 ${r.injected_tokens}t`);
  if (r.saved_tokens !== null) parts.push(`省 ${r.saved_tokens}t`);
  return parts.length ? parts.join(' · ') : '（未记录）';
}

export function FeedbackPage() {
  useHostTheme();
  // 评分默认 0 = 未评分：用户必须亲手选 1–5 星，避免「没点也提交成 3 星」的假口碑
  const [draft, setDraft] = useState<FeedbackDraft>({ memory_id: '', action: 'confirm', rating: 0, comment: '' });
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  // 批次63：召回归显（内核审计 action=recall 真实条目）；读取失败如实报错，不吞
  const [echoes, setEchoes] = useState<RecallEchoRow[]>([]);
  const [echoError, setEchoError] = useState('');
  const { node: toast, show } = useToast();
  const mirror = useFeedbackMirror();

  // 挂载回填：内核审计账本中的真实反馈记录
  useEffect(() => {
    let alive = true;
    coreLoadFeedbackRecords()
      .then((list) => { if (alive) setRecords(list); })
      .catch(() => {}); // 内核不可达 → 保持空列表（不编造记录）
    coreLoadRecallEchoes()
      .then((rows) => { if (alive) setEchoes(rows); })
      .catch((e) => { if (alive) setEchoError(e instanceof Error ? e.message : String(e)); });
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
    mirror.audit('feedback', rec, out.request_id); // G6 上抛：/api/mirror/audit（失败可见）
    const delta = out.trust_delta;
    show(
      draft.action === 'disputed'
        ? '已转 P7 冲突裁决队列（disputed）'
        : `反馈已记录：trust_delta ${delta >= 0 ? '+' : ''}${delta}（17.4）`,
    );
    setDraft({ memory_id: '', action: 'confirm', rating: 0, comment: '' });
  };

  return (
    <div className="wrap" data-testid="feedback-page">
      <div className="p0-pagehead" data-testid="feedback-head">
        <div className="p0-ph-main">
          <div className="p0-ph-title">
            <h1>反馈页</h1>
            <span className="p0-tagline">REQ-006 · P9</span>
          </div>
          <div className="p0-ph-meta">
            <span>13.7 反馈表单 + 7.1/7.2 统计</span>
            <span className="p0-ph-sep" />
            <span>提交经内核 17.4（trust_delta 内核计算）</span>
          </div>
        </div>
      </div>
      <FeedbackForm draft={draft} onChange={setDraft} onSubmit={handleSubmit} />
      {v.warning && <div className="note" data-testid="fb-warning">⚠ {v.warning}</div>}
      <StatCards stats={stats} />

      <div className="card" data-testid="feedback-history-card" style={{ marginTop: 12 }}>
        <b>回显反馈</b>
        <span className="dim" style={{ marginLeft: 8 }}>内核审计读回（含本页与接入 Agent 经 MCP 提交的记录，最多 10 条）</span>
        {records.length === 0 ? (
          <div className="p0-empty dashed" data-testid="feedback-history-empty">
            账本里还没有反馈记录：本页提交或接入 Agent 反馈后，会从 memory_op 审计回显评分、原因与 trust_delta。
          </div>
        ) : (
          <table className="ltable" data-testid="feedback-history" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>记忆</th><th>动作</th><th>评分</th><th>原因（审计原文）</th><th>trust_delta</th><th>时间</th></tr>
            </thead>
            <tbody>
              {records.slice(0, 10).map((r, i) => (
                <tr key={`${r.id}-${i}`} data-testid={`fb-row-${i}`}>
                  <td className="mid">{r.memory_id}</td>
                  <td>{r.action}</td>
                  <td>{r.rating > 0 ? `${r.rating}★` : '未评分'}</td>
                  <td data-testid={`fb-comment-${i}`}>{r.comment || '无评论'}</td>
                  <td>{r.trust_delta >= 0 ? `+${r.trust_delta}` : r.trust_delta}</td>
                  <td className="mid">{new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 批次63：召回归显 —— 内核审计 action=recall 真实条目（Agent 经 MCP recall_memory 调用落账）。
          字段全真：账本没记的列写原因；读取失败如实报错；空账本给诚实空态，绝不伪造行。 */}
      <div className="card" data-testid="recall-echo" style={{ marginTop: 12 }}>
        <b>召回回显</b>
        <span className="dim" style={{ marginLeft: 8 }}>内核审计 action=recall · 最近 ≤20 条 · Agent 经 MCP recall_memory 调用（命中数/客户端/用量按账本真实值，账本没记的列写原因）</span>
        {echoError ? (
          <div className="p0-empty" data-testid="recall-echo-error">召回审计读取失败：{echoError}</div>
        ) : echoes.length === 0 ? (
          <div className="p0-empty dashed" data-testid="recall-echo-empty">暂无召回审计（尚无 Agent 调用过 recall_memory）。</div>
        ) : (
          <table className="ltable" data-testid="recall-echo-table" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>时间</th><th>检索词</th><th>模式</th><th>命中</th><th>客户端</th><th>用量</th></tr>
            </thead>
            <tbody>
              {echoes.map((r, i) => (
                <tr key={r.request_id} data-testid={`recall-echo-row-${i}`}>
                  <td className="mid">{new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })}</td>
                  <td title={r.query}>{clipText(r.query)}</td>
                  <td>{r.mode}</td>
                  <td>{r.hits !== null ? r.hits : '（未记录）'}</td>
                  <td>{r.client ?? '（未记录）'}</td>
                  <td>{tokenText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {toast}
    </div>
  );
}
