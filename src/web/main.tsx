// 概览页入口（index.html）：按定稿 .ovx 版式整页重做，替换旧首页（问候语 + emoji 大卡）。
// 数据由 OverviewPage 内的 loadOverview() 单次读取真实账本/health/billing/会话；读不到显示真实原因。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './shared/actionLog.ts';
import { installHostBridge } from '../desktop/hostBridge.ts';
import { OverviewPage } from './overview/OverviewPage.tsx';

installHostBridge();

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 index.html）');

createRoot(el).render(
  <StrictMode>
    <OverviewPage />
  </StrictMode>,
);
