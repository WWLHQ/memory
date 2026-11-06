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

const WRITE_VIEW: View = { id: 'write', ic: '✍️', lbl: '写入页', desc: 'P2 · 写入 + 六维查重（6.1）+ L1–L6 回执', src: '/write.html', req: 'REQ-006' };
const AUDIT_VIEW: View = { id: 'audit', ic: '📋', lbl: '审计日志页', desc: 'P11 · 4.3 统一审计 + request_id 追踪', src: '/audit.html', req: 'REQ-006' };

const VIEWS: View[] = [
  { id: 'login', ic: '🏠', lbl: '首页 + 登录卡片', desc: 'P0 落地页含登录态 · 团队管理员分配 · 功劳收口', src: '/index.html', req: 'REQ-005' },
  { id: 'agent', ic: '🔌', lbl: 'Agent 接入配置页', desc: '⚡一键接入 · 双通道 · 隔离 · 效果证据', src: '/agentonboard.html', req: 'REQ-003' },
  // 批次48 A30：REQ-004 内联标识是演示产物，保留页面与浮层（生产构建可达），但**不进入主导航**。
  // 直接访问 inlineattribution.html / floatattribution.html 可见（页面顶部强制演示标识）。
  { id: 'memory', ic: '🗂️', lbl: '记忆库管理页', desc: 'P8 · 列表 + 17.3 操作（记住/忘记/置顶/锁定/归档）', src: '/memory.html', req: 'REQ-006' },
  { id: 'memory-layered', ic: '📚', lbl: '记忆层级管理页', desc: 'P8 · L0-L6 全层查阅（19.11）· L0 需授权+密码', src: '/memory-layered.html', req: 'REQ-006' },
  { id: 'lifecycle', ic: '⏳', lbl: '生命周期页', desc: 'P4 · 六态机（9.10）+ 调参（17.4/17.5）', src: '/lifecycle.html', req: 'REQ-006' },
  { id: 'growth', ic: '🌱', lbl: '自我净化与生长页', desc: 'REQ-009 P14 · 五维查重 + 短路嫁接 + 自生长收益', src: '/growth.html', req: 'REQ-009' },
  { id: 'dispute', ic: '⚖️', lbl: '冲突裁决页', desc: 'P7 · 人工审核队列 + 9.7 三模式裁决', src: '/dispute.html', req: 'REQ-006' },
  { id: 'params', ic: '🧩', lbl: '全局参数页', desc: 'P5 · 17.6 文案化配置 + 记忆库管理（保存位置/自动备份）+ 开发者模式', src: '/params.html', req: 'REQ-006' },
  { id: 'monitor', ic: '📡', lbl: '监控仪表盘', desc: 'P6 · 12.1 指标卡 + 12.2 告警时间线', src: '/monitor.html', req: 'REQ-006' },
  { id: 'feedback', ic: '💬', lbl: '用户反馈页', desc: 'P9 · 13.7 反馈表单 + 7.1/7.2 统计', src: '/feedback.html', req: 'REQ-006' },
  { id: 'security', ic: '🔐', lbl: '账号与安全页', desc: 'P12 · 4.2 密码策略 + 18.2-A 用户团队', src: '/security.html', req: 'REQ-006' },
  { id: 'recall', ic: '🔎', lbl: '检索页', desc: 'REQ-012 · 透明化召回 + 模式分流', src: '/retrieval.html', req: 'REQ-012' },
  { id: 'logs', ic: '📜', lbl: '日志记录页', desc: 'REQ-011 P15 · 全动作事件流 + 异常聚合', src: '/logs.html', req: 'REQ-011' },
  { id: 'models', ic: '🧬', lbl: '大模型配置页', desc: 'REQ-009 P13 · 向量模型 + 四用途 + 反代理映射', src: '/models.html', req: 'REQ-009' },
  WRITE_VIEW,
  AUDIT_VIEW,
];

const PLANNED: View[] = [];

export function Overview() {
  const [active, setActive] = useState('login');
  const cur = VIEWS.find((v) => v.id === active) ?? VIEWS[0];
  // 透传顶层 ?backend= 和 ?agentBackend= 给 iframe 内的子页面（首页/接入页均支持该覆盖），
  // 便于把通览 demo 整体指向指定后端，也便于 E2E 各 spec 用独立端口互不干扰。
  const backend = new URLSearchParams(location.search).get('backend');
  const agentBackend = new URLSearchParams(location.search).get('agentBackend');
  const withBackend = (src: string) => {
    const params = new URLSearchParams();
    if (backend) params.set('backend', backend);
    if (agentBackend) params.set('agentBackend', agentBackend);
    const qs = params.toString();
    return qs ? `${src}?${qs}` : src;
  };

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

  /** 悬浮覆盖层：启动独立无边框透明置顶窗，贴 Claude Desktop 窗口旁显示内联标识 */
  function openFloatLayer() {
    const api = (window as unknown as { api?: { floatAttribution?: { open: () => Promise<{ ok: boolean; error?: string }> } } }).api;
    if (api?.floatAttribution?.open) {
      void api.floatAttribution.open().then((res) => {
        if (res.ok) {
          alert('悬浮覆盖层已启动（透明置顶窗，自动贴 Claude Desktop 窗口旁）。\n若未看到挂件：① 确认 Claude Desktop 已打开 ② 挂件可能被 Claude 窗口遮挡，移动 Claude 试试');
        } else {
          alert('启动悬浮层失败：' + (res.error ?? '未知错误') + '\n请查看主进程日志（控制台）');
        }
      });
    } else {
      alert('悬浮覆盖层功能仅在 Electron 桌面版中可用（当前为纯浏览器模式，无 preload 桥）。');
    }
  }

  return (
    <>
      <div className="top">
        <span className="logo">🧠 多 Agent 记忆助手 · UI 通览</span>
        <span className="tag">REQ-005 首页 / REQ-003 接入页 / REQ-006 记忆·写入·审计·生命周期·冲突</span>
        <span className="right">{VIEWS.length} 个已落地视图 · iframe 隔离</span>
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
              style={{ marginLeft: 8, textDecoration: 'none' }}
              href={withBackend(cur.src)}
              target="_blank"
              rel="noreferrer"
            >
              新窗口打开
            </a>
          )}
          <button
            className="btn"
            style={{ marginLeft: 'auto', background: '#9d6bff', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
            onClick={openFloatLayer}
            title="演示：启动独立透明悬浮窗，贴 Claude Desktop 窗口旁显示内联记忆标识（非正式功能入口）"
          >
            🧠 悬浮标识层（演示）
          </button>
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
