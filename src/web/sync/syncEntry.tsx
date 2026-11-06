// 同步与裁决页（批次42-C）入口：挂载 SyncPage。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { SyncPage } from './SyncPage.tsx';
import '../audit/theme.css'; // 与审计页同源主题（表单/表格/卡片/toast 类名一致）
import './theme.css'; // 本页专属（裁决表 / 报告 / toast 状态色）

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><SyncPage /></StrictMode>);
