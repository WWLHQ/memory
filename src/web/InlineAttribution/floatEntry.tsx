// 悬浮覆盖层入口（REQ-004 扩展）：无边框透明窗，**贴合到 Claude Desktop 窗口右侧**显示内联记忆标识。
// 主进程创建 BrowserWindow（frame: false, transparent: true, alwaysOnTop: true）→ 本入口渲染。
// 通过 window.api.floatAttribution.detectClaude() 取 Claude 真实窗口 bounds（P/Invoke GetWindowRect），
// 把悬浮窗贴到其**右侧内沿**（x = claude.right + 8，y 垂直居中于 Claude 内容区），
// 视觉上像"嵌进" Claude 窗口右侧。可手动拖拽，"跟随"开关决定每 2s 是否自动重新贴合。
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/actionLog.ts';
import './inlineAttribution.css';
import './floatLayer.css';
import { DemoBadge } from '../shared/DemoBadge.tsx';
import { AgentConversationDemo } from './AgentConversationDemo.tsx';

/** 悬浮窗贴到 Claude 窗口右侧内沿（原生挂件感） */
function positionFloat(r: { x: number; y: number; width: number; height: number }) {
  const api = window.api?.floatAttribution;
  if (!api) return;
  const FLOAT_W = 280;
  const screenW = window.screen?.width || 1920;
  const RIGHT_GAP = 8;
  // 贴 Claude 右侧：x = claude.right + gap；放不下则贴左侧
  const xRight = r.x + r.width + RIGHT_GAP;
  const x = xRight + FLOAT_W > screenW ? Math.max(0, r.x - FLOAT_W - RIGHT_GAP) : xRight;
  const TITLE_H = 40;
  const y = r.y + TITLE_H;
  api.setPosition(x, y);
}

function FloatWrapper() {
  const [initErr, setInitErr] = useState<string | null>(null);
  const [follow, setFollow] = useState(true); // 跟随 Claude 移动开关（默认开）
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    document.body.classList.add('float-layer');
    const api = window.api?.floatAttribution;
    if (!api) {
      setInitErr('preload 桥缺失（非 Electron 环境）');
      window.api?.floatAttribution?.log?.('preload 桥缺失');
      return;
    }
    // 首次定位
    api.detectClaude().then((r) => {
      if (r) {
        api.log?.(`detectClaude 成功 pos(${r.x},${r.y}) ${r.width}x${r.height}`);
        positionFloat(r);
      } else {
        const cx = Math.round((window.screen?.width || 1920) / 2 - 140);
        const cy = Math.round((window.screen?.height || 1080) / 2 - 260);
        api.log?.(`detectClaude 返回 null，居中兜底 @(${cx},${cy})`);
        api.setPosition(cx, cy);
      }
    }).catch((e: unknown) => {
      const msg = 'detectClaude 失败: ' + String(e);
      setInitErr(msg);
      api.log?.(msg);
    });
    // 每 2s 跟随 Claude 窗口（移动/缩放时重新贴合）；follow 开关关闭则跳过
    const t = setInterval(() => {
      if (!followRef.current) return;
      api.detectClaude().then((r) => {
        if (r) positionFloat(r);
      }).catch(() => { /* 跟随失败不阻塞 */ });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div className="float-dragbar">
        <span className="draglabel">◦ 记忆标识层</span>
        {/* 跟随开关：开=每 2s 自动贴合 Claude；关=停手拖拽定位 */}
        <label className="follow-toggle" title={follow ? '跟随 Claude（开）' : '手动（关）'}>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          <span>跟随</span>
        </label>
        <span className="close" title="关闭" onClick={() => window.api?.floatAttribution?.close()}>✕</span>
      </div>
      {/* 批次48 A30：浮层同为演示产物，显著位置强制标识，不随登录态/账本开关隐藏 */}
      <DemoBadge compact />
      {initErr && (
        <div style={{ margin: '4px 8px', padding: '6px 8px', background: 'rgba(255,92,92,0.15)', border: '1px solid rgba(255,92,92,0.4)', borderRadius: 6, fontSize: 11, color: '#ff8c8c' }}>
          ⚠ {initErr}
        </div>
      )}
      <AgentConversationDemo />
    </div>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('#root 容器缺失');
createRoot(el).render(
  <StrictMode>
    <FloatWrapper />
  </StrictMode>,
);
