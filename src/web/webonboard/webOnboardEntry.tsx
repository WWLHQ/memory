// 网页端接入页入口（2026-11-19 新增）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import '../shared/p0.css';
import '../shared/p0Legacy.css';
import { WebOnboardPage } from './WebOnboardPage.tsx';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><WebOnboardPage /></StrictMode>);
