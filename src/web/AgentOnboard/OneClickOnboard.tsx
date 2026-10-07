// 一键接入本机 Agent（规格 T4 / AC-003.4 / 19.9 · 扫→分→绑→验 四段进度 + 自动绑定 + 可撤销）
// ⚠ 硬性约定：结构、class、文案、data-* 属性严格对齐
//    design/ui/Agent接入页_原型.html 的 #onboard 卡（btnDiscover / .sig / .stages / #found），禁止偏离。
import { useState } from 'react';
import type { DiscoveredAgent, Form } from '../../types/agentOnboard.ts';
import { FormBadge, GRAYED_BY_FORM } from './FormBadge.tsx';

const STAGE_DEFS = [
  { key: 'scan', label: '① 扫', desc: '发现注册信号' },
  { key: 'tag', label: '② 分', desc: '自动打标 P0/P1/P2' },
  { key: 'bind', label: '③ 绑', desc: '按默认值绑定' },
  { key: 'verify', label: '④ 验', desc: '测通 + 记审计' },
] as const;

const RUNNING_LABELS = ['扫描注册信号中…', '自动打标 P0/P1/P2 中…', '按默认值绑定中…', '测通并写审计中…'];

const SIGNALS = [
  { value: 'mcp', label: 'MCP 注册表', defChecked: true },
  { value: 'proc', label: '本机进程', defChecked: true },
  { value: 'hb', label: 'Webhook 心跳', defChecked: true },
  { value: 'manual', label: '手动兜底', defChecked: false },
] as const;

interface Props {
  form: Form;
  discovered: DiscoveredAgent[];
  /** 四段动画进行中 */
  running: boolean;
  /** 当前阶段索引（0~3，未开始为 -1） */
  stageIndex: number;
  scanState: string;
  onDiscover: () => void;
  onUnbind: (index: number) => void;
  onSignalChange: (checked: boolean) => void;
}

export function OneClickOnboard(props: Props) {
  const { form, discovered, running, stageIndex, scanState } = props;
  const [signals, setSignals] = useState<Record<string, boolean>>(
    () => Object.fromEntries(SIGNALS.map((s) => [s.value, s.defChecked])),
  );
  const grayed = GRAYED_BY_FORM[form] ?? [];

  const setSignal = (value: string, checked: boolean) => {
    setSignals((prev) => ({ ...prev, [value]: checked }));
    props.onSignalChange(checked);
  };

  return (
    <div className="card" id="onboard">
      <div className="top">
        <button className="btn primary" id="btnDiscover" disabled={running} onClick={props.onDiscover}>
          ⚡ 自动发现并接入本机 Agent
        </button>
        <FormBadge form={form} />
      </div>

      <div className="top" style={{ marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>发现信号源（按 19.10 形态置灰）：</span>
        {SIGNALS.map((s) => {
          const isGrayed = grayed.includes(s.value);
          return (
            <label className="sw" key={s.value} style={isGrayed ? { opacity: 0.4 } : undefined}>
              <input
                type="checkbox"
                className="sig"
                value={s.value}
                checked={isGrayed ? false : !!signals[s.value]}
                disabled={isGrayed}
                onChange={(e) => setSignal(s.value, e.target.checked)}
              />
              {s.label}
            </label>
          );
        })}
        <span className="pill" id="scanState" style={{ marginLeft: 'auto' }}>{scanState}</span>
      </div>

      <div className="stages" id="stages">
        {STAGE_DEFS.map((s, i) => (
          <div className={`stage${i <= stageIndex ? ' done' : ''}`} data-s={s.key} key={s.key}>
            <b>{s.label}</b>
            {i <= stageIndex && running ? RUNNING_LABELS[i] : s.desc}
          </div>
        ))}
      </div>

      <div id="found">
        {discovered.map((d, i) => {
          const st = d.bound
            ? d.ok
              ? <span className="pill on">自动发现 · 已绑定 ✓</span>
              : <span className="pill gold">自动发现 · 已绑定 ⚠ 待手动补</span>
            : <span className="pill">未发现信号 · 需手填端点</span>;
          return (
            <div className={`found${d.bound ? '' : ' unbound'}`} data-disc={i} key={d.name}>
              <span className={`badge ${d.badge}`}>{d.label}</span>
              <span className="agent-name" style={{ fontSize: 13 }}>{d.name}</span>
              <span className="method">信号：{d.signal}</span>
              <span style={{ marginLeft: 'auto' }}>{st}</span>
              {d.bound ? (
                <button className="btn" data-unbind={i} style={{ padding: '4px 10px' }} onClick={() => props.onUnbind(i)}>
                  撤销
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="note">
        原理：<b>发现</b>是技术活（扫本机注册信号），<b>绑定</b>是信任活（全用 19.4/19.5 最合理默认值）——
        所以发现即绑定、绑即可用，用户<b>不需要逐项理解配置</b>。
        默认值：隔离 project_id 共享 + user_id 偏好 · 双通道（Webhook 主 + API 补偿）· 该 Agent 免费/低价模型自动进 19.8 全量映射池。
        安全兜底：自动绑定默认<b>只开只读召回</b>，写入/反代理 P0/P1 按 19.2 放行、<b>P2 须用户确认</b>；每个绑定<b>可一键撤销</b>（审计 unbound）。
        有信号的一律自动，仅<b>无信号</b>的 Agent 才需手填端点。
      </div>
    </div>
  );
}