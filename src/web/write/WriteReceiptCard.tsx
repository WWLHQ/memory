// 写入页回执（定稿）：四类结果 + 真实 request_id / memory_id / 层级，不编辑、不重放。
import type { LayerName, SourceKind, WriteReceipt, WriteReceiptHistoryRow, WriteRefusal } from './types.ts';

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

/** 写入回执（成功 / graft / keep / filtered）：字段全部来自内核本次返回 */
export function WriteReceiptCard({ receipt }: { receipt: WriteReceipt }) {
  return (
    <div className="wf-card" data-testid="receipt">
      <div className="wf-hd">
        <span className="wf-zh">写入回执</span>
        <span className="wf-meta">字段全部来自内核本次返回 · 只读</span>
      </div>
      <div className="wf-bd">
        <div className={`wf-status ${ACTION_TONE[receipt.dedup_action]}`} data-testid="receipt-action">
          <b>{ACTION_LABEL[receipt.dedup_action]}</b>
          {receipt.dedup_action === 'filtered' ? ' · 本次未写入记忆库' : ' · 内核已落定，回执只读'}
        </div>

        <div className="wf-kv">
          <span className="wf-k">request_id</span>
          <span className="wf-v mono" data-testid="receipt-request-id">{receipt.request_id || '账本无链路'}</span>
          <span className="wf-k">memory_id</span>
          <span className="wf-v mono" data-testid="receipt-id">{receipt.memory_id || '未入库 · 质量门拦截'}</span>
          <span className="wf-k">去重结果</span>
          <span className="wf-v">{ACTION_LABEL[receipt.dedup_action]}</span>
          <span className="wf-k">精炼</span>
          <span className="wf-v">{receipt.refined_by === 'stub' ? '未精炼（未接入 LLM）' : receipt.refined_by}</span>
          <span className="wf-k">写入时间</span>
          <span className="wf-v mono">{fmtClock(receipt.created_at)}</span>
          <span className="wf-k">写密钥</span>
          <span className="wf-v">{receipt.dedup_action === 'filtered' ? '未签发（未入库）' : '已签发 · L0 密文按规则生成'}</span>
        </div>

        <div className="wf-note">L1–L6 逐层（只展示真实产出；L1 原文仅审计展开，15.3）：</div>
        {LAYERS.map((ln) => (
          <details className="wf-lrow" key={ln} data-testid={`layer-${ln}`}>
            <summary>{ln} · {receipt.layers[ln].summary}</summary>
            {receipt.layers[ln].auditOnly && (
              <div className="wf-audit">⚠ 仅审计可展开原文（15.3）</div>
            )}
            {receipt.layers[ln].text && (
              <div className="wf-layer-body" data-testid={`layer-body-${ln}`}>{receipt.layers[ln].text}</div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

/** 被内核拒绝：不生成成功回执，只展示原因 + 内核本次 request_id（未签发就如实写「未签发」） */
export function WriteRefusalCard({ refusal, source }: { refusal: WriteRefusal; source: SourceKind }) {
  return (
    <div className="wf-card" data-testid="receipt-rejected">
      <div className="wf-hd">
        <span className="wf-zh">写入被拒</span>
        <span className="wf-meta">未落库 · 不乐观成功</span>
      </div>
      <div className="wf-bd">
        <div className="wf-status bad" data-testid="receipt-action">
          <b>{refusal.l0_locked ? 'E_L0_LOCKED · L0 写密钥未解锁' : '写入被拒'}</b> · 未落库
        </div>
        <div className="wf-kv">
          <span className="wf-k">原因</span>
          <span className="wf-v" data-testid="receipt-rejected-reason">{refusal.reason}</span>
          <span className="wf-k">被挡请求</span>
          <span className="wf-v mono" data-testid="receipt-request-id">
            {refusal.request_id ?? '未签发'} · {fmtHMS(new Date(refusal.created_at).getTime())} · {SOURCE_LABEL[source]}
          </span>
          <span className="wf-k">memory_id</span>
          <span className="wf-v mono">{refusal.l0_locked ? '未落库 · 重放成功后生成' : '未落库'}</span>
          <span className="wf-k">动作</span>
          <span className="wf-v">{refusal.l0_locked ? '待重放 · 重放后内核自动裁决' : '不可重放 · 修正后重新提交'}</span>
          <span className="wf-k">精炼</span>
          <span className="wf-v">{refusal.l0_locked ? '重放成功后入后台补炼队列（pending）' : '未精炼（未落库）'}</span>
        </div>
        <div className="wf-note">
          {refusal.l0_locked
            ? '解锁写密钥后自动重放这条写入，无需再点写入；重放结果以内核真实回执为准，界面不会先显示成功。'
            : '被拒请求不会留下可重放的回执；请按原因修正后重新提交，界面不会先显示成功。'}
        </div>
      </div>
    </div>
  );
}

/** 最近写入通栏（批次58）：账本审计 action=write 最近 3 条；filtered 行如实标注质量门版本与拦截码 */
export function WriteRecentWritesCard({
  rows, phase, error,
}: {
  rows: WriteReceiptHistoryRow[];
  phase: 'loading' | 'ready' | 'error';
  error?: string;
}) {
  // filtered 写入审计行的 detail 来自 filteredAuditDetail：带 filter_code/gate_version、不带 dedup 字段；
  // 成功行反之。以 filter_code 是否存在区分，不猜 dedup 字面量。
  const desc = (r: WriteReceiptHistoryRow): string => {
    if (r.filter_code !== null) {
      return `L0+L1 质量门 v${r.gate_version ?? '?'} · ${r.filter_code}`;
    }
    const sim = r.sim === null ? '未取数' : r.sim.toFixed(2);
    return `${r.dedup} · sim ${sim} · ${r.source}`;
  };
  return (
    <div className="wf-card wf-recent">
      <div className="wf-hd">
        <span className="wf-zh">最近写入</span>
        <span className="wf-meta">来源：账本审计 action=write · 最近 3 条</span>
      </div>
      <div className="wf-bd">
        {phase === 'loading' ? (
          <div className="wf-empty" data-testid="recent-writes-loading">正在读取写入行…</div>
        ) : phase === 'error' ? (
          <div className="wf-empty dashed" data-testid="recent-writes-error">
            <b>写入行没读到</b>
            <div>原因：{error}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="wf-empty dashed" data-testid="recent-writes-empty">
            <b>账本暂无写入（真实 0 条）</b>
            <div>不注入演示行；完成一次真实写入后这里才出现行。</div>
          </div>
        ) : (
          <table className="wf-rt">
            <thead>
              <tr><th>时间</th><th>mem_id</th><th>动作</th><th>层</th><th>说明</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.request_id}>
                  <td className="mono">{fmtHMS(r.ts)}</td>
                  <td className="mono">{r.memory_id ?? '未写入'}</td>
                  <td>{r.result}</td>
                  <td className="mono">{r.layers}</td>
                  <td>{desc(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
                  <td className="mono">{r.memory_id ?? '未写入'}</td>
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
