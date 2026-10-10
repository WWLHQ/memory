// 监控仪表盘（REQ-006 / P6）入口（T1 壳）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MonitorPage } from './MonitorPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><MonitorPage /></StrictMode>);
