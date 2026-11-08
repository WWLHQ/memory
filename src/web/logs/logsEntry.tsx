// 日志记录页（REQ-011 / P15）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import '../shared/theme.css';
import '../shared/p0.css';
import { LogsPage } from './LogsPage.tsx';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><LogsPage /></StrictMode>);
