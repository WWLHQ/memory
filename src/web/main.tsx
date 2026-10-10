// 应用入口（REQ-005 首页路由 · T12 路由决策：首页 = HomePage，覆盖 REQ-003 默认页）
// 挂载 HomePage，注入 T11 后端镜像 useLoginMirror（自动读 URL ?backend= 覆盖地址，缺省 :8200）；
// 四卡为原型 §0.2 快照（UI 硬约束）；.rid 溯源真查 home server mirror 账本（coreHome）。
// AgentOnboard 页迁至 agentonboard.html 入口（保留 REQ-003 验证）。
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HomePage } from './Home/HomePage.tsx';
import { useLoginMirror } from './Home/useLoginMirror.ts';
import { coreTraceLookup, type TraceHit } from './Home/coreHome.ts';
import './Home/theme.css'; // REQ-005 原型主题（逐字提取自 design/ui/登录与首页_原型.html）
import type { RawHomeFeed } from '../home/dashboard.ts';
import type { SyncState } from '../types/home.ts';

/** 种子数据：逐字对齐 design/ui/登录与首页_原型.html 的 gains / 异常速览 / 活跃记忆 / 待办（UI 硬约束） */
const SEED: RawHomeFeed = {
  gains: [
    { icon: '🪙', title: 'Token 节省', big: '-58%', desc: 'payload 780/1500 · 极简 ≤600t', src: '原型 §0.2' },
    { icon: '⚡', title: '效率提升', big: '-34%', desc: '免重复背景交代 · 踩坑复用', src: '原型 §0.2' },
    { icon: '🔁', title: '跨 Agent 复用', big: '3.2×', desc: '1 次沉淀 · 4 端共享（19.4）', src: '原型 §0.2' },
    { icon: '💸', title: '模型成本（反代理 19.8）', big: '省¥19/月', desc: 'auto 先免费后低价 · 单价≤¥0.02/千', src: '原型 §0.2' },
  ],
  anomalies: [
    { level: 'error', title: 'Codex 熔断 OPEN', detail: 'desktop/Codex · 连续失败≥5', request_id: 'req_x1', jump: 'P10' },
    { level: 'error', title: 'Web 同步对账超时', detail: 'sync_fail · fontweb', request_id: 'req_x2', jump: 'P15' },
    { level: 'warn', title: '反代理 claude-free 额度 90%', detail: '临 proxy_budget', request_id: 'req_x3', jump: 'P13' },
  ],
  activeMemories: [
    { title: '为什么上次重构失败', hits: 12, decayClass: 'hot', request_id: 'req_001' },
    { title: '项目技术栈约束', hits: 5, decayClass: 'warm', request_id: 'req_002' },
  ],
  todos: [
    { label: '待裁决 3 条 [跳 P8]', detail: '9.7 冲突队列', request_id: 'req_003', kind: 'dispute' },
  ],
};

const SEED_SYNC: SyncState = {
  form: 'desktop',
  role: 'primary',
  lastReconcileAt: Date.now(),
  pendingSync: 0,
};

function App() {
  // useLoginMirror 自动读取 URL ?backend= 作为后端地址（缺省 http://localhost:8200）
  const mirror = useLoginMirror();
  const [traceId, setTraceId] = useState<string | null>(null);
  const [traceHits, setTraceHits] = useState<TraceHit[] | null>(null);
  // 未登录门控：首页 / AgentOnboard 等受保护页面默认 requireLogin=true；
  // 内联标识演示页（inlineattribution.html）不要求登录，传 false 即可。
  const requireLogin = new URLSearchParams(location.search).get('requireLogin') !== 'false';

  const onTrace = (id: string) => {
    setTraceId(id);
    setTraceHits(null);
    coreTraceLookup(id) // 真查 home 账本（失败/未收录 → 空数组）
      .then((hits) => setTraceHits(hits))
      .catch(() => setTraceHits([]));
  };

  return (
    <>
      <HomePage
        raw={SEED}
        sync={SEED_SYNC}
        loginFn={mirror.login}
        onLogout={mirror.logout}
        onTrace={onTrace}
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
