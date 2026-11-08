// 同步与裁决页（批次42-C）入口：挂载 SyncPage。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { SyncPage } from './SyncPage.tsx';
import '../shared/p0.css';
import '../shared/p0Legacy.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><SyncPage /></StrictMode>);
