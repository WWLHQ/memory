// 全局参数页 · LLM 精炼引擎卡片（批次31）：Ollama 管简单层（L2）、DeepSeek 管深层（L3–L6），
// 互为回退、不加硬上限。配置落数据根 llm-config.json（无密钥）；DeepSeek Key 单独 0600 文件，
// 只写不读回（输入框留空 = 保持现有密钥）。拨测走真实 HTTP，成功/失败如实展示。
import { useEffect, useState, type ReactNode } from 'react';
import {
  llmEngineAvailable, llmGetConfig, llmSaveConfig, llmTestEngine,
  type LlmConfigView, type LlmTestResult,
} from './llmEngine.ts';
import { useSessionContext } from '../shared/session.ts';
import { useToast } from './useToast.tsx';

function EngineRow(props: {
  title: string;
  note: string;
  engine: { enabled: boolean; baseURL: string; model: string };
  baseURLFixed?: boolean;
  onEngine: (patch: Partial<{ enabled: boolean; baseURL: string; model: string }>) => void;
  onTest: () => void;
  testing: boolean;
  testResult: LlmTestResult | null;
  isAdmin: boolean;
  testId: string;
  children?: ReactNode;
}) {
  const { engine, onEngine, isAdmin } = props;
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border, #e8e8ef)', paddingTop: 10 }} data-testid={props.testId}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input type="checkbox" data-testid={`${props.testId}-enabled`} checked={engine.enabled} disabled={!isAdmin}
          onChange={(e) => onEngine({ enabled: e.target.checked })} />
        <b>{props.title}</b>
      </label>
      <div className="note">{props.note}</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        {!props.baseURLFixed && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>服务地址（OpenAI 兼容）</div>
            <input data-testid={`${props.testId}-baseurl`} style={{ width: 240 }} value={engine.baseURL} disabled={!isAdmin}
              onChange={(e) => onEngine({ baseURL: e.target.value })} />
          </div>
        )}
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>模型名</div>
          <input data-testid={`${props.testId}-model`} style={{ width: 180 }} value={engine.model} disabled={!isAdmin}
            placeholder={props.testId === 'llm-ollama' ? '如 qwen2.5:7b' : 'deepseek-chat'}
            onChange={(e) => onEngine({ model: e.target.value })} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>连通拨测（真实 HTTP）</div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn" data-testid={`${props.testId}-test`} disabled={!isAdmin || props.testing}
              onClick={props.onTest}>{props.testing ? '拨测中…' : '测试连通'}</button>
            {props.testResult && (
              <span className="dim" style={{ fontSize: 11 }}>
                {props.testResult.ok
                  ? `✅ 连通（${props.testResult.model ?? engine.model}，${props.testResult.latencyMs ?? '?'}ms）`
                  : `❌ ${props.testResult.error ?? '失败'}`}
              </span>
            )}
          </div>
        </div>
      </div>
      {props.children}
    </div>
  );
}

export function LlmEngineCard() {
  const { show } = useToast();
  const available = llmEngineAvailable();
  const { role, loading: sessionLoading } = useSessionContext();
  const isAdmin = role === 'admin';
  const [view, setView] = useState<LlmConfigView | null>(null);
  const [deepseekKey, setDeepseekKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<{ ollama: boolean; deepseek: boolean }>({ ollama: false, deepseek: false });
  const [testResult, setTestResult] = useState<{ ollama: LlmTestResult | null; deepseek: LlmTestResult | null }>({ ollama: null, deepseek: null });

  useEffect(() => {
    if (!available) return;
    let alive = true;
    void llmGetConfig().then((v) => { if (alive) setView(v); });
    return () => { alive = false; };
  }, [available]);

  if (!available) {
    return (
      <div className="card" data-testid="llm-engine-card" style={{ opacity: 0.6 }}>
        <b>🧠 LLM 精炼引擎</b>
        <div className="note">
          LLM 网关仅在桌面壳（Electron）中可用（密钥只存主进程，浏览器不接触密钥）。
          当前为浏览器模式：写入仍按「未接入 LLM」口径只落 L1。请安装桌面版并在参数页配置。
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="card" data-testid="llm-engine-card">
        <b>🧠 LLM 精炼引擎</b>
        <div className="note">加载 LLM 配置中…（需登录；未登录时网关配置不可读）</div>
      </div>
    );
  }

  async function save(patch: { config?: Partial<LlmConfigView['config']>; deepseekKey?: string }) {
    setBusy(true);
    const r = await llmSaveConfig(patch);
    setBusy(false);
    if (!r.ok || !r.view) { show(`保存失败：${r.error ?? '未知错误'}`); return; }
    setView(r.view);
    setDeepseekKey('');
    show(r.view.usable ? 'LLM 配置已保存，写入记忆将逐层生成 L2–L6。' : 'LLM 配置已保存（当前无可启用引擎，写入仍只落 L1）。');
  }

  async function test(target: 'ollama' | 'deepseek') {
    setTesting((s) => ({ ...s, [target]: true }));
    const r = await llmTestEngine(target);
    setTesting((s) => ({ ...s, [target]: false }));
    setTestResult((s) => ({ ...s, [target]: r }));
  }

  const ollama = view.config.ollama;
  const deepseek = view.config.deepseek;

  return (
    <div className="card" data-testid="llm-engine-card">
      <b>🧠 LLM 精炼引擎</b>
      <div className="note">
        写记忆时逐层生成 L2–L6：简单的层（L2 会话摘要）优先本地 Ollama，需要深入的层（L3–L6）优先 DeepSeek；
        任一引擎失败自动回退另一引擎。产物由内核按层规格硬校验，不合规如实判违规。
        网关当前状态：{view.usable ? '已启用' : '未启用（写入只落 L1）'}；「测试连通」会先保存再真实拨测。
      </div>
      {!isAdmin && (
        <div className="note" data-testid="llm-admin-required" style={{ color: 'var(--warn, #b8860b)' }}>
          🔒 需管理员：修改配置与连通拨测仅管理员可操作
          {sessionLoading ? '（正在确认登录身份…）' : role === 'member' ? '（当前账号为普通成员）' : '（当前未登录）'}。
        </div>
      )}

      <EngineRow
        title="Ollama（本地免费 · 简单层优先）"
        note={`服务地址 ${ollama.baseURL || 'http://127.0.0.1:11434'}（OpenAI 兼容 /v1/chat/completions）`}
        engine={ollama} isAdmin={isAdmin} testId="llm-ollama"
        testing={testing.ollama} testResult={testResult.ollama}
        onEngine={(patch) => setView({ ...view, config: { ...view.config, ollama: { ...ollama, ...patch } } })}
        onTest={() => void save({ config: { ollama } }).then(() => void test('ollama'))}
      />

      <EngineRow
        title="DeepSeek（云端深入层优先）"
        note={`服务地址 ${deepseek.baseURL}（固定官方端点）`}
        engine={deepseek} isAdmin={isAdmin} testId="llm-deepseek" baseURLFixed
        testing={testing.deepseek} testResult={testResult.deepseek}
        onEngine={(patch) => setView({ ...view, config: { ...view.config, deepseek: { ...deepseek, ...patch } } })}
        onTest={() => void save({ config: { deepseek } }).then(() => void test('deepseek'))}
      >
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            API Key（只写不读回；{view.deepseekKeySet ? '已设置' : '未设置'}；留空 = 保持现有密钥）
          </div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input type="password" data-testid="llm-deepseek-key" style={{ width: 320 }} value={deepseekKey}
              disabled={!isAdmin} placeholder={view.deepseekKeySet ? '••••••••（已保存）' : 'sk-…'}
              onChange={(e) => setDeepseekKey(e.target.value)} />
            {deepseekKey && (
              <button type="button" className="btn" data-testid="llm-deepseek-key-save" disabled={busy || !isAdmin}
                onClick={() => void save({ deepseekKey })}>保存密钥</button>
            )}
            {view.deepseekKeySet && (
              <button type="button" className="btn" data-testid="llm-deepseek-key-clear" disabled={busy || !isAdmin}
                title="清除已保存的密钥" onClick={() => void save({ deepseekKey: '' })}>清除</button>
            )}
          </div>
        </div>
      </EngineRow>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" data-testid="llm-save" disabled={busy || !isAdmin}
          onClick={() => void save({ config: { ollama, deepseek } })}>
          {busy ? '保存中…' : '保存 LLM 配置'}
        </button>
        <span className="dim" style={{ fontSize: 11 }}>
          配置存 <code>llm-config.json</code>（不含密钥）；DeepSeek Key 存 <code>llm-deepseek-key.txt</code>（0600，仅主进程可读）。
        </span>
      </div>
    </div>
  );
}
