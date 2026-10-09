// REQ-003 接入页入口（原 index.html 默认页，因 REQ-005 首页路由决策迁至独立入口，保留 REQ-003 验证）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentOnboardPage } from './AgentOnboardPage.tsx';

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 agentonboard.html）');

createRoot(el).render(
  <StrictMode>
    <AgentOnboardPage />
  </StrictMode>,
);
