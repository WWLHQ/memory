// 全局参数页（REQ-006 / P5）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { ParamsPage } from './ParamsPage.tsx';
import '../shared/theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><ParamsPage /></StrictMode>);
