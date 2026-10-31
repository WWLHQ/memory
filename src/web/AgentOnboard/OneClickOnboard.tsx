// 一键接入本机 Agent（规格 T4 / AC-003.4 / 19.9 · 扫→分→绑→验 四段进度 + 自动绑定 + 可撤销）
// ⚠ 硬性约定：结构、class、文案、data-* 属性严格对齐
//    design/ui/Agent接入页_原型.html 的 #onboard 卡（btnDiscover / .sig / .stages / #found），禁止偏离。
// 2026-10-24 扩展：发现列表展示已安装 agent（CLI/桌面端/配置）+ 手动检测按钮。
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DiscoveredAgent, Form, InstalledAgent } from '../../types/agentOnboard.ts';
import { FormBadge, GRAYED_BY_FORM } from './FormBadge.tsx';

export type { InstalledAgent } from '../../types/agentOnboard.ts';

const VIA_LABEL: Record<InstalledAgent['via'], string> = {
  cli: 'CLI 已装', app: '桌面端已装', startmenu: '开始菜单', config: '配置文件', uninstall: '注册表卸载项',
};


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
  nameSize?: number;
  unbound?: boolean;
  dataDisc?: number;
  actions: ReactNode;
  meta: ReactNode;
}

/** 接入卡片统一外壳：首行 badge + 名称 + 右侧操作，次行元信息；发现卡片与已安装卡片共用。 */
function FoundCard({ badge, label, name, nameSize = 13, unbound = false, dataDisc, actions, meta }: FoundCardProps) {
  return (
    <div className={`found found-card${unbound ? ' unbound' : ''}`} data-disc={dataDisc}>
      <div className="found-head">
        <span className={`badge ${badge}`}>{label}</span>
        <span className="agent-name" style={{ fontSize: nameSize }}>{name}</span>
        <span className="found-actions">{actions}</span>
      </div>
      <div className="found-meta">{meta}</div>
    </div>
  );
}

export function OneClickOnboard(props: Props) {
  const { form, discovered, running, stageIndex, scanState, autoOnboarded = false } = props;
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
    <div className="card" id="onboard">
      <div className="top">
        <button className="btn primary" id="btnDiscover" disabled={running} onClick={props.onDiscover}>
          ⚡ 自动发现并接入本机 Agent
        </button>
        <button className="btn" data-testid="manual-detect" disabled={props.installedBusy} onClick={() => props.onManualDetect?.()}>
          {props.installedBusy ? '探测中…' : '🔍 手动检测'}
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

      {/* 已自动接入徽章（登录/首次接入完成并持久化后显示，切页/重载仍保留） */}
      {autoOnboarded && !running && (
        <div id="autoOnboardBadge" className="top" style={{ marginBottom: 8, alignItems: 'center' }}>
          <span
            style={{
              background: 'rgba(16,185,129,0.15)', color: '#059669', border: '1px solid rgba(16,185,129,0.4)',
              borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 600, letterSpacing: 0.3,
            }}
          >
            ✅ 已自动接入 · 切页/重载保持
          </span>
          <button
            className="btn"
            id="btnRebindAll"
            style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 11 }}
            onClick={() => props.onRebindAll?.()}
          >
            ↻ 撤销并重接
          </button>
        </div>
      )}

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
                    <button className="btn" data-unbind={i} style={{ padding: '4px 10px' }} onClick={() => props.onUnbind(i)}>
                      撤销
                    </button>
                  ) : null}
                </>
              }
              meta={<span className="method">信号：{d.signal}{srcLabel}</span>}
            />
          );
        })}
      </div>

      {/* 已安装 Agent（以电脑安装痕迹为准：CLI/安装目录/开始菜单/配置/注册表；不参考运行进程）
       *  去重：已有接入卡片的 agent 不重复进卡片，只显示「新发现」的；新发现可一键加卡片 */}
      {(freshInstalled && freshInstalled.length > 0) || installedInCards?.length ? (
        <div id="installedAgents" data-testid="installed-agents" style={{ marginTop: 10 }}>
          <div className="section-title" style={{ fontSize: 12, marginBottom: 6 }}>
            已安装的 Agent（{installed?.length ?? 0} 个 · 新发现 {freshInstalled?.length ?? 0} · 已接入 {installedInCards?.length ?? 0} ·
              以电脑安装痕迹为准 · 数据来源：{props.installedSource === 'host' ? '主进程真探测' : props.installedSource === 'browser' ? '浏览器降级（无法探测本机）' : '未探测'}）
          </div>
          {installedInCards && installedInCards.length > 0 && (
            <div className="note" style={{ fontSize: 11 }}>
              已接入卡片（不重复显示）：{installedInCards.map((f) => f.agent).join('、')}
            </div>
          )}
          {freshInstalled && freshInstalled.length === 0 && installedInCards?.length === 0 && (
            <div className="note">本机未探测到已知 Agent 安装痕迹（CLI / 桌面端 / 开始菜单 / 配置 / 注册表 五路均为空）。</div>
          )}
          {freshInstalled && freshInstalled.length > 0 && freshInstalled.map((f) => (
            <FoundCard
              key={f.agent}
              badge={f.badge}
              label={f.label}
              name={f.agent}
              nameSize={12.5}
              actions={
                <button className="btn" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => props.onAddCardForInstalled?.(f)}>
                  + 新增接入卡片
                </button>
              }
              meta={
                <>
                  <span className="pill" style={{ fontSize: 10 }}>{VIA_LABEL[f.via]}</span>
                  <span className="method" style={{ fontSize: 11, color: 'var(--dim)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.source}>
                    {f.source}{f.version ? ` · v${f.version}` : ''}
                  </span>
                </>
              }
            />
          ))}
        </div>
      ) : null}

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