// REQ-003 + REQ-005 通览演示页入口
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import { Overview } from './Overview.tsx';
import { installHostBridge } from '../../desktop/hostBridge.ts';

// 顶层窗口（有 preload 的主 frame）必须安装宿主桥：iframe 内的子页面拿不到 preload，
// 经消息桥复用本窗口的 storage/hostScan 能力（否则子页面误判"非桌面壳环境"并读不到真实账本）。
installHostBridge();

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失（检查 overview.html）');

createRoot(el).render(
  <StrictMode>
    <Overview />
  </StrictMode>,
);
