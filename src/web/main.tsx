// 概览页入口（index.html）：批次57-B 按 Stratum A 版式整页重做（总览工作台），替换旧 .ovx 首页。
// 数据由 OverviewPage 内的 loadOverview() 单次读取真实账本/审计/主进程遥测/health/billing/会话；读不到显示真实原因。
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
