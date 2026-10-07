// 浏览器入口：把逻辑核心 + 渲染层接到原型 HTML 的真实 DOM（REQ-003 T3~T8 / T10 / T14）
// 用法：用静态服务器打开 app.html（ES module 需 http，不可 file:// 直开）：
//   python -m http.server 8123  →  http://localhost:8123/src/agentOnboard/app.html
// 后端：app.html 的"后端地址"输入框为空 = 内存模式；填 http://host:port = 走 T13 真实后端（T14）。
import { AgentOnboardService } from './service.js';
import { AgentOnboardClient } from './client.js';
import { renderOnboardPage } from './render.js';

const form = detectForm();

// 后端地址可运行时切换：URL 变化时重建 service（空=内存，非空=HTTP 客户端）
let _svc = null;
let _backendUrl = undefined;
function getSvc() {
  const url = document.getElementById('backend')?.value?.trim();
  if (url !== _backendUrl) {
    _backendUrl = url;
    _svc = url ? new AgentOnboardService(new AgentOnboardClient(url)) : new AgentOnboardService();
  }
  return _svc;
}

function detectForm() {
  // 19.10 运行时检测当前端；真实端壳注入，这里用 UA 粗判
  const ua = navigator.userAgent;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';
  if (/Mac/.test(ua)) return 'mac';
  if (/Android|iPhone|iPad|Mobile/.test(ua)) return 'mobile';
  if (/cli|node/i.test(ua)) return 'cli';
  return 'desktop';
}

function setStatus(msg, color) {
  const b = document.getElementById('boot-status');
  if (b) b.innerHTML = msg ? `<span style="color:${color || '#888'}">${msg}</span>` : '';
}

async function paint() {
  const app = document.getElementById('app');
  const svc = getSvc();
  let cards = [];
  let err = null;
  try {
    cards = await svc.getCards();
  } catch (e) {
    err = e;
  }
  app.innerHTML = renderOnboardPage({ cards, form });
  window.__painted = true;
  if (err) setStatus(`加载卡片失败：${err && err.message || err}（后端不可达或跨域被拦？）`, '#e74c3c');
  else setStatus(_backendUrl ? `已渲染（后端：${_backendUrl}）` : '已渲染（内存模式）', '#2ecc71');
  wire(app);
}

async function onAct(btn, fn) {
  try {
    await fn(getSvc());
    await paint();
  } catch (e) {
    setStatus(`操作失败：${e && e.message || e}（后端不可达或跨域被拦？）`, '#e74c3c');
  }
}

function wire(root) {
  root.querySelectorAll('[data-act="test"]').forEach((btn) => {
    btn.addEventListener('click', () => onAct(btn, (svc) => svc.testConnect(btn.closest('.agent-card').dataset.agent)));
  });
  root.querySelectorAll('[data-act="rotate"]').forEach((btn) => {
    btn.addEventListener('click', () => onAct(btn, (svc) => svc.rotateKey(btn.closest('.agent-card').dataset.agent)));
  });
  root.querySelectorAll('[data-act="revoke"]').forEach((btn) => {
    btn.addEventListener('click', () => onAct(btn, (svc) => svc.revokeKey(btn.closest('.agent-card').dataset.agent)));
  });
  // 一键接入主按钮（T4 四段进度条）
  const one = document.getElementById('oneclick');
  if (one) one.addEventListener('click', () => onAct(one, (svc) => svc.oneClickOnboard(
    [
      { name: 'deepseek harness', priority: 'P0', signal: 'MCP注册表' },
      { name: 'Claude Code', priority: 'P1', signal: '本机进程' },
      { name: 'Codex', priority: 'P2', signal: 'Webhook心跳' },
    ],
    form,
  )));
  // 撤销自动绑定（R9）
  root.querySelectorAll('[data-act="revoke-bind"]').forEach((btn) => {
    btn.addEventListener('click', () => onAct(btn, (svc) => svc.revokeBind(btn.closest('.autobind-card').dataset.agent)));
  });
}

// 暴露到全局，便于控制台联调
window.__getSvc = getSvc;
paint();
