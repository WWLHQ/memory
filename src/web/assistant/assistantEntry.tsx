// 记忆助手整页入口（2026-11-10：由壳层悬浮窗改为独立中心页）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { AssistantPage } from './AssistantPage.tsx';
// 与记忆库页同一套主题变量（--text/--muted/--panel/--line/--accent + html[data-theme=dark]），
// 保证助手页与记忆库/壳层在浅色与深色下配色一致。
import '../memory/memoryManagement.css';
import './assistantPage.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><AssistantPage /></StrictMode>);
