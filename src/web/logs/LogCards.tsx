// REQ-011 T3 日志列表（§2.2）+ 异常聚合卡（§2.3）+ 审计 modal（R-LOG6，按 request_id 真查内核账本）+ L0 授权卡（§2.4）
// 批次24：列表改为固定表头 + 可拖拽列宽（宽度固化到 localStorage，重登/刷新后保持）；分页由父组件持有。
import { useEffect, useState } from 'react';
import type { LogEntry } from './types.ts';
import { ACTION_LABEL, FORM_LABEL } from './labels.ts';
import { aggrErrors } from './logic.ts';
import { coreAuditChain } from './coreLogs.ts';
import { formatLogClock, formatLogDate } from '../Home/programLog.ts';
import { formatRemaining } from '../shared/useL0Session.ts';
import { DEFAULT_PROJECT_ID, listProjectIds } from '../shared/kernelProjects.ts';
import { ColResizeHandle, useColWidths } from '../shared/useColWidths.tsx';
import '../shared/tableResize.css';

/** 7 列默认宽度（px，消息列吃掉剩余宽度）；固化键 logsColWidths */
const LOG_COL_DEFAULTS = [92, 62, 58, 96, 300, 148, 150] as const;
const LOG_COL_KEY = 'logsColWidths';
const LOG_COL_LABELS = ['时间', '级别', '端', '动作', '消息', 'request_id', '操作'];

export interface LogTableProps {
  /** 当前页要渲染的日志（分页在父组件完成） */
  logs: LogEntry[];
  onAudit: (rid: string) => void;
  /** 首页偏移：行 testid / 详情展开按全局序号，翻页后不串位 */
  indexOffset?: number;
}

export function LogTable({ logs, onAudit, indexOffset = 0 }: LogTableProps) {
  const [open, setOpen] = useState<number | null>(null);
  const { widths, startResize, reset, isDefault } = useColWidths(LOG_COL_KEY, LOG_COL_DEFAULTS);
  return (
    <div className="card" data-testid="log-table">
      <div className="col-hint">
        <span>拖表头右侧把手调列宽，调整后自动固化（刷新、重新登录都保持）。</span>
        {!isDefault && <button type="button" className="btn" data-testid="log-col-reset" onClick={reset}>恢复默认列宽</button>}
      </div>
      <div className="tbl-scroll">
        <table className="ltable col-fixed" data-testid="log-table-node">
          <thead>
            <tr>
              {LOG_COL_LABELS.map((h, i) => (
                <th key={h} style={{ width: widths[i] }} data-testid={`log-th-${i}`} data-w={widths[i]}>
                  {h}
                  <ColResizeHandle col={i} onCol={startResize} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((l, n) => {
              const i = indexOffset + n;
              return (
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
              );
            })}
          </tbody>
        </table>
      </div>
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

/** 审计全链路 modal（R-LOG6，非常驻）：打开即按 request_id 真查内核账本。
 *  批次25 P0-2 前它一次都不查，只把 request_id 印成「（真实审计记录）」——假展示。
 *  四种结果分开显示：查询中 / 命中 N 行 / 账本查无该行 / 查询失败（带原因，绝不并入「查无」）。
 *  `load` 有默认实现，测试用它注入失败路径。 */
export function AuditModal({
  requestId,
  onClose,
  load = coreAuditChain,
}: {
  requestId: string;
  onClose: () => void;
  load?: (requestId: string) => Promise<LogEntry[]>;
}) {
  const [rows, setRows] = useState<LogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    load(requestId)
      .then((r) => { if (alive) setRows(r); })
      .catch((e) => { if (alive) setError(String((e as Error)?.message ?? e)); });
    return () => { alive = false; };
  }, [requestId, load]);

  const status = error !== null ? 'failed' : rows === null ? 'loading' : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="modal-mask" data-testid="audit-modal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-head">
          <b data-testid="modal-title">审计全链路 · {requestId}</b>
          <button type="button" className="btn" data-testid="modal-close" onClick={onClose}>关闭</button>
        </div>
        <div className="note">定位该 request_id 的全部审计行（P11 形态 · 非常驻，关闭即收起 R-LOG6）。</div>
        {status === 'loading' && (
          <div className="note" data-testid="modal-loading">正在查本机记忆账本…</div>
        )}
        {status === 'failed' && (
          <div className="note" data-testid="modal-error">
            ⚠️ 账本查询失败：{error}。这是「查不了」，不是「没有记录」——请确认桌面端内核可用后重试。
          </div>
        )}
        {status === 'empty' && (
          <div className="note" data-testid="modal-empty">
            本机账本中该 request_id 查无审计行（append-only 账本里确实没有这条链路）。
          </div>
        )}
        {status === 'ready' && (
          <>
            <div className="note" data-testid="modal-chain">
              本机账本命中 {rows!.length} 行 · 按时间升序（UTC+08:00）
            </div>
            <table className="ltable" data-testid="modal-table">
              <thead>
                <tr><th>时间</th><th>端</th><th>动作</th><th>消息</th><th>request_id</th></tr>
              </thead>
              <tbody>
                {rows!.map((r, i) => (
                  <tr key={`${r.request_id}-${i}`} data-testid="modal-row">
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatLogClock(r.ts)}
                      <div className="note" style={{ margin: 0 }}>{formatLogDate(r.ts)}</div>
                    </td>
                    <td><span className="status stale">{FORM_LABEL[r.form]}</span></td>
                    <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                    <td>{r.message}</td>
                    <td className="mid">{r.request_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="note">R-LOG8：审计区无普通删除按钮；删除需 Admin + 二次确认 + 写 audit_delete（不可无痕）。</div>
      </div>
    </div>
  );
}

const l0Input = {
  background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)',
  borderRadius: 8, padding: 6, fontSize: 12,
} as const;

export interface L0AuthCardProps {
  role: 'admin' | 'member' | null;
  unlocked: boolean;
  message: string | null;
  /** 解锁后的 L0 原文（内核 browse 回填；缺省显示「无 L0 内容」，不注入演示文本） */
  sample?: string;
  /** 连续会话剩余毫秒（5 分钟空闲自动上锁） */
  remainingMs: number;
  lockedUntil: number | null;
  busy: boolean;
  grantId: string;
  onGrantIdChange: (v: string) => void;
  onAuth: (pwd: string, grantId?: string) => void;
  onLock: () => void;
  requestMsg: string | null;
  onRequest: (projectIds: string, reason: string) => void;
}

/** L0 查阅授权卡（§4.4.3）：管理员=管理密码直接查阅；被授权账号=grant_id + 一次性密码；
 *  查阅连续（5 分钟无操作自动锁定，可随时主动锁定）。成员可在此提交查阅申请。 */
export function L0AuthCard(props: L0AuthCardProps) {
  const { role, unlocked, message, sample, remainingMs, lockedUntil, busy, grantId } = props;
  const [pwd, setPwd] = useState('');
  // 批次27 P2-7：默认申请项目从账本真实派生；空账本回落默认占位项目
  const [projects, setProjects] = useState(DEFAULT_PROJECT_ID);
  useEffect(() => {
    void listProjectIds().then((ps) => {
      if (ps.length > 0) setProjects(ps.join(', '));
    });
  }, []);
  const [reason, setReason] = useState('');
  const roleText = role === 'admin' ? '管理员（管理密码直接查阅）'
    : role === 'member' ? '已授权账号（grant_id + 一次性密码）' : '未登录（登录后生效）';
  const remain = formatRemaining(remainingMs);
  return (
    <div className="card" data-testid="l0-card">
      <div className="row-head"><b>L0 查阅授权（§4.4，R-LOG3）</b></div>
      <div className="row">
        <span className="mid" data-testid="l0-sample">L0 原文：<b>{unlocked ? (sample ?? '[无 L0 内容]') : '[L0 已加密 · 需授权]'}</b></span>
      </div>
      <div className="row">
        <span className="dim">角色：{roleText}</span>
        {!unlocked && role === 'member' && (
          <input
            type="text" data-testid="l0-grant-id" value={grantId} placeholder="grant_id（管理员发放）"
            style={{ ...l0Input, width: 230 }}
            onChange={(e) => props.onGrantIdChange(e.target.value)}
          />
        )}
        {!unlocked && role !== null && (
          <>
            <input
              type="password" data-testid="l0-pwd" value={pwd}
              placeholder={role === 'admin' ? '输入 L0 管理密码' : '输入一次性授权密码'}
              style={{ ...l0Input, width: 170 }}
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { props.onAuth(pwd, grantId); setPwd(''); } }}
            />
            <button
              type="button" className="btn primary" data-testid="l0-submit" disabled={busy}
              onClick={() => { props.onAuth(pwd, grantId); setPwd(''); }}
            >
              解锁
            </button>
          </>
        )}
        {unlocked && (
          <>
            <span className="status active" data-testid="l0-countdown">已解锁 · 剩余 {remain}（空闲 5 分钟自动锁定）</span>
            <button type="button" className="btn" data-testid="l0-lock-btn" disabled={busy} onClick={props.onLock}>
              立即锁定
            </button>
          </>
        )}
      </div>
      {role === 'member' && !unlocked && (
        <div className="row" data-testid="l0-request">
          <span className="dim">无授权？提交查阅申请</span>
          <input
            type="text" data-testid="l0-req-projects" value={projects} placeholder="项目 ID（逗号分隔）"
            style={{ ...l0Input, width: 140 }} onChange={(e) => setProjects(e.target.value)}
          />
          <input
            type="text" data-testid="l0-req-reason" value={reason} placeholder="申请理由"
            style={{ ...l0Input, width: 180 }} onChange={(e) => setReason(e.target.value)}
          />
          <button
            type="button" className="btn" data-testid="l0-req-submit"
            onClick={() => props.onRequest(projects, reason)}
          >
            提交申请
          </button>
        </div>
      )}
      {props.requestMsg && <div className="note" data-testid="l0-req-msg">{props.requestMsg}</div>}
      {message && <div className="note" data-testid="l0-msg">{message}</div>}
      {lockedUntil && <div className="note">锁定中（l0_auth_fail 已记审计）</div>}
    </div>
  );
}
