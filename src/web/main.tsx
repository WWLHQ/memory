// 应用入口（REQ-005 首页路由 · T12 路由决策：首页 = HomePage，覆盖 REQ-003 默认页）
// 挂载 HomePage，注入 T11 后端镜像 useLoginMirror（自动读 URL ?backend= 覆盖地址，缺省见 src/web/backend.ts）。
// 首页全量「真实可算」：四卡（累计记忆/累计动作/近1h调用/待裁决）与异常速览 / 近 1h 召回 Top3 / 待裁决
// 全部在挂载后异步由 getHomeFeed 从内核账本（storage）真实聚合；.rid 溯源真查 home server mirror 账本。
// AgentOnboard 页迁至 agentonboard.html 入口（保留 REQ-003 验证）。
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './shared/actionLog.ts';
import { HomePage } from './Home/HomePage.tsx';
import { useLoginMirror } from './Home/useLoginMirror.ts';
import {
  coreTraceLookup,
  getHomeFeed,
  fetchMirrorItems,
  emptyGains,
  emptySync,
  type TraceHit,
  type MirrorItem,
} from './Home/coreHome.ts';
import { emptyLayerGraph, type LayerGraph } from './Home/layerGraph.ts';
import { emptyOnboardGains } from './AgentOnboard/coreOnboard.ts';
import { getKernelStorage } from './kernel.ts';
import './Home/theme.css'; // REQ-005 原型主题（逐字提取自 design/ui/登录与首页_原型.html）
import type { RawHomeFeed } from '../home/dashboard.ts';
import type { SyncState, LoginForm } from '../types/home.ts';
import type { Gain } from '../types/agentOnboard.ts';
import type { LoginFn } from './Home/tenantContext.tsx';

const EMPTY_FEED: RawHomeFeed = {
  gains: emptyGains(),
  anomalies: [],
  activeMemories: [],
  todos: [],
};

function App() {
  // 内核账本后端：Electron 下为 IpcStorageBackend（经 IPC 读主进程 SqliteStorage 真实账本）；
  // 纯浏览器/测试下为本页内存实现（无内核数据时安全降级为空态）。
  const storage = useMemo(() => getKernelStorage(), []);
  const mirror = useLoginMirror();
  const [raw, setRaw] = useState<RawHomeFeed>(EMPTY_FEED);
  const [sync, setSync] = useState<SyncState>(emptySync());
  const [graph, setGraph] = useState<LayerGraph>(() => emptyLayerGraph());
  const [effectGains, setEffectGains] = useState<Gain[]>(emptyOnboardGains);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [traceHits, setTraceHits] = useState<TraceHit[] | null>(null);
  const requireLogin = new URLSearchParams(location.search).get('requireLogin') !== 'false';

  // 真实聚合（含 mirror 镜像兜底源）：挂载、登录成功、图谱刷新共用同一条读取路径
  const loadFeed = useCallback(async () => {
    const mirrorItems: MirrorItem[] = await fetchMirrorItems().catch(() => []);
    return getHomeFeed(storage, { mirrorItems }).catch((e) => ({
      raw: EMPTY_FEED,
      sync: emptySync(),
      graph: emptyLayerGraph(),
      effectGains: emptyOnboardGains(),
      storageError: (e as { message?: string })?.message ?? String(e),
    }));
  }, [storage]);

  // 挂载后异步聚合真实 feed
  useEffect(() => {
    let alive = true;
    loadFeed().then((res) => {
      if (!alive) return;
      setRaw(res.raw);
      setSync(res.sync);
      setGraph(res.graph);
      setEffectGains(res.effectGains);
      setStorageError(res.storageError);
    });
    return () => { alive = false; };
  }, [loadFeed]);

  const onTrace = (id: string) => {
    setTraceId(id);
    setTraceHits(null);
    coreTraceLookup(id) // 真查 home 账本（失败/未收录 → 空数组）
      .then((hits) => setTraceHits(hits))
      .catch(() => setTraceHits([]));
  };

  // 登录成功后刷新真实 feed（内核账本可能已因本次会话动作发生变化）
  const loginFn: LoginFn = async (input: LoginForm) => {
    const r = await mirror.login(input);
    const res = await loadFeed();
    setRaw(res.raw);
    setSync(res.sync);
    setGraph(res.graph);
    setEffectGains(res.effectGains);
    setStorageError(res.storageError);
    return r;
  };

  // 图谱「刷新」：重新读取内核账本（真实聚合，失败保持旧数据并以动作日志记录）
  const refreshGraph = useCallback(async () => {
    const res = await loadFeed();
    setRaw(res.raw);
    setSync(res.sync);
    setGraph(res.graph);
    setEffectGains(res.effectGains);
    setStorageError(res.storageError);
  }, [loadFeed]);

  return (
    <>
      <HomePage
        raw={raw}
        sync={sync}
        graph={graph}
        effectGains={effectGains}
        storageError={storageError}
        loginFn={loginFn}
        onLogout={mirror.logout}
        onTrace={onTrace}
        onRefreshGraph={refreshGraph}
        requireLogin={requireLogin}
      />
      {traceId && (
        <div className="audit-modal" id="auditModal" role="dialog" onClick={() => setTraceId(null)}>
          <div className="audit-box" onClick={(e) => e.stopPropagation()}>
            <h3>溯源审计</h3>
            <div className="audit-rid" id="auditRid">request_id: {traceId}</div>
            {traceHits !== null && (
              <div id="auditHits" style={{ fontSize: 12, marginTop: 6 }}>
                {traceHits.length === 0
                  ? <span className="dim">home 账本未收录该 request_id（页面动作在内核账本留痕）</span>
                  : traceHits.map((h, i) => (
                    <div key={i}>#{h.seq ?? '-'} [{h.source}] {h.action}</div>
                  ))}
              </div>
            )}
            <button className="btn" id="btnCloseAudit" type="button" onClick={() => setTraceId(null)}>关闭</button>
          </div>
        </div>
      )}
    </>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 index.html）');

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
