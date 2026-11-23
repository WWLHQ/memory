// 扫描明细卡（规格 T4 / AC-003.4 / 19.9 · 批次48 起 1:1 对齐设计真源 stratum-a-full.html 的 af-panel/af-det 版式）
// 设计稿的「一键接入流水线」三步条在容器层渲染；本卡承载扫描动作与明细：
// 扫描按钮 / 手动检测 / 信号源 / 发现行 / 已安装行 / 原理说明，全部折进 af-det「扫描明细」保留功能。
// 诚实化不变：发现/安装列表只显示真扫结果；未发现不伪造。
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DiscoveredAgent, Form, InstalledAgent } from '../../types/agentOnboard.ts';
import { FormBadge, GRAYED_BY_FORM } from './FormBadge.tsx';

export type { InstalledAgent } from '../../types/agentOnboard.ts';

const VIA_LABEL: Record<InstalledAgent['via'], string> = {
  cli: 'CLI 已装', app: '桌面端已装', startmenu: '开始菜单', config: '配置文件', uninstall: '注册表卸载项',
};

const SIGNALS = [
  { value: 'mcp', label: 'MCP 注册表', defChecked: true },
  { value: 'proc', label: '本机进程', defChecked: true },
  { value: 'hb', label: 'Webhook 心跳', defChecked: true },
  { value: 'manual', label: '手动兜底', defChecked: false },
] as const;

/** 徽标 p0/p1/p2/p3 → 设计稿 af-badge 同色系 */
const BADGE_CLS: Record<string, string> = { p0: 'acc', p1: 'ok', p2: 'warn', p3: '' };

interface Props {
  form: Form;
  discovered: DiscoveredAgent[];
  /** 扫描动画进行中 */
  running: boolean;
  /** 当前阶段索引（0~3，未开始为 -1）；三步流水线在容器层渲染，此处仅供容器传入兼容 */
  stageIndex?: number;
  scanState: string;
  /** 已自动接入（持久化快照恢复）→ 显示「已自动接入」徽章；可选，缺省 false */
  autoOnboarded?: boolean;
  /** 撤销并重接：清所有绑定 + 重跑一键接入；可选 */
  onRebindAll?: () => void;
  onDiscover: () => void;
  onUnbind: (index: number) => void;
  onSignalChange: (checked: boolean) => void;
  /** 已安装 agent 探测结果（CLI/桌面端 App/配置 三路合并；无则隐藏区块） */
  installedAgents?: InstalledAgent[];
  installedProbes?: Record<string, string>;
  installedSource?: 'host' | 'browser' | null;
  installedReason?: string;
  installedBusy?: boolean;
  onManualDetect?: () => void;
  /** 新发现的已安装 agent → 新增宿主接入卡片（默认配置建议；P2/P3 只读召回 + API 兜底） */
  onAddCardForInstalled?: (f: InstalledAgent) => void;
}

interface FoundCardProps {
  badge: string;
  label: string;
  name: string;
  unbound?: boolean;
  dataDisc?: number;
  actions: ReactNode;
  meta: ReactNode;
}

/** 接入卡片统一外壳：首行 badge + 名称 + 右侧操作，次行元信息；发现卡片与已安装卡片共用。 */
function FoundCard({ badge, label, name, unbound = false, dataDisc, actions, meta }: FoundCardProps) {
  return (
    <div className={`found${unbound ? ' unbound' : ''}`} data-disc={dataDisc}>
      <div className="found-head">
        <span className={`af-badge ${BADGE_CLS[badge] ?? ''}`}>{label}</span>
        <b>{name}</b>
        <span className="found-actions">{actions}</span>
      </div>
      <div className="found-meta">{meta}</div>
    </div>
  );
}

export function OneClickOnboard(props: Props) {
  const { form, discovered, running, autoOnboarded = false } = props;
  const installed = props.installedAgents;
  /** 已有接入行的 agent 名 → 已安装列表去重，只显示「新发现」的 */
  const cardNames = new Set(discovered.map((d) => d.name));
  const freshInstalled = installed?.filter((f) => !cardNames.has(f.agent));
  /** 已有接入卡片的命中（显示「已安装 ✓」徽标，不重复进卡片） */
  const installedInCards = installed?.filter((f) => cardNames.has(f.agent));
  const [signals, setSignals] = useState<Record<string, boolean>>(
    () => Object.fromEntries(SIGNALS.map((s) => [s.value, s.defChecked])),
  );
  const grayed = GRAYED_BY_FORM[form] ?? [];

  const setSignal = (value: string, checked: boolean) => {
    setSignals((prev) => ({ ...prev, [value]: checked }));
    props.onSignalChange(checked);
  };

  return (
    <section className="af-panel" id="onboard">
      <div className="af-ph">
        <h3>扫描明细 · 一键接入本机 Agent（19.9）</h3>
        <span className="hint">发现即绑定 · 绑即可用 · 每个绑定可撤销</span>
      </div>
      <div className="af-pb af-stack" style={{ gap: 8 }}>
        <div className="af-row">
          <button className="af-btn pri" id="btnDiscover" disabled={running} onClick={props.onDiscover}>
            ⚡ 自动发现并接入本机 Agent
          </button>
          <button className="af-btn" data-testid="manual-detect" disabled={props.installedBusy} onClick={() => props.onManualDetect?.()}>
            {props.installedBusy ? '探测中…' : '🔍 手动检测'}
          </button>
          <FormBadge form={form} />
          <span className="af-pill" id="scanState" style={{ marginLeft: 'auto' }}>{props.scanState}</span>
        </div>

        {/* 已自动接入徽章（登录/首次接入完成并持久化后显示，切页/重载仍保留） */}
        {autoOnboarded && !running && (
          <div id="autoOnboardBadge" className="af-row">
            <span className="af-pill">✅ 已自动接入 · 切页/重载保持</span>
            <button
              className="af-btn sm"
              id="btnRebindAll"
              style={{ marginLeft: 'auto' }}
              onClick={() => props.onRebindAll?.()}
            >
              ↻ 撤销并重接
            </button>
          </div>
        )}

        <details className="af-det" open={discovered.length > 0 || running}>
          <summary>扫描明细（信号源 / 发现行 / 已安装行 / 原理）</summary>
          <div className="det-b af-stack" style={{ gap: 8 }}>
            <div className="af-row">
              <span className="dim">发现信号源（按 19.10 形态置灰）：</span>
              {SIGNALS.map((s) => {
                const isGrayed = grayed.includes(s.value);
                return (
                  <label className="sw" key={s.value} style={isGrayed ? { opacity: 0.4 } : undefined}>
                    <input
                      type="checkbox"
                      className="af-check sig"
                      value={s.value}
                      checked={isGrayed ? false : !!signals[s.value]}
                      disabled={isGrayed}
                      onChange={(e) => setSignal(s.value, e.target.checked)}
                    />
                    {s.label}
                  </label>
                );
              })}
            </div>

            <div id="found">
              {discovered.map((d, i) => {
                const st = d.bound
                  ? d.ok
                    ? <span className="af-badge ok">自动发现 · 已绑定 ✓</span>
                    : <span className="af-badge warn">自动发现 · 已绑定 ⚠ 待手动补</span>
                  : <span className="af-badge">未发现信号 · 需手填端点</span>;
                const srcLabel = d.source === 'host' ? ' · 宿主真扫' : d.source === 'kernel' ? ' · 内核模拟' : '';
                return (
                  <FoundCard
                    key={d.name}
                    badge={d.badge}
                    label={d.label}
                    name={d.name}
                    unbound={!d.bound}
                    dataDisc={i}
                    actions={
                      <>
                        {st}
                        {d.bound ? (
                          <button className="af-btn sm" data-unbind={i} onClick={() => props.onUnbind(i)}>
                            撤销
                          </button>
                        ) : null}
                      </>
                    }
                    meta={<span className="dim">信号：{d.signal}{srcLabel}</span>}
                  />
                );
              })}
            </div>

            {/* 已安装 Agent（以电脑安装痕迹为准：CLI/安装目录/开始菜单/配置/注册表；不参考运行进程）
             *  去重：已有接入卡片的 agent 不重复进卡片，只显示「新发现」的；新发现可一键加卡片 */}
            {(freshInstalled && freshInstalled.length > 0) || installedInCards?.length ? (
              <div id="installedAgents" data-testid="installed-agents">
                <p className="af-note">
                  已安装的 Agent（{installed?.length ?? 0} 个 · 新发现 {freshInstalled?.length ?? 0} · 已接入 {installedInCards?.length ?? 0} ·
                    以电脑安装痕迹为准 · 数据来源：{props.installedSource === 'host' ? '主进程真探测' : props.installedSource === 'browser' ? '浏览器降级（无法探测本机）' : '未探测'}）
                </p>
                {installedInCards && installedInCards.length > 0 && (
                  <p className="af-note">
                    已接入卡片（不重复显示）：{installedInCards.map((f) => f.agent).join('、')}
                  </p>
                )}
                {freshInstalled && freshInstalled.length === 0 && installedInCards?.length === 0 && (
                  <p className="af-note">本机未探测到已知 Agent 安装痕迹（CLI / 桌面端 / 开始菜单 / 配置 / 注册表 五路均为空）。</p>
                )}
                {freshInstalled && freshInstalled.length > 0 && freshInstalled.map((f) => (
                  <FoundCard
                    key={f.agent}
                    badge={f.badge}
                    label={f.label}
                    name={f.agent}
                    actions={
                      <button className="af-btn sm" onClick={() => props.onAddCardForInstalled?.(f)}>
                        + 新增接入卡片
                      </button>
                    }
                    meta={
                      <>
                        <span className="af-badge">{VIA_LABEL[f.via]}</span>
                        <span className="dim" title={f.source}>
                          {f.source}{f.version ? ` · v${f.version}` : ''}
                        </span>
                      </>
                    }
                  />
                ))}
              </div>
            ) : null}

            <p className="af-note">
              原理：<b>发现</b>是技术活（扫本机注册信号），<b>绑定</b>是信任活（全用 19.4/19.5 最合理默认值）——
              所以发现即绑定、绑即可用，用户<b>不需要逐项理解配置</b>。
              默认值：隔离 project_id 共享 + user_id 偏好 · 双通道（Webhook 主 + API 补偿）· 该 Agent 免费/低价模型自动进 19.8 全量映射池。
              安全兜底：自动绑定默认<b>只开只读召回</b>，写入/反代理 P0/P1 按 19.2 放行、<b>P2 须用户确认</b>；每个绑定<b>可一键撤销</b>（审计 unbound）。
              有信号的一律自动，仅<b>无信号</b>的 Agent 才需手填端点。
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
