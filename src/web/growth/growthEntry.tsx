// 自我净化与生长页（REQ-009 / P14）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { GrowthPage } from './GrowthPage.tsx';
import '../shared/theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><GrowthPage /></StrictMode>);
