// 工作台壳层入口（批次48 S1）：Electron 主窗口加载 workspace.html。
// 顶层必须安装宿主桥：中心区 iframe 内的真实页面拿不到 preload，经消息桥复用 storage/l0/sync 等能力。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { installHostBridge } from '../../desktop/hostBridge.ts';
import { Workspace } from './Workspace.tsx';
import './theme.css';

installHostBridge();

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 workspace.html）');

createRoot(el).render(
  <StrictMode>
    <Workspace />
  </StrictMode>,
);
