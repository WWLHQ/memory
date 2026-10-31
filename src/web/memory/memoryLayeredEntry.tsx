// 记忆层级管理页入口（REQ-006 / P8 · 19.11）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { MemoryLayeredPage } from './MemoryLayeredPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><MemoryLayeredPage /></StrictMode>);
