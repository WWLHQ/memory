// REQ-004 宿主演示页入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentConversationDemo } from './AgentConversationDemo.tsx';

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 inlineAttribution.html）');

createRoot(el).render(
  <StrictMode>
    <AgentConversationDemo />
  </StrictMode>,
);
