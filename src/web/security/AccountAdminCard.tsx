// 管理员账号卡片（批次7）：账号列表 / 角色切换 / 团队分配 / 修改我的密码。
// 权限：仅 admin 会话可用；后端 /api/accounts*、/api/password 同样强制校验，前端只做展示门禁。
import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '../shared/session.ts';
import { changeOwnPassword, fetchAccounts, updateAccount, type AccountView } from './accountsClient.ts';
import { useToast } from './useToast.tsx';
import type { AccountRole } from '../../types/home.ts';

export function AdminAccountCard() {
  const { role, context, loading } = useSessionContext();
  const { node: toast, show } = useToast();
  const [items, setItems] = useState<AccountView[]>([]);
  const [teams, setTeams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');

  const applyItems = useCallback((next: AccountView[]) => {
    setItems(next);
    setTeams(Object.fromEntries(next.map((a) => [a.account, a.team_id])));
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    const r = await fetchAccounts();
    setBusy(false);
    if (r.ok) { setErr(''); applyItems(r.items); return; }
    setErr(r.error);
  }, [applyItems]);

  useEffect(() => {
    if (role === 'admin') void refresh();
  }, [role, refresh]);

  if (loading) {
    return (
      <div className="card" data-testid="admin-accounts-card">
        <b>👤 管理员账号</b>
        <div className="note">正在确认登录身份…</div>
      </div>
    );
  }

  if (role !== 'admin') {
    return (
      <div className="card" data-testid="admin-accounts-card" style={{ opacity: 0.75 }}>
        <b>👤 管理员账号</b>
        <div className="note" data-testid="admin-required">
          🔒 需管理员：账号/角色/团队管理与密码修改仅管理员可操作。
          {role === 'member' ? '（当前账号为普通成员）' : '（当前未登录，请先在首页登录管理员账号）'}
        </div>
        <div className="note">内置管理员账号 <code>admin</code>，初始密码 <code>Admin@123456</code>（首次登录后请立即修改）。</div>
      </div>
    );
  }

  async function changeRole(account: string, nextRole: AccountRole) {
    setBusy(true);
    const r = await updateAccount({ account, role: nextRole });
    setBusy(false);
    if (!r.ok) { setErr(r.error); show(`修改失败：${r.error}`); return; }
    setErr('');
    applyItems(r.items);
    show(`${account} 角色已改为 ${nextRole === 'admin' ? '管理员' : '普通成员'}`);
  }

  async function saveTeam(account: string) {
    const team = (teams[account] ?? '').trim();
    if (!team) { setErr('团队 ID 不能为空'); return; }
    setBusy(true);
    const r = await updateAccount({ account, team_id: team });
    setBusy(false);
    if (!r.ok) { setErr(r.error); show(`修改失败：${r.error}`); return; }
    setErr('');
    applyItems(r.items);
    show(`${account} 团队已设为 ${team}`);
  }

  async function submitPassword() {
    if (!oldPwd || !newPwd) { setErr('请填写旧密码与新密码'); return; }
    setBusy(true);
    const r = await changeOwnPassword(oldPwd, newPwd);
    setBusy(false);
    if (!r.ok) { setErr(r.error); show(`修改失败：${r.error}`); return; }
    setErr('');
    setOldPwd('');
    setNewPwd('');
    show(r.message);
  }

  return (
    <div className="card" data-testid="admin-accounts-card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>👤 管理员账号（批次7）</b>
        <button type="button" className="btn" data-testid="admin-refresh" disabled={busy} onClick={() => void refresh()}>
          刷新
        </button>
      </div>
      <div className="note">
        内置管理员 <code>admin</code> / 初始密码 <code>Admin@123456</code>（首次登录后请立即修改）。
        账号、角色、团队仅管理员可管理；最后一个管理员不可降级。
      </div>

      <table className="ltable" data-testid="admin-accounts-table">
        <thead>
          <tr><th>账号</th><th>角色</th><th>团队（管理员分配 · 只读给用户）</th><th>操作</th></tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.account} data-testid={`acct-${a.account}`}>
              <td className="mid">
                {a.account}
                {a.account === context?.user_id ? '（我）' : ''}
              </td>
              <td>
                <select
                  data-testid={`role-${a.account}`}
                  value={a.role}
                  disabled={busy}
                  onChange={(e) => void changeRole(a.account, e.target.value as AccountRole)}
                >
                  <option value="admin">管理员</option>
                  <option value="member">普通成员</option>
                </select>
              </td>
              <td>
                <input
                  data-testid={`team-${a.account}`}
                  value={teams[a.account] ?? ''}
                  disabled={busy}
                  style={{ width: 150 }}
                  onChange={(e) => setTeams((prev) => ({ ...prev, [a.account]: e.target.value }))}
                />
              </td>
              <td>
                <button type="button" className="btn" data-testid={`team-save-${a.account}`} disabled={busy} onClick={() => void saveTeam(a.account)}>
                  保存团队
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 12, borderTop: '1px solid var(--border, #e8e8ef)', paddingTop: 10 }}>
        <div style={{ fontSize: 12, marginBottom: 6 }}>修改我的密码（{context?.user_id}）</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <input type="password" placeholder="旧密码" data-testid="pwd-old" value={oldPwd} disabled={busy}
            onChange={(e) => setOldPwd(e.target.value)} />
          <input type="password" placeholder="新密码（至少 8 位）" data-testid="pwd-new" value={newPwd} disabled={busy}
            onChange={(e) => setNewPwd(e.target.value)} />
          <button type="button" className="btn primary" data-testid="pwd-change" disabled={busy} onClick={() => void submitPassword()}>
            修改密码
          </button>
        </div>
      </div>

      {err && <div className="note" data-testid="admin-err" style={{ color: 'var(--danger, #c0392b)' }}>{err}</div>}
      {toast}
    </div>
  );
}
