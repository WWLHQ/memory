// 浏览器入口：把逻辑核心 + 渲染层接到原型 HTML 的真实 DOM（REQ-003 T3~T8 / T10）
// 用法：用静态服务器打开 app.html（ES module 需 http，不可 file:// 直开）：
//   python -m http.server 8080  →  http://localhost:8080/src/agentOnboard/app.html
import { AgentOnboardService } from './service.js';
import { renderOnboardPage, renderCard, renderTestPanel } from './render.js';

const svc = new AgentOnboardService();
const form = detectForm();

function detectForm() {
  // 19.10 运行时检测当前端；真实端壳注入，这里用 UA 粗判
  const ua = navigator.userAgent;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';
  if (/Mac/.test(ua)) return 'mac';
  if (/Android|iPhone|iPad|Mobile/.test(ua)) return 'mobile';
  if (/cli|node/i.test(ua)) return 'cli';
  return 'desktop';
}

function paint() {
  const app = document.getElementById('app');
  const cards = [...svc.cards.values()];
  app.innerHTML = renderOnboardPage({ cards, form });
  wire(app);
  window.__painted = true;
}

function wire(root) {
  root.querySelectorAll('[data-act="test"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.closest('.agent-card').dataset.agent;
      svc.testConnect(name);
      paint();
    });
  });
  root.querySelectorAll('[data-act="rotate"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      svc.rotateKey(btn.closest('.agent-card').dataset.agent);
      paint();
    });
  });
  root.querySelectorAll('[data-act="revoke"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      svc.revokeKey(btn.closest('.agent-card').dataset.agent);
      paint();
    });
  });
  // 一键接入主按钮（T4 四段进度条）
  const one = document.getElementById('oneclick');
  if (one) one.addEventListener('click', () => {
    svc.oneClickOnboard(
      [
        { name: 'deepseek harness', priority: 'P0', signal: 'MCP注册表' },
        { name: 'Claude Code', priority: 'P1', signal: '本机进程' },
        { name: 'Codex', priority: 'P2', signal: 'Webhook心跳' },
      ],
      form,
    );
    paint();
  });
}

// 暴露到全局，便于控制台联调
window.__svc = svc;
paint();
