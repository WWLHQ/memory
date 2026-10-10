// P12-T3 角色矩阵（只读）+ 成员表（增删改/共享标记）+ 密钥表（轮换/吊销）
import type { ApiKey, TeamMember } from './types.ts';
import { ROLE_MATRIX } from './seed.ts';
import { canCrossTeam, rotateWarn } from './logic.ts';

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
      <div className="note">改共享标记即时生效。</div>
    </div>
  );
}

export function MemberTable({ members, onChange }: { members: TeamMember[]; onChange: (next: TeamMember[], msg: string) => void }) {
  const toggleShared = (i: number) => {
    const next = members.map((m, j) => (j === i ? { ...m, shared: !m.shared } : m));
    onChange(next, `${next[i].id} 共享=${next[i].shared ? '开' : '关'}（即时生效）`);
  };
  const remove = (i: number) => onChange(members.filter((_, j) => j !== i), `${members[i].id} 已删除`);
  return (
    <div className="card" data-testid="member-table">
      <b>用户 / 团队（18.2-A）</b>
      <table className="ltable">
        <thead><tr><th>ID</th><th>角色</th><th>团队</th><th>共享</th><th>操作</th></tr></thead>
        <tbody>
          {members.map((m, i) => (
            <tr key={m.id} data-testid={`member-${m.id}`}>
              <td className="mid">{m.id}</td>
              <td>{m.role}</td>
              <td>{m.team}</td>
              <td>
                <input type="checkbox" checked={m.shared} data-testid={`shared-${m.id}`} onChange={() => toggleShared(i)} />
                {!m.shared && <span className="dim">（未共享：禁跨团队）</span>}
              </td>
              <td>
                <button type="button" className="btn" data-testid={`remove-${m.id}`}
                  onClick={() => (canCrossTeam(m) ? remove(i) : undefined)}
                  disabled={!canCrossTeam(m)}
                  title={canCrossTeam(m) ? '删除' : '未共享，禁跨团队操作（3.2）'}
                >删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyTable({ keys, onAction }: { keys: ApiKey[]; onAction: (msg: string) => void }) {
  return (
    <div className="card" data-testid="key-table">
      <b>Agent API 密钥（脱敏，与 P10 联动）</b>
      <table className="ltable">
        <thead><tr><th>ID</th><th>密钥</th><th>上次轮换</th><th>状态</th><th>操作</th></tr></thead>
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
                  {!k.revoked && <span className="dim"> · 吊销宽限 24h</span>}
                </td>
                <td>
                  {!k.revoked && (
                    <>
                      <button type="button" className="btn" data-testid={`rotate-${k.id}`}
                        onClick={() => onAction(`${k.id} 已轮换（旧钥宽限 24h）`)}>轮换</button>{' '}
                      <button type="button" className="btn danger" data-testid={`revoke-${k.id}`}
                        onClick={() => {
                          if (confirm(`确认吊销 ${k.id}？吊销后立即失效。`)) onAction(`${k.id} 已吊销`);
                        }}>吊销</button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
