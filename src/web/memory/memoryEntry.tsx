// 记忆管理页入口：六标签统一视图（全部 / 个人 / 分层 / 冲突 / 待重放 / L0）。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { MemoryManagementPage } from './MemoryManagementPage.tsx';
import './memoryManagement.css';

const el = document.getElementById('root');
if (el) createRoot(el).render(<StrictMode><MemoryManagementPage /></StrictMode>);
