// 安全页 · 「个人记忆账号绑定」卡（OB-3）。
// 读口 owner-bindings:read：登录即可读（成员需要看到自己绑没绑，才能理解个人记忆为什么 agent 召回不到）；
// 写口 owner-bindings:set：仅管理员 + 逐字口令 BIND + 写前备份 + 审计 + 重启生效提示。
// 语义：已绑定 = 该登录账号写的个人记忆归到绑定的本机用户，agent 可召回；
//       未绑定 = 个人条目仅本机可见（安全默认，不是故障）。多个账号绑到同一目标会被拒绝（防止并号）。
// UI 铁律（AC-11）：整页中文名 + 一句摘要，不渲染原始 JSON / payload / 英文字段名。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import { newRequestId } from '../kernel.ts';
import { BINDING_CONFIRM_WORD, BINDING_FIELD_KEYS, BINDING_FIELD_LABELS, BINDING_SOURCE_LABELS } from './ownerBindingLabels.ts';

interface Binding { account: string; kernel_user_id: string }

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

export function OwnerBindingsCard({ enabled }: { enabled: boolean }) {
  const [bindings, setBindings] = useState<Binding[] | null>(null);
  const [source, setSource] = useState<'env' | 'file'>('file');
  const [kernelUserId, setKernelUserId] = useState<string>('');
  const [readErr, setReadErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Binding[] | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<{
        ok: boolean; bindings?: Binding[]; source?: 'env' | 'file'; kernel_user_id?: string; error?: string;
      }>('owner-bindings:read', [currentSessionId()]);
      if (res?.ok) {
        setBindings(res.bindings ?? []);
        setDraft((res.bindings ?? []).map((b) => ({ ...b })));
        setSource(res.source ?? 'file');
        setKernelUserId(res.kernel_user_id ?? '');
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

  const updateDraft = (idx: number, key: keyof Binding, value: string) => {
    setDraft((d) => (d ? d.map((row, i) => (i === idx ? { ...row, [key]: value } : row)) : d));
  };

  const addRow = () => {
    setDraft((d) => (d ? [...d, { account: '', kernel_user_id: kernelUserId }] : d));
  };

  const removeRow = (idx: number) => {
    setDraft((d) => (d ? d.filter((_, i) => i !== idx) : d));
  };

  const doSave = async () => {
    if (!draft) return;
    setBusy(true);
    setActionErr(null);
    const requestId = newRequestId('req');
    try {
      const res = await hostCall<{
        ok: boolean; prev?: Binding[]; next?: Binding[]; backup_file?: string; restart_required?: boolean; error?: string;
      }>('owner-bindings:set', [draft, confirmText.trim(), requestId, currentSessionId()]);
      if (res?.ok) {
        setBindings(res.next ?? []);
        const lines: string[] = [`已保存（审计编号 ${requestId}）：绑定已更新并写入本机备份，重启应用后生效。`];
        if ((res.prev ?? []).length > 0 || (res.next ?? []).length > 0) lines.push(`备份文件：${res.backup_file ?? '（首次配置，无旧文件可备份）'}`);
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

  const draftValid = !!draft
    && draft.every((row) => BINDING_FIELD_KEYS.every((k) => (row[k] ?? '').trim().length > 0))
    && !busy;

  const canSave = draftValid
    && confirmText.trim().toUpperCase() === BINDING_CONFIRM_WORD;

  return (
    <div className="card" data-testid="owner-bindings-card">
      <div className="section-title">个人记忆账号绑定（哪个登录账号的个人记忆归到哪个本机用户）</div>
      {!hostReady && (
        <div className="note" data-testid="owner-bindings-unavailable">
          当前为浏览器环境，读不到本机绑定文件；请在桌面端查看。
        </div>
      )}
      {hostReady && readErr && (
        <div className="note" data-testid="owner-bindings-error" style={{ color: 'var(--err)' }}>{readErr}</div>
      )}
      {hostReady && !readErr && bindings !== null && (
        <>
          <div className="note" data-testid="owner-bindings-summary">
            这里决定每个登录账号写的个人记忆归谁：有绑定的账号，其个人记忆可以被 Agent 召回；
            没绑定的账号，个人条目只在本机可见（这是安全默认，不是故障）。
            {enabled ? '两个账号绑到同一个目标会被拒绝，防止把两边的个人记忆混成一份。' : '修改需管理员账号。'}
            {` ${BINDING_SOURCE_LABELS[source]}`}
          </div>
          <table className="ltable" data-testid="owner-bindings-table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>{BINDING_FIELD_LABELS.account.name}</th>
                <th>{BINDING_FIELD_LABELS.kernel_user_id.name}</th>
                {enabled ? <th style={{ width: 60 }}>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {(draft ?? []).length === 0 && (
                <tr data-testid="owner-bindings-empty">
                  <td colSpan={enabled ? 3 : 2} className="dim">暂无绑定（所有账号的个人记忆都仅本机可见）。</td>
                </tr>
              )}
              {(draft ?? []).map((row, idx) => (
                <tr key={idx} data-testid={`owner-bindings-row-${idx}`}>
                  {BINDING_FIELD_KEYS.map((k) => (
                    <td key={k}>
                      {enabled
                        ? <input
                          data-testid={`owner-bindings-input-${idx}-${k}`}
                          value={row[k]}
                          onChange={(e) => updateDraft(idx, k, e.target.value)}
                          aria-label={`${BINDING_FIELD_LABELS[k].name}（第 ${idx + 1} 条）`}
                        />
                        : <code>{row[k]}</code>}
                    </td>
                  ))}
                  {enabled ? (
                    <td>
                      <button type="button" className="btn" data-testid={`owner-bindings-remove-${idx}`} disabled={busy} onClick={() => removeRow(idx)}>
                        删除
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {!enabled && (
            <div className="note" data-testid="owner-bindings-member-note">需要管理员修改（成员只读，没有写入口）。</div>
          )}
          {enabled && (
            <>
              <div className="row">
                <button type="button" className="btn" data-testid="owner-bindings-add" disabled={busy} onClick={addRow}>
                  添加一条绑定
                </button>
                <span className="dim">新绑定的目标默认填本机用户标识（{kernelUserId || '读取中'}）；绑到别的目标不会生效、保存时会被拒绝。</span>
              </div>
              <div className="row" data-testid="owner-bindings-confirm">
                <span className="dim">
                  保存前会自动备份绑定文件（首次配置没有旧文件则不备份），写入会留审计（含修改前后与审计编号）。
                  逐字输入 {BINDING_CONFIRM_WORD} 才能点保存；保存后需重启应用才生效。
                </span>
                <input
                  data-testid="owner-bindings-word"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={`输入 ${BINDING_CONFIRM_WORD}`}
                  aria-label="绑定修改确认口令"
                />
                <button type="button" className="btn danger" data-testid="owner-bindings-save" disabled={!canSave} onClick={() => void doSave()}>
                  保存绑定（重启后生效）
                </button>
              </div>
            </>
          )}
          {receipt && <div className="note" data-testid="owner-bindings-receipt">{receipt}</div>}
          {actionErr && <div className="note" data-testid="owner-bindings-action-error" style={{ color: 'var(--err)' }}>{actionErr}</div>}
          <div className="note">
            口径边界：绑定是「登录账号 → 本机用户」的对应关系；本机用户标识在上方「本机租户身份」卡里维护，
            若那边的用户标识改了，这里的绑定会失配，需要回到这张卡重新核对。
          </div>
        </>
      )}
    </div>
  );
}
