// 用户反馈页（REQ-006 / P9）入口（T1 壳）
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FeedbackPage } from './FeedbackPage.tsx';
import './theme.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><FeedbackPage /></StrictMode>);
