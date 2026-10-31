// P12-T3 密码策略 + 实时校验（4.2）
import { useState } from 'react';
import type { PwdPolicy } from './types.ts';
import { validatePwd } from './logic.ts';

interface Props {
  policy: PwdPolicy;
  /** 历史密码（真实域数据；内核暂无此域模型 → 空数组，历史查重不生效但策略其余项照常校验） */
  history?: string[];
  /** 批次7：敏感操作仅管理员 → 非管理员只读（样例校验仍可用） */
  readOnly?: boolean;
  onChange: (next: PwdPolicy, changed: string) => void;
}

export function PwdPolicyCard({ policy, history = [], onChange, readOnly = false }: Props) {
  const [sample, setSample] = useState('');
  const err = sample ? validatePwd(sample, policy, history) : null;
  const toggle = (k: keyof PwdPolicy, label: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...policy, [k]: e.target.checked }, `${label}=${e.target.checked ? '开' : '关'}`);

  return (
    <div className="card" data-testid="pwd-policy">
      <b>密码策略（4.2）</b>
      {readOnly && (
        <div className="note" data-testid="pwd-policy-admin-required" style={{ color: 'var(--warn, #b8860b)' }}>
          🔒 需管理员：修改密码策略仅管理员可操作（下方样例校验仍可用）。
        </div>
      )}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }} data-testid="pwd-policy-controls">
      <div className="row">
        <label style={{ fontSize: 12 }}>长度
          <input type="number" min={8} max={64} value={policy.min_len} style={{ width: 52 }} data-testid="pwd-min"
            onChange={(e) => onChange({ ...policy, min_len: Number(e.target.value) }, `最短长度=${e.target.value}`)} />
          -
          <input type="number" min={8} max={64} value={policy.max_len} style={{ width: 52 }} data-testid="pwd-max"
            onChange={(e) => onChange({ ...policy, max_len: Number(e.target.value) }, `最长长度=${e.target.value}`)} />
        </label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={policy.upper} data-testid="pwd-upper" onChange={toggle('upper', '大写')} />大写</label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={policy.lower} data-testid="pwd-lower" onChange={toggle('lower', '小写')} />小写</label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={policy.digit} data-testid="pwd-digit" onChange={toggle('digit', '数字')} />数字</label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={policy.special} data-testid="pwd-special" onChange={toggle('special', '特殊')} />特殊</label>
        <label style={{ fontSize: 12 }}>历史
          <input type="number" min={1} max={10} value={policy.history_count} style={{ width: 44 }} data-testid="pwd-history"
            onChange={(e) => onChange({ ...policy, history_count: Number(e.target.value) }, `历史次数=${e.target.value}`)} />
          次不可重复
        </label>
      </div>
      </fieldset>
      <div className="row">
        <label style={{ fontSize: 12 }}>试一试：</label>
        <input
          type="text" value={sample} data-testid="pwd-sample"
          placeholder="输入示例密码实时校验"
          style={{ flex: 1, background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}
          onChange={(e) => setSample(e.target.value)}
        />
        {err ? <span className="status deprecated" data-testid="pwd-err">{err}</span> : sample ? <span className="status active" data-testid="pwd-ok">通过 ✓</span> : null}
      </div>
    </div>
  );
}
