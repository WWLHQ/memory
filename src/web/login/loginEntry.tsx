// 登录页入口（login.html）：真实 /api/login，会话写入 localStorage（session:realpage）。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { installHostBridge } from '../../desktop/hostBridge.ts';
import { LoginPage } from './LoginPage.tsx';

installHostBridge();

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 login.html）');

createRoot(el).render(
  <StrictMode>
    <LoginPage />
  </StrictMode>,
);
