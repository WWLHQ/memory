// 网页端接入页（2026-11-19 新增）：功能导航「连接」组的网页端接入视图。
//
// 职责：承载网页会话自动采集的全部控件（自参数页迁入）；
// 数据口径与迁入前完全一致——只显示主进程回执的真值，不伪造任何读数。
import { useHostTheme } from '../shared/hostTheme.ts';
import { WebchatAutoCard } from './WebchatAutoCard.tsx';
import { WebChatExportCard } from '../AgentOnboard/WebChatExportCard.tsx';

export function WebOnboardPage() {
  useHostTheme();
  return (
    <div className="p0-page" data-testid="webonboard-page">
      <div className="p0-hd">
        <h2>🌐 网页端接入</h2>
        <span className="p0-tag">连接 · 网页会话自动采集</span>
      </div>
      <div className="sub">
        网页端会话自动导出的接入与运维：站点登录、定时巡检、立即采一轮、补齐历史会话、导出目录。
        卡片「网页会话自动采集」自全局参数页迁入（2026-11-19），控件与真值口径未变。
        卡片「自带插件导出（网页版对话接入）」自 Agent 接入页迁入（2026-11-21），原页不再展示。
      </div>
      <WebchatAutoCard />
      {/* 迁入卡沿用 af-* 版式：外层补 .aob-page 以提供其设计令牌，高度自适应不撑满 */}
      <div className="aob-page" style={{ height: 'auto', minHeight: 0, background: 'transparent' }}>
        <WebChatExportCard />
      </div>
    </div>
  );
}
