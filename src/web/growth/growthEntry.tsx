// 自我净化与生长页（REQ-009 / P14）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import '../shared/p0.css';
import '../shared/p0Legacy.css';
import { GrowthPage } from './GrowthPage.tsx';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><GrowthPage /></StrictMode>);
