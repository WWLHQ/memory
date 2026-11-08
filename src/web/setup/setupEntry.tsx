// 首启向导入口（批次37-B）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { SetupPage } from './SetupPage.tsx';
import '../shared/theme.css';
import '../shared/p0.css';
import '../shared/legacyLight.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><SetupPage /></StrictMode>);
