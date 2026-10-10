// P13-T3 LLM 四用途表：本地/网络复选 + 端点/Key 脱敏槽 + 温度 + 超时 + fallback 恒开（R1/R2/R3/R4）
import type { LlmUsage, UsageConfig } from './types.ts';
import { USAGE_KEYS, USAGE_LABELS } from './seed.ts';
import { FALLBACK_ALWAYS_ON, maskKey } from './logic.ts';

interface Props {
  usages: Record<LlmUsage, UsageConfig>;
  onChange: (usage: LlmUsage, patch: Partial<UsageConfig>) => void;
}

export function LlmUsageTable({ usages, onChange }: Props) {
  return (
    <div className="card" data-testid="usage-table">
      <b>LLM 用途分配（13.2）</b>
      <div className="note">
        R1 每用途至少一个可用模型 · C3 勾网络通道必须配端点 · R2 Key 只存内存、界面脱敏 ·
        R4 judge 温度恒 0 · R3 fallback_local 恒开（无关闭入口）。
      </div>
      <table className="ltable" data-testid="usage-rows">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>用途</th>
            <th>本地</th>
            <th>网络</th>
            <th style={{ textAlign: 'left' }}>端点</th>
            <th style={{ textAlign: 'left' }}>API Key</th>
            <th>温度</th>
            <th>超时(s)</th>
          </tr>
        </thead>
        <tbody>
          {USAGE_KEYS.map((u) => {
            const cfg = usages[u];
            const judgeLocked = u === 'judge'; // R4
            return (
              <tr key={u} data-testid={`usage-${u}`}>
                <td style={{ textAlign: 'left' }}>{USAGE_LABELS[u]}</td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    data-testid={`usage-${u}-local`}
                    checked={cfg.local}
                    onChange={(e) => onChange(u, { local: e.target.checked })}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    data-testid={`usage-${u}-net`}
                    checked={cfg.net}
                    onChange={(e) => onChange(u, { net: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    data-testid={`usage-${u}-endpoint`}
                    value={cfg.endpoint}
                    disabled={!cfg.net}
                    placeholder={cfg.net ? 'https://…' : '—'}
                    onChange={(e) => onChange(u, { endpoint: e.target.value })}
                    style={{ width: 200 }}
                  />
                </td>
                <td>
                  {cfg.apiKey ? (
                    <span data-testid={`usage-${u}-masked`} className="dim">{maskKey(cfg.apiKey)}</span>
                  ) : (
                    <input
                      data-testid={`usage-${u}-key`}
                      type="password"
                      placeholder="未配置"
                      disabled={!cfg.net}
                      onChange={(e) => onChange(u, { apiKey: e.target.value })}
                      style={{ width: 140 }}
                    />
                  )}
                </td>
                <td>
                  <input
                    data-testid={`usage-${u}-temp`}
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={cfg.temperature}
                    disabled={judgeLocked}
                    title={judgeLocked ? 'R4：裁决用途温度恒 0' : undefined}
                    onChange={(e) => onChange(u, { temperature: Number(e.target.value) })}
                    style={{ width: 64 }}
                  />
                </td>
                <td>
                  <input
                    data-testid={`usage-${u}-timeout`}
                    type="number"
                    min={1}
                    value={cfg.timeoutSec}
                    onChange={(e) => onChange(u, { timeoutSec: Number(e.target.value) })}
                    style={{ width: 64 }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="note" style={{ marginTop: 8 }}>
        fallback_local：{FALLBACK_ALWAYS_ON ? '恒开 ✓' : '关'} —— 网络/代理不可用时一律回退本地模型（R3，无关闭入口）。
      </div>
    </div>
  );
}
