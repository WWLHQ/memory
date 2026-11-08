// 账号与安全页（REQ-006 / P12）T4 编排
// 批次47：成员/密钥读真实后端（/api/accounts、/api/keys）；安全操作真写内核审计账本 + mirror 上抛。
// 结构照定稿：检查摘要 / 危险操作卡（11 张真实卡）/ 账号与密钥 / L0 审计 四个页签。
// 徽标按真实状态显示：TLS 取当前协议、脱敏用内核 sanitizeL1 运行时探针、审计链取服务端 integrity。
import { useState, useEffect, useCallback, useRef } from 'react';
import { DEFAULT_POLICY } from './defaults.ts';
import { useSecurityMirror } from './useSecurityMirror.ts';
import { coreL0Status, coreLoadL0Audit, coreSecurityAudit, type L0AuditRow } from './coreSecurity.ts';
import { newRequestId } from '../kernel.ts';
import { sanitizeL1 } from '../../core/memagent/layerRules.ts';
import type { L0VaultStatus } from '../../core/memagent/types.ts';
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
  fetchMirrorIntegrity, type AccountView, type ApiKeyRecord, type MirrorIntegrityView,
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

function errText(e: unknown): string {
  const o = e as { code?: string; message?: string };
  return `${o?.code ? `[${o.code}] ` : ''}${o?.message ?? String(e)}`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

const L0_ACTION_TEXT: Record<string, string> = {
  l0_view: '查看 L0',
  l0_write: '写入 L0',
  l0_auth_fail: 'L0 鉴权失败',
  l0_admin: 'L0 管理操作',
  security_change: '安全变更',
};

type CheckTone = 'ok' | 'warn' | 'err' | 'info';

export function SecurityPage() {
  const [tab, setTab] = useState(0);
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
  const { sid, context, role, loading } = useSessionContext();
  // L0 密钥环 / L0 审计 / mirror 审计链：真实接口，失败如实显示错误码
  const [l0, setL0] = useState<L0VaultStatus | null>(null);
  const [l0Err, setL0Err] = useState<string>('');
  const [l0Audit, setL0Audit] = useState<L0AuditRow[] | null>(null);
  const [l0AuditErr, setL0AuditErr] = useState<string>('');
  const [chain, setChain] = useState<MirrorIntegrityView | null>(null);

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

  // 检查摘要的真实数据：L0 密钥环 / L0 审计 / mirror 审计链（互不依赖，各自失败各自报错）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const st = await coreL0Status();
        if (alive) { setL0(st); setL0Err(''); }
      } catch (e) {
        if (alive) { setL0(null); setL0Err(errText(e)); }
      }
      try {
        const rows = await coreLoadL0Audit();
        if (alive) { setL0Audit(rows); setL0AuditErr(''); }
      } catch (e) {
        if (alive) { setL0Audit([]); setL0AuditErr(errText(e)); }
      }
      const chainView = await fetchMirrorIntegrity();
      if (alive) setChain(chainView);
    })();
    return () => { alive = false; };
  }, []);

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

  // TLS：取当前页面真实协议，不写死「开」
  const tlsOn = typeof location !== 'undefined' && location.protocol === 'https:';
  const proto = typeof location !== 'undefined' ? location.protocol : 'unknown';
  // 脱敏：用内核 sanitizeL1 对样例做运行时探针（掩码生效 = 已启用），不是硬编码
  const probeRaw = 'api_key=abcdef123456';
  const desensOn = sanitizeL1(probeRaw) !== probeRaw;
  const desensOut = sanitizeL1(probeRaw);

  const checks: Array<{ k: string; v: string; tone: CheckTone; testid: string }> = [
    {
      k: '登录会话',
      testid: 'chk-session',
      tone: sid ? (loading ? 'info' : context ? 'ok' : 'err') : 'err',
      v: sid
        ? (loading ? '校验中（/api/me）' : context ? `有效：${context.user_id} · ${context.role ?? 'member'}` : '会话无效：/api/me 无返回')
        : '未登录',
    },
    {
      k: '管理员角色',
      testid: 'chk-role',
      tone: role === 'admin' ? 'ok' : 'warn',
      v: role === 'admin' ? '管理员（危险操作卡启用）' : role === 'member' ? '普通成员（危险操作卡禁用）' : '未登录（危险操作卡禁用）',
    },
    {
      k: '密码策略',
      testid: 'chk-policy',
      tone: policyErr ? 'err' : role ? 'ok' : 'warn',
      v: policyErr ? `读取失败：${policyErr}` : role ? `已生效（后端 home-policy.json · min_len ${policy.min_len}）` : '未登录，未读取',
    },
    {
      k: 'L0 密钥环',
      testid: 'chk-l0',
      tone: l0Err ? 'err' : l0 ? (l0.write_unlocked ? 'warn' : 'ok') : 'info',
      v: l0Err ? `读取失败：${l0Err}` : l0
        ? `管理密码包装 ${l0.has_admin_wrap ? '已设置' : '未设置'} · 写密钥 ${l0.write_unlocked ? '已解锁' : '锁定'} · 活跃授权 ${l0.active_grants}`
        : '读取中…',
    },
    {
      k: 'L0 读写审计',
      testid: 'chk-l0audit',
      tone: l0AuditErr ? 'err' : l0Audit && l0Audit.length > 0 ? 'ok' : 'warn',
      v: l0AuditErr ? `读取失败：${l0AuditErr}` : l0Audit ? `账本最近 ${l0Audit.length} 条 L0/安全变更审计（上限 30）` : '读取中…',
    },
    {
      k: '审计链完整性',
      testid: 'chk-chain',
      tone: chain ? (chain.ok ? (chain.legacy_unsealed > 0 ? 'warn' : 'ok') : 'err') : 'info',
      v: chain
        ? (chain.ok
          ? `HMAC-SHA256 链完整 · sealed ${chain.sealed}${chain.legacy_unsealed > 0 ? ` · 未签名旧段 ${chain.legacy_unsealed}` : ''}`
          : `不可校验：${chain.error ?? chain.reason ?? 'unknown'}`)
        : '读取中…',
    },
    {
      k: 'IPC 会话校验',
      testid: 'chk-ipc',
      tone: 'info',
      v: '同步/裁决/账号/危险操作 IPC 均要求会话（无会话返回 401/403），权限由主进程/后端强制',
    },
    {
      k: '上行鉴权',
      testid: 'chk-up',
      tone: 'info',
      v: '中枢上下行需登录会话；人工裁决需管理员（见同步页真实通道状态）',
    },
  ];
  const issueCount = checks.filter((c) => c.tone === 'warn' || c.tone === 'err').length;

  return (
    <div className="p0-page" data-testid="security-page">
      <div className="p0-hd">
        <h2>🔐 安全与账号</h2>
        <span className="p0-tag">REQ-006 · P12</span>
        <span className="p0-tag info">真实审计账本</span>
        <div className="p0-right">
          <span className={`p0-tag ${issueCount > 0 ? 'warn' : 'ok'}`}>
            {issueCount > 0 ? `${issueCount} 项需处理` : '全部检查通过'}
          </span>
        </div>
      </div>
      <div className="sub">
        4.1 加密 · 4.2 密码策略 · 3.2 角色矩阵 · 18.2-A 用户团队 · L0 危险操作（11 卡）· 审计落内核 security_change
      </div>

      <div className="p0-tabs" role="tablist" data-testid="security-tabs">
        {['检查摘要', '危险操作卡', '账号与密钥', 'L0 审计'].map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`sec-tab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}{i === 1 ? <span className="p0-tabnum">11</span> : null}</button>
        ))}
      </div>

      {/* ── 1. 检查摘要 ── */}
      <div hidden={tab !== 0} data-testid="security-summary">
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>安全检查摘要</h3>
            <span className="p0-tag">实时读取 · 失败如实</span>
            <button className="btn" type="button" onClick={() => setTab(1)}>查看操作卡</button>
          </div>
          <div className="p0-banner info" data-testid="summary-banner">
            只读检查不会修改任何状态；破坏性卡一律「管理员口令 → 强制备份 → 逐字口令」，账号/密码策略卡走真实后端接口并需管理员。
          </div>
          <div className="card">
            <b>8 项检查（有真实接口的按实况显示，无接口的明确标注程序事实）</b>
            <table className="ltable" data-testid="security-checks">
              <thead>
                <tr><th style={{ width: 120 }}>检查项</th><th>状态</th><th>说明</th></tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.k} data-testid={c.testid}>
                    <td>{c.k}</td>
                    <td style={{
                      fontWeight: 700,
                      color: c.tone === 'ok' ? 'var(--ok)' : c.tone === 'warn' ? 'var(--warn)'
                        : c.tone === 'err' ? 'var(--err)' : 'var(--accent)',
                    }}>
                      {c.tone === 'ok' ? '通过' : c.tone === 'warn' ? '需处理' : c.tone === 'err' ? '失败' : '只读'}
                    </td>
                    <td>{c.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="note">
              「IPC 会话校验 / 上行鉴权」是程序架构事实（主进程 handler 与后端强制），非页面推断；
              其余各项来自真实接口：/api/me、/api/policy、内核 l0Status、内核审计账本、/api/mirror/audit integrity。
            </div>
          </div>

          <div className="card" data-testid="danger-overview">
            <b>11 张危险操作卡（按权限前置分组）</b>
            <div className="note" style={{ lineHeight: 1.9 }}>
              L0 相关 6 张：密钥环 / SPLIT / 遗留迁移 / 恢复 / 遗留账本清理 / 从 L0 重建；<br />
              账本相关 3 张：RESET / REJUDGE / 字段回填；账号相关 2 张：管理员账号 / 密码策略。<br />
              破坏性卡执行条件：管理员角色 + 强制备份 + 逐字口令，缺一不可；账号/密码策略卡需管理员角色并调用真实后端接口；无接口时卡内标「程序无该接口」。
            </div>
          </div>

          <div className="card" data-testid="encrypt-card">
            <b>加密状态（4.1，只读 · 按真实状态）</b>
            <div className="row">
              <span className={desensOn ? 'status active' : 'status deprecated'} data-testid="tls-desens">
                L1 脱敏{desensOn ? `已启用（运行时探针实测：${desensOut.slice(0, 24)}…）` : '未生效（探针原文未变化）'}
              </span>
              {tlsOn
                ? <span className="status active">TLS 已启用（当前 https）</span>
                : <span className="status stale">TLS 未启用（当前为 {proto} 本机回环）</span>}
              <span className="status stale">L0 AES-256-GCM：以密钥环实况为准（见检查摘要 / L0 管理卡）</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. 危险操作卡（11 张，全部真实接口） ── */}
      <div hidden={tab !== 1} data-testid="danger-panel">
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>危险操作卡</h3>
            <span className="p0-tag warn">11 张 · 破坏性卡三段确认</span>
          </div>
          <div className="note" data-testid="danger-note" style={{ marginBottom: 8 }}>
            每张卡调用真实接口（主进程 IPC / 内核 L0 端口），成功后显示真实回执与 request_id；
            因环境缺少接口而无法执行时，卡内明确写「程序无该接口」，不使用「演示执行」类口径。
          </div>
          <div className="p0-grid2" data-testid="danger-cards">
            <div data-testid="danger-card-01"><AdminAccountCard /></div>
            <div data-testid="danger-card-02"><PwdPolicyCard
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
            /></div>
            <div data-testid="danger-card-03"><L0AdminCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-04"><L0SplitCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-05"><L0MigrateCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-06"><L0RecoveryCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-07"><LegacyLedgerCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-08"><LedgerResetCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-09"><RulesRejudgeCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-10"><FieldBackfillCard enabled={role === 'admin'} /></div>
            <div data-testid="danger-card-11"><RebuildFromL0Card enabled={role === 'admin'} /></div>
          </div>
          {policyErr ? <div className="note" data-testid="pwd-policy-error" style={{ color: 'var(--warn)' }}>{policyErr}</div> : null}
          <div className="note" data-testid="pwd-policy-scope">
            密码策略已保存到本机登录后端（.data/home-policy.json），对注册与修改密码真实生效，刷新后保持。
            历史密码查重（history_count）暂无历史库，未参与校验。
          </div>
        </div>
      </div>

      {/* ── 3. 账号与密钥 ── */}
      <div hidden={tab !== 2}>
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>账号与密钥</h3>
            <span className="p0-tag">真实后端 /api/accounts · /api/keys</span>
          </div>
          <RoleMatrixCard />
          <MemberTable accounts={accounts} error={accErr} />
          <KeyTable
            keys={rawKeys.map(toKeyView)}
            busy={busy}
            error={keysErr}
            onRotate={(id) => void onRotateKey(id)}
            onRevoke={(id) => void onRevokeKey(id)}
          />
        </div>
      </div>

      {/* ── 4. L0 审计 ── */}
      <div hidden={tab !== 3} data-testid="l0-audit-panel">
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>L0 审计</h3>
            <span className="p0-tag">内核账本 · 只读</span>
          </div>
          <div className="card">
            <b>L0 相关审计（l0_* + security_change/l0*，最近 30 条）</b>
            {l0AuditErr && <div className="p0-banner err" data-testid="l0-audit-error">{l0AuditErr}</div>}
            {!l0AuditErr && l0Audit && l0Audit.length === 0 && (
              <div className="p0-empty dashed" data-testid="l0-audit-empty">
                暂无 L0 审计记录（账本中无 l0_* / l0 安全变更）；执行 L0 管理或查看动作后在此如实出现。
              </div>
            )}
            {!l0AuditErr && l0Audit && l0Audit.length > 0 && (
              <table className="ltable" data-testid="l0-audit-table">
                <thead>
                  <tr><th style={{ width: 180 }}>时间</th><th>动作</th><th>说明</th><th>request_id</th></tr>
                </thead>
                <tbody>
                  {l0Audit.map((a) => (
                    <tr key={`${a.request_id}-${a.ts}`}>
                      <td>{fmtTime(a.ts)}</td>
                      <td>{L0_ACTION_TEXT[a.action] ?? a.action}</td>
                      <td>{a.op || '无'}</td>
                      <td className="mid">{a.request_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!l0AuditErr && !l0Audit && <div className="note">读取内核审计账本中…</div>}
            <div className="note">
              本表只读内核真实审计；不展示 L0 明文或密钥材料。未解锁会话不提供 L0 条数接口——程序无该接口。
            </div>
          </div>
        </div>
      </div>

      {toast}
    </div>
  );
}
