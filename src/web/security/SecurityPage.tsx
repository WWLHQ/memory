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
import { MyWriteWrapCard } from './MyWriteWrapCard.tsx';
import { LegacyLedgerCard } from './LegacyLedgerCard.tsx';
import { LedgerResetCard } from './LedgerResetCard.tsx';
import { RulesRejudgeCard } from './RulesRejudgeCard.tsx';
import { FieldBackfillCard } from './FieldBackfillCard.tsx';
import { L0SplitCard } from './L0SplitCard.tsx';
import { L0MigrateCard } from './L0MigrateCard.tsx';
import { RebuildFromL0Card } from './RebuildFromL0Card.tsx';
import { L0RecoveryCard } from './L0RecoveryCard.tsx';
import { L0FilteredCard } from './L0FilteredCard.tsx';
import { L0OwnerBackfillCard } from './L0OwnerBackfillCard.tsx';
import { TenantIdentityCard } from './TenantIdentityCard.tsx';
import { OwnerBindingsCard } from './OwnerBindingsCard.tsx';
import { useSessionContext } from '../shared/session.ts';
import { useToast } from './useToast.tsx';
import {
  fetchAccounts, fetchApiKeys, mintApiKey, revokeApiKey, fetchPwdPolicy, savePwdPolicy,
  fetchMirrorIntegrity, resealMirrorAudit, type AccountView, type ApiKeyRecord, type MirrorIntegrityView,
} from './accountsClient.ts';
import type { ApiKey, PwdPolicy } from './types.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import '../shared/afPage.css';

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

interface Remedy {
  why: string;
  need: string;
  after: string;
  action?: 'l0' | 'role' | 'reseal';
}

/** 每条「需处理」的真实原因 / 所需身份或密钥 / 处理后的状态（与 checks 的 testid 一一对应） */
const REMEDY: Record<string, Remedy> = {
  'chk-session': {
    why: '当前没有有效登录会话，后端与管理 IPC 一律拒绝（401/403）。',
    need: '用本机账号重新登录（管理员账号可解锁全部操作）。',
    after: '该项转为「通过」；依赖会话的检查同步刷新。',
  },
  'chk-role': {
    why: '当前是 member 会话，危险操作卡与管理员接口被主进程/后端强制禁用。',
    need: '管理员账号登录；或由现有管理员在「账号与密钥」表把该账号角色改为 admin 并保存。',
    after: '角色变为管理员，危险操作卡启用，该项转为「通过」，计数 -1。',
    action: 'role',
  },
  'chk-policy': {
    why: '密码策略未能从后端读取（接口失败或会话失效），页面只能显示默认值。',
    need: '有效登录会话 + 后端 /api/policy 可达；修改策略还需管理员角色。',
    after: '读取成功后显示后端已生效值，该项转为「通过」。',
  },
  'chk-l0': {
    why: 'L0 密钥环读取失败：主密钥/管理密码包装不可用，或当前会话无权读取。',
    need: '管理员会话 + L0 管理密码；若密钥环文件损坏，需用「恢复」卡从备份重建。',
    after: '读取成功后显示包装/写锁/授权实况；写密钥锁定即为通过，计数随之下降。',
    action: 'l0',
  },
  'chk-l0audit': {
    why: '内核 L0/安全变更审计读不到或为空，无法证明最近的安全操作有留痕。',
    need: '内核审计账本可读（桌面壳运行中）；空账本需先产生一次真实安全操作。',
    after: '读到审计条目后该项转为「通过」。',
  },
  'chk-chain': {
    why: '审计链存在旧版未签名段（sealed 与前缀 legacy 混存），或链校验失败/接口不可达。',
    need: '管理员会话 + 本机 home-mirror.key（0600，与账本同目录）；断链时不可封存。',
    after: '旧段补签成功后 sealed 增加、未签名归零、追加 mirror_reseal 审计；断链则报 E_MIRROR_CHAIN_BROKEN 并点名 seq。',
    action: 'reseal',
  },
  'chk-ipc': {
    why: '程序架构事实：所有敏感 IPC 都要求会话并由主进程强制权限。',
    need: '无需处理；如需变更权限策略请改主进程代码。',
    after: '该行不会自动转为通过（只读说明行）。',
  },
  'chk-up': {
    why: '上行/裁决依赖登录会话与管理员身份。',
    need: '登录会话；人工裁决需管理员。',
    after: '保持只读说明；真实通道状态见同步页。',
  },
};

export function SecurityPage() {
  useHostTheme();
  const [tab, setTab] = useState(0);
  // T3（§14.1）：管理台入口 href '?tab=overview' → 落「检查摘要」页签（壳层管理台复用本页，不新增入口）
  useEffect(() => {
    const t = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tab') : null;
    if (t === 'overview') setTab(0);
  }, []);
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
  // 批次63：「N 项需处理」chip 可点开，逐条给原因/所需身份/处理后状态与可执行动作
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [issueMsg, setIssueMsg] = useState('');
  const [issueErr, setIssueErr] = useState('');
  const [resealing, setResealing] = useState(false);

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
  const refreshChain = useCallback(async () => {
    const v = await fetchMirrorIntegrity();
    setChain(v);
  }, []);

  const refreshChecks = useCallback(async () => {
    try {
      const st = await coreL0Status();
      setL0(st); setL0Err('');
    } catch (e) {
      setL0(null); setL0Err(errText(e));
    }
    try {
      const rows = await coreLoadL0Audit();
      setL0Audit(rows); setL0AuditErr('');
    } catch (e) {
      setL0Audit([]); setL0AuditErr(errText(e));
    }
    await refreshChain();
  }, [refreshChain]);

  useEffect(() => { void refreshChecks(); }, [refreshChecks]);

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
  // 只把 warn/err 计为「需处理」；清单与计数用同一数组，保证一一对应
  const issues = checks.filter((c) => c.tone === 'warn' || c.tone === 'err');
  const issueCount = issues.length;

  const jumpToTab = (index: number, testid: string) => {
    setTab(index);
    setTimeout(() => {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  const doReseal = async () => {
    setIssueMsg('');
    setIssueErr('');
    if (role !== 'admin') {
      setIssueErr('[E_ADMIN_REQUIRED] 封存旧审计段需要管理员会话（后端同样强制）');
      return;
    }
    setResealing(true);
    const r = await resealMirrorAudit();
    setResealing(false);
    if (!r.ok) {
      setIssueErr(`[${r.code ?? 'E_UNKNOWN'}] ${r.error ?? r.reason ?? '封存失败'}${typeof r.broken_at_seq === 'number' ? ` · 断链 seq ${r.broken_at_seq}` : ''}`);
      await refreshChain(); // 失败也刷新：不把旧读数当成功
      return;
    }
    await refreshChain(); // 成功：sealed/未签名/计数实时更新
    setIssueMsg(r.resealed && r.resealed > 0
      ? `已封存 ${r.resealed} 条旧无签名条目；备份 ${r.backup_path ?? '已生成'}；审计已记 mirror_reseal。`
      : '没有需要封存的旧段（状态未变）。');
  };

  return (
    <div className="p0-page af-page" data-testid="security-page">
      <div className="af-head" data-testid="security-head">
        <h1>账号与安全</h1>
        <span className="sub">
          账号与角色 · 会话与登录安全 · L0 密钥环 · 审计链完整性 · 真实接口（失败原样报错误码）
        </span>
        <span className="right">
          <span className="p0-tag info">真实审计账本</span>
          <button
            type="button"
            className={`p0-tag ${issueCount > 0 ? 'warn' : 'ok'}`}
            data-testid="security-issue-chip"
            aria-expanded={issuesOpen}
            aria-controls="sec-issue-list"
            title={issueCount > 0 ? `展开这 ${issueCount} 项分别是什么、怎么处理` : '当前没有需处理项'}
            style={{ cursor: issueCount > 0 ? 'pointer' : 'default' }}
            disabled={issueCount === 0}
            onClick={() => setIssuesOpen((v) => !v)}
          >
            {issueCount > 0 ? `${issueCount} 项需处理 ${issuesOpen ? '▴' : '▾'}` : '全部检查通过'}
          </button>
        </span>
      </div>

      {/* ── 摘要读数条（真实接口：/api/me、内核 l0Status、/api/mirror/audit） ── */}
      <section className="af-panel" data-testid="security-readout">
        <div className="af-ph"><h3>安全摘要</h3><span className="hint">真实检查 · 不把失败改判为通过</span></div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat">
              <div className="k">账号与角色 <span>role</span></div>
              <div className="v sm">{role ?? '未登录'}</div>
              <div className={role === 'admin' ? 'd' : 'd mut'}>
                {role === 'admin' ? `管理员 · 账号表 ${accounts.length} 条` : '危险操作卡与管理员接口被禁用'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">登录会话 <span>session</span></div>
              <div className="v sm">{loading ? '校验中' : context ? context.user_id : sid ? '会话无效' : '未登录'}</div>
              <div className={context ? 'd mut' : 'd bad'}>
                {context ? `角色 ${context.role ?? 'member'} · /api/me 已确认` : '无有效会话：敏感接口返回 401/403'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">L0 密钥环 <span>l0Status</span></div>
              <div className={`v sm${l0Err ? ' bad' : ''}`}>
                {l0Err ? '不可用' : l0 ? (l0.write_unlocked ? '已解锁' : '已锁定') : '读取中'}
              </div>
              <div className={l0Err ? 'd bad' : 'd mut'}>
                {l0Err ? l0Err : l0 ? `管理密码包装 ${l0.has_admin_wrap ? '已设置' : '未设置'} · 活跃授权 ${l0.active_grants}` : '读取内核密钥环状态中'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">审计链完整性 <span>mirror integrity</span></div>
              <div className={`v sm${chain && !chain.ok ? ' bad' : ''}`}>
                {chain ? (chain.ok ? `sealed ${chain.sealed}` : '不可校验') : '读取中'}
              </div>
              <div className={chain && (!chain.ok || chain.legacy_unsealed > 0) ? 'd bad' : 'd mut'}>
                {chain
                  ? (chain.ok
                    ? (chain.legacy_unsealed > 0 ? `未签名旧段 ${chain.legacy_unsealed} 条` : 'HMAC-SHA256 链完整')
                    : (chain.error ?? chain.reason ?? '接口不可达'))
                  : '读取 /api/mirror/audit integrity 中'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">需处理 <span>warn + err</span></div>
              <div className={`v${issueCount > 0 ? ' bad' : ''}`}>{issueCount}</div>
              <div className={issueCount > 0 ? 'd bad' : 'd'}>
                {issueCount > 0 ? '点右上角计数逐条展开处理路径' : '全部检查通过'}
              </div>
            </div>
          </div>
          <p className="af-note">
            数据来源：/api/me（会话与角色）、/api/policy（密码策略）、内核 l0Status（密钥环）、内核审计账本（L0 留痕）、
            /api/mirror/audit integrity（签名链）。每一项都是真实读取；失败写真实错误码，不用默认值冒充通过。
          </p>
        </div>
      </section>

      {/* ── 场景分组：账号/会话/L0/审计链各一张，动作直达真实面板 ── */}
      <div className="af-g2" data-testid="security-groups">
        <section className="af-panel" data-testid="security-group-account">
          <div className="af-ph"><h3>账号与角色</h3><span className="hint">/api/accounts · /api/me</span></div>
          <div className="af-pb">
            <p className="af-q">有哪些账号、谁是管理员、谁能改危险设置？</p>
            <div className="af-mini">
              <span>当前角色 <b>{role ?? '未登录'}</b></span>
              <span>账号表 <b>{role === 'admin' ? `${accounts.length} 条` : '需管理员'}</b></span>
              <span>密钥 <b>{role === 'admin' ? `${rawKeys.length} 条` : '需管理员'}</b></span>
            </div>
            <p className="af-note">来源：真实后端 /api/accounts · /api/keys（成员会话不返回）。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="security-jump-accounts" onClick={() => jumpToTab(2, 'admin-accounts-card')}>打开账号与密钥</button>
              {role !== 'admin' && <span className="dim" style={{ fontSize: 11 }}>需管理员会话才能改角色</span>}
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="security-group-session">
          <div className="af-ph"><h3>会话与登录安全</h3><span className="hint">/api/me · /api/policy</span></div>
          <div className="af-pb">
            <p className="af-q">登录是否有效，密码策略与传输/脱敏是否真生效？</p>
            <div className="af-mini">
              <span>会话 <b>{context ? '有效' : sid ? '无效' : '未登录'}</b></span>
              <span>最小长度 <b>{policy.min_len}</b></span>
              <span>TLS <b>{tlsOn ? 'https' : proto}</b></span>
              <span>L1 脱敏 <b>{desensOn ? '已启用' : '未生效'}</b></span>
            </div>
            <p className="af-note">来源：/api/me 会话校验、后端 home-policy.json、运行时 sanitizeL1 探针与当前协议。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="security-jump-policy" onClick={() => jumpToTab(1, 'pwd-upper')}>打开密码策略</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="security-group-l0">
          <div className="af-ph"><h3>L0 密钥环</h3><span className="hint">内核 l0Status</span></div>
          <div className="af-pb">
            <p className="af-q">L0 加密密钥能不能用，写密钥是否已解锁？</p>
            <div className="af-mini">
              <span>状态 <b>{l0Err ? '不可用' : l0 ? (l0.write_unlocked ? '写密钥已解锁' : '写密钥锁定') : '读取中'}</b></span>
              <span>管理密码包装 <b>{l0 ? (l0.has_admin_wrap ? '已设置' : '未设置') : '读取中'}</b></span>
              <span className={l0Err ? 'bad' : ''}>错误 <b className={l0Err ? 'bad' : ''}>{l0Err || '无'}</b></span>
            </div>
            <p className="af-note">来源：内核 L0 密钥环真实状态；锁定态下写 L0 会被内核拒绝，不在页面伪造解锁。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="security-jump-l0" onClick={() => jumpToTab(1, 'l0-admin-card')}>去解锁 / 管理 L0</button>
              <button type="button" className="btn" data-testid="security-refresh-l0" onClick={() => void refreshChecks()}>重新读取</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="security-group-chain">
          <div className="af-ph"><h3>审计链完整性</h3><span className="hint">HMAC-SHA256</span></div>
          <div className="af-pb">
            <p className="af-q">审计账本是否被改过，未签名旧段能否补签封存？</p>
            <div className="af-mini">
              <span>结论 <b>{chain ? (chain.ok ? '链完整' : '校验失败 / 不可达') : '读取中'}</b></span>
              <span>sealed <b>{chain?.sealed ?? '未读取'}</b></span>
              <span>未签名旧段 <b className={chain && chain.legacy_unsealed > 0 ? 'bad' : ''}>{chain ? chain.legacy_unsealed : '未读取'}</b></span>
              <span>错误 <b>{chain && !chain.ok ? (chain.error ?? chain.reason ?? 'unknown') : '无'}</b></span>
            </div>
            <p className="af-note">
              来源：/api/mirror/audit integrity + 本机 home-mirror.key；封存只补签名不改内容，链断时禁止封存。
            </p>
            <div className="af-actions">
              <button
                type="button" className="btn primary" data-testid="security-chain-reseal"
                disabled={resealing || !chain?.ok || (chain?.legacy_unsealed ?? 0) === 0 || role !== 'admin'}
                onClick={() => void doReseal()}
              >
                {resealing ? '封存中…' : `封存未签名旧段${chain ? `（${chain.legacy_unsealed} 条）` : ''}`}
              </button>
              <a className="btn" data-testid="security-jump-audit" href="../audit.html">打开审计日志</a>
              <span className="dim" style={{ fontSize: 11 }}>
                {!chain?.ok ? '链校验未通过：按钮禁用' : role !== 'admin' ? '需管理员会话' : ''}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* 「N 项需处理」逐条展开：计数与下表同一数组，一条不多一条不少 */}
      {issuesOpen && issueCount > 0 && (
        <div className="card" id="sec-issue-list" data-testid="sec-issue-list">
          <b>需处理 {issueCount} 项（与下方「安全检查摘要」逐条对应）</b>
          <div className="note">每条都来自真实检查；按钮只做真实操作（后端/内核/主进程），失败原样报错误码，不把失败改判为通过。</div>
          {issues.map((c) => {
            const r = REMEDY[c.testid];
            return (
              <div
                key={c.testid}
                data-testid={`sec-issue-${c.testid}`}
                style={{ borderTop: '1px solid var(--line)', padding: '10px 0', fontSize: 12, lineHeight: 1.7 }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b>{c.k}</b>
                  <span className={`p0-tag ${c.tone === 'err' ? 'warn' : 'info'}`}>{c.tone === 'err' ? '失败' : '需处理'}</span>
                  <span className="dim">{c.v}</span>
                </div>
                <div className="note">为什么：{r?.why ?? '该检查未通过，原因见上方状态。'}</div>
                <div className="note">需要：{r?.need ?? '管理员/运维确认。'}</div>
                <div className="note">处理后：{r?.after ?? '修复后该项实时转为通过，计数随之下降。'}</div>
                <div className="row" style={{ marginTop: 4, gap: 8 }}>
                  {r?.action === 'reseal' && (
                    <>
                      <button
                        type="button" className="btn primary" data-testid="sec-fix-chain"
                        disabled={resealing || !chain?.ok || (chain?.legacy_unsealed ?? 0) === 0}
                        onClick={() => void doReseal()}
                      >
                        {resealing ? '封存中…' : `封存未签名旧段${chain ? `（${chain.legacy_unsealed} 条）` : ''}`}
                      </button>
                      <span className="dim">
                        {chain && !chain.ok
                          ? '链校验失败：禁止封存（避免把破坏签名合法化）'
                          : role !== 'admin'
                            ? '需管理员会话（当前会话会被后端拒绝）'
                            : '仅补签名，不改内容；迁移前强制备份'}
                      </span>
                    </>
                  )}
                  {r?.action === 'l0' && (
                    <button
                      type="button" className="btn" data-testid="sec-fix-l0"
                      onClick={() => jumpToTab(1, 'l0-admin-card')}
                    >去解锁 L0 密钥环</button>
                  )}
                  {r?.action === 'role' && (
                    <button
                      type="button" className="btn" data-testid="sec-fix-role"
                      onClick={() => jumpToTab(2, 'admin-accounts-card')}
                    >去「账号与密钥」改角色</button>
                  )}
                  {!r?.action && <span className="dim">需人工按上述步骤处理（无可用的一键接口）</span>}
                </div>
              </div>
            );
          })}
          {issueMsg && <div className="note" data-testid="sec-issue-msg" style={{ color: 'var(--ok)' }}>{issueMsg}</div>}
          {issueErr && <div className="note" data-testid="sec-issue-err" style={{ color: 'var(--err)' }}>{issueErr}</div>}
        </div>
      )}

      <div className="p0-tabs" role="tablist" data-testid="security-tabs">
        {['检查摘要', '危险操作卡', '账号与密钥', 'L0 审计'].map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`sec-tab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}{i === 1 ? <span className="p0-tabnum">13</span> : null}</button>
        ))}
      </div>

      {/* ── 1. 检查摘要 ── */}
      <div hidden={tab !== 0} data-testid="security-summary">
        <div className="af-stack">
          <section className="af-panel">
            <div className="af-ph">
              <h3>安全检查摘要</h3>
              <span className="hint">实时读取 · 失败如实</span>
              <button className="btn" type="button" onClick={() => setTab(1)}>查看操作卡</button>
            </div>
            <div className="af-pb">
              <p className="af-q" data-testid="summary-banner">
                只读检查不改状态；破坏性动作一律「管理员口令 → 强制备份 → 逐字口令」，账号/密码走真实后端。
              </p>
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
              <p className="af-note">来源：/api/me、/api/policy、内核 l0Status、审计账本、/api/mirror/audit integrity；IPC/上行鉴权为程序架构事实。</p>
            </div>
          </section>

          <div className="af-g2">
            <section className="af-panel" data-testid="danger-overview">
              <div className="af-ph"><h3>危险操作卡</h3><span className="hint">13 张 · 按权限前置分组</span></div>
              <div className="af-pb">
                <div className="af-mini">
                  <span>L0 相关 <b>6</b></span>
                  <span>账本相关 <b>3</b></span>
                  <span>账号相关 <b>3</b></span>
                  <span>身份相关 <b>1</b></span>
                </div>
                <p className="af-note">破坏性卡需管理员 + 强制备份 + 逐字口令；无接口时卡内标「程序无该接口」。</p>
                <div className="af-actions">
                  <button type="button" className="btn" data-testid="security-jump-danger" onClick={() => setTab(1)}>打开操作卡</button>
                </div>
              </div>
            </section>

            <section className="af-panel" data-testid="encrypt-card">
              <div className="af-ph"><h3>加密状态</h3><span className="hint">4.1 · 只读</span></div>
              <div className="af-pb">
                <div className="af-mini">
                  <span className={desensOn ? '' : 'bad'}>L1 脱敏 <b>{desensOn ? '已启用' : '未生效'}</b></span>
                  <span>TLS <b>{tlsOn ? '开（https）' : `未启用（${proto}）`}</b></span>
                  <span>L0 <b>AES-256-GCM</b></span>
                </div>
                <p className="af-note" data-testid="tls-desens">
                  {desensOn ? `运行时探针实测：${desensOut.slice(0, 24)}…` : '运行时探针原文未变化，L1 脱敏未生效'}
                  ；L0 加解密以密钥环实况为准。
                </p>
                <div className="af-actions">
                  <button type="button" className="btn" data-testid="security-refresh-checks" onClick={() => void refreshChecks()}>重新读取</button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ── 2. 危险操作卡（11 张，全部真实接口） ── */}
      <div hidden={tab !== 1} data-testid="danger-panel">
        <div className="p0-sec">
          <div className="p0-sec-hd">
            <h3>危险操作卡</h3>
            <span className="p0-tag warn">13 张 · 破坏性卡三段确认</span>
          </div>
          <div className="note" data-testid="danger-note" style={{ marginBottom: 8 }}>
            每张卡调用真实接口（主进程 IPC / 内核 L0），成功给回执与 request_id；缺接口时卡内明确写「程序无该接口」。
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
            {/* T4（§14.2）：「本机租户身份」卡与 AccountAdminCard / L0AdminCard 并列；成员只读、管理员可编辑带护栏 */}
            <div data-testid="danger-card-12"><TenantIdentityCard enabled={role === 'admin'} /></div>
            {/* OB-3：「个人记忆账号绑定」卡紧随身份卡（同属身份域）；成员只读、管理员可增删改带护栏 */}
            <div data-testid="danger-card-13"><OwnerBindingsCard enabled={role === 'admin'} /></div>
            {/* L0-first 拦截记录卡（2026-11-17）：登录即可（本人看自己的，管理员看全部）；查阅/重判权限主进程再校验 */}
            <div data-testid="danger-card-14"><L0FilteredCard enabled={Boolean(role)} /></div>
            {/* 存量 L0 归属回填卡（2026-11-17）：统计登录可见；执行仅管理员（指定归属账号 + 写密钥解锁 + 自动备份） */}
            <div data-testid="danger-card-15"><L0OwnerBackfillCard enabled={Boolean(role)} role={role} /></div>
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
          <div className="af-g2">
            <RoleMatrixCard />
            <MyWriteWrapCard />
          </div>
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
          <section className="af-panel" data-testid="l0-audit-panel-inner">
            <div className="af-ph"><h3>L0 相关审计</h3><span className="hint">l0_* + security_change/l0* · 最近 30 条</span></div>
            <div className="af-pb">
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
              {!l0AuditErr && !l0Audit && <div className="af-note">读取内核审计账本中…</div>}
              <p className="af-note">只读内核真实审计；不展示 L0 明文或密钥材料，未解锁会话不提供 L0 条数接口。</p>
            </div>
          </section>
        </div>
      </div>

      {toast}
    </div>
  );
}
