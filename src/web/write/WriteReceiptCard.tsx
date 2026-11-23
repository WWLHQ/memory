// 写入页回执与最近写入（STRATUM 1:1 复刻 · 设计真源 stratum-a-full.html pg-write）：
// 回执 = af-panel(af-ph h3 回执 + af-badge 结果 + hint) + af-kv 字段（request_id/memory_id/去重/精炼/时间），
// 四类结果照内核真实返回展示（filtered 也出回执但明确未入库）；被拒只出原因 + request_id（未签发写「未签发」）。
// 最近写入 = 通栏 af-panel + af-table（时间/mem_id/动作/层），只统计真实落库行（create/graft/keep）。
// 回执只读、不编辑、不重放；不做乐观成功。⚠ 禁止演示数据：空账本即空表。
import type { SourceKind, WriteReceipt, WriteReceiptHistoryRow, WriteRefusal } from './types.ts';

const ACTION_LABEL: Record<WriteReceipt['dedup_action'], string> = {
  create: 'create · 新建条目',
  graft: 'graft · 嫁接为新版本',
  keep: 'keep · 保留原记忆',
  filtered: 'filtered · 质量门拦截（未入库）',
};

const ACTION_TONE: Record<WriteReceipt['dedup_action'], string> = {
  create: 'ok', graft: 'info', keep: 'warn', filtered: 'warn',
};

const ACTION_BADGE: Record<WriteReceipt['dedup_action'], string> = {
  create: 'acc', graft: 'ok', keep: 'warn', filtered: 'warn',
};

const SOURCE_LABEL: Record<SourceKind, string> = {
  conversation: '会话', api: 'API', mcp: 'MCP',
};

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 本地 HH:MM:SS（账本 ts 是 epoch，用户可读时间一律本地时区） */
export function fmtHMS(ts: number): string {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 写入回执（create / graft / keep / filtered）：字段全部来自内核本次返回，回执只读 */
export function WriteReceiptCard({ receipt }: { receipt: WriteReceipt }) {
  return (
    <section className="af-panel" data-testid="receipt">
      <div className="af-ph">
        <h3>回执</h3>
        <span className={`af-badge ${ACTION_BADGE[receipt.dedup_action]}`}>{receipt.dedup_action}</span>
        <span className="hint">{fmtClock(receipt.created_at)} · 回执只读</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 8 }}>
        <div className={`af-actline ${ACTION_TONE[receipt.dedup_action]}`} data-testid="receipt-action">
          <b>{ACTION_LABEL[receipt.dedup_action]}</b>
          {receipt.dedup_action === 'filtered' ? '· 本次未写入记忆库' : '· 内核已落定，回执只读'}
        </div>
        <dl className="af-kv">
          <dt>request_id</dt>
          <dd data-testid="receipt-request-id">{receipt.request_id || '账本无链路'}</dd>
          <dt>memory_id</dt>
          <dd data-testid="receipt-id">{receipt.memory_id || '未入库 · 质量门拦截'}</dd>
          <dt>去重结果</dt>
          <dd>{ACTION_LABEL[receipt.dedup_action]}</dd>
          <dt>精炼</dt>
          <dd>{receipt.refined_by === 'stub' ? '未精炼（未接入 LLM）' : receipt.refined_by}</dd>
          <dt>写入时间</dt>
          <dd>{fmtClock(receipt.created_at)}</dd>
        </dl>
        <p className="af-note">
          字段全部来自内核本次返回 · 回执只读；L1–L6 分层由内核签发（L1 原文仅审计可展开），界面不再逐层展示。
        </p>
      </div>
    </section>
  );
}

/** 被内核拒绝：不生成成功回执，只展示原因 + 内核本次 request_id（未签发就如实写「未签发」） */
export function WriteRefusalCard({ refusal, source }: { refusal: WriteRefusal; source: SourceKind }) {
  return (
    <section className="af-panel" data-testid="receipt-rejected">
      <div className="af-ph">
        <h3>回执</h3>
        <span className={`af-badge ${refusal.l0_locked ? 'warn' : 'bad'}`}>{refusal.l0_locked ? 'L0 锁定' : '未落库'}</span>
        <span className="hint">{refusal.request_id ?? '未签发'} · {refusal.l0_locked ? '待解锁重放' : '未落库'}</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 8 }}>
        <div className={`af-actline ${refusal.l0_locked ? 'warn' : 'bad'}`} data-testid="receipt-action">
          {refusal.l0_locked
            ? <b>写入被 L0 锁定挡下（E_L0_LOCKED）· 解锁后自动重放并出示回执</b>
            : <><b>写入被拒</b> · 未落库 · 不乐观成功</>}
        </div>
        <dl className="af-kv">
          {!refusal.l0_locked && (
            <>
              <dt>原因</dt>
              <dd data-testid="receipt-rejected-reason">{refusal.reason}</dd>
            </>
          )}
          <dt>被挡请求</dt>
          <dd data-testid="receipt-request-id">
            {refusal.request_id ?? '未签发'} · {fmtHMS(new Date(refusal.created_at).getTime())} · {SOURCE_LABEL[source]}
          </dd>
          <dt>memory_id</dt>
          <dd>{refusal.l0_locked ? '未落库 · 重放成功后生成' : '未落库'}</dd>
          <dt>动作</dt>
          <dd>{refusal.l0_locked ? 'create · 待重放' : '不可重放 · 修正后重新提交'}</dd>
          <dt>精炼</dt>
          <dd>{refusal.l0_locked ? '重放成功后入后台补炼队列（pending）' : '未精炼（未落库）'}</dd>
        </dl>
        <p className="af-note">
          {refusal.l0_locked
            ? '解锁重放成功后出示真实回执 · 当前无正文落库 · 下方就地解锁后自动重放被挡那条。'
            : '被拒请求不会留下可重放的回执；请按原因修正后重新提交，界面不会先显示成功。'}
        </p>
      </div>
    </section>
  );
}

/** 最近写入通栏（设计稿 pg-write 底部表）：账本审计 action=write 真实落库行；
 * 质量门拦截（filter_code 在）不是写入——mem_id 未写入、层未产生，不计入。 */
export function WriteRecentWritesCard({
  rows, phase, error,
}: {
  rows: WriteReceiptHistoryRow[];
  phase: 'loading' | 'ready' | 'error';
  error?: string;
}) {
  return (
    <section className="af-panel">
      <div className="af-ph">
        <h3>最近写入</h3>
        <span className="hint">写入快路径 · L0 封存 + 脱敏 L1 落库 · 深层后台补炼</span>
      </div>
      {phase === 'loading' ? (
        <div className="af-empty" data-testid="recent-writes-loading">正在读取写入行…</div>
      ) : phase === 'error' ? (
        <div className="af-empty" data-testid="recent-writes-error">
          <b>写入行没读到</b>
          原因：{error}
        </div>
      ) : rows.length === 0 ? (
        <div className="af-empty" data-testid="recent-writes-empty">
          <b>账本暂无写入（真实 0 条）</b>
          只统计真实落库的写入（create / graft / keep）；质量门拦截不是写入，不计入。完成一次真实写入后这里才出现行。
        </div>
      ) : (
        <table className="af-table">
          <thead>
            <tr><th>时间</th><th>mem_id</th><th>动作</th><th>层</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.request_id}>
                <td className="num">{fmtHMS(r.ts)}</td>
                <td className="num">{r.memory_id ?? '未写入'}</td>
                <td>
                  <span className={`af-badge ${r.dedup === 'new' ? 'acc' : r.dedup === 'grafted' ? 'ok' : 'warn'}`}>{r.result}</span>
                </td>
                <td className="num">{r.layers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
