// 安全页 · 「本机租户身份」卡（管理员与成员权限设计 §14.2，2026-11-15 用户确认新增；
// design/ui 下无账号与安全页原型，用户已显式批准偏离原型）。
// 读口 tenant:read：读机器级 tenant.json 真源（≠ tenant:get 的登录会话三元组，两套值禁止合成一套）；
// 写口 tenant:set：仅管理员 + 逐字口令 TENANT + 写前备份 + 审计 + 重启生效提示；
// 归一 tenant:normalize：仅管理员，按 45-A2 口径把存量账本行归一到本机身份（user_id 保留）。
// UI 铁律（AC-11）：整页中文名 + 一句摘要，不渲染原始 JSON / payload / 英文字段名。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import { newRequestId } from '../kernel.ts';
import { TENANT_CONFIRM_WORD, TENANT_FIELD_KEYS, TENANT_FIELD_LABELS } from './tenantLabels.ts';

interface Triple { user_id: string; team_id: string; enterprise_id: string }

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

export function TenantIdentityCard({ enabled }: { enabled: boolean }) {
  const [tenant, setTenant] = useState<Triple | null>(null);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Triple | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [normalizeReport, setNormalizeReport] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{ ok: boolean; tenant?: Triple | null; error?: string }>(
        'tenant:read', [currentSessionId()],
      );
      if (res?.ok) {
        setTenant(res.tenant ?? null);
        setDraft(res.tenant ? { ...res.tenant } : null);
        setReadErr(null);
      } else {
        setReadErr(res?.error ?? '读取失败（主进程未返回结果）');
      }
    } catch (e) {
      setReadErr(`读取失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [hostReady]);

  useEffect(() => {
    if (hostReady) void refresh();
  }, [hostReady, refresh]);

  const doSave = async () => {
    if (!draft) return;
    setBusy(true);
    setActionErr(null);
    const requestId = newRequestId('req');
    try {
      const res = await hostCall<{
        ok: boolean; prev?: Triple; next?: Triple; backup_file?: string; restart_required?: boolean; error?: string;
      }>('tenant:set', [draft, confirmText.trim(), requestId, currentSessionId()]);
      if (res?.ok) {
        const prev = res.prev!;
        const next = res.next!;
        setTenant(next);
        const lines: string[] = [`已保存（审计编号 ${requestId}）：三项身份已更新并写入本机备份，重启应用后生效。`];
        if (prev.user_id !== next.user_id) {
          lines.push('注意：本机用户标识已变更，此前配置的个人记忆账号绑定（如 MAM_PERSONAL_OWNER_BINDINGS）会失配，需按新标识重新核对。');
        }
        lines.push(`备份文件：${res.backup_file ?? '（未知）'}`);
        setReceipt(lines.join(' '));
        setConfirmText('');
      } else {
        setActionErr(res?.error ?? '保存失败（主进程未返回结果）');
      }
    } catch (e) {
      setActionErr(`保存失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const doNormalize = async () => {
    setBusy(true);
    setActionErr(null);
    const requestId = newRequestId('req');
    try {
      const res = await hostCall<{
        ok: boolean; total?: number; mismatched?: number; normalized?: number; failed?: number; error?: string;
      }>('tenant:normalize', [requestId, currentSessionId()]);
      if (res?.ok) {
        setNormalizeReport(
          res.mismatched === 0
            ? `存量记忆已全部与本机身份一致（共 ${res.total} 条），本次无需改写。`
            : `归一完成（审计编号 ${requestId}）：共 ${res.total} 条，其中 ${res.normalized} 条已归一到本机身份，失败 ${res.failed} 条（明细见审计日志页）。`,
        );
      } else {
        setActionErr(res?.error ?? '归一失败（主进程未返回结果）');
      }
    } catch (e) {
      setActionErr(`归一失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const canSave = !!draft
    && TENANT_FIELD_KEYS.every((k) => (draft[k] ?? '').trim().length > 0)
    && confirmText.trim().toUpperCase() === TENANT_CONFIRM_WORD
    && !busy;

  return (
    <div className="card" data-testid="tenant-identity-card">
      <div className="section-title">本机租户身份（这台设备上所有记忆数据的归属口径）</div>
      {!hostReady && (
        <div className="note" data-testid="tenant-identity-unavailable">
          当前为浏览器环境，读不到本机身份文件；请在桌面端查看。
        </div>
      )}
      {hostReady && readErr && (
        <div className="note" data-testid="tenant-identity-error" style={{ color: 'var(--err)' }}>{readErr}</div>
      )}
      {hostReady && !readErr && tenant === null && (
        <div className="note" data-testid="tenant-identity-missing">
          本机尚未生成身份文件（重启应用后会按规范自动创建）。
        </div>
      )}
      {hostReady && tenant && (
        <>
          <div className="note" data-testid="tenant-identity-summary">
            下面三项是这台设备上记忆数据的「户口」：个人记忆归谁、团队边界在哪、多租户隔离到哪层。
            {enabled ? '修改会影响所有账号、所有历史记忆、Agent 接入与同步口径，请谨慎操作。' : '修改需管理员账号。'}
          </div>
          <table className="ltable" data-testid="tenant-identity-table">
            <thead>
              <tr><th style={{ width: 130 }}>身份项</th><th>当前值</th><th>说明</th></tr>
            </thead>
            <tbody>
              {TENANT_FIELD_KEYS.map((k) => (
                <tr key={k} data-testid={`tenant-identity-${k}`}>
                  <td>{TENANT_FIELD_LABELS[k].name}</td>
                  <td>{enabled && draft
                    ? <input
                      data-testid={`tenant-identity-input-${k}`}
                      value={draft[k]}
                      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                      aria-label={TENANT_FIELD_LABELS[k].name}
                    />
                    : <code>{tenant[k]}</code>}
                  </td>
                  <td className="dim">{TENANT_FIELD_LABELS[k].desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!enabled && (
            <div className="note" data-testid="tenant-identity-member-note">需要管理员修改（成员只读，没有写入口）。</div>
          )}
          {enabled && draft && (
            <>
              <div className="row" data-testid="tenant-identity-confirm">
                <span className="dim">
                  保存前会自动备份本机身份文件，备份成功才允许写入；写入会留审计（含修改前后与审计编号）。
                  逐字输入 {TENANT_CONFIRM_WORD} 才能点保存；保存后需重启应用才生效。
                </span>
                <input
                  data-testid="tenant-identity-word"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={`输入 ${TENANT_CONFIRM_WORD}`}
                  aria-label="身份修改确认口令"
                />
                <button type="button" className="btn danger" data-testid="tenant-identity-save" disabled={!canSave} onClick={() => void doSave()}>
                  保存身份（重启后生效）
                </button>
              </div>
              <div className="row">
                <button type="button" className="btn" data-testid="tenant-identity-normalize" disabled={busy} onClick={() => void doNormalize()}>
                  把存量记忆归一到本机身份
                </button>
                <span className="dim">只改历史记忆的团队/企业归属以匹配上表，不动个人归属与正文；执行前自动备份账本。</span>
              </div>
            </>
          )}
          {receipt && <div className="note" data-testid="tenant-identity-receipt">{receipt}</div>}
          {normalizeReport && <div className="note" data-testid="tenant-identity-normalize-report">{normalizeReport}</div>}
          {actionErr && <div className="note" data-testid="tenant-identity-action-error" style={{ color: 'var(--err)' }}>{actionErr}</div>}
          <div className="note">
            口径边界：这里读写的「本机身份」是设备级真源文件，与顶栏登录账号是两套值（登录账号属于登录服务），
            两者各有各的用途，卡片不会把它们合并显示。
          </div>
        </>
      )}
    </div>
  );
}
