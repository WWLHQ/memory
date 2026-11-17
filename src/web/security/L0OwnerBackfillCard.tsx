// 存量 L0 归属回填卡（2026-11-17 用户拍板）：归属元数据上线前落的存量密文全部无 owner
//（实测 3852 条）→ 本人直读 fail-closed 跳过 → 旧数据永远读不出。
// 本卡 = 管理员把无归属存量归属到**显式选择的账号**（实测教训：管理员与成员是两个不同账号，
// 归给管理员账号会让成员登录时的直读依旧读不到）；执行前主进程强制先备份 L0 库文件；
// 逐条只改元数据、不碰密文；回填数记审计。统计登录可见；执行仅管理员（主进程再校验）。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import { fetchAccounts, type AccountView } from './accountsClient.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

const ROLE_ZH: Record<string, string> = { admin: '管理员', member: '成员' };

interface PreviewResult {
  ok: boolean;
  total?: number;
  no_owner?: number;
  mine?: number;
  others?: number;
  error?: string;
}

interface RunResult {
  ok: boolean;
  backfilled?: number;
  backup?: string | null;
  target?: string;
  error?: string;
}

export function L0OwnerBackfillCard({ enabled, role }: { enabled: boolean; role: 'admin' | 'member' | null }) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [accErr, setAccErr] = useState<string | null>(null);
  const [target, setTarget] = useState<string>('');
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<PreviewResult>('l0:ownerBackfillPreview', [currentSessionId()]);
      if (res?.ok) { setPreview(res); setErr(null); }
      else setErr(res?.error ?? '读取归属统计失败（主进程未返回结果）');
    } catch (e) {
      setErr(`读取归属统计失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [hostReady]);

  useEffect(() => {
    if (enabled && hostReady) void refresh();
  }, [enabled, hostReady, refresh]);

  // 管理员才拉账号列表（fetchAccounts 是管理员接口；成员调用会 403，不白拉）
  useEffect(() => {
    if (!enabled || role !== 'admin' || !hostReady) return;
    let alive = true;
    void (async () => {
      const r = await fetchAccounts();
      if (!alive) return;
      if (r.ok) {
        setAccounts(r.items);
        setAccErr(null);
        // 默认归属目标：账号表里第一个成员账号（单成员库场景 = 库的实际主人）；无成员则第一个账号
        const member = r.items.find((a) => a.role === 'member') ?? r.items[0];
        if (member) setTarget((prev) => prev || member.account);
      } else {
        setAccErr(r.error);
      }
    })();
    return () => { alive = false; };
  }, [enabled, role, hostReady]);

  const doBackfill = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await hostCall<RunResult>('l0:ownerBackfillRun', [target, currentSessionId()]);
      if (res?.ok) {
        setResult(res);
        setConfirming(false);
        await refresh();
      } else {
        setErr(res?.error ?? '回填失败（主进程未返回结果）');
      }
    } catch (e) {
      setErr(`回填失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <div className="card" data-testid="l0-owner-backfill">
        <b>存量 L0 归属回填</b>
        <div className="note">登录后可查看存量密文的归属统计；回填仅管理员可执行。</div>
      </div>
    );
  }

  const noOwner = preview?.no_owner ?? null;
  const total = preview?.total ?? null;

  return (
    <div className="card" data-testid="l0-owner-backfill">
      <b>存量 L0 归属回填</b>
      <div className="note" style={{ marginTop: 4 }}>
        归属元数据上线前的存量密文没有记录归属人，本人直读读不到它们（fail-closed，不猜归属）。
        回填把无归属条目归属到<b>下方选择的账号</b>；只改归属元数据、不碰密文，执行前自动备份 L0 库文件。
      </div>
      <div style={{ margin: '8px 0', fontSize: 13 }}>
        {preview?.ok ? (
          <>
            库内正常密文 <b>{total ?? '?'}</b> 条：归属本人 <b>{preview.mine ?? 0}</b> ·
            {' '}<b data-testid="l0-backfill-no-owner">无归属存量 {noOwner ?? 0}</b> ·
            {' '}归属他人 {preview.others ?? 0}
          </>
        ) : busy ? '统计中…' : (err ?? '尚未读取')}
      </div>
      {noOwner !== null && noOwner > 0 && !confirming && role !== 'admin' && (
        <div className="note" data-testid="l0-backfill-need-admin" style={{ color: '#e0a84f' }}>
          回填需<b>管理员账号</b>登录后执行（当前为成员登录）。当前登录账号的直读也只覆盖归属到自己的条目。
        </div>
      )}
      {noOwner !== null && noOwner > 0 && !confirming && role === 'admin' && (
        <div className="row" style={{ alignItems: 'center', marginTop: 6 }}>
          <button className="btn" data-testid="l0-backfill-start" disabled={busy} onClick={() => setConfirming(true)}>
            回填 {noOwner} 条到所选账号
          </button>
          <select
            data-testid="l0-backfill-target"
            value={target}
            style={{ marginLeft: 8 }}
            onChange={(e) => setTarget(e.target.value)}
          >
            {(accounts ?? []).map((a) => (
              <option key={a.account} value={a.account}>
                {a.account}（{ROLE_ZH[a.role] ?? a.role}）
              </option>
            ))}
          </select>
          {accErr && <span className="note" style={{ color: '#ff5c5c' }}>账号列表读不到：{accErr}</span>}
        </div>
      )}
      {confirming && (
        <div style={{ marginTop: 6 }}>
          <div className="note" style={{ color: '#e0a84f' }}>
            将把 <b>{noOwner}</b> 条无归属存量全部归属到 <b>{target || '（未选账号）'}</b>。
            请确认这些条目确实是该账号产出的（多成员库勿盲目执行）。执行前自动备份 L0 库文件。
          </div>
          <button className="btn primary" data-testid="l0-backfill-confirm" disabled={busy || !target} onClick={() => void doBackfill()}>
            {busy ? '回填中…' : '确认回填（自动备份）'}
          </button>
          <button className="btn" data-testid="l0-backfill-cancel" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
        </div>
      )}
      {result?.ok && (
        <div className="note" data-testid="l0-backfill-result" style={{ color: '#3ecf8e', marginTop: 6 }}>
          ✅ 已回填 {result.backfilled ?? 0} 条归属到 {result.target ?? target}。
          {result.backup ? `备份：${result.backup}` : ''}
          {' '}用该账号登录后去「记忆 → L0 密文」点「本人直读（免审批）」即可读出这些原文。
        </div>
      )}
      {err && (
        <div className="note" data-testid="l0-backfill-error" style={{ color: '#ff5c5c', marginTop: 6 }}>⚠ {err}</div>
      )}
    </div>
  );
}
