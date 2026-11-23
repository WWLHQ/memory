// 采集通道配置行（规格 T6 / 19.3 · R4 双通道至少开一 + SHA-256 幂等不可关）
// ⚠ 结构与文案严格对齐原型 renderCards 的「采集通道（19.3）」一行。
import type { UiChan } from '../../types/agentOnboard.ts';

interface Props {
  chan: UiChan;
  onChange: (ch: 'webhook' | 'api', checked: boolean) => void;
}

export function ChannelConfig({ chan, onChange }: Props) {
  return (
    <div className="af-row">
      <span className="dim">采集通道（19.3）：</span>
      <label className="sw">
        <input
          type="checkbox"
          className="af-switch"
          data-chan="webhook"
          checked={chan.webhook}
          onChange={(e) => onChange('webhook', e.target.checked)}
        />
        主 Webhook
      </label>
      <label className="sw">
        <input
          type="checkbox"
          className="af-switch"
          data-chan="api"
          checked={chan.api}
          onChange={(e) => onChange('api', e.target.checked)}
        />
        补偿 API 拉取
      </label>
      <span className="af-badge">对账 {chan.recon}</span>
      <span className="af-badge ok">SHA-256 幂等（不可关）</span>
    </div>
  );
}