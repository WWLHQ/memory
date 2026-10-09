// REQ-003 + REQ-005 通览演示页入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Overview } from './Overview.tsx';

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 overview.html）');

createRoot(el).render(
  <StrictMode>
    <Overview />
  </StrictMode>,
);
