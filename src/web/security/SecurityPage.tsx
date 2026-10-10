// 账号与安全页（REQ-006 / P12）T4 编排
// 安全操作真写内核审计账本（security_change）+ mirror 上抛；成员/密钥实体保留种子（内核无此域模型）。
import { useRef, useState } from 'react';
import { DEFAULT_POLICY, SEED_KEYS, SEED_MEMBERS } from './seed.ts';
import { useSecurityMirror } from './useSecurityMirror.ts';
import { coreSecurityAudit } from './coreSecurity.ts';
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

  const audit = async (msg: string, detail: Record<string, unknown> = {}) => {
    seq.current += 1;
    const requestId = `req_s${seq.current}`;
    try {
      await coreSecurityAudit('security_change', requestId, { msg, ...detail }); // 内核账本真写
      mirror.audit('security_change', requestId); // G6 上抛
      show(`${msg}（${requestId}）`);
    } catch {
      show(`${msg}（内核暂不可达，未记审计）`);
    }
    return requestId;
  };

  return (
    <div className="wrap" data-testid="security-page">
      <h1>🔐 账号与安全页 <span className="badge p2">REQ-006 · P12</span></h1>
      <div className="sub">4.1 加密 · 4.2 密码策略 · 3.2 角色矩阵 · 18.2-A 用户团队 · 操作审计为内核账本</div>

      <PwdPolicyCard policy={policy} onChange={(next, label) => { setPolicy(next); void audit(label, { target: 'policy' }); }} />

      <div className="card" data-testid="encrypt-card">
        <b>加密状态（4.1，只读）</b>
        <div className="row">
          <span className="status active">L1 脱敏占位符 开</span>
          <span className="status active">TLS 开</span>
          <span className="status active">AES 开</span>
        </div>
      </div>

      <RoleMatrixCard />
      <MemberTable members={members} onChange={(next, msg) => { setMembers(next); void audit(msg, { target: 'member' }); }} />
      <KeyTable
        keys={keys}
        onAction={(msg) => {
          void audit(msg, { target: 'key' });
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
