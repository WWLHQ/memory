// MCP 接入页入口（2026-11-21）：独立页面挂载点。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import '../shared/p0.css';
import '../shared/p0Legacy.css';
import { McpPage } from './McpPage.tsx';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><McpPage /></StrictMode>);
