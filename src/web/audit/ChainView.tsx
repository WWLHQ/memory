// 链路视图（18.2-E）· 定稿 5 段：只连真实存在的事件，缺失段显示「—」，不补造节点。
import { chainStages } from './logic.ts';
import type { AuditEntry } from './types.ts';

export function ChainView({ requestId, rows }: { requestId: string; rows: AuditEntry[] }) {
  const stages = chainStages(rows);
  return (
    <div className="p0-card" data-testid="chain-view">
      <div className="p0-hd">
        <h3>链路视图 · <span className="mono">{requestId}</span></h3>
        <span className="p0-sub">共 {rows.length} 行真实审计（append-only）</span>
        <span className="p0-right p0-tag info">缺失段显示「—」，不补造证据</span>
      </div>
      <div className="p0-chain">
        {stages.map((s, i) => (
          <div key={s.key} className={`p0-chain-node${s.evidence ? '' : ' missing'}`} data-testid={`chain-node-${i}`}>
            <div className="p0-chain-dot" aria-hidden="true">{i + 1}</div>
            <div className="p0-chain-body">
              <b>{s.label}</b>
              <div className="p0-note mono">{s.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
