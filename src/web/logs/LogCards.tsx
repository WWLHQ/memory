// REQ-011 T3 日志列表（§2.2）+ 异常聚合卡（§2.3）+ 审计 modal（R-LOG6）+ L0 授权卡（§2.4）
import { useState } from 'react';
import type { LogEntry } from './types.ts';
import { ACTION_LABEL, FORM_LABEL } from './seed.ts';
import { aggrErrors } from './logic.ts';

export function LogTable({ logs, onAudit }: { logs: LogEntry[]; onAudit: (rid: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="card" data-testid="log-table">
      <table className="ltable">
        <thead><tr><th>时间</th><th>级别</th><th>端</th><th>动作</th><th>消息</th><th>request_id</th><th>操作</th></tr></thead>
        <tbody>
          {logs.map((l, i) => (
            <tr key={i} className={l.level === 'error' ? 'err-row' : ''} data-testid={`log-${i}`}>
              <td style={{ whiteSpace: 'nowrap' }}>{l.ts.slice(11, 19)}<div className="note" style={{ margin: 0 }}>{l.ts.slice(0, 10)}</div></td>
              <td><span className={`dot ${l.level}`} />{l.level}</td>
              <td><span className="status stale">{FORM_LABEL[l.form]}</span></td>
              <td>{ACTION_LABEL[l.action] ?? l.action}</td>
              <td>
                {l.message}
                {open === i && l.extra && (
                  <div className="note" data-testid={`extra-${i}`}>详情：{JSON.stringify(l.extra)}</div>
                )}
              </td>
              <td>
                {l.request_id === 'n/a'
                  ? <span className="status deprecated" data-testid={`na-${i}`}>n/a（缺审计链）</span>
                  : <a href="#" className="mid" data-testid={`rid-${i}`} onClick={(e) => { e.preventDefault(); onAudit(l.request_id); }}>{l.request_id}</a>}
              </td>
              <td>
                {l.extra && <button type="button" className="btn" data-testid={`detail-${i}`} onClick={() => setOpen(open === i ? null : i)}>详情</button>}
                {l.request_id !== 'n/a' && (
                  <button type="button" className="btn" data-testid={`audit-${i}`} onClick={() => onAudit(l.request_id)}>查阅审计</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {logs.length === 0 && <div className="note" data-testid="log-empty">无匹配日志</div>}
    </div>
  );
}

export function ErrorAggr({ logs, onJump }: { logs: LogEntry[]; onJump: (target: string) => void }) {
  const aggr = aggrErrors(logs);
  if (aggr.length === 0) return null;
  return (
    <div className="card" data-testid="error-aggr">
      <div className="row-head"><b>异常分类（§2.3，error 置顶）</b></div>
      <div className="row">
        {aggr.map((a) => (
          <span key={a.kind} className="status deprecated" style={{ cursor: 'pointer' }} data-testid={`aggr-${a.kind}`} onClick={() => onJump(a.target)}>
            {a.kind} × {a.count} → {a.target}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AuditModal({ requestId, onClose }: { requestId: string; onClose: () => void }) {
  return (
    <div className="modal-mask" data-testid="audit-modal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-head">
          <b>审计全链路 · {requestId}</b>
          <button type="button" className="btn" data-testid="modal-close" onClick={onClose}>关闭</button>
        </div>
        <div className="note">定位该 request_id 的全部审计行（P11 形态 · 非常驻，关闭即收起 R-LOG6）。</div>
        <div className="note" data-testid="modal-chain">链路：recall → rerank → mode_dispatch（演示数据）</div>
        <div className="note">R-LOG8：审计区无普通删除按钮；删除需 Admin + 二次确认 + 写 audit_delete（不可无痕）。</div>
      </div>
    </div>
  );
}

export function L0AuthCard({ state, message, onAuth, sample }: {
  state: { role: 'admin' | 'member'; unlocked: boolean; failCount: number; lockedUntil: number | null };
  message: string | null;
  onAuth: (pwd: string) => void;
  /** 解锁后的 L0 原文（内核 browse 回填；缺省用演示样例） */
  sample?: string;
}) {
  const [pwd, setPwd] = useState('');
  return (
    <div className="card" data-testid="l0-card">
      <div className="row-head"><b>L0 查阅授权（§2.4，R-LOG3）</b></div>
      <div className="row">
        <span className="mid" data-testid="l0-sample">mem_005 生产库连接串：<b>{state.unlocked ? (sample ?? 'tcp://prod-db:5432/app') : '[L0 已加密 · 需授权]'}</b></span>
      </div>
      <div className="row">
        <span className="dim">角色：{state.role === 'admin' ? '管理员' : '普通成员（恒遮罩）'}</span>
        {state.role === 'admin' && !state.unlocked && (
          <>
            <input
              type="password" data-testid="l0-pwd" value={pwd} placeholder="输入 L0 密码"
              style={{ width: 140, background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}
              onChange={(e) => setPwd(e.target.value)}
            />
            <button type="button" className="btn primary" data-testid="l0-submit" onClick={() => { onAuth(pwd); setPwd(''); }}>解锁</button>
          </>
        )}
        {state.unlocked && <span className="status active">已解锁（会话级）</span>}
      </div>
      {message && <div className="note" data-testid="l0-msg">{message}</div>}
      {state.lockedUntil && <div className="note">锁定中（l0_auth_fail 已记审计）</div>}
    </div>
  );
}
