// 批次62 · 参数页「硬前置召回」卡片：A 宿主钩子 / B 内置 LLM 网关 / C MCP 内核门禁。
// UI 严格对齐 design/ui/硬前置召回开关_原型.html（结构、class、文案、二选一「启用 / 不启用」交互）。
//
// 一块必须说清的事：徽标与状态行显示的是**主进程回执的真值**（宿主配置里是否真有钩子 / 网关端口是否真在跑 /
// 门禁当前求值结果），二选一按钮显示的是**草稿意图**。两者不一致时状态行明说「有未保存改动」，
// 绝不让「点了启用」看起来等于「已经启用」。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionContext } from '../shared/session.ts';
import type { RecallHardConfig } from '../../shared/recallHardConfig.ts';
import {
  recallHardAvailable, recallHardSet, recallHardState, type RecallHardStateView,
} from './recallHard.ts';
import './recallHard.css';

interface Draft {
  a_hook: boolean;
  b_gateway: boolean;
  b_upstream: string;
  c_strict_gate: boolean;
}

const toDraft = (c: RecallHardConfig): Draft => ({
  a_hook: c.a_hook, b_gateway: c.b_gateway, b_upstream: c.b_upstream, c_strict_gate: c.c_strict_gate,
});

const sameDraft = (a: Draft, b: Draft): boolean =>
  a.a_hook === b.a_hook && a.b_gateway === b.b_gateway
  && a.b_upstream.trim() === b.b_upstream.trim() && a.c_strict_gate === b.c_strict_gate;

function LayerPick(props: {
  label: string;
  on: boolean;
  disabled: boolean;
  testId: string;
  onPick: (on: boolean) => void;
}) {
  const { label, on, disabled, testId, onPick } = props;
  return (
    <span className="rh-pick" role="radiogroup" aria-label={label} data-testid={testId}>
      <button
        type="button"
        className={`rh-choice${on ? ' active' : ''}`}
        data-value="on"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => onPick(true)}
      >
        启用
      </button>
      <button
        type="button"
        className={`rh-choice${on ? '' : ' active'}`}
        data-value="off"
        aria-pressed={!on}
        disabled={disabled}
        onClick={() => onPick(false)}
      >
        不启用
      </button>
    </span>
  );
}

const stCls = (on: boolean): string => `rh-st${on ? ' on' : ' idle'}`;
const stTxt = (on: boolean): string => (on ? '已启用' : '未启用');

export function RecallHardCard() {
  const { role } = useSessionContext();
  const isAdmin = role === 'admin';
  const available = recallHardAvailable();
  const [state, setState] = useState<RecallHardStateView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 用户在草稿里的编辑：刷新回填不得顶掉正在改的值
  const touched = useRef(false);

  const refresh = useCallback(async () => {
    if (!available) return;
    const r = await recallHardState();
    if (!r.state) { setErr(r.error ?? '读不到硬前置召回状态'); return; }
    setState(r.state);
    setErr(r.ok ? null : (r.error ?? null));
    if (!touched.current) setDraft(toDraft(r.state.config));
  }, [available]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saved = state ? toDraft(state.config) : null;
  const dirty = Boolean(draft && saved && !sameDraft(draft, saved));

  const pick = (key: keyof Draft, on: boolean) => {
    if (!draft || busy) return;
    if (key === 'b_gateway' && on && !draft.b_upstream.trim()) {
      setErr(null);
      setMsg('请先填写上游地址再启用 B');
      return;
    }
    touched.current = true;
    setMsg(null);
    setDraft({ ...draft, [key]: on } as Draft);
  };

  const onUpstream = (v: string) => {
    if (!draft) return;
    touched.current = true;
    setMsg(null);
    setDraft({ ...draft, b_upstream: v });
  };

  const save = async () => {
    if (!draft || !saved || busy) return;
    const patch: Partial<RecallHardConfig> = {};
    if (draft.a_hook !== saved.a_hook) patch.a_hook = draft.a_hook;
    if (draft.b_gateway !== saved.b_gateway) patch.b_gateway = draft.b_gateway;
    if (draft.b_upstream.trim() !== saved.b_upstream.trim()) patch.b_upstream = draft.b_upstream.trim();
    if (draft.c_strict_gate !== saved.c_strict_gate) patch.c_strict_gate = draft.c_strict_gate;
    if (Object.keys(patch).length === 0) { setMsg('没有改动'); return; }

    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await recallHardSet(patch);
      if (r.state) setState(r.state);
      if (!r.ok) { setErr(r.error ?? '保存失败'); return; }
      touched.current = false;
      if (r.state) setDraft(toDraft(r.state.config));
      setMsg(`已保存并生效：A=${r.state?.a.installed ? '启用' : '不启用'} · B=${r.state?.b.running ? '启用' : '不启用'} · C=${r.state?.c.effective ? '启用' : '不启用'}`);
    } finally {
      setBusy(false);
    }
  };

  const copyBaseUrl = async () => {
    const url = state?.b.baseUrl ?? '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setMsg('已复制接入地址');
    } catch {
      setMsg(`接入地址：${url}`);
    }
  };

  if (!available) {
    return (
      <div className="card rh-card" data-testid="recall-hard-card">
        <div className="rh-h">硬前置召回<span className="rh-ref">A 宿主钩子 / B LLM 网关 / C MCP 内核门禁</span></div>
        <div className="note" data-testid="recall-hard-unavailable">
          当前不是桌面宿主环境：三层开关由主进程执行（改宿主配置、起本机端口、切内核门禁），浏览器模式没有它。
        </div>
      </div>
    );
  }

  const d = draft;
  const enabledCount = d ? [d.a_hook, d.b_gateway, d.c_strict_gate].filter(Boolean).length : 0;

  return (
    <div className="card rh-card" data-testid="recall-hard-card">
      <div className="rh-h">
        硬前置召回
        <span className="rh-ref">A 宿主钩子 / B LLM 网关 / C MCP 内核门禁 · 互不替代</span>
      </div>
      <div className="note">
        A 保证每轮必召回；B 真正把记忆拼进 system 最前面；C 保证没召回就不许调别的工具。
        三层可单独启用或停用，设置写本机配置并记审计；C 只约束「调了工具但没先召回」，
        模型一个工具都不调直接回答需靠 A / B 兜住。
      </div>

      {!state && <div className="note" data-testid="recall-hard-loading">正在读取本机真实状态…</div>}

      {state && d && (
        <>
          {/* A · 宿主钩子 */}
          <div className="rh-layer" data-testid="rh-a">
            <div className="rh-head">
              <span className="rh-name">A · 宿主钩子</span>
              <span className={stCls(state.a.installed)} data-testid="rh-a-st">{stTxt(state.a.installed)}</span>
            </div>
            <div className="rh-desc">
              宿主在模型处理前同步执行 UserPromptSubmit 强制召回，注入 additionalContext。桌面端需重启宿主并在 hooks 面板审核后生效。
            </div>
            <div className="rh-foot">
              <LayerPick label="A 宿主钩子" testId="rh-a-pick" on={d.a_hook} disabled={!isAdmin || busy} onPick={(on) => pick('a_hook', on)} />
              <span className="rh-state" data-testid="rh-a-state">{state.a.note}</span>
            </div>
            {!state.a.scriptExists && (
              <div className="rh-warn" data-testid="rh-a-script-missing">
                钩子脚本不存在，启用会被拒绝：<code>{state.a.hookScript}</code>
              </div>
            )}
            {state.a.installed && state.a.installedPath && (
              <div className="rh-line" data-testid="rh-a-path">
                宿主钩子实际指向：<code>{state.a.installedPath}</code>
              </div>
            )}
            {state.a.installed && state.a.installedPath
              && state.a.installedPath.replace(/\\/g, '/').toLowerCase() !== state.a.hookScript.replace(/\\/g, '/').toLowerCase() && (
              <div className="rh-warn" data-testid="rh-a-path-mismatch">
                该路径与当前宿主脚本不符（开发态→打包态过渡常见）：点「保存并生效」会重写为 <code>{state.a.hookScript}</code>，再重启宿主即恢复每轮召回。
              </div>
            )}
            {state.a.needsRestart && (
              <div className="rh-warn" data-testid="rh-a-restart">
                A 的改动已写入宿主配置，但 hooks 不热加载：请重启宿主（或到 hooks 面板审核新钩子）后才会真正每轮召回。
              </div>
            )}
          </div>

          {/* B · LLM 网关 */}
          <div className="rh-layer" data-testid="rh-b">
            <div className="rh-head">
              <span className="rh-name">B · LLM 网关</span>
              <span className={stCls(state.b.running)} data-testid="rh-b-st">{stTxt(state.b.running)}</span>
            </div>
            <div className="rh-desc">
              应用内置反向代理，把召回记忆置顶拼进 system，再转发上游。启用后把客户端 base_url 指向下方接入地址。
            </div>
            <div className="rh-foot">
              <LayerPick label="B LLM 网关" testId="rh-b-pick" on={d.b_gateway} disabled={!isAdmin || busy} onPick={(on) => pick('b_gateway', on)} />
              <span className="rh-state" data-testid="rh-b-state">
                {state.b.running ? `网关运行中 · 监听端口 ${state.b.port}` : `网关未运行 · 监听端口 ${state.b.port}`}
              </span>
            </div>
            <div className={`rh-extra${d.b_gateway ? '' : ' off'}`} data-testid="rh-b-extra">
              <div className="row">
                <label htmlFor="rh-upstream">上游地址</label>
                <input
                  id="rh-upstream"
                  type="text"
                  className="rh-upstream"
                  placeholder="https://api.example.com"
                  value={d.b_upstream}
                  disabled={!isAdmin || busy || !d.b_gateway}
                  onChange={(e) => onUpstream(e.target.value)}
                  data-testid="rh-upstream"
                />
                <span className="dim">启用前必填；客户端自己的密钥原样透传、不落盘</span>
              </div>
              <div className="row">
                <label>接入地址</label>
                <code className="rh-epi" data-testid="rh-baseurl">{state.b.baseUrl}</code>
                <button type="button" className="btn" onClick={() => void copyBaseUrl()} data-testid="rh-copy">复制</button>
                <span className="dim">把客户端 base_url 指向这里</span>
              </div>
            </div>
            {state.b.error && <div className="rh-err" data-testid="rh-b-error">{state.b.error}</div>}
          </div>

          {/* C · MCP 内核门禁 */}
          <div className="rh-layer" data-testid="rh-c">
            <div className="rh-head">
              <span className="rh-name">C · MCP 内核门禁</span>
              <span className={stCls(state.c.effective)} data-testid="rh-c-st">{stTxt(state.c.effective)}</span>
            </div>
            <div className="rh-desc">
              可靠会话未先调用 recall_memory 时，除 recall_memory 自身外的所有工具都被硬拦。切换后无需重启，下一次 tools/call 立即按新口径判定。
            </div>
            <div className="rh-foot">
              <LayerPick label="C MCP 内核门禁" testId="rh-c-pick" on={d.c_strict_gate} disabled={!isAdmin || busy} onPick={(on) => pick('c_strict_gate', on)} />
              <span className="rh-state" data-testid="rh-c-state">
                {state.c.effective ? '严格门禁生效中 · 未召回即硬拦全部非 recall 工具' : '退回旧行为 · 只硬拦写入/治理类工具'}
              </span>
            </div>
            {state.c.effective !== state.c.enabled && (
              <div className="rh-warn" data-testid="rh-c-lag">
                配置意图与实际生效不一致：服务端当前是{d.c_strict_gate ? '关闭' : '开启'}，请保存或刷新状态。
              </div>
            )}
          </div>

          <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <span className="rh-state" data-testid="rh-summary">
              已启用 {enabledCount} / 3 层 · 三层都依赖本机 8204 记忆服务在线；服务没起时只是不注入，不影响对话
              {dirty && ' · 有未保存改动'}
            </span>
            <span className="row" style={{ margin: 0 }}>
              <button type="button" className="btn" onClick={() => void refresh()} disabled={busy} data-testid="rh-refresh">刷新</button>
              <button type="button" className="btn primary" onClick={() => void save()} disabled={!isAdmin || busy || !dirty} data-testid="rh-save">
                保存并生效
              </button>
            </span>
          </div>

          {!isAdmin && (
            <div className="note" data-testid="rh-need-admin">
              需管理员：三层开关会改写宿主配置、起停本机端口、改变所有 Agent 的首步门禁强度；只读状态不限角色。
            </div>
          )}
          {msg && <div className="note" data-testid="rh-msg">{msg}</div>}
          {err && <div className="rh-err" data-testid="rh-error">{err}</div>}
          <div className="rh-line">
            状态来自本机真实配置，不是页面猜测值：A 读宿主 settings.json，B 读网关端口监听状态，C 读服务端严格门禁当前值。
            选择「不启用」不会删除其它层，也不会删掉宿主里已有的其它钩子。
          </div>
        </>
      )}
    </div>
  );
}
