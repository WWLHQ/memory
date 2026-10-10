// 日志记录页（REQ-011 / P15）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LogsPage } from './LogsPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><LogsPage /></StrictMode>);
