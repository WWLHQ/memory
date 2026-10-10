// Agent 接入配置页容器（REQ-003 接原型）
// ⚠ 硬性约定：页面结构、class、文案、交互严格对齐 design/ui/Agent接入页_原型.html。
// 业务内核复用 src/agentOnboard/*（状态机/校验/服务），此处只做"原型逻辑 → React state"的翻译。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DiscoveredAgent, Form, UiAgentCard } from '../../types/agentOnboard.ts';
import { hasActiveSession } from '../Home/crossTabAuth.ts';
import { AgentCard, toolRef } from './AgentCard.tsx';
import { OneClickOnboard } from './OneClickOnboard.tsx';
import { Gains } from './Gains.tsx';
import { SEED_AGENTS, SEED_DISCOVERED, SEED_GAINS } from './seed.ts';
import { coreDiscover } from './coreOnboard.ts';
import { useBackendMirror } from './useBackendMirror.ts';
import './theme.css';

/** 19.10 运行时检测当前端；真实端壳注入，这里用 UA 粗判 */
export function detectForm(): Form {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Linux/.test(ua) && !/Android/.test(ua)) return 'linux';
  if (/Mac/.test(ua)) return 'mac';
  if (/Android|iPhone|iPad|Mobile/.test(ua)) return 'mobile';
  if (/cli|node/i.test(ua)) return 'cli';
  return 'desktop';
}

/** R2：写记忆须带 project_id（关掉共享后提示） */
function checkR2(a: UiAgentCard): string | null {
  if (toolRef(a.tools.write).on && !a.iso.projShare) {
    return 'R2：记忆读写须带 project_id（关闭共享后请确认 project_id 仍可解析）';
  }
  return null;
}

/** R4：双通道至少开一 */
function checkR4(a: UiAgentCard): string | null {
  if (!a.chan.webhook && !a.chan.api) return 'R4：双通道（Webhook + API 拉取）至少开一，记忆库需可采集（5.1）';
  return null;
}

export function AgentOnboardPage() {
  const form = useMemo(detectForm, []);
  // 后端已有卡片合并回填：按 agent_name 匹配种子卡，仅同步 circuit/badge（不增删行数，原型语义优先）
  const onCards = useCallback((cards: Array<{ agent_name: string; circuit?: string; priority?: string }>) => {
    setAgents((prev) => prev.map((a) => {
      const c = cards.find((x) => x.agent_name === a.name);
      if (!c) return a;
      return {
        ...a,
        ...(c.circuit ? { circuit: c.circuit as UiAgentCard['circuit'] } : {}),
        ...(c.priority ? { badge: c.priority.toLowerCase() as UiAgentCard['badge'] } : {}),
      };
    }));
  }, []);
  const backend = useBackendMirror(onCards);
  const [agents, setAgents] = useState<UiAgentCard[]>(SEED_AGENTS);
  const [discovered, setDiscovered] = useState<DiscoveredAgent[]>(SEED_DISCOVERED);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [injectShown, setInjectShown] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);
  const [stageIndex, setStageIndex] = useState(-1);
  const [scanState, setScanState] = useState('待扫描');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2600);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /** 更新第 i 张卡片并重算 R4 */
  const patchAgent = useCallback((i: number, patch: (a: UiAgentCard) => UiAgentCard) => {
    setAgents((prev) => {
      const next = prev.map((a, idx) => (idx === i ? patch(a) : a));
      const err = checkR4(next[i]);
      setErrors((e) => ({ ...e, [next[i].name]: err ?? '' }));
      return next;
    });
  }, []);

  /* ---------- 开关交互 ---------- */
  const onToolChange = (i: number, tool: 'recall' | 'write' | 'pref', checked: boolean) => {
    patchAgent(i, (a) => {
      // 惰性提升布尔为对象：原型 pref 可能是 false，直接赋值会抛 TypeError
      if (tool === 'pref') a.tools.pref = { ...toolRef(a.tools.pref), on: checked };
      else if (tool === 'write') a.tools.write = { ...toolRef(a.tools.write), on: checked };
      else a.tools.recall = { ...a.tools.recall, on: checked };

      // R3：scene=critical 时 mode 不得 minimal（16.5）
      if (tool === 'recall' && a.tools.recall.scene === 'critical' && a.tools.recall.mode === 'minimal') {
        a.tools.recall.mode = '';
        toast('critical 禁极简，已回落自动（16.5）');
      }
      return a;
    });
  };

  const onIsoChange = (i: number, key: 'projShare' | 'prefCross', checked: boolean) => {
    patchAgent(i, (a) => {
      a.iso = { ...a.iso, [key]: checked };
      toast(
        key === 'projShare'
          ? (checked ? '已开启 project_id 跨 Agent 共享' : '已关闭：该项目记忆不再跨 Agent 共享')
          : (checked ? '个人偏好跨 Agent/项目共享（user_id 级）' : '个人偏好随项目隔离'),
      );
      return a;
    });
  };

  const onChanChange = (i: number, ch: 'webhook' | 'api', checked: boolean) => {
    patchAgent(i, (a) => {
      a.chan = { ...a.chan, [ch]: checked };
      return a;
    });
  };

  /* ---------- 操作按钮 ---------- */
  const onAct = (i: number, act: 'test' | 'rotate' | 'save') => {
    const a = agents[i];
    if (act === 'test') {
      if (a.circuit === 'OPEN') return;
      toast(`测试成功：${a.name} → req_test，已记审计（4.3）`);
      setInjectShown((s) => ({ ...s, [a.name]: true }));
      backend.test(a.name);
    }
    if (act === 'rotate') {
      // 对齐原型 act('rotate')：脱敏值加「（新）」+ 上次轮换记为「刚轮换」
      patchAgent(i, (x) => ({ ...x, key: { ...x.key, last: '刚轮换', rotated: true } }));
      toast(`已轮换，旧 Key ${a.key.grace}h 内有效（4.1）`);
      backend.rotate(a.name);
    }
    if (act === 'save') {
      const r2 = checkR2(a);
      if (r2) { toast(r2); return; }
      toast(`已保存 ${a.name} 接入配置`);
      backend.save(a);
    }
  };

  const onRidClick = (name: string) => toast(`开审计页（独立窗口）定位 ${name} 的 request_id 链路（18.2-E）`);

  /* ---------- 一键接入：扫→分→绑→验 ---------- */
  const onDiscover = () => {
    if (running) return;
    setRunning(true);
    setStageIndex(-1);
    setScanState('待扫描');
    [0, 1, 2, 3].forEach((i) => {
      setTimeout(() => {
        setStageIndex(i);
        setScanState(['扫描注册信号中…', '自动打标 P0/P1/P2 中…', '按默认值绑定中…', '测通并写审计中…'][i]);
        if (i === 3) {
          // 第 4 段接真内核：ma.discover（desktop 全信号）→ 绑定数以内核回执为准（auto_bind 审计内核真写）
          void coreDiscover()
            .then((r) => {
              const n = r.agents.length;
              setAgents((prev) => prev.map((a) => {
                const d = SEED_DISCOVERED.find((x) => x.name === a.name);
                if (!d || !d.bound) return a;
                return { ...a, state: d.ok ? 'connected' : 'degraded' };
              }));
              setScanState(`完成 · 发现并绑定 ${n} 个 · 已记审计 auto_bind`);
              toast(`一键接入完成：自动发现 ${n} 个 Agent 并绑定（审计 auto_bind），立即可用`);
              backend.discover(
                SEED_DISCOVERED.filter((d) => d.bound).map((d) => ({ name: d.name, priority: d.badge.toUpperCase(), signal: d.signal })),
                form,
              );
              setRunning(false);
            })
            .catch(() => setRunning(false)); // 内核不可达 → 停止演出（safe-noop 语义）
        }
      }, 430 * (i + 1));
    });
  };

  const onUnbind = (i: number) => {
    const d = discovered[i];
    if (!d) return;
    const next = discovered.map((x, idx) => (idx === i ? { ...x, bound: false } : x));
    setDiscovered(next);
    setAgents((prev) => prev.map((a) => (a.name === d.name ? { ...a, state: 'onboard' as const } : a)));
    backend.unbind(d.name);
    toast(`已撤销 ${d.name} 的自动绑定（审计 unbound）；恢复需重跑一键接入`);
  };

  // 登录门控：未登录 → 提示并阻断
  if (!hasActiveSession()) {
    return (
      <div className="wrap">
        <div className="auth-gate">
          <div className="gate-card">
            <h2>请先登录</h2>
            <p>登录后可访问 Agent 接入配置页（REQ-003）。点击确定跳转至首页登录后重试。</p>
            <button
              className="btn primary"
              id="btnGotoLoginFromAgent"
              type="button"
              onClick={() => {
                if (window.opener) window.close();
                else window.location.href = '/index.html';
              }}
            >
              → 前往登录页
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>Agent 接入配置页 · 可交互原型</h1>
      <div className="sub">
        按《Agent 接入页字段级交互规格》实现 · MVP 两家起步（deepseek harness P0 + Claude Code P1）· 一键接入 · 双通道降级 · 隔离开关 · 密钥脱敏 · 效果证据
      </div>

      <div className="section-title">⚡ 一键接入本机 Agent（19.9）· 自动发现 + 默认绑定，不用逐个设置</div>
      <OneClickOnboard
        form={form}
        discovered={discovered}
        running={running}
        stageIndex={stageIndex}
        scanState={scanState}
        onDiscover={onDiscover}
        onUnbind={onUnbind}
        onSignalChange={() => { /* 信号源仅影响发现范围，原型默认全开即全部展示 */ }}
      />

      <div className="section-title">宿主 Agent 接入卡片（19.2 / 19.3 / 5.2）</div>
      <div id="cards">
        {agents.map((a, i) => (
          <AgentCard
            key={a.name}
            agent={a}
            error={errors[a.name] ?? ''}
            testDisabled={a.circuit === 'OPEN'}
            saveDisabled={!!errors[a.name]}
            injectVisible={!!injectShown[a.name]}
            onToolChange={(t, c) => onToolChange(i, t, c)}
            onIsoChange={(k, c) => onIsoChange(i, k, c)}
            onChanChange={(ch, c) => onChanChange(i, ch, c)}
            onAct={(act) => onAct(i, act)}
            onRidClick={onRidClick}
          />
        ))}
      </div>

      <div className="section-title">效果证据 · 用户可感知的「省」与「快」（token / 效率 / 模型成本）</div>
      <Gains gains={SEED_GAINS} />
      <div className="note">
        说明：终端用户感知不到「记忆助手」本身（19.1 透明），他感知到的是 <b>Agent 变聪明了、变省了</b>。
        以上证据链来自检索页预算面板（payload / pipeline token）、极简模式短查询（≤600t，2.4.1）、次模式（≤200t 占位符注入，2.4.3）、
        跨会话背景免重复交代（9.1）、踩坑复用（9.3）、决策追溯（9.4）、跨 Agent 共享（19.4）、模型成本节省（19.8），
        审计页可按 request_id 逐项核对（4.3 / 18.2-E）。
      </div>

      <div className="toast" id="toast" style={toastMsg ? { display: 'block' } : { display: 'none' }}>
        {toastMsg}
      </div>
    </div>
  );
}

export default AgentOnboardPage;