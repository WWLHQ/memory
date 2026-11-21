// 冲突裁决页（REQ-006 / P7）入口：挂载 DisputePage（批次53 起 af 化版式，p0-pagehead 旧版式类清零）。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import '../shared/p0.css';
import '../shared/legacyLight.css';
import { DisputePage } from './DisputePage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><DisputePage /></StrictMode>);
