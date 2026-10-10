// REQ-003 + REQ-005 配合展示（通览演示页）
// 结构/样式对齐 design/ui/index.html：顶部 logo 条 + 左侧视图导航 + 右侧 iframe 舞台。
// 仅收录已真实落地的视图；未实现的原型视图标注「规划中」并禁用，避免给出不可用入口。
// 登录门控：点击非登录视图时若未登录 → 自动切回登录视图并 toast 提示。
import { useState } from 'react';
import { hasActiveSession } from '../Home/crossTabAuth.ts';
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
  { id: 'inline', ic: '🧠', lbl: 'Agent 界面内联标识', desc: '让功劳当场可见（19.7）· 对话内联 🧠/⚡/📎/⚠️ · 可干预', src: '/inlineattribution.html', req: 'REQ-004' },
  { id: 'memory', ic: '🗂️', lbl: '记忆管理页', desc: 'P8 · 列表 + 17.3 操作（记住/忘记/置顶/锁定/归档）', src: '/memory.html', req: 'REQ-006' },
  { id: 'write', ic: '✍️', lbl: '写入页', desc: 'P2 · 写入 + 六维查重（6.1）+ L1–L6 回执', src: '/write.html', req: 'REQ-006' },
  { id: 'audit', ic: '📋', lbl: '审计日志页', desc: 'P11 · 4.3 统一审计 + request_id 追踪', src: '/audit.html', req: 'REQ-006' },
  { id: 'lifecycle', ic: '⏳', lbl: '生命周期页', desc: 'P4 · 六态机（9.10）+ 调参（17.4/17.5）', src: '/lifecycle.html', req: 'REQ-006' },
  { id: 'dispute', ic: '⚖️', lbl: '冲突裁决页', desc: 'P7 · 人工审核队列 + 9.7 三模式裁决', src: '/dispute.html', req: 'REQ-006' },
];

const PLANNED: View[] = [
  { id: 'recall', ic: '🔎', lbl: '检索页', desc: '8 条验收用例 · 透明化召回', src: null, req: '规划中' },
];

export function Overview() {
  const [active, setActive] = useState('login');
  const cur = VIEWS.find((v) => v.id === active) ?? VIEWS[0];
  // 透传顶层 ?backend= 给 iframe 内的子页面（首页/接入页均支持该覆盖），
  // 便于把通览 demo 整体指向指定后端，也便于 E2E 各 spec 用独立端口互不干扰。
  const backend = new URLSearchParams(location.search).get('backend');
  const withBackend = (src: string) => (backend ? `${src}?backend=${encodeURIComponent(backend)}` : src);

  // 登录门控：非登录视图需先登录；未登录时点击 → 切回登录视图
  function handleNavClick(v: typeof VIEWS[number]) {
    if (v.id === 'login') {
      setActive(v.id);
      return;
    }
    if (!hasActiveSession()) {
      alert('请先登录后再访问该页面。\n\n点击确定后跳转至「首页 + 登录卡片」。');
      setActive('login');
      return;
    }
    setActive(v.id);
  }

  return (
    <>
      <div className="top">
        <span className="logo">🧠 多 Agent 记忆助手 · UI 通览</span>
        <span className="tag">REQ-005 首页 / REQ-003 接入页 / REQ-004 内联标识 / REQ-006 记忆·写入·审计·生命周期·冲突</span>
        <span className="right">8 个已落地视图 · iframe 隔离</span>
      </div>
      <div className="body">
        <div className="nav" id="nav">
        <div className="grp">已落地</div>
        {VIEWS.map((v) => (
          <div
            key={v.id}
            className={`item${v.id === active ? ' active' : ''}`}
            onClick={() => handleNavClick(v)}
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
