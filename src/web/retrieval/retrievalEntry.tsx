// 检索页（REQ-012）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { RetrievalPage } from './RetrievalPage.tsx';
// 主题令牌（浅色纸灰 / 深色深空蓝 + --ok/--warn/--bad）由 p0.css 提供；缺这一行本页所有 var() 都会失效
import '../shared/p0.css';
import './retrieval.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><RetrievalPage /></StrictMode>);
