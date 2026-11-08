// 写入页（REQ-006 / P2）入口：挂载 WritePage。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { WritePage } from './WritePage.tsx';
import '../shared/p0.css';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><WritePage /></StrictMode>);
