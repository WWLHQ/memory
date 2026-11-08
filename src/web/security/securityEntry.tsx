// 账号与安全页（REQ-006 / P12）入口（T1 壳）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { SecurityPage } from './SecurityPage.tsx';
import '../shared/p0.css';
import '../shared/p0Legacy.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><SecurityPage /></StrictMode>);
