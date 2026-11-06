// P12-T3 角色矩阵（只读）+ 成员表（真实账号，只读）+ 密钥表（真实 /api/keys：轮换/吊销）
import type { ApiKey } from './types.ts';
import type { AccountView } from './accountsClient.ts';
import { ROLE_MATRIX } from './defaults.ts';
import { rotateWarn } from './logic.ts';

export function RoleMatrixCard() {
  return (
    <div className="card" data-testid="role-matrix">
      <b>角色矩阵（3.2，只读）</b>
      <table className="ltable">
        <thead><tr><th>范围</th><th>可见性</th></tr></thead>
        <tbody>
          {ROLE_MATRIX.map((r) => (
            <tr key={r.scope}><td>{r.scope}</td><td>{r.visible}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 成员表（18.2-A）：展示 home server `/api/accounts` 的真实账号。
 * 批次47：此前是前端 useState 假开关（共享标记/删除只改内存）。
 * 后端没有「共享标记」「删除账号」能力 → 这里如实只读，不再提供点了没用的按钮。
 */
export function MemberTable({ accounts, loading, error }: {
  accounts: AccountView[];
  loading?: boolean;
  error?: string;
}) {
  return (
    <div className="card" data-testid="member-table">
      <b>用户 / 团队（18.2-A，真实账号）</b>
      {error ? (
        <div className="note" data-testid="member-source-error" style={{ color: 'var(--warn, #b8860b)' }}>
          无法读取账号：{error}
        </div>
      ) : null}
      {loading ? <div className="note">读取中…</div> : null}
      <table className="ltable">
        <thead><tr><th>账号</th><th>角色</th><th>团队</th><th>可见范围</th></tr></thead>
        <tbody>
          {accounts.map((m) => (
            <tr key={m.account} data-testid={`member-${m.account}`}>
              <td className="mid">{m.account}</td>
              <td>{m.role}</td>
              <td>{m.team_id}</td>
              <td>{m.perspective}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note">后端未提供「共享标记 / 增删成员」接口，故本表只读；角色/团队请在下方管理员账号卡修改。</div>
    </div>
  );
}

/**
 * 密钥表：展示内核成员库真实密钥（/api/keys）。轮换=新建同属主/同范围密钥 + 吊销旧钥。
 * 批次47：此前轮换/吊销只改前端 state，刷新即恢复原状。
 */
export function KeyTable({ keys, busy, error, onRotate, onRevoke }: {
  keys: ApiKey[];
  busy?: boolean;
  error?: string;
  onRotate: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <div className="card" data-testid="key-table">
      <b>Agent API 密钥（脱敏，与 P10 联动）</b>
      {error ? (
        <div className="note" data-testid="key-source-error" style={{ color: 'var(--warn, #b8860b)' }}>
          无法读取密钥：{error}
        </div>
      ) : null}
      <Table keys={keys} busy={busy} onRotate={onRotate} onRevoke={onRevoke} />
    </div>
  );
}

function Table({ keys, busy, onRotate, onRevoke }: {
  keys: ApiKey[];
  busy?: boolean;
  onRotate: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  return (
    <table className="ltable">
      <thead><tr><th>ID</th><th>密钥</th><th>创建/上次轮换</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        {keys.map((k, i) => {
          const warn = rotateWarn(k);
          return (
            <tr key={k.id} data-testid={`key-${k.id}`}>
              <td className="mid">{k.id}</td>
              <td className="mid">{k.masked}</td>
              <td>{k.last_rotated.slice(0, 10)}</td>
              <td>
                {k.revoked ? <span className="status deprecated">已吊销</span> : warn ? <span className="status deprecated" data-testid={`key-warn-${i}`}>{warn}</span> : <span className="status active">正常</span>}
              </td>
              <td>
                {!k.revoked && (
                  <>
                    <button type="button" className="btn" data-testid={`rotate-${k.id}`} disabled={busy}
                      onClick={() => onRotate(k.id)}>轮换</button>{' '}
                    <button type="button" className="btn danger" data-testid={`revoke-${k.id}`} disabled={busy}
                      onClick={() => onRevoke(k.id)}>吊销</button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
