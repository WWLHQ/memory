// Agent 接入配置页容器（REQ-003 接原型）
// ⚠ 硬性约定：页面结构、class、文案、交互严格对齐 design/ui/Agent接入页_原型.html。
// 业务内核复用 src/agentOnboard/*（状态机/校验/服务），此处只做"原型逻辑 → React state"的翻译。
// 批次16：登录自动接入结果经 storage 事件即时恢复；失败提示「🔍 手动检测」；卡片接真实统计/熔断/延迟/租户。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentRealStats, DiscoveredAgent, Form, InstalledAgent, UiAgentCard,
} from '../../types/agentOnboard.ts';
import { hasActiveSession } from '../Home/crossTabAuth.ts';
import { AgentCard, toolRef } from './AgentCard.tsx';
import type { TestEvidence } from './TestPanel.tsx';
import { OneClickOnboard } from './OneClickOnboard.tsx';
import { restoreCards, restoreDiscovered, makeCard, specOf } from './cards.ts';
import { addAgentCard } from './store.ts';
import {
  ONBOARD_STATE_KEY, readOnboardState, writeOnboardState,
  type OnboardMcpSummary, type OnboardState,
} from './onboardState.ts';
import { getOnboardInjectPreview } from './coreOnboard.ts';
import { getKernelStorage, getTenant } from '../kernel.ts';
import {
  loadAgentLedger, mergeLedgerIntoCards, recordAgentAction,
  type AgentActionInput, type OnboardTenant,
} from './ledger.ts';
import { normalizeAgentKey, statsForAgent, useBackendMirror } from './useBackendMirror.ts';
import {
  ONBOARD_FAILURE_KEY, hasAutoScannedSession, readOnboardFailure, resetAutoOnboardState, runAutoOnboard,
} from './autoOnboard.ts';
import { hostCapability } from '../../desktop/hostBridge.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import { useSessionContext } from '../shared/session.ts';
import { McpClientsPanel } from './McpClientsPanel.tsx';
import './theme.css';

/** 19.10 运行时检测当前端；真实端壳注入，这里用 UA 粗判 */
export function detectForm(): Form {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';
  if (/Mac/.test(ua)) return 'mac';
  if (/Android|iPhone|iPad|Mobile/.test(ua)) return 'mobile';
  if (/cli|node/i.test(ua)) return 'cli';
  return 'desktop';
}

const RUNNING_STAGES = ['扫描注册信号中…', '自动打标 P0/P1/P2 中…', '按默认值绑定中…', '测通并写审计中…'];

/** R2：记忆读写须带 project_id（关闭共享后请确认 project_id 仍可解析） */
function checkR2(a: UiAgentCard): string | null {
  if (toolRef(a.tools.write).on && !a.iso.projShare) {
    return 'R2：记忆读写须带 project_id（关闭共享后请确认 project_id 仍可解析）';
  }
  return null;
}

/** R4：双通道至少开一个 */
function checkR4(a: UiAgentCard): string | null {
  if (!a.chan.webhook && !a.chan.api) return 'R4：双通道（Webhook + API 拉取）至少开一个，否则记忆库无法采集（5.1）';
  return null;
}

/** 服务层真实状态 → 原型状态点；未知/缺省 → undefined（保持现状，不臆造连通） */
function uiStateOf(status?: string): UiAgentCard['state'] | undefined {
  switch (status) {
    case 'CONNECTED': return 'connected';
    case 'DEGRADED': return 'degraded';
    case 'CONFIGURED':
    case 'ONBOARD': return 'onboard';
    default: return undefined;
  }
}

/** 合并恢复卡片：保留内存中已改配置，只补新出现的卡片 */
function mergeRestored(prev: UiAgentCard[], restored: UiAgentCard[]): UiAgentCard[] {
  const seen = new Set(prev.map((a) => a.name.toLowerCase()));
  const added = restored.filter((a) => !seen.has(a.name.toLowerCase()));
  return added.length > 0 ? [...prev, ...added] : prev;
}

export function AgentOnboardPage() {
  useHostTheme();
  const form = useMemo(detectForm, []);
  const session = useSessionContext();
  const tenantLabel = session.context
    ? `${session.context.enterprise_id} / ${session.context.team_id}`
    : undefined;
  const initial = readOnboardState();
  const initialFailure = readOnboardFailure();
  /** 真实拨测失败原因（来自服务层 lastTest；UI 如实展示，不滞留「已连通」） */
  const [failureReasons, setFailureReasons] = useState<Record<string, string>>({});
  /** 后端审计汇总的真实指标（成功率 / 平均延时 / 最近轮换） */
  const [stats, setStats] = useState<Record<string, AgentRealStats>>({});
  // 后端已有卡片合并回填：按 agent_name 匹配本地卡片，同步 circuit/badge/status（不增删行数）
  const onCards = useCallback((cards: Array<{
    agent_name: string; circuit?: string; priority?: string; status?: string;
    lastTest?: { ok: boolean; reason: string };
  }>) => {
    setFailureReasons((prev) => {
      const next = { ...prev };
      for (const c of cards) {
        if (!c.lastTest) continue;
        // 键按归一化名存，读取时同样归一化（避免大小写/空白不同导致失败原因丢失）
        const key = normalizeAgentKey(c.agent_name);
        if (c.lastTest.ok) delete next[key];
        else next[key] = c.lastTest.reason;
      }
      return next;
    });
    setAgents((prev) => prev.map((a) => {
      const key = normalizeAgentKey(a.name);
      const c = cards.find((x) => normalizeAgentKey(x.agent_name) === key);
      if (!c) return a;
      const state = uiStateOf(c.status);
      return {
        ...a,
        ...(c.circuit ? { circuit: c.circuit as UiAgentCard['circuit'] } : {}),
        ...(c.priority ? { badge: c.priority.toLowerCase() as UiAgentCard['badge'] } : {}),
        ...(state ? { state } : {}),
      };
    }));
  }, []);
  const backend = useBackendMirror(onCards, setStats);
  const refreshBackend = backend.refresh;
  // 初始态 = 用户真实接入过的卡片/发现行/安装痕迹（localStorage 持久化）
  const [agents, setAgents] = useState<UiAgentCard[]>(restoreCards);
  const [discovered, setDiscovered] = useState<DiscoveredAgent[]>(restoreDiscovered);
  const [installed, setInstalled] = useState<InstalledAgent[]>(
    () => initial?.installed ?? initialFailure?.installed ?? [],
  );
  const [installedProbes, setInstalledProbes] = useState<Record<string, string>>(
    () => initial?.installedProbes ?? initialFailure?.installedProbes ?? {},
  );
  const [installedSource, setInstalledSource] = useState<'host' | 'browser' | null>(
    () => (hostCapability() === 'none' ? 'browser' : initial?.source === 'host' ? 'host' : null),
  );
  const [installedBusy, setInstalledBusy] = useState(false);
  const [mcpSummary, setMcpSummary] = useState<OnboardMcpSummary | null>(() => initial?.mcp ?? null);
  const [failure, setFailure] = useState('');
  const [autoOnboarded, setAutoOnboarded] = useState(() => !!initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [injectShown, setInjectShown] = useState<Record<string, boolean>>({});
  /** 本次测试回执（后端 request_id / 后端不可达的未验证原因 + 账本 top5 注入预览） */
  const [evidence, setEvidence] = useState<Record<string, TestEvidence>>({});
  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(() => (initial ? 3 : -1));
  const [scanState, setScanState] = useState(() => {
    if (initialFailure) return `本次自动接入失败 · ${initialFailure.reason}`;
    if (initial) return `完成 · 发现并绑定 ${initial.agentNames.length} 个 · 宿主真扫`;
    return '待扫描';
  });
  const [toastMsg, setToastMsg] = useState('');
  /** 定稿 4 页签：接入概览 / MCP 客户端 / 探针结果 / 接入配置 */
  const [tab, setTab] = useState(0);
  /** MCP 客户端页签计数 = 主进程真扫出的已安装客户端数（未知时不显示，不拿定稿的 6 充数） */
  const [mcpCount, setMcpCount] = useState<number | null>(null);
  const onMcpCount = useCallback((n: number) => {
    setMcpCount((prev) => (prev === n ? prev : n));
  }, []);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stageTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  /** 指标刷新重试定时器（接入写入与审计读取有毫秒级竞态，幂等重拉两次） */
  const statTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  /** 启动补扫只跑一次（StrictMode 双挂载 / 依赖变化不重复触发） */
  const autoScanRef = useRef(false);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2600);
  }, []);

  const clearStageTimers = useCallback(() => {
    for (const t of stageTimers.current) clearTimeout(t);
    stageTimers.current = [];
  }, []);

  /** 指标重拉：立即 + 800ms/2400ms 各补一次，覆盖 auto_bind 落盘与页面读取的竞态 */
  const refreshStats = useCallback(() => {
    for (const t of statTimers.current) clearTimeout(t);
    statTimers.current = [];
    void refreshBackend();
    for (const ms of [800, 2400]) {
      statTimers.current.push(setTimeout(() => { void refreshBackend(); }, ms));
    }
  }, [refreshBackend]);

  /** A29：当前租户（会话优先，缺省回退本机默认租户；账本按它隔离） */
  const ledgerTenant = useMemo<OnboardTenant>(() => {
    const t = getTenant();
    return {
      enterprise_id: session.context?.enterprise_id ?? t.enterprise_id,
      team_id: session.context?.team_id ?? t.team_id,
      ...(session.context?.user_id ? { user_id: session.context.user_id } : {}),
    };
  }, [session.context]);

  /** A29：从内核账本重建页面状态（账本为空 → 保留本地缓存，不臆造） */
  const syncLedger = useCallback(async () => {
    try {
      const ledger = await loadAgentLedger(getKernelStorage(), ledgerTenant);
      if (ledger.agents.length === 0) return;
      setAgents((prev) => mergeLedgerIntoCards(prev, ledger));
    } catch {
      /* 账本不可达：保留本地快照，不伪造状态 */
    }
  }, [ledgerTenant]);

  /** A29：接入动作统一写内核审计（写后立即按账本重建状态） */
  const logAgent = useCallback((input: Omit<AgentActionInput, 'tenant' | 'form'>) => {
    void recordAgentAction(getKernelStorage(), { ...input, tenant: ledgerTenant, form })
      .then(() => syncLedger())
      .catch(() => { /* 账本写入失败：动作本身已完成，页面保留当前状态 */ });
  }, [ledgerTenant, form, syncLedger]);

  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    clearStageTimers();
    for (const t of statTimers.current) clearTimeout(t);
  }, [clearStageTimers]);

  // A29：挂载即按账本重建（本地缓存被清/换窗口时，状态仍由内核审计恢复）
  useEffect(() => { void syncLedger(); }, [syncLedger]);

  // 从别的窗口/页面回到接入页时重拉一次真实指标（不轮询，不伪造）
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) refreshStats(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshStats]);

  /** 把持久化接入状态同步到页面（登录自动接入完成 / 手动检测成功 / 跨 iframe storage 事件） */
  const applyStoredState = useCallback((st: OnboardState) => {
    setAgents((prev) => mergeRestored(prev, restoreCards()));
    setDiscovered(restoreDiscovered());
    setInstalled(st.installed ?? []);
    setInstalledProbes(st.installedProbes ?? {});
    setInstalledSource(st.source === 'host' ? 'host' : 'browser');
    setMcpSummary(st.mcp ?? null);
    setAutoOnboarded(true);
    setFailure('');
    setStageIndex(3);
    setScanState(`完成 · 发现并绑定 ${st.agentNames.length} 个 · 宿主真扫`);
    refreshStats();
  }, [refreshStats]);

  /** 登录自动接入在其他 iframe 完成后，storage 事件即时刷新（无需切页重扫） */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ONBOARD_STATE_KEY && e.key !== ONBOARD_FAILURE_KEY) return;
      const st = readOnboardState();
      if (st) applyStoredState(st);
      const f = readOnboardFailure();
      if (f) {
        setFailure(f.reason);
        setInstalled(f.installed ?? []);
        setInstalledProbes(f.installedProbes ?? {});
        setInstalledSource(f.source === 'browser' ? 'browser' : 'host');
        setScanState(`本次自动接入失败 · ${f.reason}`);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [applyStoredState]);

  /** 更新第 i 张卡片并重算 R4 */
  const patchAgent = useCallback((i: number, patch: (a: UiAgentCard) => UiAgentCard) => {
    setAgents((prev) => {
      const next = prev.map((a, idx) => (idx === i ? patch(a) : a));
      const err = checkR4(next[i]);
      setErrors((e) => ({ ...e, [next[i].name]: err ?? '' }));
      return next;
    });
  }, []);

  /* ---------- 开关交互 ---------- */
  const onToolChange = (i: number, tool: 'recall' | 'write' | 'pref', checked: boolean) => {
    patchAgent(i, (a) => {
      // 惰性提升布尔为对象：原型 pref 可能是 false，直接测值会报 TypeError
      if (tool === 'pref') a.tools.pref = { ...toolRef(a.tools.pref), on: checked };
      else if (tool === 'write') a.tools.write = { ...toolRef(a.tools.write), on: checked };
      else a.tools.recall = { ...a.tools.recall, on: checked };

      // R3：scene=critical 时 mode 不得 minimal（16.5）
      if (tool === 'recall' && a.tools.recall.scene === 'critical' && a.tools.recall.mode === 'minimal') {
        a.tools.recall.mode = '';
        toast('critical 禁极简，已回落自动（16.5）');
      }
      return a;
    });
  };

  const onIsoChange = (i: number, key: 'projShare' | 'prefCross', checked: boolean) => {
    patchAgent(i, (a) => {
      a.iso = { ...a.iso, [key]: checked };
      toast(
        key === 'projShare'
          ? (checked ? '已开启 project_id 跨 Agent 共享' : '已关闭：该项目记忆不再跨 Agent 共享')
          : (checked ? '个人偏好跨 Agent/项目共享（user_id 级）' : '个人偏好随项目隔离'),
      );
      return a;
    });
  };

  const onChanChange = (i: number, ch: 'webhook' | 'api', checked: boolean) => {
    patchAgent(i, (a) => {
      a.chan = { ...a.chan, [ch]: checked };
      return a;
    });
  };

  /* ---------- 操作按钮 ---------- */
  const onAct = (i: number, act: 'test' | 'rotate' | 'save') => {
    const a = agents[i];
    if (!a) return;
    if (act === 'test') {
      if (a.circuit === 'OPEN') return;
      setInjectShown((s) => ({ ...s, [a.name]: true }));
      void backend.test(a.name).then(async (r) => {
        const inject = await getOnboardInjectPreview(getKernelStorage()).catch(() => null);
        setEvidence((e) => ({
          ...e,
          [a.name]: {
            rid: r.requestId ?? null,
            inject,
            local: r.via === 'local',
            ok: r.ok,
            reason: r.reason,
          },
        }));
        // 真实拨测结果落回卡片状态点：失败 → 降级，绝不滞留「已连通」
        const st = uiStateOf(r.status);
        if (st) patchAgent(i, (x) => ({ ...x, state: st }));
        setFailureReasons((m) => {
          const next = { ...m };
          if (r.ok) delete next[a.name];
          else next[a.name] = r.reason ?? '接入后端不可达，本地未验证';
          return next;
        });
        // A29：测试结论也写内核账本（页面状态随后从账本重建，不依赖后端 JSON 审计）
        logAgent({
          action: 'agent_test', agent: a.name, op: 'test',
          result: r.ok ? 'pass' : 'fail', status: r.status, reason: r.reason,
          durationMs: typeof r.rtt === 'number' ? r.rtt : undefined,
          requestId: r.requestId ?? undefined, rev: r.rev,
        });
        void refreshStats(); // 指标（成功率/平均延时/最近测试）随真实审计刷新
        toast(r.ok
          ? `测试通过：${a.name}${r.requestId ? ` · ${r.requestId}` : ''} · ${r.rtt}ms（已记审计）`
          : `测试未通过：${a.name} —— ${r.reason ?? '接入后端不可达，本地未验证'}`);
      });
    }
    if (act === 'rotate') {
      // 真实轮换回执成功后才更新脱敏值（对齐原型 act('rotate')：加「（新）」/「刚轮换」）
      void backend.rotate(a.name).then((r) => {
        if (!r.ok) {
          toast(`轮换失败：${a.name} —— ${r.reason ?? '接入后端不可达，密钥未轮换'}`);
          return;
        }
        patchAgent(i, (x) => ({ ...x, key: { ...x.key, last: '刚轮换', rotated: true } }));
        logAgent({
          action: 'agent_rotate', agent: a.name, op: 'rotate', result: 'ok',
          keyTail: r.card?.keyTail, rev: r.rev,
        });
        refreshStats();
        toast(`已轮换，旧 Key ${a.key.grace}h 内有效（4.1）`);
      });
    }
    if (act === 'save') {
      const r2 = checkR2(a);
      if (r2) { toast(r2); return; }
      toast(`已保存 ${a.name} 接入配置`);
      backend.save(a);
      // A29：接入/改配置写内核审计（result=ok 才会被账本回放采用）
      logAgent({ action: 'agent_onboard', agent: a.name, op: 'configure', result: 'ok', status: 'CONFIGURED', rev: a.rev });
    }
  };

  const onRidClick = (name: string) => toast(`开审计页（独立窗口）定位 ${name} 的 request_id 链路（18.2-E）`);

  /* ---------- 自动接入：三路真扫 → 建卡 → auto_bind → 写 MCP ---------- */
  const runPipeline = useCallback((mode: 'discover' | 'manual' | 'auto') => {
    if (running) return;
    setRunning(true);
    setInstalledBusy(true);
    setFailure('');
    clearStageTimers();
    if (mode === 'discover') {
      setStageIndex(-1);
      setScanState('待扫描');
      [0, 1, 2].forEach((i) => {
        stageTimers.current.push(setTimeout(() => {
          setStageIndex(i);
          setScanState(RUNNING_STAGES[i]);
        }, 430 * (i + 1)));
      });
    } else if (mode === 'manual') {
      setStageIndex(3);
      setScanState('手动检测中…（宿主真扫 + 安装痕迹 + MCP 配置）');
    } else {
      setStageIndex(-1);
      setScanState('启动后自动扫描…（宿主真扫 + 安装痕迹 + MCP 配置）');
    }
    const begin = () => {
      setStageIndex(3);
      setScanState('宿主真扫 + 安装痕迹 + MCP 配置中…');
      void runAutoOnboard({
        role: session.role,
        sid: session.sid,
        form,
        trigger: mode === 'manual' ? 'manual' : mode === 'auto' ? 'auto' : 'rebind',
      })
        .then((out) => {
          setInstalled(out.installed);
          setInstalledProbes(out.installedProbes);
          setInstalledSource(out.scan.capability === 'none' ? 'browser' : 'host');
          if (!out.ok) {
            const reason = out.reason ?? '未知原因';
            setFailure(reason);
            setScanState(`自动接入失败 · ${reason}`);
            toast(`自动接入失败：${reason}（可点「🔍 手动检测」重试）`);
            return;
          }
          if (out.state) applyStoredState(out.state);
          // A29：一键接入逐家写内核审计（状态/原因取后端回执，后端不可达则如实标失败）
          const byName = new Map((out.backendCards ?? []).map((c) => [normalizeAgentKey(c.agent_name), c]));
          for (const d of out.discovered) {
            const c = byName.get(normalizeAgentKey(d.name));
            const connected = c?.status === 'CONNECTED';
            logAgent({
              action: 'auto_bind', agent: d.name, op: 'one_click',
              result: connected ? 'pass' : 'fail',
              status: c?.status ?? 'DEGRADED',
              priority: c?.priority,
              reason: c?.lastTest?.reason ?? out.backendError,
              durationMs: c?.lastTest?.durationMs,
              rev: c?.rev,
            });
          }
          const mcpNote = out.mcp?.changed.length ? `；MCP 已写入 ${out.mcp.changed.join('、')}` : '';
          const mcpFailed = out.mcp?.failed.length ? `；${out.mcp.failed.length} 个客户端写入失败（见下方说明）` : '';
          toast(`一键接入完成：自动发现 ${out.discovered.length} 个 Agent 并绑定${mcpNote}${mcpFailed}`);
          if (!out.discovered.length) {
            setScanState('完成 · 未发现本机 Agent 安装痕迹 · 宿主真扫');
          }
        })
        .catch((e: unknown) => {
          const reason = (e as Error)?.message ?? String(e);
          setFailure(reason);
          setScanState(`自动接入失败 · ${reason}`);
          toast(`自动接入失败：${reason}`);
        })
        .finally(() => {
          setRunning(false);
          setInstalledBusy(false);
        });
    };
    stageTimers.current.push(setTimeout(begin, mode === 'discover' ? 430 * 3 : 0));
  }, [running, session.role, session.sid, form, toast, applyStoredState, clearStageTimers, logAgent]);

  // 批次18：应用重启恢复会话时没有登录事件 → 接入页挂载后补跑一轮三路真扫。
  // 批次33-A：改按「本次登录会话是否已扫过」判定（用户反馈：首次登录扫一次即可，切页面不该再扫）。
  // 已扫过就不起扫描：挂载初始态已从持久化快照回填卡片/发现行/接入状态，无需重复拉。
  // 无会话交给登录门禁；「手动检测 / 重新接入」始终真扫，不受标记约束。
  useEffect(() => {
    if (autoScanRef.current) return;
    if (!session.sid || session.loading) return;
    autoScanRef.current = true;
    if (hasAutoScannedSession(session.sid)) return;
    runPipeline('auto');
  }, [session.sid, session.loading, runPipeline]);

  const onDiscover = () => runPipeline('discover');
  const onManualDetect = () => runPipeline('manual');

  const onRebindAll = () => {
    if (running) return;
    for (const d of discovered) {
      backend.unbind(d.name);
      logAgent({ action: 'unbound', agent: d.name, op: 'rebind_all', result: 'ok' });
    }
    resetAutoOnboardState();
    setAutoOnboarded(false);
    setDiscovered([]);
    setMcpSummary(null);
    setFailure('');
    setStageIndex(-1);
    toast('已清除接入状态，重新扫描本机…');
    runPipeline('discover');
  };

  const onUnbind = (i: number) => {
    const d = discovered[i];
    if (!d) return;
    const next = discovered.map((x, idx) => (idx === i ? { ...x, bound: false } : x));
    setDiscovered(next);
    setAgents((prev) => prev.map((a) => (a.name === d.name ? { ...a, state: 'onboard' as const } : a)));
    backend.unbind(d.name);
    logAgent({ action: 'unbound', agent: d.name, op: 'unbind', result: 'ok' });
    // 持久化名单同步移除，避免刷新后又回到「已绑定」
    const st = readOnboardState();
    if (st) {
      writeOnboardState({
        ...st,
        agentNames: st.agentNames.filter((n) => n !== d.name),
        discovered: (st.discovered ?? []).filter((x) => x.name !== d.name),
        seq: Date.now(),
      });
    }
    toast(`已撤销 ${d.name} 的自动绑定（审计 unbound）；恢复需重跑一键接入`);
  };

  const onAddCardForInstalled = (f: InstalledAgent) => {
    if (agents.some((a) => a.name.toLowerCase() === f.agent.toLowerCase())) {
      toast(`${f.agent} 已有接入卡片（不重复新增）`);
      return;
    }
    const spec = specOf(f.agent);
    const card = makeCard(f.agent, { ...spec, badge: f.badge, label: f.label });
    addAgentCard(f.agent, card);
    setAgents((prev) => [...prev, card]);
    backend.save(card);
    logAgent({ action: 'agent_onboard', agent: f.agent, op: 'manual_add', result: 'ok', status: 'CONFIGURED' });
    refreshStats();
    toast(`已新增接入卡片：${f.agent}（未连通；点「测试接入」验证）`);
  };

  // 登录门禁：未登录 → 提示并阻止
  if (!hasActiveSession()) {
    return (
      <div className="wrap">
        <div className="auth-gate">
          <div className="gate-card">
            <h2>请先登录</h2>
            <p>登录后可访问 Agent 接入配置页（REQ-003）。点击确定跳转至首页登录后重试。</p>
            <button
              className="btn primary"
              id="btnGotoLoginFromAgent"
              type="button"
              onClick={() => {
                if (window.opener) window.close();
                else window.location.href = '/index.html';
              }}
            >
              → 前往登录页
            </button>
          </div>
        </div>
      </div>
    );
  }

  const mcpText = mcpSummary
    ? [
        mcpSummary.wired.length > 0
          ? `已写入 ${mcpSummary.wired.join('、')}${mcpSummary.changed.length > 0 ? `（本次新增 ${mcpSummary.changed.join('、')}）` : ''}`
          : '',
        mcpSummary.manual.length > 0 ? `需手工添加 ${mcpSummary.manual.join('、')}（无稳定可写配置）` : '',
        mcpSummary.failed.length > 0
          ? `失败 ${mcpSummary.failed.map((f) => `${f.client}（${f.reason}）`).join('；')}`
          : '',
      ].filter(Boolean).join(' · ')
    : '';
  const failureNode = failure ? (
    <div className="warn show" data-testid="onboard-failure" style={{ marginBottom: 10 }}>
      ⚠ 自动接入未完成：{failure}
      <span style={{ marginLeft: 8 }}>请点击上方「🔍 手动检测」重试（逐路读取本机安装痕迹）。</span>
    </div>
  ) : null;

  const STATE_TEXT: Record<UiAgentCard['state'], string> = {
    connected: '已连通',
    degraded: '降级（仅补偿）',
    onboard: '未配置',
  };
  const fmtTime = (ts?: number): string =>
    ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '未取数';

  /** 探针结论只认真实样本：有失败原因 → 未通过；有样本且通过 → 通过；否则如实说无样本 */
  const probeOf = (a: UiAgentCard): { verdict: string; cls: string } => {
    const s = statsForAgent(stats, a.name);
    if (failureReasons[normalizeAgentKey(a.name)]) return { verdict: '未通过', cls: 'err' };
    if (!s || s.tests === 0) return { verdict: '无探针样本', cls: 'muted' };
    if (s.passed > 0) return { verdict: '通过', cls: 'ok' };
    return { verdict: '未通过', cls: 'err' };
  };

  const tabs = [
    '接入概览',
    `MCP 客户端${mcpCount === null ? '' : ` ${mcpCount}`}`,
    '探针结果',
    '接入配置',
  ];

  return (
    <div className="wrap" data-testid="agent-onboard-page">
      <h1>Agent 接入配置页 · 可交互原型</h1>
      <div className="sub">
        按《Agent 接入页字段级交互规格》实现 · MVP 两家起步（deepseek harness P0 + Claude Code P1）· 一键接入 · 双通道降级 · 隔离开关 · 密钥脱敏 · 效果证据
      </div>

      <div className="p0-tabs" role="tablist" data-testid="agent-tabs">
        {tabs.map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`agent-tab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}</button>
        ))}
      </div>

      {/* ── 1. 接入概览：一键接入 + 真实发现行 + 接入摘要 ── */}
      <div hidden={tab !== 0} data-testid="agent-panel-0">
        <div className="section-title">⚡ 一键接入本机 Agent（19.9）· 自动发现 + 默认绑定，不用逐个设置</div>
        {failureNode}
        <OneClickOnboard
          form={form}
          discovered={discovered}
          running={running}
          stageIndex={stageIndex}
          scanState={scanState}
          onDiscover={onDiscover}
          onUnbind={onUnbind}
          onSignalChange={() => { /* 信号源仅影响发现范围，原型默认全开即全部展示 */ }}
          autoOnboarded={autoOnboarded}
          onRebindAll={onRebindAll}
          installedAgents={installed}
          installedProbes={installedProbes}
          installedSource={installedSource}
          installedReason={failure || undefined}
          installedBusy={installedBusy}
          onManualDetect={onManualDetect}
          onAddCardForInstalled={onAddCardForInstalled}
        />

        <div className="section-title">接入摘要 · 状态来自后端真实回填与内核账本</div>
        {agents.length === 0 ? (
          <div className="card" data-testid="overview-empty">
            尚无接入卡片：点上方「自动发现并接入本机 Agent」真扫本机后建卡；空名单不伪造 Agent 行。
          </div>
        ) : (
          <div className="card">
            <table className="ltable" data-testid="overview-table">
              <thead>
                <tr>
                  <th>Agent</th><th>状态</th><th>连通成功率</th><th>平均延时</th>
                  <th>最近探针</th><th>熔断</th><th>双通道</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const s = statsForAgent(stats, a.name);
                  const rate = s && s.tests > 0 ? `${Math.round((s.passed / s.tests) * 100)}%` : '未取数';
                  return (
                    <tr key={a.name} data-testid={`overview-row-${a.name}`}>
                      <td>{a.name}</td>
                      <td>{STATE_TEXT[a.state]}</td>
                      <td>{rate}{s && s.tests > 0 ? `（${s.passed}/${s.tests}）` : ''}</td>
                      <td>{s?.avgRtt !== undefined ? `${s.avgRtt}ms` : '未取数'}</td>
                      <td className="mid">{fmtTime(s?.lastTestAt)}</td>
                      <td>{a.circuit}</td>
                      <td>{a.chan.webhook && a.chan.api ? 'webhook + API' : a.chan.webhook ? 'webhook' : a.chan.api ? 'API' : '全关'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 2. MCP 客户端：七态 + 真实本机配置 ── */}
      <div hidden={tab !== 1} data-testid="agent-panel-1">
        {mcpText && (
          <div className="note" data-testid="mcp-wire-summary" style={{ marginBottom: 10 }}>
            🧠 MCP 接入（自动写入已连通 Agent）：{mcpText} · 端点 {mcpSummary?.endpoint}；
            未列出的客户端在下方客户端列表可查看真实状态与手工说明。
          </div>
        )}
        <McpClientsPanel onInstalledCount={onMcpCount} />
      </div>

      {/* ── 3. 探针结果：只展示真实拨测回执，无样本不显示 200 ── */}
      <div hidden={tab !== 2} data-testid="agent-panel-2">
        <div className="section-title">探针结果 · 真实请求与回执（200 / 401 / 超时按真实结果展示）</div>
        <div className="note" data-testid="probe-note" style={{ margin: '0 0 8px' }}>
          探针结论与耗时来自接入后端 /agents 的 lastTest 与 /audit 审计样本；后端不可达时显示「无探针样本」，
          不把「未知」标成「通过」。
        </div>
        {agents.length === 0 ? (
          <div className="card" data-testid="probe-empty">
            暂无真实探针样本：先完成一键接入，或在「接入配置」页逐张点「测试接入」。
          </div>
        ) : (
          <div className="card">
            <table className="ltable" data-testid="probe-table">
              <thead>
                <tr>
                  <th>Agent</th><th>探针结论</th><th>最近探针</th><th>延时</th>
                  <th>request_id</th><th>失败原因 / 证据</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const s = statsForAgent(stats, a.name);
                  const p = probeOf(a);
                  const ev = evidence[a.name];
                  const reason = failureReasons[normalizeAgentKey(a.name)] ?? ev?.reason ?? '';
                  return (
                    <tr key={a.name} data-testid={`probe-row-${a.name}`}>
                      <td>{a.name}</td>
                      <td><span className={`status ${p.cls === 'ok' ? 'active' : p.cls === 'err' ? 'deprecated' : ''}`}>{p.verdict}</span></td>
                      <td className="mid">{fmtTime(s?.lastTestAt)}</td>
                      <td>{s?.lastRtt !== undefined ? `${s.lastRtt}ms` : '未取数'}</td>
                      <td className="mid">{ev?.rid ?? '账本无链路'}</td>
                      <td>{reason || '无'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 4. 接入配置：逐张卡片开关 + 密钥 + 通道 ── */}
      <div hidden={tab !== 3} data-testid="agent-panel-3">
        <div className="section-title">宿主 Agent 接入卡片（19.2 / 19.3 / 5.2）</div>
        <div className="note" data-testid="card-metric-note" style={{ margin: '0 0 8px' }}>
          连通成功率与平均延时只统计真实拨测样本（登录自动接入的 auto_bind + 手动「测试接入」），
          不需要逐张点击测试；手动测试用于复查与排障，不点不影响接入和指标。
        </div>
        {agents.length === 0 ? (
          <div className="card" data-testid="cards-empty">
            当前没有接入卡片：先在「接入概览」完成一键接入；未接入的 Agent 不展示配置表单。
          </div>
        ) : (
          <div id="cards">
            {agents.map((a, i) => (
              <AgentCard
                key={a.name}
                agent={a}
                error={errors[a.name] ?? ''}
                testDisabled={a.circuit === 'OPEN'}
                saveDisabled={!!errors[a.name]}
                injectVisible={!!injectShown[a.name]}
                testEvidence={evidence[a.name]}
                failureReason={failureReasons[normalizeAgentKey(a.name)]}
                stats={statsForAgent(stats, a.name)}
                tenantOverride={tenantLabel}
                onToolChange={(t, c) => onToolChange(i, t, c)}
                onIsoChange={(k, c) => onIsoChange(i, k, c)}
                onChanChange={(ch, c) => onChanChange(i, ch, c)}
                onAct={(act) => onAct(i, act)}
                onRidClick={onRidClick}
              />
            ))}
          </div>
        )}
      </div>

      <div className="toast" id="toast" style={toastMsg ? { display: 'block' } : { display: 'none' }}>
        {toastMsg}
      </div>
    </div>
  );
}

export default AgentOnboardPage;
