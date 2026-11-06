// REQ-004 宿主演示页入口
// 批次48 A30：演示页保留且生产构建可达，但页面显著位置强制标明「演示」，不进入通览页主导航。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { DemoBadge } from '../shared/DemoBadge.tsx';
import { AgentConversationDemo } from './AgentConversationDemo.tsx';

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 inlineattribution.html）');

createRoot(el).render(
  <StrictMode>
    <DemoBadge />
    <AgentConversationDemo />
  </StrictMode>,
);
