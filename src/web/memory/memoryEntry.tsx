// 记忆管理页（REQ-006 / P8）入口：挂载 MemoryPage。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryPage } from './MemoryPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><MemoryPage /></StrictMode>);
