// 写入页回执（定稿）：四类结果 + 真实 request_id / memory_id / 层级，不编辑、不重放。
import type { LayerName, WriteReceipt, WriteReceiptHistoryRow, WriteRefusal } from './types.ts';

const LAYERS: LayerName[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

const ACTION_LABEL: Record<WriteReceipt['dedup_action'], string> = {
  create: 'create · 新建条目',
  graft: 'graft · 嫁接为新版本',
  keep: 'keep · 保留原记忆',
  filtered: 'filtered · 质量门拦截（未入库）',
};

const ACTION_TONE: Record<WriteReceipt['dedup_action'], string> = {
  create: 'ok', graft: 'info', keep: 'warn', filtered: 'warn',
};

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 写入回执（成功 / graft / keep / filtered）：字段全部来自内核本次返回 */
export function WriteReceiptCard({ receipt }: { receipt: WriteReceipt }) {
  return (
    <div className="p0-card" data-testid="receipt">
      <div className={`p0-banner ${ACTION_TONE[receipt.dedup_action]}`} data-testid="receipt-action">
        <span>
          <b>{ACTION_LABEL[receipt.dedup_action]}</b>
          {receipt.dedup_action === 'filtered'
            ? ' · 本次未写入记忆库'
            : ' · 内核已落定，回执只读'}
        </span>
      </div>

      <div className="p0-kv">
        <span className="p0-k">request_id</span>
        <span className="p0-v mono" data-testid="receipt-request-id">{receipt.request_id || '账本无链路'}</span>
        <span className="p0-k">memory_id</span>
        <span className="p0-v mono" data-testid="receipt-id">{receipt.memory_id || '—（本次未入库）'}</span>
        <span className="p0-k">去重结果</span>
        <span className="p0-v">{ACTION_LABEL[receipt.dedup_action]}</span>
        <span className="p0-k">精炼</span>
        <span className="p0-v">{receipt.refined_by === 'stub' ? '未精炼（未接入 LLM）' : receipt.refined_by}</span>
        <span className="p0-k">写入时间</span>
        <span className="p0-v mono">{fmtClock(receipt.created_at)}</span>
        <span className="p0-k">写密钥</span>
        <span className="p0-v">{receipt.dedup_action === 'filtered' ? '未签发（未入库）' : '已签发 · L0 密文按规则生成'}</span>
      </div>

      <div className="p0-note">L1–L6 逐层（只展示真实产出；L1 原文仅审计展开，15.3）：</div>
      {LAYERS.map((ln) => (
        <details className="p0-lrow" key={ln} data-testid={`layer-${ln}`}>
          <summary>{ln} · {receipt.layers[ln].summary}</summary>
          {receipt.layers[ln].auditOnly && (
            <div className="audit">⚠ 仅审计可展开原文（15.3）</div>
          )}
          {receipt.layers[ln].text && (
            <div className="layer-body" data-testid={`layer-body-${ln}`}>{receipt.layers[ln].text}</div>
          )}
        </details>
      ))}
    </div>
  );
}

/** 被内核拒绝：不生成成功回执，只展示原因 + 内核本次 request_id（未签发就如实写「未签发」） */
export function WriteRefusalCard({ refusal }: { refusal: WriteRefusal }) {
  return (
    <div className="p0-card" data-testid="receipt-rejected">
      <div className="p0-banner err">
        <span><b>写入被拒 · 未落库</b>{refusal.l0_locked ? ' · L0 写密钥未解锁' : ''}</span>
      </div>
      <div className="p0-kv">
        <span className="p0-k">原因</span>
        <span className="p0-v" data-testid="receipt-rejected-reason">{refusal.reason}</span>
        <span className="p0-k">request_id</span>
        <span className="p0-v mono" data-testid="receipt-request-id">
          {refusal.request_id ?? '未签发（内核拒绝前未返回）'}
        </span>
        <span className="p0-k">时间</span>
        <span className="p0-v mono">{fmtClock(refusal.created_at)}</span>
      </div>
      <div className="p0-note">
        {refusal.l0_locked
          ? 'L0 写密钥锁定时内核不会伪造 request_id / mem_id；解锁写密钥后可按 created_at 自动重放这条写入（队列页程序未提供，界面不显示条数）。'
          : '被拒请求不会留下可重放的回执；请按原因修正后重新提交，界面不会先显示成功。'}
      </div>
    </div>
  );
}

/** 最近回执 = 账本 action=write 审计行（无演示数据；被拒请求不入账） */
export function WriteReceiptTable({
  rows, phase, error, onRetry,
}: {
  rows: WriteReceiptHistoryRow[];
  phase: 'loading' | 'ready' | 'error';
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="p0-card">
      <div className="p0-hd">
        <h3>最近回执</h3>
        <span className="p0-sub">来源：账本审计 action=write（最近 10 条）</span>
        <span className="p0-right">
          {onRetry && <button type="button" className="p0-btn" onClick={onRetry}>刷新</button>}
        </span>
      </div>
      {phase === 'loading' ? (
        <div className="p0-empty">正在读取回执行…</div>
      ) : phase === 'error' ? (
        <div className="p0-empty dashed">
          <b>回执行没读到</b>
          <div>原因：{error}</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="p0-empty dashed" data-testid="receipt-history-empty">
          <b>账本暂无写入回执（真实 0 条）</b>
          <div>不注入演示回执；完成一次真实写入后这里才出现行。</div>
        </div>
      ) : (
        <div className="p0-tablewrap">
          <table className="p0-table">
            <thead>
              <tr>
                <th>回执 ID</th><th>时间</th><th>结果</th><th>去重结果</th>
                <th>sim</th><th>memory_id</th><th>层级回执</th><th>来源</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.request_id}>
                  <td className="mono">{r.request_id}</td>
                  <td className="mono">{fmtClock(new Date(r.ts).toISOString())}</td>
                  <td>{r.result}</td>
                  <td className="mono">{r.dedup}</td>
                  <td className="num">{r.sim === null ? '未取数' : r.sim.toFixed(2)}</td>
                  <td className="mono">{r.memory_id ?? '账本无链路'}</td>
                  <td className="mono">{r.layers}</td>
                  <td>{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="p0-note">
        回执只读、不可编辑、不提供「重放」按钮；写密钥锁定等被拒请求在落库前被拦下，不会留下回执行。
      </div>
    </div>
  );
}
