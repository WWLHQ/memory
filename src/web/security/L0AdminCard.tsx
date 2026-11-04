// 账号与安全页 · L0 密钥环管理卡（§4.4）
// 管理密码设置/轮换 · 写密钥解锁/锁定 · 查阅申请审批 · 一次性授权发放/撤销。
// 页面只做展示与交互编排：口令校验/包裹/会话/审计全部在内核 L0Vault；一次性密码绝不落盘不进日志。
// 「旧数据迁移（§4.4.6）」已拆成独立卡片 L0MigrateCard.tsx——它和 L0 拆分/重建卡是同一类批量动作，摆在一起才看得懂分工。
import { useCallback, useEffect, useState } from 'react';
import type { L0GrantView, L0RequestView, L0VaultStatus } from '../../core/memagent/types.ts';
import {
  coreL0ChangeAdminPassword, coreL0Deny, coreL0Grant, coreL0ListGrants, coreL0ListRequests,
  coreL0LockWrite, coreL0Revoke, coreL0SetupAdminPassword, coreL0Status, coreL0UnlockWrite,
} from './coreSecurity.ts';

const MIN_LEN = 8;
const inputStyle = {
  background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)',
  borderRadius: 8, padding: 6, fontSize: 12,
} as const;

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
const fmt = (ts?: number): string => (ts ? new Date(ts).toLocaleString() : '—');

interface IssuedGrant {
  grant_id: string;
  password?: string;
}

export function L0AdminCard({ enabled }: { enabled: boolean }) {
  const [status, setStatus] = useState<L0VaultStatus | null>(null);
  const [requests, setRequests] = useState<L0RequestView[]>([]);
  const [grants, setGrants] = useState<L0GrantView[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [setupPw, setSetupPw] = useState('');
  const [setupPw2, setSetupPw2] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [writePw, setWritePw] = useState('');
  const [grantee, setGrantee] = useState('');
  const [scope, setScope] = useState('');
  const [grantPw, setGrantPw] = useState('');
  const [issued, setIssued] = useState<IssuedGrant | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [st, rq, gr] = await Promise.all([coreL0Status(), coreL0ListRequests(), coreL0ListGrants()]);
      setStatus(st);
      setRequests(rq);
      setGrants(gr);
      setErr(null);
    } catch (e) {
      setStatus(null);
      setErr(`L0 管理不可用：${errText(e)}`);
    }
  }, []);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setErr(`${label}失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <div className="card" data-testid="l0-admin-card">
        <b>🔐 L0 密钥环（§4.4）</b>
        <div className="note" data-testid="l0-admin-required">
          需管理员权限：管理密码、写密钥与查阅授权仅管理员可操作（旧数据迁移见下方独立卡）。
        </div>
      </div>
    );
  }

  const doSetup = () => {
    if (setupPw.length < MIN_LEN) { setErr(`管理密码至少 ${MIN_LEN} 位（§4.4.1）`); return; }
    if (setupPw !== setupPw2) { setErr('两次输入的管理密码不一致'); return; }
    void run('设置管理密码', async () => {
      await coreL0SetupAdminPassword(setupPw);
      setSetupPw(''); setSetupPw2('');
      setMsg('管理密码已设置：DEK 已生成并以管理密码包裹落盘（写密钥已在内存）');
    });
  };

  const doRotate = () => {
    if (newPw.length < MIN_LEN) { setErr(`新管理密码至少 ${MIN_LEN} 位（§4.4.1）`); return; }
    if (newPw !== newPw2) { setErr('两次输入的新管理密码不一致'); return; }
    void run('轮换管理密码', async () => {
      await coreL0ChangeAdminPassword(oldPw, newPw);
      setOldPw(''); setNewPw(''); setNewPw2('');
      setMsg('管理密码已轮换：旧管理密码立即失效，DEK 不变（已加密数据无需重写）');
    });
  };

  const doApprove = (r: L0RequestView) => {
    void run(`批准 ${r.request_id}`, async () => {
      // 系统随机生成授权密码：只在本次结果中显示一次，绝不落盘/进日志
      const g = await coreL0Grant({
        request_id: r.request_id,
        grantee_user_id: r.user_id,
        scope_project_ids: r.project_ids,
      });
      setIssued({ grant_id: g.grant_id, password: g.password });
      setMsg(`已批准 ${r.user_id} 的申请：请把一次性授权密码线下交给该账号`);
    });
  };

  const doDeny = (r: L0RequestView) => {
    if (!window.confirm(`确认拒绝 ${r.user_id} 的 L0 查阅申请？`)) return;
    void run(`拒绝 ${r.request_id}`, async () => {
      await coreL0Deny(r.request_id, '管理员拒绝');
      setMsg(`已拒绝 ${r.request_id}`);
    });
  };

  const doGrant = () => {
    const ids = scope.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!grantee.trim()) { setErr('请输入被授权账号 user_id'); return; }
    if (ids.length === 0) { setErr('请输入授权范围（项目 ID，逗号分隔）'); return; }
    if (grantPw && grantPw.length < MIN_LEN) { setErr(`授权密码至少 ${MIN_LEN} 位（§4.4.1）`); return; }
    void run('发放授权', async () => {
      const g = await coreL0Grant({
        grantee_user_id: grantee.trim(),
        scope_project_ids: ids,
        password: grantPw || undefined,
      });
      setIssued({ grant_id: g.grant_id, password: g.password });
      setMsg(`已向 ${g.grantee_user_id} 发放授权（范围 ${ids.join('、')}）`);
      setGrantee(''); setScope(''); setGrantPw('');
    });
  };

  const doRevoke = (g: L0GrantView) => {
    if (!window.confirm(`确认撤销 ${g.grant_id}？撤销后 wrapped DEK 立即删除，无法再解密。`)) return;
    void run(`撤销 ${g.grant_id}`, async () => {
      await coreL0Revoke(g.grant_id, '管理员撤销');
      setMsg(`已撤销 ${g.grant_id}（wrapped DEK 已删除）`);
    });
  };

  const doWriteUnlock = () => {
    if (!writePw) { setErr('请输入管理密码以解锁写密钥'); return; }
    void run('解锁写密钥', async () => {
      await coreL0UnlockWrite(writePw);
      setWritePw('');
      setMsg('写密钥已解锁：L0 写入可用（仅加密，不能解密查阅）');
    });
  };

  const doWriteLock = () => {
    void run('锁定写密钥', async () => {
      await coreL0LockWrite();
      setMsg('写密钥已锁定：新的 L0 写入将返回 E_L0_LOCKED');
    });
  };

  const pending = requests.filter((r) => r.status === 'pending');

  return (
    <div className="card" data-testid="l0-admin-card">
      <div className="row-head">
        <b>🔐 L0 密钥环（§4.4：AES-256-GCM · DEK 只在主进程内存）</b>
        <button type="button" className="btn" data-testid="l0-refresh" disabled={busy} onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      <div className="row" data-testid="l0-status">
        <span className={`status ${status?.has_admin_wrap ? 'active' : 'deprecated'}`} data-testid="l0-status-has">
          管理密码：{status?.has_admin_wrap ? '已设置' : '未设置'}
        </span>
        <span className={`status ${status?.write_unlocked ? 'active' : 'deprecated'}`} data-testid="l0-status-write">
          写密钥：{status?.write_unlocked ? '已解锁' : '已锁定'}
        </span>
        <span className="status stale" data-testid="l0-status-sessions">活跃查阅会话 {status?.active_sessions ?? 0}</span>
        <span className="status stale" data-testid="l0-status-grants">有效授权 {status?.active_grants ?? 0}</span>
      </div>

      {msg && <div className="note" data-testid="l0-msg">{msg}</div>}
      {err && <div className="note" data-testid="l0-err" style={{ color: 'var(--warn)' }}>{err}</div>}

      {status && !status.has_admin_wrap && (
        <div className="row" data-testid="l0-setup">
          <span className="dim">首次初始化：设置管理密码（≥{MIN_LEN} 位）</span>
          <input type="password" data-testid="l0-setup-pw" value={setupPw} placeholder="管理密码"
            style={{ ...inputStyle, width: 150 }} onChange={(e) => setSetupPw(e.target.value)} />
          <input type="password" data-testid="l0-setup-pw2" value={setupPw2} placeholder="再次输入"
            style={{ ...inputStyle, width: 150 }} onChange={(e) => setSetupPw2(e.target.value)} />
          <button type="button" className="btn primary" data-testid="l0-setup-submit" disabled={busy} onClick={doSetup}>
            设置管理密码
          </button>
        </div>
      )}

      {status?.has_admin_wrap && (
        <div className="row" data-testid="l0-rotate">
          <span className="dim">轮换管理密码</span>
          <input type="password" data-testid="l0-old-pw" value={oldPw} placeholder="旧管理密码"
            style={{ ...inputStyle, width: 130 }} onChange={(e) => setOldPw(e.target.value)} />
          <input type="password" data-testid="l0-new-pw" value={newPw} placeholder="新管理密码"
            style={{ ...inputStyle, width: 130 }} onChange={(e) => setNewPw(e.target.value)} />
          <input type="password" data-testid="l0-new-pw2" value={newPw2} placeholder="再次输入新密码"
            style={{ ...inputStyle, width: 140 }} onChange={(e) => setNewPw2(e.target.value)} />
          <button type="button" className="btn" data-testid="l0-rotate-submit" disabled={busy} onClick={doRotate}>
            轮换
          </button>
        </div>
      )}

      <div className="row" data-testid="l0-write">
        <span className="dim">写密钥（只加密，不可解密）</span>
        {status?.write_unlocked ? (
          <button type="button" className="btn danger" data-testid="l0-write-lock" disabled={busy} onClick={doWriteLock}>
            锁定写密钥
          </button>
        ) : (
          <>
            <input type="password" data-testid="l0-write-pw" value={writePw} placeholder="管理密码"
              style={{ ...inputStyle, width: 150 }} onChange={(e) => setWritePw(e.target.value)} />
            <button type="button" className="btn primary" data-testid="l0-write-unlock" disabled={busy} onClick={doWriteUnlock}>
              解锁写密钥
            </button>
          </>
        )}
      </div>

      <div className="section-title">查阅申请（非管理员提交 → 管理员批准/拒绝）</div>
      <table className="ltable" data-testid="l0-req-table">
        <thead><tr><th>request_id</th><th>账号</th><th>范围</th><th>理由</th><th>时间</th><th>操作</th></tr></thead>
        <tbody>
          {pending.map((r) => (
            <tr key={r.request_id} data-testid={`l0-req-${r.request_id}`}>
              <td className="mid">{r.request_id}</td>
              <td className="mid">{r.user_id}</td>
              <td className="mid">{r.project_ids.join('、') || '—'}</td>
              <td>{r.reason || '—'}</td>
              <td>{fmt(r.created_at)}</td>
              <td>
                <button type="button" className="btn primary" data-testid={`l0-approve-${r.request_id}`}
                  disabled={busy} onClick={() => doApprove(r)}>批准</button>{' '}
                <button type="button" className="btn danger" data-testid={`l0-deny-${r.request_id}`}
                  disabled={busy} onClick={() => doDeny(r)}>拒绝</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pending.length === 0 && <div className="note" data-testid="l0-req-empty">无待处理申请</div>}

      <div className="section-title">直接发放一次性授权</div>
      <div className="row" data-testid="l0-grant-form">
        <input type="text" data-testid="l0-grantee" value={grantee} placeholder="被授权账号 user_id"
          style={{ ...inputStyle, width: 170 }} onChange={(e) => setGrantee(e.target.value)} />
        <input type="text" data-testid="l0-scope" value={scope} placeholder="授权范围（项目 ID，逗号分隔）"
          style={{ ...inputStyle, width: 240 }} onChange={(e) => setScope(e.target.value)} />
        <input type="password" data-testid="l0-grant-pw" value={grantPw} placeholder="授权密码（留空=系统随机）"
          style={{ ...inputStyle, width: 190 }} onChange={(e) => setGrantPw(e.target.value)} />
        <button type="button" className="btn primary" data-testid="l0-grant-submit" disabled={busy} onClick={doGrant}>
          发放授权
        </button>
      </div>
      {issued && (
        <div className="note" data-testid="l0-issued" style={{ border: '1px solid var(--accent)', borderRadius: 8, padding: 8 }}>
          一次性授权密码（grant_id <code>{issued.grant_id}</code>）：
          <b data-testid="l0-issued-pw">{issued.password ?? '已按你输入的密码设置（不回显）'}</b>
          {issued.password && <span> · 仅显示这一次，请线下交付后点击</span>}
          <button type="button" className="btn" data-testid="l0-issued-clear" onClick={() => setIssued(null)}>我已保存</button>
        </div>
      )}

      <div className="section-title">授权列表（过期/撤销/一次性消费后 wrapped DEK 立即删除）</div>
      <table className="ltable" data-testid="l0-grant-table">
        <thead><tr><th>grant_id</th><th>账号</th><th>范围</th><th>状态</th><th>最近查阅</th><th>操作</th></tr></thead>
        <tbody>
          {grants.map((g) => (
            <tr key={g.grant_id} data-testid={`l0-grant-${g.grant_id}`}>
              <td className="mid">{g.grant_id}</td>
              <td className="mid">{g.grantee_user_id}</td>
              <td className="mid">{g.scope_project_ids.join('、') || '—'}</td>
              <td>
                <span className={`status ${g.status === 'active' ? 'active' : 'deprecated'}`}>{g.status}</span>
              </td>
              <td>{fmt(g.last_view_at)}</td>
              <td>
                {(g.status === 'active' || g.status === 'consumed') && (
                  <button type="button" className="btn danger" data-testid={`l0-revoke-${g.grant_id}`}
                    disabled={busy} onClick={() => doRevoke(g)}>撤销</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {grants.length === 0 && <div className="note" data-testid="l0-grant-empty">暂无授权记录</div>}

      <div className="note">
        红线：管理密码/授权密码/DEK 不进日志、审计与 URL；审计只记 grant_id · 账号 · 动作 · 结果（§4.4.7）。
      </div>
    </div>
  );
}
