// 账号与安全页（REQ-006 / P12）T4 编排
import { useRef, useState } from 'react';
import { DEFAULT_POLICY, SEED_KEYS, SEED_MEMBERS } from './seed.ts';
import { useSecurityMirror } from './useSecurityMirror.ts';
import { PwdPolicyCard } from './PwdPolicyCard.tsx';
import { KeyTable, MemberTable, RoleMatrixCard } from './SecurityCards.tsx';
import { useToast } from './useToast.tsx';
import type { ApiKey, PwdPolicy, TeamMember } from './types.ts';

export function SecurityPage() {
  const [policy, setPolicy] = useState<PwdPolicy>(DEFAULT_POLICY);
  const [members, setMembers] = useState<TeamMember[]>(SEED_MEMBERS);
  const [keys, setKeys] = useState<ApiKey[]>(SEED_KEYS);
  const { node: toast, show } = useToast();
  const mirror = useSecurityMirror();
  const seq = useRef(0);

  const audit = (msg: string) => {
    seq.current += 1;
    mirror.audit('security_change', `req_s${seq.current}`); // G6 safe-noop
    show(`${msg}（req_s${seq.current}）`);
  };

  return (
    <div className="wrap" data-testid="security-page">
      <h1>🔐 账号与安全页 <span className="badge p2">REQ-006 · P12</span></h1>
      <div className="sub">4.1 加密 · 4.2 密码策略 · 3.2 角色矩阵 · 18.2-A 用户团队 · 数据本地种子为真相</div>

      <PwdPolicyCard policy={policy} onChange={(next, label) => { setPolicy(next); audit(label); }} />

      <div className="card" data-testid="encrypt-card">
        <b>加密状态（4.1，只读）</b>
        <div className="row">
          <span className="status active">L1 脱敏占位符 开</span>
          <span className="status active">TLS 开</span>
          <span className="status active">AES 开</span>
        </div>
      </div>

      <RoleMatrixCard />
      <MemberTable members={members} onChange={(next, msg) => { setMembers(next); audit(msg); }} />
      <KeyTable
        keys={keys}
        onAction={(msg) => {
          audit(msg);
          if (msg.includes('已吊销')) {
            const id = msg.split(' ')[0];
            setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revoked: true } : k)));
          }
        }}
      />
      {toast}
    </div>
  );
}
