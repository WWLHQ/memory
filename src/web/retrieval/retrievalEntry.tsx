// 检索页（REQ-012）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RetrievalPage } from './RetrievalPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><RetrievalPage /></StrictMode>);
