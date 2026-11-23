// 个人记忆双窗（第一轮本机闭环 + 第二轮跨端同步）：左「已确认」/ 右「收件箱」。
//
// 数据口径（定稿 UI-Design-Proposals/final-01-workspace.html 个人记忆部分）：
// - 只展示内核 personal.ts 返回的真实条目（PersonalSnapshot），无数据写空态，不编造计数；
// - 每个动作都经真实数据面（桌面壳 IPC / 登录后端 HTTP）落 personal_memory 审计并回执 request_id；
// - 「不是我的」只把条目移出本机视图（rejected，可撤销），不删账本；删除需二次确认并只写墓碑；
// - 个人确认不会自动变成团队可见；上行团队必须二次确认（explicit 授权）后走真实 PgSyncHub；
// - 同步失败如实显示阶段 + 错误码，绝不显示「已同步」；L0 原始内容不进收件箱。
//
// N8 回退改良（用户 2026-11-10 确认，全页 + 壳层常驻面板共用本组件）：
// - 样式自包含：本文件直接 import personalMemoryPane.css（pmp- 前缀变量，不覆盖宿主全局），
//   因此记忆库全页与壳层常驻面板都自动带上样式，不再依赖宿主是否引入 memoryManagement.css；
// - 改良 ② 所有卡片 / 分区框 / 空态框 / 搜索框 / 下拉 / 按钮 / 徽标统一圆角（9–12px）。
// - 2026-11-21 用户定制：删掉顶部快速记录通栏；左「已确认显示窗」只剩自由输入 textarea +「保存」，
//   保存走真实 quick_add → confirm（已确认语义，参与召回）；召回归属移到页头右侧。
// - 2026-11-21 第二轮：左窗内的搜索框 / 时间范围 / 已确认列表 / 空态 / 统计行全部移除（用户图2 红框），
//   计数并入左窗标题。
// - 2026-11-21 第三轮（用户拍板）：左卡下半部恢复「已保存」常驻列表（保存即出现、刷新仍在、不折叠）；
//   已确认条目逐条标注「每次会话强制召回」。个人记忆不再做「转存到记忆库」：删除上行/重试入口，
//   内核改为 confirmed 全量强制注入（见 agent.ts / personal.ts），页面只保留本机确认与剔除。
// - 2026-11-22 第四轮（用户定稿「就是一张记事本」）：顶部只留一个「保存」；已确认正文常驻显示在编辑框内，
//   用户直接在框内改，点保存写回原条目（不新增重复）。去掉已保存下拉、删除、字数计数与取消编辑。
import './personalMemoryPane.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { kernelErrorText } from '../shared/kernelLoad.tsx';
import { getPersonalPort, type PersonalPort } from '../shared/personalPort.ts';
import type { PersonalEntry } from '../../core/memagent/personalStore.ts';
import type { PersonalReceipt, PersonalSnapshot } from '../../core/memagent/personal.ts';
import { publishNavCount } from '../shared/navCountChannel.ts';

/** 与内核 PERSONAL_MAX_CHARS 同一上限（textarea maxLength / 计数 / 守卫） */
const MAX_NOTE = 4000;

export interface PersonalPaneProps {
  phase: 'loading' | 'ok' | 'error';
  data: PersonalSnapshot | undefined;
  error: string | null;
  onRetry: () => void;
  /** 动作成功后把最新快照回写页面级加载态（页签/导航计数同源） */
  onChanged: (next: PersonalSnapshot) => void;
  /** 窄容器（壳层常驻面板）：双窗改上下堆叠 */
  narrow?: boolean;
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtWhen(ts: number | null): string {
  if (!ts) return '时间未记录';
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function sourceText(e: PersonalEntry): string {
  return e.source === 'agent' ? `来源 agent · ${e.source_agent ?? '未记名'}` : '来源 本机录入';
}

export function PersonalMemoryPane({ phase, data, error, onRetry, onChanged, narrow }: PersonalPaneProps) {
  const portRef = useRef<PersonalPort | null>(null);
  if (!portRef.current) portRef.current = getPersonalPort();
  const port = portRef.current;

  const [noteText, setNoteText] = useState('');
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const confirmed = data?.confirmed ?? [];
  /** 记事本正文 = 已确认条目按存储顺序拼接（单条即原文；多条用空行分隔，保存时逐段写回） */
  const notebookText = confirmed.map((e) => e.content).join('\n\n');
  const baselineRef = useRef<string | null>(null);
  const noteTextRef = useRef(noteText);
  noteTextRef.current = noteText;
  const confirmedRef = useRef(confirmed);
  confirmedRef.current = confirmed;

  // 用户有未保存改动（正文 ≠ 基线）时不覆盖输入；空闲时跟随真实快照刷新。
  useEffect(() => {
    if (baselineRef.current !== null && noteTextRef.current !== baselineRef.current) return;
    if (baselineRef.current === notebookText && noteTextRef.current === notebookText) return;
    baselineRef.current = notebookText;
    setNoteText(notebookText);
  }, [notebookText]);

  /** 保存/重读后把基线同步到真实快照，避免刚写完又被误判成外部变更 */
  const applySnapshotText = useCallback((next: PersonalSnapshot) => {
    const text = next.confirmed.map((e) => e.content).join('\n\n');
    baselineRef.current = text;
    setNoteText(text);
  }, []);

  // 页签/左侧导航的真实待确认计数（未登录或读失败时清 0，不显示假数字）
  useEffect(() => {
    publishNavCount('ledger-personal', phase === 'ok' ? (data?.counts.pending ?? 0) : 0);
  }, [phase, data?.counts.pending]);

  const refresh = useCallback(async (): Promise<PersonalSnapshot | null> => {
    try {
      const next = await port.invoke<PersonalSnapshot>('list');
      onChanged(next);
      return next;
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `重读个人记忆失败：${kernelErrorText(e)}` });
      return null;
    }
  }, [onChanged, port]);

  const act = useCallback(async (op: 'confirm' | 'reject' | 'revoke', entry: PersonalEntry) => {
    setBusy(entry.id);
    setMsg(null);
    try {
      const receipt = await port.invoke<{ request_id: string }>(op, { id: entry.id });
      await refresh();
      setMsg({ kind: 'ok', text: `${op === 'confirm' ? '已确认是我的' : op === 'reject' ? '已剔除（只移出本机视图，账本保留）' : '已撤销，回到待确认'} · request_id ${receipt.request_id}` });
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `动作未生效：${kernelErrorText(e)}` });
    } finally {
      setBusy(null);
    }
  }, [port, refresh]);

  // 记事本「保存」：框内正文就是已确认内容。
  // 0 条 → quick_add + confirm 新建；1 条 → edit 覆盖原 pm:<id>；多条 → 按空行分段逐条写回原条目。
  // 全部走真实数据面并落 personal_memory 审计；绝不追加重复条目。
  const saveNote = useCallback(async () => {
    const text = noteText.trim();
    if (!text) {
      setMsg({ kind: 'warn', text: '内容为空：未保存（不会把空条目写进个人记忆）' });
      return;
    }
    if (text.length > MAX_NOTE) {
      setMsg({ kind: 'warn', text: `内容超过 ${MAX_NOTE} 字：请拆分后再保存` });
      return;
    }
    const entries = confirmedRef.current;
    setBusy('__note__');
    setMsg(null);
    try {
      if (entries.length === 0) {
        const added = await port.invoke<PersonalReceipt>('quick_add', { content: text });
        try {
          const confirmedR = await port.invoke<PersonalReceipt>('confirm', { id: added.entry.id });
          const next = await refresh();
          if (next) applySnapshotText(next);
          setMsg({ kind: 'ok', text: `已保存并确认（参与召回）· request_id ${confirmedR.request_id}` });
        } catch (e: unknown) {
          const next = await refresh();
          if (next) applySnapshotText(next);
          setMsg({
            kind: 'warn',
            text: `已写入个人记忆，但确认失败（仍在待确认）：${kernelErrorText(e)}。可在右窗收件箱再确认一次。`,
          });
        }
        return;
      }
      if (entries.length === 1) {
        if (text === entries[0].content) {
          setMsg({ kind: 'ok', text: '已保存：内容未变化（未新增重复）' });
          return;
        }
        const receipt = await port.invoke<PersonalReceipt>('edit', { id: entries[0].id, content: text });
        const next = await refresh();
        if (next) applySnapshotText(next);
        setMsg({
          kind: 'ok',
          text: `已保存：写回原条目 ${entries[0].id}（未新增重复 · v${receipt.entry.version}）· request_id ${receipt.request_id}`,
        });
        return;
      }
      // 多条已确认：正文按空行分段，逐条写回，条目数与顺序不变
      const parts = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      if (parts.length !== entries.length) {
        setMsg({
          kind: 'warn',
          text: `当前有 ${entries.length} 条已确认记忆：正文需用空行分成 ${entries.length} 段再保存（不新增、不丢条目）`,
        });
        return;
      }
      let lastRid = '';
      let changed = 0;
      for (let i = 0; i < entries.length; i += 1) {
        if (parts[i] === entries[i].content) continue;
        const r = await port.invoke<PersonalReceipt>('edit', { id: entries[i].id, content: parts[i] });
        lastRid = r.request_id;
        changed += 1;
      }
      const next = await refresh();
      if (next) applySnapshotText(next);
      setMsg({
        kind: 'ok',
        text: changed === 0
          ? '已保存：内容未变化'
          : `已保存：逐条写回 ${changed} 条原条目（未新增重复）· request_id ${lastRid}`,
      });
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `未保存：${kernelErrorText(e)}` });
    } finally {
      setBusy(null);
    }
  }, [port, noteText, refresh, applySnapshotText]);

  const pendingQuick = data?.pending.filter((e) => e.source === 'quick_note') ?? [];
  const pendingAgent = data?.pending.filter((e) => e.source === 'agent') ?? [];
  const rejected = data?.rejected ?? [];
  const binding = data?.owner_binding;

  const rootClass = `mm-personal-pane${narrow ? ' pmp-narrow' : ''}`;

  if (phase === 'loading') {
    return (
      <div className={rootClass} data-testid="mm-personal-pane">
        <div className="pmp-empty" data-testid="pm-loading"><b>个人记忆读取中</b><div>正在从本机独立存储读取已确认与收件箱条目…</div></div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className={rootClass} data-testid="mm-personal-pane">
        <div className="pmp-banner warn" data-testid="pm-error">
          <span><b>个人记忆没读到：</b>{error ?? '未知错误'}。这不是「没有个人记忆」，是数据面不可用；未显示任何编造条目。</span>
          <button type="button" className="pmp-btn" onClick={() => { setMsg(null); onRetry(); }} data-testid="pm-retry">重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass} data-testid="mm-personal-pane">
      <div className="pmp-hd">
        <h3>个人记忆</h3>
        {/* 计数与标题同行（2026-11-10：删掉「左/右/数据面」说明行，计数并入标题行并调整宽度） */}
        <span className="pmp-tag mono" data-testid="pm-counts">已确认 {data?.counts.confirmed ?? 0} · 待确认 {data?.counts.pending ?? 0} · 已剔除 {data?.counts.rejected ?? 0}</span>
        {/* 召回归属移到页头右侧（用户 2026-11-21 图2 红框）；信息仍来自真实 owner_binding */}
        {binding ? (
          <span className={`pmp-owner-inline ${binding.bound ? 'ok' : 'warn'}`} data-testid="pm-owner-binding">
            召回归属：内核账号 <b className="mono">{binding.kernel_user_id}</b> · 登录账号 <b className="mono">{binding.login_account}</b> ·{' '}
            {binding.bound
              ? (binding.via === 'same_name' ? '同名直通' : binding.via === 'binding' ? '已按显式绑定映射' : '无内核身份配置，按登录账号口径')
              : '未绑定内核账号 → 本机可用，agent 暂不可召回（不会静默并号）'}
          </span>
        ) : null}
      </div>

      {msg ? (
        <div className={`pmp-msg ${msg.kind}`} data-testid="pm-msg">{msg.text}</div>
      ) : null}

      <div className="pmp-wrap">
        {/* ── 左：整卡即输入区（用户图2 蓝框：卡片撑满可用宽高，保存移到右上角；红框小输入框已取消） ── */}
        <div className="pmp-col pmp-note-col" data-testid="pm-confirmed">
          <div className="pmp-head pmp-head-note">
            <div className="pmp-title">
              已确认显示窗
              <span className="n" data-testid="pm-confirmed-count">{data?.counts.confirmed ?? 0}</span>
            </div>
            {/* 2026-11-22 用户定稿：顶部只留一个「保存」；正文常驻框内，直接改后点保存写回原条目。 */}
            <button
              type="button"
              className="pmp-btn primary pmp-note-save-top"
              disabled={busy === '__note__'}
              onClick={() => void saveNote()}
              data-testid="pm-note-save"
            >{busy === '__note__' ? '保存中…' : '保存'}</button>
          </div>
          <div className="pmp-body pmp-note-body" data-testid="pm-confirmed-list">
            {/* 2026-11-22 记事本形态：已确认正文常驻显示（刷新/重启后仍是真实内容），
                用户直接在框内改，点右上角「保存」写回原条目，不新增重复。 */}
            <textarea
              ref={noteRef}
              className="pmp-note-area"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              maxLength={MAX_NOTE}
              placeholder="在这里写下要记住的个人内容…（支持多行；保存即生效）"
              aria-label="写入个人记忆"
              data-testid="pm-note-input"
              disabled={busy === '__note__'}
            />
          </div>
        </div>

        <div className="pmp-div" />

        {/* ── 右：收件箱（快速记一条已移到顶部通栏） ─────────────────────── */}
        <div className="pmp-col pmp-inbox-col" data-testid="pm-inbox">
          <div className="pmp-head">
            <div className="pmp-title">
              收件箱<span className="n" data-testid="pm-pending-count">{data?.counts.pending ?? 0}</span>
            </div>
          </div>
          <div className="pmp-body" data-testid="pm-inbox-list">
            <section className="pmp-sect" data-testid="pm-sect-quick">
              <h4>本机待确认 · 不进召回 <span className="pmp-sect-n">{pendingQuick.length}</span></h4>
              {pendingQuick.length === 0 ? <div className="pmp-none">没有本机录入待确认</div> : pendingQuick.map((e) => (
                <div className="pmp-item" key={e.id} data-testid={`pm-pending-${e.id}`}>
                  <div className="pmp-item-top">
                    <span className="pmp-src">{sourceText(e)}</span>
                    <span className="pmp-time mono">{fmtWhen(e.delivered_at)}</span>
                    <span className="pmp-badge warn" data-testid={`pm-pending-state-${e.id}`}>待确认 · 不进召回</span>
                  </div>
                  <div className="pmp-item-body">{e.content}</div>
                  <div className="pmp-item-actions">
                    <button type="button" className="pmp-btn primary" disabled={busy === e.id} data-testid={`pm-confirm-${e.id}`} onClick={() => act('confirm', e)}>是我的</button>
                    <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-reject-${e.id}`} onClick={() => act('reject', e)}>不是我的</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pmp-sect" data-testid="pm-sect-agent">
              <h4>待 agent 确认 <span className="pmp-sect-n">{pendingAgent.length}</span></h4>
              {pendingAgent.length === 0 ? <div className="pmp-none">没有 agent 投递待确认条目</div> : pendingAgent.map((e) => (
                <div className="pmp-item" key={e.id} data-testid={`pm-pending-${e.id}`}>
                  <div className="pmp-item-top">
                    <span className="pmp-src">{sourceText(e)}</span>
                    <span className="pmp-time mono">{fmtWhen(e.delivered_at)}</span>
                    <span className="pmp-badge warn" data-testid={`pm-pending-state-${e.id}`}>待确认 · 不进召回</span>
                  </div>
                  <div className="pmp-item-body">{e.content}</div>
                  <div className="pmp-item-actions">
                    <button type="button" className="pmp-btn primary" disabled={busy === e.id} data-testid={`pm-confirm-${e.id}`} onClick={() => act('confirm', e)}>是我的</button>
                    <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-reject-${e.id}`} onClick={() => act('reject', e)}>不是我的</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pmp-sect" data-testid="pm-sect-rejected">
              <h4>已剔除 · 可撤销 <span className="pmp-sect-n">{rejected.length}</span></h4>
              {rejected.length === 0 ? <div className="pmp-none">没有被剔除的条目</div> : rejected.map((e) => (
                <div className="pmp-item rejected" key={e.id} data-testid={`pm-rejected-${e.id}`}>
                  <div className="pmp-item-top">
                    <span className="pmp-src">{sourceText(e)}</span>
                    <span className="pmp-time mono">剔除于 {fmtWhen(e.rejected_at)}</span>
                    <span className="pmp-badge quiet" data-testid={`pm-rejected-state-${e.id}`}>已剔除 · 不进召回</span>
                  </div>
                  <div className="pmp-item-body">{e.content}</div>
                  <div className="pmp-item-actions">
                    <button type="button" className="pmp-btn" disabled={busy === e.id} data-testid={`pm-revoke-${e.id}`} onClick={() => act('revoke', e)}>撤销剔除</button>
                  </div>
                </div>
              ))}
            </section>

            <section className="pmp-rules" data-testid="pm-rules">
              <h4>判定口径</h4>
              <ul>
                <li>只有「已确认且未删除」条目参与召回，且是<strong>每次会话强制召回</strong>：不按相似度阈值过滤、不占 top_k 名额、不受条数上限截断；待确认 / 已剔除 / 已删除不进召回。</li>
                <li>强制召回在内核召回装配层保证：候选集组装完成后直接并入注入列表（pm: 前缀受保护）；项目记忆按分数裁剪时不会挤掉个人记忆。</li>
                <li>注入配额：个人记忆优先占用单次注入预算（3000t），项目记忆让位；个人总量自身超顶时保留全部条目、截短单条正文，条目不会消失。</li>
                <li>个人记忆不做「转存到记忆库 / 团队」：本页不提供上行、重试或晋级入口，条目默认仅本机 + 本人。</li>
                <li>「不是我的」只把条目移出本机视图，不删账本；撤销后回到待确认。</li>
                <li>删除需二次确认，只写墓碑（记录保留），不复用记忆主表。</li>
                <li>L0 原始密文不进收件箱：这里只处理已有可读内容（L1）。</li>
              </ul>
            </section>
          </div>
          <div className="pmp-foot" data-testid="pm-inbox-foot">
            待确认 {data?.counts.pending ?? 0} · 已剔除 {data?.counts.rejected ?? 0} · 本机待确认 {data?.counts.pending_quick ?? 0} · 已确认每次会话强制召回 {data?.counts.confirmed ?? 0}
          </div>
        </div>
      </div>
    </div>
  );
}
