// 大模型配置页（REQ-009 / P13）入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelsPage } from './ModelsPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><ModelsPage /></StrictMode>);
