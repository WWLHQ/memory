// P12-T3 密码策略 + 实时校验（4.2）
import { useState } from 'react';
import type { PwdPolicy } from './types.ts';
import { PWD_HISTORY } from './seed.ts';
import { validatePwd } from './logic.ts';

interface Props {
  policy: PwdPolicy;
  onChange: (next: PwdPolicy, changed: string) => void;
}

export function PwdPolicyCard({ policy, onChange }: Props) {
  const [sample, setSample] = useState('');
  const err = sample ? validatePwd(sample, policy, PWD_HISTORY) : null;
  const toggle = (k: keyof PwdPolicy, label: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...policy, [k]: e.target.checked }, `${label}=${e.target.checked ? '开' : '关'}`);

  return (
    <div className="card" data-testid="pwd-policy">
      <b>密码策略（4.2）</b>
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
