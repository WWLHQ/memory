// 记忆层级管理页（REQ-006 / P8 · 19.11）
// 展示 L0-L6 全部七层；L0 走连续会话（§4.4.3）：管理员=管理密码，被授权账号=grant_id + 一次性密码，
// 5 分钟无操作自动上锁（页面倒计时 + 60s 心跳，主进程空闲回收兜底）。
// 数据来源：真实账本（coreListMemories + coreBrowse），无种子兜底。
// ⚠ 内核读不到（批次25 P0-7）→ 三态加载：显示原因 + 重试；某层 browse 失败也点名，绝不当成「该层为空」。
import React, { useEffect, useState } from 'react';
import { coreListMemories, coreBrowse, coreUpdateContent, openMemoryFile, storageLocation } from './coreMemoryOps.ts';
import { hostCall } from '../../desktop/hostBridge.ts';
import { currentSessionId } from '../shared/session.ts';
import { DEDUP_THRESHOLDS } from '../../core/memagent/layerRules.ts';
import type { MemoryRecord } from './types.ts';
import { decayClass } from './logic.ts';
import { useToast } from './useToast.tsx';
import { KernelLoadError, kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import { DEFAULT_PROJECT_ID, listProjectIds } from '../shared/kernelProjects.ts';
import { useL0Session, formatRemaining } from '../shared/useL0Session.ts';
import { useSessionContext } from '../shared/session.ts';
import { fmtLayerGen } from '../shared/layerTime.ts';
import { LayerFilterBar, LayerPager } from './LayerFilterBar.tsx';
import { publishSelection } from '../shared/selectionChannel.ts';
import { LayerMemoryTable } from './LayerMemoryTable.tsx';
import { filterLayerPaged, initialLayerSource, LAYER_DEFAULT_FILTER } from './layerFilter.ts';
import type { LayerFilterState } from './layerFilter.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import './layeredPage.css';

export type LayerId = 'L6' | 'L5' | 'L4' | 'L3' | 'L2' | 'L1' | 'L0';
// 层色板（批次 E）：与首页层级刻度 STRATA_LAYERS（shell/strataScale.ts）同源——
// L0 #8fa3bc / L1 #22d3ee / L2 #38bdf8 / L3 #818cf8 / L4 #c084fc / L5 #f472b6 / L6 #fbbf24。
// 人机交互：name=这层是什么（大白话），plain=它替你做了什么，desc=内部生成规则（仅 technical 提示，不进卡片正文）
const LAYERS: { id: LayerId; name: string; plain: string; color: string; desc: string; thr: string }[] = [
  { id: 'L6', name: '快速索引', plain: '把每条记忆压成几个关键词，找东西时先看这里，最快命中。', color: '#fbbf24', thr: DEDUP_THRESHOLDS.L6.toFixed(2), desc: '关键字 ≤30 词 + relevance' },
  { id: 'L5', name: '一句话要点', plain: '一句话说清一条记忆到底讲了什么。', color: '#f472b6', thr: DEDUP_THRESHOLDS.L5.toFixed(2), desc: '本质洞察 ≤60 字' },
  { id: 'L4', name: '规律总结', plain: '把几条相关记忆合起来，看出反复出现的规律。', color: '#c084fc', thr: DEDUP_THRESHOLDS.L4.toFixed(2), desc: '规律提炼 ≤120 字' },
  { id: 'L3', name: '经验得失', plain: '从经历里提炼出哪些做法有用、哪些没用。', color: '#818cf8', thr: DEDUP_THRESHOLDS.L3.toFixed(2), desc: '总结得失 ≤200 字' },
  { id: 'L2', name: '对话摘要', plain: '把一大段对话浓缩成几句话，省得重读原文。', color: '#38bdf8', thr: DEDUP_THRESHOLDS.L2.toFixed(2), desc: '情景摘要 ≤300 字' },
  { id: 'L1', name: '清洗后的原文', plain: '去掉敏感信息后的记忆原文——真正喂给回答的就是这一层。', color: '#22d3ee', thr: DEDUP_THRESHOLDS.L1.toFixed(2), desc: '唯一可进 prompt 的原始形态' },
  { id: 'L0', name: '原始对话', plain: '最初写进来的完整记录，加密保存，平时不参与检索。', color: '#8fa3bc', thr: '不适用', desc: 'AES-256 加密，仅授权+密码' },
];

/** layerContent[layer][memId] = content string | null（null 表示该层暂无内容） */
type LayerContentMap = Record<LayerId, Record<string, string | null>>;

export function MemoryLayeredPage({ load = coreListMemories }: { load?: () => Promise<MemoryRecord[]> } = {}) {
  useHostTheme();
  const toast = useToast();

  const ledger = useKernelLoad('memory-layered', load);
  const memories = ledger.data ?? [];
  const [layerContent, setLayerContent] = useState<LayerContentMap>({
    L6: {}, L5: {}, L4: {}, L3: {}, L2: {}, L1: {}, L0: {},
  });
  /** 某些层的 browse 请求失败（≠ 该层没有内容），点名显示 */
  const [layerError, setLayerError] = useState<string | null>(null);
  const { role } = useSessionContext();
  const [l0Pwd, setL0Pwd] = useState('');
  const [l0GrantId, setL0GrantId] = useState('');
  const [l0Msg, setL0Msg] = useState<string>('状态：已锁定（L0 不参与检索，仅授权查阅）');
  // 批次27 P2-7：默认申请项目从账本真实派生；空账本回落默认占位项目
  const [reqProjects, setReqProjects] = useState(DEFAULT_PROJECT_ID);
  useEffect(() => {
    void listProjectIds().then((ps) => {
      if (ps.length > 0) setReqProjects(ps.join(', '));
    });
  }, []);
  const [reqReason, setReqReason] = useState('');
  const [reqMsg, setReqMsg] = useState<string | null>(null);

  const clearL0Content = React.useCallback(() => {
    setLayerContent((prev) => ({ ...prev, L0: {} }));
  }, []);
  const l0Session = useL0Session({
    onExpired: (reason) => {
      clearL0Content();
      setL0Msg(reason === 'idle_5min'
        ? '状态：已因 5 分钟无操作锁定 · 需重新申请/解锁'
        : '状态：会话已被主进程回收（重启/锁屏/休眠） · 需重新申请/解锁');
      toast.show('L0 已自动锁定');
    },
  });
  const l0Unlocked = !!l0Session.session;

  const [selectedMemId, setSelectedMemId] = useState<string | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<LayerId | null>(null);
  const [loc, setLoc] = useState<{ kind: string; path?: string; source: string } | null>(null);
  /** 层内容重读触发器（异常层处理里的「重试读取」真实重跑 coreBrowse，不是只刷新 UI） */
  const [browseTick, setBrowseTick] = useState(0);
  // all / collected / manual / webhook / mcp（全局来源快捷过滤）；D4 深链 ?source= 在此生效
  const [filterSource, setFilterSource] = useState<string>(() => initialLayerSource(location.search));

  // 每层独立的过滤 + 分页状态（默认每页 5 条）
  const [layerFilters, setLayerFilters] = useState<Record<LayerId, LayerFilterState>>({
    L6: LAYER_DEFAULT_FILTER, L5: LAYER_DEFAULT_FILTER, L4: LAYER_DEFAULT_FILTER,
    L3: LAYER_DEFAULT_FILTER, L2: LAYER_DEFAULT_FILTER, L1: LAYER_DEFAULT_FILTER,
    L0: LAYER_DEFAULT_FILTER,
  });
  function setLayerFilter(layer: LayerId, next: LayerFilterState) {
    setLayerFilters((prev) => ({ ...prev, [layer]: next }));
  }

  /** 某层经「全局来源过滤 + 层内过滤 + 分页 + 该层有内容」后的可见条目 */
  function pagedForLayer(layer: LayerId) {
    const f = layerFilters[layer];
    const hasContent = (m: MemoryRecord) => {
      const c = layerContent[layer]?.[m.id];
      return !!c && c.trim().length > 0;
    };
    // 基准列表 = 全局来源过滤后的 visibleMemories（层内 source 过滤在 filterLayerPaged 内叠加）
    return filterLayerPaged(visibleMemories, f, { page: f.page, pageSize: f.pageSize }, hasContent);
  }

  /** 记忆是否来自采集通道（§19.3）：source_agent 非空且非 manual */
  function isCollected(m: MemoryRecord): boolean {
    const src = m.source_agent ?? '';
    return src !== '' && src !== 'manual';
  }

  /** 按采集来源过滤后的记忆列表 */
  const visibleMemories = filterSource === 'all'
    ? memories
    : filterSource === 'collected'
      ? memories.filter(isCollected)
      : memories.filter((m) => m.source_agent === filterSource);

  // 账本到手后再并行拉 L1–L6 层内容（内核读不到时不拉，错误态由 ledger 呈现）
  const { phase } = ledger;
  useEffect(() => {
    if (phase !== 'ok') return;
    let alive = true;
    void storageLocation().then(
      (l) => { if (alive) setLoc(l); },
      () => { if (alive) setLoc(null); },
    );

    const layers: LayerId[] = ['L6', 'L5', 'L4', 'L3', 'L2', 'L1'];
    void Promise.allSettled(layers.map((layer) => coreBrowse(layer))).then((results) => {
      if (!alive) return;
      setLayerContent((prev) => {
        const next = { ...prev };
        layers.forEach((layer, i) => {
          const r = results[i];
          if (r.status === 'fulfilled' && r.value) {
            const map: Record<string, string | null> = {};
            for (const row of r.value.rows) map[row.mem_id] = row.content;
            next[layer] = map;
          }
        });
        return next;
      });
      const failed = layers.filter((_, i) => results[i].status === 'rejected');
      if (failed.length === 0) setLayerError(null);
      else {
        const reason = kernelErrorText((results[layers.indexOf(failed[0])] as PromiseRejectedResult).reason);
        setLayerError(`${failed.join('、')} 层内容没读到（不是该层为空）：${reason}`);
      }
    });
    return () => { alive = false; };
  }, [phase, browseTick]);

  /** 解锁 L0：管理员仅管理密码；被授权账号需 grant_id + 一次性授权密码（§4.4.2） */
  async function handleUnlock() {
    if (l0Pwd.length < 8) {
      toast.show('L0 密码至少 8 位（§4.4.1）');
      return;
    }
    if (role === 'member' && !l0GrantId.trim()) {
      toast.show('普通成员请先提交申请，并输入管理员发放的 grant_id');
      return;
    }
    const u = await l0Session.unlock(l0Pwd, role === 'member' ? l0GrantId : undefined);
    if (!u.ok) {
      toast.show(`L0 授权失败：${u.error}`);
      setL0Msg(`状态：授权失败（已记审计） · ${u.error}`);
      return;
    }
    const result = await coreBrowse('L0', u.session.l0_session_id);
    if (!result) {
      await l0Session.lock();
      setL0Msg('状态：授权失败或会话已过期 · 请重新解锁');
      return;
    }
    const map: Record<string, string | null> = {};
    for (const row of result.rows) {
      map[row.mem_id] = row.content;
    }
    setLayerContent((prev) => ({ ...prev, L0: map }));
    setL0Pwd('');
    setL0Msg(`状态：已解锁（连续会话 · 每次查阅记 l0_view 审计） · 剩余 ${formatRemaining(u.session.idle_timeout_ms)}`);
    toast.show('L0 已解锁：空闲 5 分钟自动锁定');
  }

  /** 主动锁定 L0（清会话 + wrapped DEK 删除） */
  async function handleLock() {
    await l0Session.lock();
    setL0Pwd('');
    clearL0Content();
    setL0Msg('状态：已锁定 [L0 已加密 · 需授权]');
  }

  // 口径一本人直读（2026-11-17 用户拍板）：解锁写密钥后免审批直读本人 L0 原文。
  // 归属校验在主进程（blob 元数据 owner === 登录账号）；他人条目仍拒（须申请授权）。
  const [selfBusy, setSelfBusy] = useState(false);
  async function handleSelfBrowse() {
    setSelfBusy(true);
    try {
      const r = await hostCall<{ ok: true; mine: number; decrypted: number; locked: boolean; no_owner?: number; rows: Array<{ mem_id: string; content: string }> }
        | { ok: false; error: string; locked?: boolean }>('l0:selfBrowse', [currentSessionId()]);
      if (!r || r.ok !== true) {
        const msg = r && !r.ok ? r.error : '本人直读通道不可用（宿主桥未就绪）';
        setL0Msg(`状态：本人直读未生效 · ${msg}`);
        toast.show(`本人直读未生效：${msg}`);
        return;
      }
      const map: Record<string, string | null> = {};
      for (const row of r.rows) map[row.mem_id] = row.content;
      setLayerContent((prev) => ({ ...prev, L0: map }));
      const noOwner = r.no_owner ?? 0;
      const noOwnerNote = noOwner > 0
        ? `；另有 ${noOwner} 条存量无归属（可在安全页「存量 L0 归属回填」卡回填后直读）`
        : '';
      setL0Msg(`状态：本人直读完成 · 归属本人 ${r.mine} 条，已解出 ${r.decrypted} 条${noOwnerNote}（他人条目仍需授权 §4.4.2）`);
      toast.show(`已直读本人 L0 原文 ${r.decrypted} 条${noOwner > 0 && r.decrypted === 0 ? `（存量 ${noOwner} 条无归属，先去安全页回填）` : ''}`);
    } catch (e) {
      setL0Msg(`状态：本人直读失败 · ${String((e as Error)?.message ?? e)}`);
    } finally {
      setSelfBusy(false);
    }
  }

  /** 非管理员提交查阅申请；管理员在「账号与安全」页批准并发放一次性密码 */
  async function handleRequest() {
    const ids = reqProjects.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      setReqMsg('请填写项目 ID（逗号分隔）');
      return;
    }
    const r = await l0Session.requestAccess(ids, reqReason.trim() || undefined);
    setReqMsg(r.ok
      ? `已提交申请 ${r.request_id}：等待管理员批准后输入 grant_id + 一次性授权密码`
      : `申请失败：${r.error}`);
  }

  /** 点击记忆条目 → 打开右侧详情 */
  function handleSelectMem(memId: string, layer: LayerId) {
    setSelectedMemId(memId);
    setSelectedLayer(layer);
  }

  const selectedMem = visibleMemories.find((m) => m.id === selectedMemId) ?? null;

  // S4：把层级页当前选中的真实记忆回传给壳层属性检查器
  useEffect(() => {
    if (!selectedMem || !selectedLayer) {
      publishSelection(null);
      return;
    }
    const layerText = layerContent[selectedLayer]?.[selectedMem.id];
    const contentLen = layerText ? layerText.length : 0;
    publishSelection({
      v: 1,
      page: 'memory-layered.html',
      title: `记忆 ${selectedMem.id} · ${selectedLayer}`,
      subtitle: `分层查阅选中项 · 数据真相 = 本机账本`,
      fields: [
        { k: 'ID', v: selectedMem.id, mono: true },
        { k: '当前查阅层', v: selectedLayer },
        { k: '内核层级', v: selectedMem.layer ?? '未记录（内核未给 layer）' },
        { k: '状态', v: selectedMem.status },
        { k: '来源', v: selectedMem.source_agent ? selectedMem.source_agent : 'manual（手动写入页）' },
        { k: '该层内容', v: layerText ? `${contentLen} 字` : '该层暂无内容（账本真实为空）' },
        { k: '更新时间', v: selectedMem.updated_at },
      ],
    });
  }, [selectedMem, selectedLayer, layerContent]);

  /**
   * 保存 = 真写内核账本（批次25 P0-1）。旧实现只 dispatchEvent('layered-memory-save')，
   * 全仓无监听 → 页面看似已保存、账本纹丝不动。
   * 写回走 coreUpdateContent：过 L0→L1 质量门 → 主内容 + 该记忆自身最深层同步、version+1、
   * 重算 sha256（L1 还重算向量）→ 落 memory_op 审计；拒绝原因原样回给面板显示。
   */
  async function handleLayerSave(layer: LayerId, next: MemoryRecord): Promise<{ ok: boolean; error?: string }> {
    const res = await coreUpdateContent(next.id, next.content);
    if (!res.ok || !res.rec) return { ok: false, error: res.error ?? '保存失败（内核未写回）' };
    const rec = res.rec;
    ledger.replace((list) => list.map((m) => (m.id === rec.id ? rec : m)));
    setLayerContent((prev) => ({ ...prev, [layer]: { ...prev[layer], [rec.id]: rec.content } }));
    if (rec.layer === 'L1') setLayerContent((prev) => ({ ...prev, L1: { ...prev.L1, [rec.id]: rec.content } }));
    toast.show('已保存修改（写回本机记忆账本 + memory_op 审计）。');
    return { ok: true };
  }

  // ── 真实读数（全部从 coreBrowse 层内容 + 账本派生；取不到就写未采样，不造数） ──
  const shownLayers: Exclude<LayerId, 'L0'>[] = ['L6', 'L5', 'L4', 'L3', 'L2', 'L1'];
  /** 该层有真实内容的记忆条数（layerContent 来自 coreBrowse，null/空串不算） */
  function layerFilled(id: LayerId): number {
    const map = layerContent[id] ?? {};
    return Object.keys(map).filter((k) => {
      const c = map[k];
      return !!c && c.trim().length > 0;
    }).length;
  }
  /** 记忆自身最深层落在该层的条数（rec.layer） */
  function layerOwn(id: LayerId): number {
    return memories.filter((m) => (m.layer ?? 'L1') === id).length;
  }
  /** 该层最近一次内容写入（取含该层内容的记忆 updated_at 最大值；账本无层级时间戳） */
  function layerLastWrite(id: LayerId): string | null {
    const map = layerContent[id] ?? {};
    let best: string | null = null;
    for (const m of memories) {
      const c = map[m.id];
      if (!c || !c.trim()) continue;
      const t = Date.parse(m.updated_at);
      if (!Number.isFinite(t)) continue;
      if (!best || t > Date.parse(best)) best = m.updated_at;
    }
    return best;
  }
  function fmtWhen(iso: string | null): string {
    if (!iso) return '未记录';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '时间不可读';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const l1Filled = layerFilled('L1');
  const derivedFilled = shownLayers.filter((i) => i !== 'L1').reduce((n, i) => n + layerFilled(i), 0);
  const missingLayer = memories.filter((m) => !m.layer).length;
  const lockedMemories = memories.filter((m) => m.locked).length;
  const flowMax = Math.max(memories.length, 1);
  function jumpTo(id: LayerId): void {
    const el = document.getElementById(`layer-block-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** L0 授权框：管理员=管理密码；被授权账号=grant_id + 一次性密码；成员可就地申请（§4.4.2） */
  const l0Bar = (
    <div className="l0bar" id="l0bar" data-testid="l0-bar" style={{ flexWrap: 'wrap' }}>
      <span style={{ fontSize: 16 }}>🔐</span>
      <label htmlFor="l0pwd">
        L0 原始层查阅授权（{role === 'admin' ? '管理员 · 管理密码' : role === 'member' ? '被授权账号 · grant_id + 一次性密码' : '未登录 · 登录后生效'}）
      </label>
      {!l0Unlocked && role !== null && (
        <>
          {role === 'member' && (
            <input
              id="l0grant"
              type="text"
              placeholder="grant_id（管理员发放）"
              data-testid="l0-grant-id"
              value={l0GrantId}
              style={{ width: 210 }}
              onChange={(e) => setL0GrantId(e.target.value)}
            />
          )}
          <input
            id="l0pwd"
            type="password"
            placeholder={role === 'admin' ? '输入 L0 管理密码' : '输入一次性授权密码'}
            data-testid="l0-pwd"
            value={l0Pwd}
            onChange={(e) => setL0Pwd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleUnlock(); }}
          />
          <button className="btn primary" id="l0-unlock" data-testid="l0-unlock" disabled={l0Session.busy} onClick={() => void handleUnlock()}>
            解锁 L0
          </button>
        </>
      )}
      {l0Unlocked && (
        <>
          <span className="status active" data-testid="l0-countdown" style={{ fontSize: 11 }}>
            已解锁 · 剩余 {formatRemaining(l0Session.remainingMs)}（空闲 5 分钟自动锁定）
          </span>
          <button className="btn" id="l0-lock" data-testid="l0-lock" onClick={() => void handleLock()}>
            立即锁定
          </button>
        </>
      )}
      <span data-testid="l0-status" style={{ fontSize: 11, color: 'var(--muted)' }}>{l0Msg}</span>
      {role !== null && !l0Unlocked && (
        <div className="row" data-testid="l0-self-read" style={{ width: '100%', alignItems: 'center' }}>
          <button className="btn" data-testid="l0-self-browse" disabled={selfBusy} onClick={() => void handleSelfBrowse()}>
            {selfBusy ? '直读中…' : '本人直读（免审批）'}
          </button>
          <span className="note" style={{ fontSize: 11, color: 'var(--muted)' }}>
            先在安全页解锁写密钥，即可直读<b>本人</b>的 L0 原文；查阅他人的仍须申请授权
          </span>
        </div>
      )}
      {role === 'member' && !l0Unlocked && (
        <div className="row" data-testid="l0-request" style={{ width: '100%' }}>
          <input
            type="text" placeholder="项目 ID（逗号分隔）" data-testid="l0-req-projects" value={reqProjects}
            style={{ width: 140 }} onChange={(e) => setReqProjects(e.target.value)}
          />
          <input
            type="text" placeholder="申请理由" data-testid="l0-req-reason" value={reqReason}
            style={{ width: 180 }} onChange={(e) => setReqReason(e.target.value)}
          />
          <button className="btn" data-testid="l0-req-submit" onClick={() => void handleRequest()}>提交查阅申请</button>
          {reqMsg && <span className="note" data-testid="l0-req-msg">{reqMsg}</span>}
        </div>
      )}
    </div>
  );

  return (
    <div className="p0-page layered-page" data-testid="layered-memory-page">
      <div className="af-head" data-testid="layered-head">
        <h1>层级管理</h1>
        <span className="sub">L1–L6 精炼分层 · L0 原始层需授权 · 数据真相 = 本机账本（coreListMemories + coreBrowse）</span>
        <span className="right">
          <span className="p0-tag info">{memories.length} 条记忆</span>
          <span className="p0-tag">{l0Unlocked ? 'L0 已解锁' : 'L0 已锁定'}</span>
          {!l0Unlocked && (
            <button
              type="button"
              className="btn"
              data-testid="layered-goto-l0"
              onClick={() => document.getElementById('l0bar')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            >
              去授权 L0
            </button>
          )}
        </span>
      </div>

      {/* ── 摘要读数条：回答「现在分层里有多少东西、缺哪层」 ── */}
      <section className="af-panel" data-testid="layered-summary">
        <div className="af-ph"><h3>分层摘要</h3><span className="hint">账本快照 · 非示例数据</span></div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat">
              <div className="k">记忆总数 <span>ledger</span></div>
              <div className="v">{memories.length}</div>
              <div className="d mut">来源过滤后 {visibleMemories.length} 条</div>
            </div>
            <div className="af-stat">
              <div className="k">L1 已生成 <span>coreBrowse</span></div>
              <div className="v">{l1Filled}<em>/{memories.length}</em></div>
              <div className="d mut">唯一可进 prompt 的原始形态</div>
            </div>
            <div className="af-stat">
              <div className="k">L2–L6 已生成 <span>coreBrowse</span></div>
              <div className="v">{derivedFilled}</div>
              <div className={derivedFilled > 0 ? 'd' : 'd mut'}>
                {derivedFilled > 0 ? '上层派生内容合计（同一条可多层级计）' : '尚无派生内容：未接 LLM 时不生成占位文本'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">L0 原始层 <span>加密</span></div>
              <div className="v">{l0Unlocked ? layerFilled('L0') : '未授权'}</div>
              <div className={l0Unlocked ? 'd' : 'd mut'}>{l0Unlocked ? '本次连续会话已解锁' : '需管理密码 / grant_id + 一次性密码'}</div>
            </div>
          </div>
          <div className={layerError ? 'af-note bad' : 'af-note'} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>
              {layerError
                ? layerError
                : '层内容读取自 coreBrowse；账本只有记忆 updated_at，没有逐层写入时间，因此「最近写入」取含该层内容的记忆最后更新时间。'}
            </span>
            {layerError && (
              <button type="button" className="btn" data-testid="layered-retry-browse" onClick={() => setBrowseTick((t) => t + 1)}>重试读取</button>
            )}
          </div>
        </div>
      </section>

      {/* ── 三列网格：L6→L1 每层一张语义卡（定义 / 条数 / 规则 / 可执行的定位动作） ── */}
      <div className="af-g3" data-testid="layered-layer-grid">
        {LAYERS.filter((l) => l.id !== 'L0').map((L) => {
          const filled = layerFilled(L.id);
          const own = layerOwn(L.id);
          const canEdit = L.id === 'L1' || own > 0;
          return (
            <section className="af-panel layer-sem" key={L.id} data-testid={`layer-card-${L.id}`} data-layer={L.id}>
              <div className="af-ph">
                <span className="layer-dot" style={{ background: L.color }} />
                <h3 style={{ color: L.color }}>{L.id} · {L.name}</h3>
              </div>
              <div className="af-pb">
                <p className="af-q">{L.plain}</p>
                <div className="layer-mini">
                  <span>已有内容 <b>{filled}</b> 条</span>
                  <span>最近更新 <b>{fmtWhen(layerLastWrite(L.id))}</b></span>
                </div>
                <p className="af-note">
                  {canEdit ? '这一层可以直接改。' : '这一层由系统自动生成，这里只能查看。'}
                  数字来自真实账本，读不到会明确告诉你，不会当空层。
                </p>
                <div className="layer-actions">
                  <button type="button" className="btn" data-testid={`layered-jump-${L.id}`} onClick={() => jumpTo(L.id)}>
                    查看这层的 {filled} 条内容
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {/* ── 层间流动（整行；异常层处理卡已按用户要求移除，读取失败/重试内联在摘要里） ── */}
      <section className="af-panel" data-testid="layered-flow">
          <div className="af-ph"><h3>层间流动 · L1 → L6</h3><span className="hint">各层有内容的记忆条数 / 总数 {memories.length}</span></div>
          <div className="af-pb">
            <div className="layer-flow">
              {shownLayers.map((id) => {
                const L = LAYERS.find((x) => x.id === id)!;
                const n = layerFilled(id);
                return (
                  <div className="flow-row" key={id}>
                    <span className="flow-id" style={{ color: L.color }}>{id}</span>
                    <span className="flow-name">{L.name}</span>
                    <span className="flow-bar"><i style={{ width: `${Math.round((n / flowMax) * 100)}%`, background: L.color }} /></span>
                    <span className="flow-n">{n}</span>
                  </div>
                );
              })}
            </div>
            <p className="af-note">
              流动规则：L1 由写入 / 采集产生，是唯一可进 prompt 的原始形态；L2–L6 由精炼链路从下层向上生成。
              层本身不按时间衰减——降温、归档、弃用由生命周期页管理。
              数据侧写：未标层 {missingLayer} 条 · 锁定 {lockedMemories} 条。
            </p>
            <div className="layer-actions">
              <a className="btn" href="/lifecycle.html" data-testid="layered-goto-lifecycle">去生命周期页处理衰减/归档</a>
            </div>
          </div>
        </section>

      {phase === 'loading' && (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--dim)' }}>
          加载中…
        </div>
      )}
      {phase === 'error' && (
        <KernelLoadError what="读取记忆账本" error={ledger.error} onRetry={ledger.retry} />
      )}
      {phase === 'ok' && layerError && (
        <div className="card" data-testid="layer-load-error" style={{ borderLeft: '3px solid #ff5c5c', fontSize: 12 }}>
          ⚠ {layerError}
        </div>
      )}
      {phase === 'ok' && (
        <>
          <section className="af-panel" data-testid="layered-workbench">
            <div className="af-ph">
              <h3>分层查阅与编辑</h3>
              <span className="hint">点条目在右侧阅读/编辑 · 保存 = 真写内核账本 + memory_op 审计</span>
            </div>
            <div className="af-pb layered-workbench-body">
          {memories.length === 0 ? (
            <div className="cols">
              <div className="left-col">
                <div className="card" data-testid="memory-empty" style={{ padding: 36, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🗂️</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>记忆账本还是空的</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                    这里只显示真实记忆数据（来自本机账本 / 各端写入）。<br />
                    去「✍️ 写入页」写下第一条记忆，或让 Agent 在对话中自动沉淀。
                  </div>
                  <button
                    className="btn primary"
                    data-testid="goto-write"
                    type="button"
                    onClick={() => { window.location.href = '/write.html'; }}
                  >
                    → 去写入页产生真实记忆
                  </button>
                </div>
                {l0Bar}
              </div>
              <div className="detail" data-testid="detail">
                <div className="empty-detail">← 写入记忆后，点左侧任意层中的条目，在此打开阅读与编辑该层内容。</div>
              </div>
            </div>
          ) : (
            <div className="cols">
              {/* 左列：层卡片堆叠 */}
              <div className="left-col">
                {/* 采集来源过滤栏（§19.3 双通道） */}
                <div className="layer-toolbar" data-testid="source-filter">
                  <span style={{ fontSize: 12, fontWeight: 600, marginRight: 8 }}>📡 采集来源</span>
                  {(['all', 'collected', 'manual', 'webhook', 'mcp'] as const).map((opt) => (
                    <button
                      key={opt}
                      className={`btn${filterSource === opt ? ' primary' : ''}`}
                      data-testid={`filter-${opt}`}
                      style={{ fontSize: 11, padding: '2px 8px', margin: '0 3px' }}
                      onClick={() => setFilterSource(opt)}
                    >
                      {opt === 'all' ? '全部' : opt === 'collected' ? '⚡ 采集' : opt === 'manual' ? '✍️ 手动' : opt === 'webhook' ? '⚡ Webhook' : '🔌 MCP'}
                    </button>
                  ))}
                  {filterSource !== 'all' && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>
                      {visibleMemories.length} / {memories.length} 条
                    </span>
                  )}
                </div>

                {/* L6→L1 层卡片 */}
                {LAYERS.filter((l) => l.id !== 'L0').map((L) => {
                  const paged = pagedForLayer(L.id);
                  return (
                    <div key={L.id} className="layer" id={`layer-block-${L.id}`} data-layer={L.id}>
                      <div className="layer-head">
                        <span className="dot" style={{ background: L.color }} />
                        <h2 style={{ color: L.color, margin: 0 }}>{L.id} · {L.name}</h2>
                        <span className="tag">{L.desc}</span>
                        <span className="thr">阈值 {L.thr}</span>
                        <span className="count">{paged.total} / {visibleMemories.length} 条</span>
                      </div>
                      <LayerFilterBar
                        layer={L.id}
                        state={layerFilters[L.id]}
                        onChange={(next) => setLayerFilter(L.id, next)}
                      />
                      <div className="layer-body">
                        {paged.items.length === 0 ? (
                          <div className="empty" data-testid={`${L.id}-empty`}>该层无符合条件的记忆</div>
                        ) : (
                          <LayerMemoryTable
                            layerId={L.id}
                            memories={paged.items}
                            layerContent={layerContent[L.id]}
                            selectedId={selectedMemId}
                            onSelect={(memId, layer) => handleSelectMem(memId, layer)}
                          />
                        )}
                      </div>
                      <LayerPager
                        layer={L.id}
                        state={layerFilters[L.id]}
                        total={paged.total}
                        totalPages={paged.totalPages}
                        onChange={(next) => setLayerFilter(L.id, next)}
                      />
                    </div>
                  );
                })}

                {/* L0 卡片容器：默认隐藏，解锁后渲染 */}
                <div id="l0Stack" data-testid="l0-stack" style={{ display: l0Unlocked ? '' : 'none' }}>
                  {l0Unlocked && (() => {
                    const L = LAYERS.find((l) => l.id === 'L0')!;
                    const paged = pagedForLayer('L0');
                    return (
                      <div className="layer" data-layer="L0">
                        <div className="layer-head">
                          <span className="dot" style={{ background: L.color }} />
                          <h2 style={{ color: L.color, margin: 0 }}>{L.id} · {L.name}</h2>
                          <span className="tag">{L.desc}</span>
                          <span className="thr">阈值 —</span>
                          <span className="count">{paged.total} / {visibleMemories.length} 条</span>
                          <button
                            className="btn"
                            style={{ marginLeft: 8, fontSize: 11 }}
                            data-testid="l0-exit"
                            onClick={handleLock}
                            title="退出 L0 并上锁"
                          >
                            退出
                          </button>
                        </div>
                        <LayerFilterBar
                          layer="L0"
                          state={layerFilters.L0}
                          onChange={(next) => setLayerFilter('L0', next)}
                        />
                        <div className="layer-body">
                          {paged.items.length === 0 ? (
                            <div className="empty" data-testid="L0-empty">该层无符合条件的记忆</div>
                          ) : (
                            <LayerMemoryTable
                              layerId="L0"
                              memories={paged.items}
                              layerContent={layerContent.L0}
                              selectedId={selectedMemId}
                              onSelect={(memId, layer) => handleSelectMem(memId, layer)}
                            />
                          )}
                        </div>
                        <LayerPager
                          layer="L0"
                          state={layerFilters.L0}
                          total={paged.total}
                          totalPages={paged.totalPages}
                          onChange={(next) => setLayerFilter('L0', next)}
                        />
                      </div>
                    );
                  })()}
                </div>

                {/* L0 授权框：紧贴 L1 卡片下方，与层卡片同宽（left-col 宽度）、同距（gap 12px） */}
                {l0Bar}
              </div>

              {/* 右列：详情/编辑（窄窗口由 CSS 转为悬浮抽屉，点选即见） */}
              <div className={`detail${selectedMem ? ' detail-open' : ''}`} data-testid="detail">
                {!selectedMem ? (
                  <div className="empty-detail">← 点左侧任意层中的记忆条目，在此打开阅读与编辑该层内容。</div>
                ) : (
                  <DetailPanel
                    rec={selectedMem}
                    layer={selectedLayer!}
                    content={layerContent[selectedLayer!]?.[selectedMem.id] ?? selectedMem.content}
                    location={loc}
                    isL0={selectedLayer === 'L0'}
                    // L0 原文落盘为 v2 密文：页面只读展示，避免把明文写回 content 破坏加密边界
                    // 非自身最深层 = 派生视图：写回只能作用于主内容 + 该记忆自己的层级，否则会把摘要文本灌进 L1
                    readOnly={selectedMem.locked || selectedLayer === 'L0' || selectedLayer !== (selectedMem.layer ?? 'L1')}
                    derivedFrom={selectedLayer !== 'L0' && selectedLayer !== (selectedMem.layer ?? 'L1') ? (selectedMem.layer ?? 'L1') : null}
                    onBack={() => { setSelectedMemId(null); setSelectedLayer(null); }}
                    onSave={(next) => handleLayerSave(selectedLayer!, next)}
                    onOpenFile={() => {
                      void (async () => {
                        const r = await openMemoryFile(selectedMem.id);
                        if (r.ok) toast.show(`已打开：${r.path}`);
                        else toast.show(`无法打开文件：${r.error}`);
                      })();
                    }}
                  />
                )}
              </div>
            </div>
          )}
            </div>
          </section>

          <section className="af-panel" data-testid="layered-rules">
            <div className="af-ph"><h3>规则与边界</h3><span className="hint">层语义 · 显示 · 连续查阅 · 编辑</span></div>
            <div className="af-pb layer-rules-grid">
              <div>
                <b>层语义（§2.1）</b>
                <p>L6 关键字投影（≤30 词 + relevance）· L5 洞察提炼（≤60 字）· L4 模式归纳（≤120 字）· L3 得失分析（≤200 字）· L2 会话摘要（≤300 字）· L1 清洗脱敏（唯一可进 prompt 的原始形态）· L0 原始对话（AES-256 加密，仅授权+密码）。</p>
              </div>
              <div>
                <b>显示与 L0</b>
                <p>L6→L1 始终可见；L0 授权框固定显示在 L1 明细之后，管理员用管理密码、被授权账号用 grant_id + 一次性密码解锁后，L0 卡片出现在授权框上方（连续会话，每次 l0_view 写审计）。</p>
              </div>
              <div>
                <b>连续查阅</b>
                <p>空闲 <b>5 分钟</b>自动锁定（页面倒计时 + 60s 心跳，主进程空闲回收兜底）；锁定后 wrapped DEK 删除，再次查阅须重新解锁，成员需重新申请。</p>
              </div>
              <div>
                <b>编辑规则</b>
                <p>只有记忆<b>自身的最深层</b>可编辑（保存 = 写主内容 + 该层，version+1、重算 sha256／L1 向量，并落 <code>memory_op</code> 审计）；上层是派生视图只读并提示应去哪层改；L0 只读（v2 密文）；locked 记忆内容只读。被内核拒绝（空内容／未过质量门／已锁定）时显示原因，草稿保留、账本不动。</p>
              </div>
              <div>
                <b>当前阶段</b>
                <p>尚未接入真实 LLM：写入只生成 L1 清洗脱敏内容（列表标「未精炼」），L2–L6 不生成占位文本、各层显示「该层暂无内容」；接入后替换内核 <code>generateRefinedContent</code> 单点即可生成 L2–L6。</p>
              </div>
            </div>
          </section>
        </>
      )}

      {toast.node}
    </div>
  );
}

/** 详情面板子组件 */
function DetailPanel({
  rec,
  layer,
  content,
  location,
  isL0,
  readOnly,
  derivedFrom,
  onBack,
  onSave,
  onOpenFile,
}: {
  rec: MemoryRecord;
  layer: LayerId;
  content: string;
  location: { kind: string; path?: string; source: string } | null;
  isL0: boolean;
  readOnly: boolean;
  /** 非 null = 当前查看的是派生层（该记忆自身最深层是它），编辑须回到那一层 */
  derivedFrom: LayerId | null;
  onBack: () => void;
  /** 真写内核；失败必须把原因带回面板显示（不得静默） */
  onSave: (next: MemoryRecord) => Promise<{ ok: boolean; error?: string }>;
  onOpenFile: () => void;
}) {
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => { setDraft(content); setSaveError(null); }, [content]);

  const dirty = draft !== content;
  const editable = !readOnly;

  async function save() {
    if (!dirty || !editable || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await onSave({ ...rec, content: draft });
      // 失败：草稿保留、原因可见 —— 绝不让用户以为已经写进账本
      if (!res.ok) setSaveError(res.error ?? '保存失败（内核未写回）');
    } catch (e) {
      setSaveError(`保存失败：${String((e as Error)?.message ?? e)}`);
    } finally {
      setSaving(false);
    }
  }

  const layerInfo = LAYERS.find((l) => l.id === layer)!;
  const temp = decayClass(rec);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 13 }}>
          📖 {layerInfo.name}
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--accent)', marginLeft: 8 }}>{rec.id}</span>
        </h3>
        <button className="btn" data-testid="detail-close" onClick={onBack}>关闭</button>
      </div>
      <div className="kv">
        <b>类型</b><span>{rec.type}</span>
        <b>温度 / 状态</b><span><span className={`temp ${temp}`}>{temp}</span> · active</span>
        <b>标记</b><span>{rec.pinned && '📌置顶 '}
          {rec.locked && '🔒锁定 '}
          {rec.archived && '🗄️归档 '}
          {!rec.pinned && !rec.locked && !rec.archived && ''}</span>
        <b>标签</b><span>{rec.tags.join(', ') || '无'}</span>
        <b>该层阈值</b><span style={{ fontFamily: 'monospace' }}>{layerInfo.thr}</span>
        <b>存储位置</b>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all' }} data-testid="store-location">
          {location?.kind === 'file' ? `本机账本 · ${location.path}` :
           location?.kind === 'memory' ? (location.source === 'http-backend'
             ? `登录后端账本（只读镜像）· ${location.path ?? ''}`
             : '浏览器内存态（未落盘）') : '账本位置未知'}
        </span>
        <b>访问 / 强化</b><span>{rec.access_count} / {rec.reinforce_count}</span>
        <b>合并谱系</b><span>{rec.merged_from ? `合并自 ${rec.merged_from.join(', ')}` : rec.merged_into ? `并入 ${rec.merged_into}` : '无'}</span>
        <b>创建 / 更新</b><span>{new Date(rec.created_at).toLocaleString()} / {new Date(rec.updated_at).toLocaleString()}</span>
        <b>层级生成</b><span data-testid="layered-layer-gen-at">{fmtLayerGen(rec.layers_generated_at)}</span>
      </div>

      {rec.locked && (
        <div className="mask-banner" style={{ background: '#2a2310', borderColor: '#6b5a1e', color: '#ffe6a8' }}>
          🔒 该记忆已锁定（G4）：内容只读，请先解锁。
        </div>
      )}
      {derivedFrom && (
        <div className="mask-banner" data-testid="derived-note" style={{ background: '#12203a', borderColor: '#2b4a7a', color: '#bfe0ff' }}>
          📐 {layer} 是派生视图：这条记忆自身的最深层是 <b>{derivedFrom}</b>。
          编辑只写主内容与自身最深层（并重算 sha256／向量），改派生层会污染账本口径 —— 请到 <b>{derivedFrom}</b> 卡片编辑。
        </div>
      )}
      {saveError && (
        <div className="mask-banner" data-testid="save-error" style={{ background: '#2a1214', borderColor: '#7a2b34', color: '#ffc9cf' }}>
          ⚠️ 未写入账本：{saveError}（草稿已保留，可改后重试）
        </div>
      )}

      <div className="section-title">{readOnly ? '阅读（只读）' : '阅读 + 编辑'}</div>
      <textarea
        id="ed"
        data-testid="edit"
        rows={6}
        readOnly={readOnly}
        style={{
          width: '100%', background: 'var(--panel2)', color: 'var(--txt)',
          border: '1px solid var(--line)', borderRadius: 8, padding: 8,
          fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical',
          opacity: readOnly ? 0.6 : 1, cursor: readOnly ? 'not-allowed' : 'text',
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="save-row">
        <span className="save-hint">
          {isL0 ? 'L0 只读（落盘为 v2 密文，改动请回源端重写）· 查阅已记审计' :
           derivedFrom ? `派生层只读：请到 ${derivedFrom} 卡片编辑` :
           readOnly ? '该记忆已锁定，内容只读' : '保存 = 写回本机真实账本（version+1）+ memory_op 审计'}
        </span>
        <button className="btn" data-testid="open-memory-file" disabled={saving} onClick={onOpenFile}>
          📂 打开记忆文件
        </button>
        <button
          className="btn primary"
          data-testid="save"
          disabled={!dirty || readOnly || saving}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存修改'}
        </button>
      </div>
    </>
  );
}
