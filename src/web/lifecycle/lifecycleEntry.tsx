// 生命周期页（REQ-006 / P4）入口：挂载 LifecyclePage。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LifecyclePage } from './LifecyclePage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><LifecyclePage /></StrictMode>);
