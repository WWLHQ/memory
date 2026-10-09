// REQ-003 + REQ-005 配合展示（通览演示页）
// 结构/样式对齐 design/ui/index.html：顶部 logo 条 + 左侧视图导航 + 右侧 iframe 舞台。
// 仅收录已真实落地的视图；未实现的原型视图标注「规划中」并禁用，避免给出不可用入口。
import { useState } from 'react';
import './theme.css';

interface View {
  id: string;
  ic: string;
  lbl: string;
  desc: string;
  /** 真实页面地址；null = 尚未落地 */
  src: string | null;
  req: string;
}

const VIEWS: View[] = [
  { id: 'login', ic: '🏠', lbl: '首页 + 登录卡片', desc: 'P0 落地页含登录态 · 团队管理员分配 · 功劳收口', src: '/index.html', req: 'REQ-005' },
  { id: 'agent', ic: '🔌', lbl: 'Agent 接入配置页', desc: '⚡一键接入 · 双通道 · 隔离 · 效果证据', src: '/agentonboard.html', req: 'REQ-003' },
];

const PLANNED: View[] = [
  { id: 'recall', ic: '🔎', lbl: '检索页', desc: '8 条验收用例 · 透明化召回', src: null, req: '规划中' },
  { id: 'inline', ic: '🧠', lbl: 'Agent 界面内联标识', desc: '让功劳当场可见（19.7）', src: null, req: '规划中' },
  { id: 'audit', ic: '📋', lbl: '审计日志页', desc: 'request_id 可溯源 · 4.3 统一审计', src: null, req: '规划中' },
];

export function Overview() {
  const [active, setActive] = useState('login');
  const cur = VIEWS.find((v) => v.id === active) ?? VIEWS[0];
  // 透传顶层 ?backend= 给 iframe 内的子页面（首页/接入页均支持该覆盖），
  // 便于把通览 demo 整体指向指定后端，也便于 E2E 各 spec 用独立端口互不干扰。
  const backend = new URLSearchParams(location.search).get('backend');
  const withBackend = (src: string) => (backend ? `${src}?backend=${encodeURIComponent(backend)}` : src);

  return (
    <>
      <div className="top">
        <span className="logo">🧠 多 Agent 记忆助手 · UI 通览</span>
        <span className="tag">REQ-005 首页 / REQ-003 接入页</span>
        <span className="right">2 个已落地视图 · iframe 隔离</span>
      </div>
      <div className="body">
        <div className="nav" id="nav">
        <div className="grp">已落地</div>
        {VIEWS.map((v) => (
          <div
            key={v.id}
            className={`item${v.id === active ? ' active' : ''}`}
            onClick={() => setActive(v.id)}
          >
            <span className="ic">{v.ic}</span>
            <span className="lbl">
              {v.lbl}
              <span className="desc">{v.desc}</span>
            </span>
          </div>
        ))}
        <div className="grp">规划中（尚未实现）</div>
        {PLANNED.map((v) => (
          <div key={v.id} className="item" style={{ opacity: 0.42, cursor: 'not-allowed' }}>
            <span className="ic">{v.ic}</span>
            <span className="lbl">
              {v.lbl}
              <span className="desc">{v.desc}</span>
            </span>
          </div>
        ))}
        </div>
      <div className="main">
        <div className="stagebar">
          <b>{cur.lbl}</b>
          <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 11 }}>
            {cur.req} · {cur.src}
          </span>
          {cur.src && (
            <a
              className="btn"
              style={{ marginLeft: 'auto', textDecoration: 'none' }}
              href={withBackend(cur.src)}
              target="_blank"
              rel="noreferrer"
            >
              新窗口打开
            </a>
          )}
        </div>
        {cur.src ? (
          <iframe id="stage" title={cur.lbl} src={withBackend(cur.src)} style={{ flex: 1, border: 0, width: '100%' }} />
        ) : (
          <div style={{ padding: 40, color: 'var(--muted)' }}>尚未实现</div>
        )}
      </div>
      </div>
    </>
  );
}
