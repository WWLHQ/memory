// 全局参数页（REQ-006 / P5）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import '../shared/p0.css';
import '../shared/p0Legacy.css';
import { ParamsPage } from './ParamsPage.tsx';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><ParamsPage /></StrictMode>);
