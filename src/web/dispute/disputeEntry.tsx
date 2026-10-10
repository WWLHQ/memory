// 冲突裁决页（REQ-006 / P7）入口：挂载 DisputePage。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DisputePage } from './DisputePage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><DisputePage /></StrictMode>);
