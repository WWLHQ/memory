// 账号与安全页（REQ-006 / P12）T4 编排
// 批次47：成员/密钥改为读真实后端（/api/accounts、/api/keys），不再用前端 useState 假开关。
// 安全操作仍真写内核审计账本（security_change）+ mirror 上抛。
import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_POLICY } from './defaults.ts';
import { useSecurityMirror } from './useSecurityMirror.ts';
import { coreSecurityAudit } from './coreSecurity.ts';
import { newRequestId } from '../kernel.ts';
import { PwdPolicyCard } from './PwdPolicyCard.tsx';
import { KeyTable, MemberTable, RoleMatrixCard } from './SecurityCards.tsx';
import { AdminAccountCard } from './AccountAdminCard.tsx';
import { L0AdminCard } from './L0AdminCard.tsx';
import { LegacyLedgerCard } from './LegacyLedgerCard.tsx';
import { LedgerResetCard } from './LedgerResetCard.tsx';
import { RulesRejudgeCard } from './RulesRejudgeCard.tsx';
import { FieldBackfillCard } from './FieldBackfillCard.tsx';
import { L0SplitCard } from './L0SplitCard.tsx';
import { L0MigrateCard } from './L0MigrateCard.tsx';
import { RebuildFromL0Card } from './RebuildFromL0Card.tsx';
import { L0RecoveryCard } from './L0RecoveryCard.tsx';
import { useSessionContext } from '../shared/session.ts';
import { useToast } from './useToast.tsx';
import {
  fetchAccounts, fetchApiKeys, mintApiKey, revokeApiKey, fetchPwdPolicy, savePwdPolicy,
  type AccountView, type ApiKeyRecord,
} from './accountsClient.ts';
import type { ApiKey, PwdPolicy } from './types.ts';

/** 服务端密钥记录 → 表格视图（masked 只含 label/尾号，绝不含明文） */
function toKeyView(k: ApiKeyRecord): ApiKey {
  const tail = k.key_id.slice(-6);
  // 服务端是毫秒时间戳；表格按 ISO 日期展示（此前误当字符串会直接 TypeError）
  const created = new Date(k.created_at).toISOString();
  return {
    id: k.key_id,
    masked: k.label ? `${k.label} · …${tail}` : `…${tail}`,
    created_at: created,
    last_rotated: created,
    revoked: k.revoked_at !== undefined,
  };
}

export function SecurityPage() {
  const [policy, setPolicy] = useState<PwdPolicy>(DEFAULT_POLICY);
  const [policyErr, setPolicyErr] = useState<string>('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [rawKeys, setRawKeys] = useState<ApiKeyRecord[]>([]);
  const [keysErr, setKeysErr] = useState<string>('');
  const [accErr, setAccErr] = useState<string>('');
  const [busy, setBusy] = useState(false);
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

  const refresh = useCallback(async () => {
    if (role !== 'admin') {
      setAccounts([]);
      setRawKeys([]);
      setAccErr('需管理员权限');
      setKeysErr('需管理员权限');
      return;
    }
    const [acc, keys] = await Promise.all([fetchAccounts(), fetchApiKeys()]);
    if (acc.ok) {
      setAccounts(acc.items);
      setAccErr('');
    } else {
      setAccounts([]);
      setAccErr(acc.error);
    }
    if (keys.ok) {
      setRawKeys(keys.items);
      setKeysErr('');
    } else {
      setRawKeys([]);
      setKeysErr(keys.error);
    }
  }, [role]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 批次48 A10：策略从后端读取（未登录不请求，避免匿名探测）；读取失败如实标注并显示默认值
  useEffect(() => {
    if (!role) return;
    let alive = true;
    void (async () => {
      const r = await fetchPwdPolicy();
      if (!alive) return;
      if (!r.ok) { setPolicyErr(`策略读取失败（当前显示默认值）：${r.error}`); return; }
      setPolicy(r.policy);
      setPolicyErr('');
    })();
    return () => { alive = false; };
  }, [role]);

  // 卸载时清掉尚未落盘的保存定时器
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const onRevokeKey = async (id: string) => {
    if (role !== 'admin') { show('需管理员权限：密钥管理仅管理员可操作'); return; }
    if (!confirm(`确认吊销 ${id}？吊销后立即失效。`)) return;
    setBusy(true);
    const r = await revokeApiKey(id);
    setBusy(false);
    if (!r.ok) { show(`吊销失败：${r.error}`); return; }
    await audit(`密钥 ${id} 已吊销`, { target: 'key', key_id: id });
    await refresh();
  };

  const onRotateKey = async (id: string) => {
    if (role !== 'admin') { show('需管理员权限：密钥管理仅管理员可操作'); return; }
    const row = rawKeys.find((k) => k.key_id === id);
    if (!row) { show('密钥记录已变化，请刷新后重试'); return; }
    setBusy(true);
    // 轮换 = 新建同属主/同范围密钥 → 吊销旧钥（真实两次后端调用，任一步失败都如实报告）
    const minted = await mintApiKey({
      owner_member_id: row.owner_member_id,
      scope_project_ids: row.scope_project_ids,
      ...(row.label ? { label: row.label } : {}),
    });
    if (!minted.ok) {
      setBusy(false);
      show(`轮换失败（未创建新钥）：${minted.error}`);
      return;
    }
    const revoked = await revokeApiKey(id);
    setBusy(false);
    await audit(
      revoked.ok
        ? `密钥 ${id} 已轮换（新钥 ${minted.record.key_id}，旧钥已吊销）`
        : `密钥 ${id} 已新建 ${minted.record.key_id}，但旧钥吊销失败：${revoked.error}`,
      { target: 'key', old_key_id: id, new_key_id: minted.record.key_id, revoked: revoked.ok },
    );
    // 明文只在本次响应出现一次：明确提示，不写入任何本地存储
    show(`新密钥（仅显示一次）：${minted.key}`);
    await refresh();
  };

  const tlsOn = typeof location !== 'undefined' && location.protocol === 'https:';

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
          void audit(`${label}（已保存到后端）`, { target: 'policy' });
          // 防抖落盘：数字输入中途的临时非法值不必逐键 POST；350ms 后写最终值，服务端再做规范化
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            void (async () => {
              const r = await savePwdPolicy(next);
              if (r.ok) { setPolicy(r.policy); setPolicyErr(''); }
              else setPolicyErr(`策略保存失败：${r.error}`);
            })();
          }, 350);
        }}
      />
      {policyErr ? <div className="note" data-testid="pwd-policy-error" style={{ color: 'var(--warn, #b8860b)' }}>{policyErr}</div> : null}
      <div className="note" data-testid="pwd-policy-scope">
        密码策略已保存到本机登录后端（.data/home-policy.json），对注册与修改密码真实生效，刷新后保持。
        历史密码查重（history_count）暂无历史库，未参与校验。
      </div>

      <div className="card" data-testid="encrypt-card">
        <b>加密状态（4.1，只读）</b>
        <div className="row">
          <span className="status active">L1 脱敏占位符 开（写入时由内核执行）</span>
          {tlsOn
            ? <span className="status active">TLS 开（当前 https）</span>
            : <span className="status stale">TLS 未启用（当前为本机 HTTP 回环）</span>}
          <span className="status stale">L0 AES-256-GCM：以密钥环实况为准（下方）</span>
        </div>
      </div>

      <L0AdminCard enabled={role === 'admin'} />

      <L0SplitCard enabled={role === 'admin'} />
      <L0MigrateCard enabled={role === 'admin'} />
      <L0RecoveryCard enabled={role === 'admin'} />

      <LegacyLedgerCard enabled={role === 'admin'} />

      <LedgerResetCard enabled={role === 'admin'} />

      <RulesRejudgeCard enabled={role === 'admin'} />

      <FieldBackfillCard enabled={role === 'admin'} />

      <RebuildFromL0Card enabled={role === 'admin'} />

      <RoleMatrixCard />
      <MemberTable accounts={accounts} error={accErr} />
      <KeyTable
        keys={rawKeys.map(toKeyView)}
        busy={busy}
        error={keysErr}
        onRotate={(id) => void onRotateKey(id)}
        onRevoke={(id) => void onRevokeKey(id)}
      />
      {toast}
    </div>
  );
}
