// 审计日志页（REQ-011 / P11）入口：挂载 AuditPage。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { AuditPage } from './AuditPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><AuditPage /></StrictMode>);
