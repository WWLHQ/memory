// 批次48 A31-c/A31-d：模型页「厂商余额与手工兜底」面板。
// 口径（逐字段 provenance，不整块打标）：
//  · 余额：只有真厂商端点成功才是「厂商实时 · HH:mm」；401/403 降级手工并写明原因；超时/5xx 保留上次成功值标 stale；
//  · 日配额 / 单价：厂商 API 一律不提供，恒为手工值（标注「手工配置」），随 llm-config.json 持久化；
//  · 单次成本：本地 usage × 单价推算，界面明确写「推算」，绝不呈现为厂商账单；
//  · 凭据：只显示「已配置/未配置」，明文只在管理员输入框里出现，保存后立即清空输入框。
import { useEffect, useState } from 'react';
import {
  billingAmountText, billingHHmm, billingProvenanceText, type BillingEngineView, type ManualBilling,
} from '../../shared/billing.ts';

export type ManualPatch = {
  balance?: number | null;
  dailyQuota?: number | null;
  priceCnyPerMTok?: number | null;
};

interface Props {
  views: BillingEngineView[];
  ttlMs: number;
  /** 最近一次余额拉取成功的时刻（页面顶部时间戳用；null = 未拉取过） */
  fetchedAt: number | null;
  loading: boolean;
  error: string | null;
  /** 浏览器模式无宿主能力：诚实说明，不伪造余额 */
  hostAvailable: boolean;
  onRefresh: () => void;
  onSaveManual: (id: string, patch: ManualPatch) => void;
  onSetKey: (id: string, value: string) => void;
}

/** 手工数字输入：空串/非法一律提交 null（未设置），不把空串悄悄当 0 */
function ManualNumber(props: {
  value: number | null;
  unit: string;
  testId: string;
  /** true = 必须 > 0（配额）；false = 允许 0（单价） */
  positive: boolean;
  onCommit: (v: number | null) => void;
}) {
  const [text, setText] = useState(props.value === null ? '' : String(props.value));
  useEffect(() => { setText(props.value === null ? '' : String(props.value)); }, [props.value]);
  const commit = () => {
    const s = text.trim();
    if (!s) { props.onCommit(null); return; }
    const n = Number(s);
    const ok = Number.isFinite(n) && n >= 0 && (!props.positive || n > 0);
    props.onCommit(ok ? n : null);
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        data-testid={props.testId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        placeholder="未设置"
        inputMode="decimal"
        style={{ width: 90 }}
      />
      <span className="dim" style={{ fontSize: 12 }}>{props.unit}</span>
    </span>
  );
}

function CredentialCell(props: {
  view: BillingEngineView;
  onSetKey: (id: string, value: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const v = props.view;
  const needsManagement = v.id === 'openrouter';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
      <span className="dim" data-testid={`billing-key-state-${v.id}`}>
        {v.keySet
          ? `已配置（${v.credentialSource === 'billing' ? '独立 billing 槽' : '沿用推理 key'}）`
          : '未配置'}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          data-testid={`billing-key-input-${v.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={needsManagement ? 'management key（普通 key 只能读 key 限额）' : '留空则沿用推理 key'}
          style={{ flex: 1, minWidth: 120 }}
        />
        <button
          className="btn"
          data-testid={`billing-key-save-${v.id}`}
          onClick={() => { props.onSetKey(v.id, draft); setDraft(''); }}
        >保存</button>
        {v.keySet && (
          <button
            className="btn"
            data-testid={`billing-key-clear-${v.id}`}
            onClick={() => { props.onSetKey(v.id, ''); setDraft(''); }}
          >清除</button>
        )}
      </div>
    </div>
  );
}

/** 单个引擎的手工兜底配置（余额/日配额/单价）；只在管理员保存时写盘 */
function ManualCells(props: { view: BillingEngineView; onSaveManual: (id: string, patch: ManualPatch) => void }) {
  const m: ManualBilling = props.view.manual;
  return (
    <>
      <td data-testid={`billing-manual-balance-${props.view.id}`}>
        <span title="厂商 API 不提供余额时才用这里的手工值">手工余额 </span>
        <ManualNumber
          testId={`billing-balance-input-${props.view.id}`}
          value={m.balance}
          unit={m.currency}
          positive={false}
          onCommit={(v) => props.onSaveManual(props.view.id, { balance: v })}
        />
        {m.updatedAt !== null && <div className="dim" style={{ fontSize: 12 }}>写入于 {billingHHmm(m.updatedAt)}</div>}
      </td>
      <td data-testid={`billing-manual-quota-${props.view.id}`}>
        <ManualNumber
          testId={`billing-quota-input-${props.view.id}`}
          value={m.dailyQuota}
          unit="次/日"
          positive
          onCommit={(v) => props.onSaveManual(props.view.id, { dailyQuota: v })}
        />
        <div className="dim" style={{ fontSize: 12 }}>手工配置（厂商不提供）</div>
      </td>
      <td data-testid={`billing-manual-price-${props.view.id}`}>
        <ManualNumber
          testId={`billing-price-input-${props.view.id}`}
          value={m.priceCnyPerMTok}
          unit="¥/百万词元"
          positive={false}
          onCommit={(v) => props.onSaveManual(props.view.id, { priceCnyPerMTok: v })}
        />
        <div className="dim" style={{ fontSize: 12 }}>手工配置（厂商不提供）</div>
      </td>
    </>
  );
}

export function BillingPanel(p: Props) {
  return (
    <div className="card" data-testid="billing-panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>厂商余额与手工兜底（A31）</b>
        <button className="btn" data-testid="billing-refresh" onClick={p.onRefresh} disabled={p.loading}>
          {p.loading ? '查询中…' : '手动刷新余额'}
        </button>
      </div>
      <div className="note">
        余额逐字段标来源：厂商实时 / 厂商上次成功（当前不可达）/ 手工兜底（非厂商实时）/ 未设置。
        日配额与单价由厂商 API 不提供、一律手工填写；单次成本 = 本地 usage × 单价<strong>推算</strong>，不是厂商账单。
        {p.fetchedAt !== null && ` 本页最近一次拉取：${billingHHmm(p.fetchedAt)}。`}
        {` 默认 ${Math.round(p.ttlMs / 60_000)} 分钟自动复用缓存。`}
      </div>
      {p.error && <div className="dim" data-testid="billing-error" style={{ color: 'var(--danger,#ff5d5d)' }}>{p.error}</div>}
      {!p.hostAvailable && (
        <div className="dim" data-testid="billing-no-host">浏览器模式无宿主能力：余额查询只在桌面壳内可用（此处不伪造任何余额）。</div>
      )}
      {p.views.length === 0 ? (
        <div className="dim" data-testid="billing-empty" style={{ padding: '6px 0' }}>尚无引擎配置</div>
      ) : (
        <table className="tbl" style={{ width: '100%', marginTop: 8 }}>
          <thead>
            <tr>
              <th>引擎</th>
              <th>余额（厂商/手工）</th>
              <th>凭据</th>
              <th>手工余额</th>
              <th>日配额</th>
              <th>单价</th>
            </tr>
          </thead>
          <tbody>
            {p.views.map((v) => (
              <tr key={v.id} data-testid={`billing-row-${v.id}`}>
                <td>
                  <div>{v.name}</div>
                  <div className="dim" style={{ fontSize: 12 }}>{v.id}</div>
                </td>
                <td data-testid={`billing-balance-${v.id}`}>
                  <div>{billingAmountText(v.balance, v.currency)}</div>
                  <div className="dim" data-testid={`billing-prov-${v.id}`} style={{ fontSize: 12 }}>
                    {billingProvenanceText({ provenance: v.provenance, asOf: v.asOf, scope: v.scope }, p.fetchedAt ?? Date.now())}
                  </div>
                  {v.lastError && (
                    <div className="dim" data-testid={`billing-reason-${v.id}`} style={{ fontSize: 12 }}>
                      {v.lastError}
                    </div>
                  )}
                </td>
                <td>
                  {v.kind === 'local'
                    ? <span className="dim">本机端点，无需凭据</span>
                    : <CredentialCell view={v} onSetKey={p.onSetKey} />}
                </td>
                <ManualCells view={v} onSaveManual={p.onSaveManual} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
