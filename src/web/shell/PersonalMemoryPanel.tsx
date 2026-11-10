// 个人记忆壳层常驻面板（N8）：点击「记忆管理 / 个人记忆」或状态栏快捷按钮展开，全局常驻，
// 切换中心标签不丢状态；收起只是不渲染。
//
// 界面（用户 2026-11-10 定稿）：**回到原「左已确认 / 右收件箱」双窗界面**，与记忆库全页
// 共用同一个 PersonalMemoryPane 组件（组件自带 personalMemoryPane.css），改一次两处同时生效。
// 两处改良：①「快速记一条 + 记一条」置顶通栏；② 所有卡片/方框统一圆角（9–12px）。
// 壳层只额外提供：头部 + Agent 记忆归并入口（读取会话时自动拉取 / agent 主动投递 / 手动拉取兜底）。
//
// 分流口径（对齐 specs/多用户三池隔离设计_D1-D25.md 与 personal.ts 状态机）：
// - 「是我的」→ 归入私人池（confirmed，参与 agent 召回，仅本人可见）；
// - 「不是我的」→ 进共享（个人侧落 rejected；账本记忆原样留在共享池、团队可见）；
// - 检索只读取「我的私人 + 团队共享」，不读取他人私人记忆（内核 selectPersonalRecall 已保证）。
//   ⚠ 记忆记录无 scope 字段，隔离靠 project_id 三池 + 个人独立存储，绝不靠在账本上打标记。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.tsx';
import { PersonalMemoryPane } from '../memory/PersonalMemoryPane.tsx';
import { kernelErrorText, useKernelLoad } from '../shared/kernelLoad.tsx';
import {
  getPersonalPort, importPersonalFromAgent, rejectPersonalFromAgent, loadPersonalSnapshot,
  type PersonalPort,
} from '../shared/personalPort.ts';
import { splitAgentIngest, type AgentMemoryCandidate } from '../memory/coreMemoryOps.ts';
import type { PersonalSnapshot } from '../../core/memagent/personal.ts';

function p2(n: number): string {
  return String(n).padStart(2, '0');
}
function fmtWhen(iso: string | null): string {
  if (!iso) return '时间未记录';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '时间不可读';
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export interface PersonalMemoryPanelProps {
  open: boolean;
  onClose: () => void;
  /** 打开记忆库全页的个人记忆 Tab（memory.html?tab=personal） */
  onOpenFull?: () => void;
}

/**
 * 个人记忆常驻面板：原双窗 + Agent 记忆归并区。收起时不渲染（状态保留在壳层，不丢会话）。
 */
export function PersonalMemoryPanel({ open, onClose, onOpenFull }: PersonalMemoryPanelProps) {
  const personalMem = useKernelLoad<PersonalSnapshot>('personal-panel', loadPersonalSnapshot);
  const [candidates, setCandidates] = useState<AgentMemoryCandidate[]>([]);
  const [sessionInfoCount, setSessionInfoCount] = useState(0);
  const [ingestPhase, setIngestPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const portRef = useRef<PersonalPort | null>(null);
  if (!portRef.current) portRef.current = getPersonalPort();
  const port = portRef.current;

  // 已归入个人 / 已判定「不是我的」的账本 ref id（去重，避免重复出现在候选里）。
  // 两类都已耐久落进个人存储（pending/confirmed 或 rejected，均带 origin_ref_id）。
  const importedRefIds = useMemo(() => {
    const snap = personalMem.data;
    if (!snap) return new Set<string>();
    const all = [...snap.confirmed, ...snap.pending, ...snap.rejected];
    return new Set(all.map((e) => e.origin_ref_id).filter((x): x is string => typeof x === 'string'));
  }, [personalMem.data]);

  const excludeRef = useRef<Set<string>>(new Set());
  excludeRef.current = importedRefIds;

  // 首次自动拉取可能早于个人快照返回；渲染时再按 origin_ref_id 过滤一次，
  // 保证已归入/已判定的账本记忆不会短暂重现（去重以个人存储为准）。
  const visibleCandidates = useMemo(
    () => candidates.filter((c) => !importedRefIds.has(c.id)),
    [candidates, importedRefIds],
  );

  const loadCandidates = useCallback(async () => {
    setIngestPhase('loading');
    setIngestError(null);
    try {
      // 进库分流：会话信息（带 session_id）直接放行；agent 提取的记忆才进发件箱等用户判定
      const split = await splitAgentIngest(excludeRef.current);
      setCandidates(split.candidates);
      setSessionInfoCount(split.sessionInfoCount);
      setIngestPhase('idle');
    } catch (e: unknown) {
      setIngestError(kernelErrorText(e));
      setIngestPhase('error');
    }
  }, []);

  // 读取会话时自动读：面板打开即拉取一次（auto + 兜底；agent 主动投递走收件箱 pendingAgent）
  useEffect(() => {
    if (open) void loadCandidates();
  }, [open, loadCandidates]);

  // 人机交互：Esc 收起面板
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const refresh = useCallback(() => personalMem.retry(), [personalMem]);

  /** 「不是我的 → 进共享」：个人侧落 rejected 条目，共享账本记忆原样保留 */
  const markNotMine = useCallback(async (c: AgentMemoryCandidate) => {
    setBusyId(c.id);
    setMsg(null);
    try {
      const receipt = await rejectPersonalFromAgent({
        content: c.content,
        sourceAgent: c.sourceAgent ?? '未知 agent',
        sourceRefId: c.id,
        originTs: Number.isFinite(Date.parse(c.createdAt)) ? Date.parse(c.createdAt) : undefined,
      });
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      refresh();
      void loadCandidates();
      setMsg({ kind: 'warn', text: `已判定「不是我的」→ 进共享（账本记忆原样保留、团队可见，不进你的私人召回）· request_id ${receipt.request_id}` });
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `判定失败：${kernelErrorText(e)}` });
    } finally {
      setBusyId(null);
    }
  }, [refresh, loadCandidates]);

  /** 「是我的 → 归入私人池」：import 落 pending 个人条目，随后 confirm 进入 confirmed */
  const markMine = useCallback(async (c: AgentMemoryCandidate) => {
    setBusyId(c.id);
    setMsg(null);
    try {
      const input = {
        content: c.content,
        sourceAgent: c.sourceAgent ?? '未知 agent',
        sourceRefId: c.id,
        originTs: Number.isFinite(Date.parse(c.createdAt)) ? Date.parse(c.createdAt) : undefined,
      };
      const imported = await importPersonalFromAgent(input);
      try {
        await port.invoke('confirm', { id: imported.entry.id });
      } catch (e: unknown) {
        setCandidates((prev) => prev.filter((x) => x.id !== c.id));
        refresh();
        void loadCandidates();
        setMsg({ kind: 'warn', text: `已归入个人收件箱，但确认失败（未进入私人池）：${kernelErrorText(e)}。可在「收件箱」里再确认一次` });
        return;
      }
      setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      refresh();
      void loadCandidates();
      setMsg({ kind: 'ok', text: `已归入私人池（仅本人可见、参与召回）· request_id ${imported.request_id}` });
    } catch (e: unknown) {
      setMsg({ kind: 'err', text: `归入失败：${kernelErrorText(e)}` });
    } finally {
      setBusyId(null);
    }
  }, [port, refresh, loadCandidates]);

  if (!open) return null;

  return (
    <div className="pm-shell-panel" role="dialog" aria-label="个人记忆" data-testid="personal-memory-panel">
      <div className="pm-sp-head">
        <span className="pm-sp-mark"><Icon name="user" size={13} /></span>
        <b>个人记忆</b>
        <span className="pm-sp-spring" />
        <button
          type="button"
          className="pm-sp-tool"
          onClick={() => void loadCandidates()}
          disabled={ingestPhase === 'loading'}
          title="重新拉取账本中的 agent 记忆（打开面板时已自动拉取）"
          aria-label="重新拉取 agent 记忆"
          data-testid="pm-ingest-refresh"
        ><Icon name="refresh" size={12} /></button>
        <button
          type="button"
          className="pm-sp-tool"
          onClick={onClose}
          title="收起个人记忆面板（Esc）"
          aria-label="收起个人记忆面板"
          data-testid="pm-panel-close"
        ><Icon name="x" size={12} /></button>
      </div>

      {/* 打开记忆库全页的个人记忆 Tab（完整管理：上行团队 / 同步 / 绑定 / 判定口径） */}
      {onOpenFull ? (
        <button
          type="button"
          className="pm-sp-openfull"
          onClick={onOpenFull}
          data-testid="pm-panel-open-full"
        >在记忆库中打开个人记忆页 →</button>
      ) : null}

      {/* 进库分流口径（用户 2026-11-10 定稿）：会话信息直接放行；agent 提取的记忆进发件箱等判定 */}
      <div className="pm-ingest-note" data-testid="pm-ingest-split">
        进库分流：会话信息（带 session_id）<b>直接放行</b> {sessionInfoCount} 条 · agent 提取的记忆进发件箱待判定 {visibleCandidates.length} 条
      </div>

      {msg ? <div className={`pm-sp-msg ${msg.kind}`} data-testid="pm-panel-msg">{msg.text}</div> : null}

      {/* 原双窗界面（与记忆库全页共用同一组件 / 同一样式），窄容器下双窗上下堆叠 */}
      <div className="pm-shell-body">
        <PersonalMemoryPane
          phase={personalMem.phase}
          data={personalMem.data}
          error={personalMem.error}
          onRetry={personalMem.retry}
          onChanged={personalMem.replace}
          narrow
        />
      </div>

      {/* Agent 记忆归并区（发件箱）：常驻窗口的核心新增，保留原界面之外的这一条通道。
          放在双窗下方 —— 候选可达 2910 条，放上方会把双窗完全挤出视口。 */}
      <div className="pm-ingest">
        <div className="pm-ingest-head">
          <b>发件箱 · Agent 记忆归并</b>
          <span className="pm-sp-spring" />
          <span className="pm-ingest-note" data-testid="pm-ingest-count">待判定 {visibleCandidates.length}</span>
        </div>
        <div className="pm-ingest-note">会话信息已直接放行；此处只放 agent 提取的记忆，逐条确认是否为个人（私人）记忆。</div>

        {ingestPhase === 'loading' ? (
          <div className="pm-ingest-empty" data-testid="pm-ingest-loading">正在读取账本中的 agent 记忆…</div>
        ) : ingestPhase === 'error' ? (
          <div className="pm-ingest-err" data-testid="pm-ingest-error">
            读取失败：{ingestError}
            <button type="button" className="pm-sp-mini" onClick={() => void loadCandidates()} data-testid="pm-ingest-retry">重试</button>
          </div>
        ) : visibleCandidates.length === 0 ? (
          <div className="pm-ingest-empty" data-testid="pm-ingest-empty">没有待归并的 agent 记忆（账本里没有 agent 写入，或都已处理）</div>
        ) : (
          <div className="pm-ingest-list" data-testid="pm-ingest-list">
            {visibleCandidates.map((c) => (
              <div className="pm-ingest-item" key={c.id} data-testid={`pm-ingest-${c.id}`}>
                <div className="pm-ingest-top">
                  <span className="pm-src">来源 agent · {c.sourceAgent ?? '未记名'}</span>
                  <span className="pm-time mono">{fmtWhen(c.createdAt)}</span>
                </div>
                <div className="pm-ingest-body">{c.content}</div>
                <div className="pm-ingest-actions">
                  <button
                    type="button"
                    className="pmp-btn primary"
                    disabled={busyId === c.id}
                    onClick={() => void markMine(c)}
                    data-testid={`pm-ingest-mine-${c.id}`}
                  >是我的（归入私人池）</button>
                  <button
                    type="button"
                    className="pmp-btn"
                    disabled={busyId === c.id}
                    onClick={() => void markNotMine(c)}
                    data-testid={`pm-ingest-notmine-${c.id}`}
                  >不是我的（进共享）</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
