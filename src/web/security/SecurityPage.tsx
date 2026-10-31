// 账号与安全页（REQ-006 / P12）T4 编排
// 安全操作真写内核审计账本（security_change）+ mirror 上抛；成员/密钥实体无种子（内核无此域模型，空列表为真实初始态）。
import { useState } from 'react';
import { DEFAULT_POLICY } from './defaults.ts';
import { useSecurityMirror } from './useSecurityMirror.ts';
import { coreSecurityAudit } from './coreSecurity.ts';
import { newRequestId } from '../kernel.ts';
import { PwdPolicyCard } from './PwdPolicyCard.tsx';
import { KeyTable, MemberTable, RoleMatrixCard } from './SecurityCards.tsx';
import { AdminAccountCard } from './AccountAdminCard.tsx';
import { L0AdminCard } from './L0AdminCard.tsx';
import { LegacyLedgerCard } from './LegacyLedgerCard.tsx';
import { useSessionContext } from '../shared/session.ts';
import { useToast } from './useToast.tsx';
import type { ApiKey, PwdPolicy, TeamMember } from './types.ts';

export function SecurityPage() {
  const [policy, setPolicy] = useState<PwdPolicy>(DEFAULT_POLICY);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const { node: toast, show } = useToast();
  const mirror = useSecurityMirror();
  // 批次7：敏感安全操作（策略/成员/密钥）仅管理员；后端与管理 IPC 同样强制
  const { role } = useSessionContext();

  const audit = async (msg: string, detail: Record<string, unknown> = {}) => {
    const requestId = newRequestId('req');
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
      <div className="sub">4.1 加密 · 4.2 密码策略 · 3.2 角色矩阵 · 18.2-A 用户团队 · 管理员账号（批次7） · 操作审计为内核账本</div>

      <AdminAccountCard />

      <PwdPolicyCard
        policy={policy}
        readOnly={role !== 'admin'}
        onChange={(next, label) => {
          if (role !== 'admin') { show('需管理员权限：密码策略仅管理员可修改'); return; }
          setPolicy(next);
          void audit(label, { target: 'policy' });
        }}
      />

      <div className="card" data-testid="encrypt-card">
        <b>加密状态（4.1，只读）</b>
        <div className="row">
          <span className="status active">L1 脱敏占位符 开</span>
          <span className="status active">TLS 开</span>
          <span className="status stale">L0 AES-256-GCM：以密钥环实况为准（下方）</span>
        </div>
      </div>

      <L0AdminCard enabled={role === 'admin'} />

      <LegacyLedgerCard enabled={role === 'admin'} />

      <RoleMatrixCard />
      <MemberTable
        members={members}
        onChange={(next, msg) => {
          if (role !== 'admin') { show('需管理员权限：成员管理仅管理员可操作'); return; }
          setMembers(next);
          void audit(msg, { target: 'member' });
        }}
      />
      <KeyTable
        keys={keys}
        onAction={(msg) => {
          if (role !== 'admin') { show('需管理员权限：密钥管理仅管理员可操作'); return; }
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
