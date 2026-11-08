// 检索页（REQ-012）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { RetrievalPage } from './RetrievalPage.tsx';
import '../shared/theme.css';
import '../shared/p0.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><RetrievalPage /></StrictMode>);
