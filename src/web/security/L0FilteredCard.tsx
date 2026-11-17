// 安全页 · L0 拦截记录卡（L0-first，2026-11-17 用户拍板）
// 质量门拦截的条目不再纯丢弃：原文密文以 bak_* 键留在主 L0 库并做标记（status=filtered + 归属人）。
// 本卡 = 统计区分 + 展示 + 查看 + 人工重判入口。权限：本人看/操作自己的，管理员看全部；
// 查阅走「口径一」（解锁写密钥后免审批直读，免申请/免查阅会话），全程落审计。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

/** 拦截码 → 中文（唯一表；没有对应译名的一律归「其它拦截规则」，不把英文枚举糊给用户） */
const FILTER_CODE_ZH: Record<string, string> = {
  empty: '空内容',
  thin: '有效内容太少',
  short_low_signal: '太短且无具体信息',
  greeting: '纯打招呼/客套话',
  disclaimer: '免责声明',
  capability_list: '能力清单自述',
  unspecified: '未分类拦截',
};

function codeZh(code: string): string {
  return FILTER_CODE_ZH[code] ?? '其它拦截规则';
}

function timeText(ts: number): string {
  if (!ts) return '（无时间记录）';
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface FilteredItem {
  id: string;
  sealed_at: number;
  owner: string;
  mine: boolean;
  project_id: string;
  source: string;
  filter_code: string;
  filter_reason: string;
}

interface ListResult {
  ok: boolean;
  role?: 'admin' | 'member';
  filtered_count?: number;
  accepted_count?: number;
  items?: FilteredItem[];
  truncated?: boolean;
  error?: string;
}

export function L0FilteredCard({ enabled }: { enabled: boolean }) {
  const [list, setList] = useState<ListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewText, setViewText] = useState<{ id: string; content: string } | null>(null);
  const [viewErr, setViewErr] = useState<string | null>(null);
  const [rejudgeNote, setRejudgeNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const hostReady = hostCapability() !== 'none';

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    setBusy(true);
    try {
      const res = await hostCall<ListResult>('l0:filteredList', [currentSessionId()]);
      if (res?.ok) { setList(res); setErr(null); }
      else setErr(res?.error ?? '读取拦截记录失败（主进程未返回结果）');
    } catch (e) {
      setErr(`读取拦截记录失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  }, [hostReady]);

  useEffect(() => {
    if (enabled && hostReady) void refresh();
  }, [enabled, hostReady, refresh]);

  const doView = async (id: string) => {
    setActing(id);
    setViewErr(null);
    setViewText(null);
    try {
      const res = await hostCall<{ ok: boolean; content?: string; error?: string }>('l0:filteredView', [id, currentSessionId()]);
      if (res?.ok) setViewText({ id, content: res.content ?? '' });
      else setViewErr(res?.error ?? '查阅失败（主进程未返回结果）');
    } catch (e) {
      setViewErr(`查阅失败：${errText(e)}`);
    } finally {
      setActing(null);
    }
  };

  const doRejudge = async (id: string) => {
    setActing(id);
    setRejudgeNote(null);
    try {
      const res = await hostCall<{ ok: boolean; mem_id?: string; dedup?: string; error?: string; reason?: string }>('l0:filteredRejudge', [id, currentSessionId()]);
      if (res?.ok) {
        setRejudgeNote({
          id,
          ok: true,
          text: res.dedup === 'grafted' ? `重判通过：与库内已有记忆合并（${(res.mem_id ?? '').slice(0, 20)}…）` : `重判通过：已正常入库`,
        });
        await refresh();
      } else if (res && 'still_filtered' in res) {
        setRejudgeNote({ id, ok: false, text: `重判仍未通过：${res.error ?? '质量门拦截'}` });
      } else {
        setRejudgeNote({ id, ok: false, text: res?.error ?? '重判失败（主进程未返回结果）' });
      }
    } catch (e) {
      setRejudgeNote({ id, ok: false, text: `重判失败：${errText(e)}` });
    } finally {
      setActing(null);
    }
  };

  if (!enabled) {
    return (
      <div className="card" data-testid="l0-filtered">
        <b>拦截记录（L0 标记）</b>
        <div className="note">登录后可查看质量门拦截条目的标记记录（本人自己的）。</div>
      </div>
    );
  }

  const items = list?.items ?? [];

  return (
    <div className="card" data-testid="l0-filtered">
      <b>拦截记录（L0 标记）</b>
      <div className="note">
        入库未通过质量门的条目保留原文密文并做标记：不进记忆列表、不参与召回，可在此查看与人工重判。
        {list?.role === 'admin' ? '当前口径：管理员（可见全部）' : '当前口径：仅本人'}
      </div>
      {err ? <div className="note" style={{ color: 'var(--warn, #b8860b)' }}>{err}</div> : null}
      {list ? (
        <div className="note" data-testid="l0-filtered-stats">
          拦截 {list.filtered_count ?? 0} 条 · 正常入库（含 L0 原件）{list.accepted_count ?? 0} 条
          {list.truncated ? ' · 仅显示最近 200 条' : ''}
          {' · '}
          <button type="button" className="btn" onClick={() => void refresh()} disabled={busy}>刷新</button>
        </div>
      ) : null}
      {items.length === 0 && list ? (
        <div className="note">当前没有拦截记录。</div>
      ) : null}
      {items.length > 0 ? (
        <table className="ltable" data-testid="l0-filtered-table">
          <thead>
            <tr><th>时间</th><th>来源</th><th>拦截原因</th><th>归属</th><th>操作</th></tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} data-testid={`l0-filtered-${it.id}`}>
                <td>{timeText(it.sealed_at)}</td>
                <td>{it.source || '（来源未标注）'}</td>
                <td>
                  {codeZh(it.filter_code)}
                  {it.filter_reason ? `：${it.filter_reason}` : ''}
                </td>
                <td>{it.mine ? '我' : it.owner || '（旧数据·管理员）'}</td>
                <td>
                  <button type="button" className="btn" disabled={acting !== null}
                    onClick={() => void doView(it.id)}>查看</button>{' '}
                  <button type="button" className="btn" disabled={acting !== null}
                    onClick={() => void doRejudge(it.id)}>重判</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {viewErr ? <div className="note" style={{ color: 'var(--warn, #b8860b)' }}>{viewErr}</div> : null}
      {viewText ? (
        <div data-testid={`l0-filtered-view-${viewText.id}`}>
          <b>原文（解密）</b>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' }}>{viewText.content}</pre>
        </div>
      ) : null}
      {rejudgeNote ? (
        <div className="note" data-testid={`l0-filtered-rejudge-${rejudgeNote.id}`}
          style={{ color: rejudgeNote.ok ? undefined : 'var(--warn, #b8860b)' }}>
          {rejudgeNote.text}
        </div>
      ) : null}
    </div>
  );
}
