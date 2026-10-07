// 应用入口（规格 T1脚手架 · React 挂载）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentOnboardPage } from './AgentOnboard/AgentOnboardPage.tsx';

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 index.html）');

createRoot(el).render(
  <StrictMode>
    <AgentOnboardPage />
  </StrictMode>,
);