// 网页端接入页（2026-11-19 新增）：功能导航「连接」组的网页端接入视图。
//
// 职责：承载网页会话自动采集的全部控件（自参数页迁入）；
// 数据口径与迁入前完全一致——只显示主进程回执的真值，不伪造任何读数。
import { WebchatAutoCard } from './WebchatAutoCard.tsx';

export function WebOnboardPage() {
  return (
    <div className="p0-page" data-testid="webonboard-page">
      <div className="p0-hd">
        <h2>🌐 网页端接入</h2>
        <span className="p0-tag">连接 · 网页会话自动采集</span>
      </div>
      <div className="sub">
        网页端会话自动导出的接入与运维：站点登录、定时巡检、立即采一轮、补齐历史会话、导出目录。
        卡片「网页会话自动采集」自全局参数页迁入（2026-11-19），控件与真值口径未变。
      </div>
      <WebchatAutoCard />
    </div>
  );
}
