// 全局参数页 · LLM 精炼引擎卡片（批次31 建 / 批次32 多引擎化）：任意多家 OpenAI 兼容引擎（预设快选或自定义），
// 路由口径「哪个能用、哪个快用哪个」——按各引擎最近一次真实拨测延时排队，首个成功即用，失败回退下一个。
// 配置落数据根 llm-config.json（不含密钥）；密钥统一落 llm-keys.json（0600），只写不读回（输入框留空 = 保持现有）。
// 拨测走真实 HTTP，成功/失败与延时如实展示；未拨测的引擎排在已拨测之后（顺序徽标按同一口径算）。
import { useCallback, useEffect, useState } from 'react';
import {
  llmEngineAvailable, llmGetConfig, llmSaveConfig, llmTestEngine, type LlmConfigPatch,
} from './llmEngine.ts';
import type { LlmEngineView, LlmGatewaySnapshot, LlmPresetView } from '../hostLlm.ts';
import { isLocalBase } from '../hostLlm.ts';
import { useSessionContext } from '../shared/session.ts';
import { useToast } from './useToast.tsx';

/** 与主进程 callOrder 同口径：可调用引擎按最近拨测延时升序（未拨测排后，保持列表顺序） */
function callOrder(engines: LlmEngineView[]): LlmEngineView[] {
  return engines
    .filter((e) => e.enabled && e.model && (!e.needsKey || e.keySet))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.lastLatencyMs ?? Number.MAX_SAFE_INTEGER) - (b.e.lastLatencyMs ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map(({ e }) => e);
}

function probeText(e: LlmEngineView): string {
  if (e.lastProbeAt === null) return '尚未拨测';
  const at = new Date(e.lastProbeAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  if (e.lastProbeOk === true) return `上次拨测 ${at} ✅ ${e.lastLatencyMs ?? '?'}ms`;
  return `上次拨测 ${at} ❌ 失败`;
}

function EngineRow(props: {
  engine: LlmEngineView;
  rank: number | null; // 调用顺序（1 起）；null = 当前条件不可调用
  draft: { name: string; enabled: boolean; baseURL: string; model: string };
  onDraft: (patch: Partial<EngineRowDraft>) => void;
  keyDraft: string;
  onKeyDraft: (v: string) => void;
  onSaveKey: () => void;
  onClearKey: () => void;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; latencyMs?: number; error?: string; enabled?: boolean } | null;
  onRemove: () => void;
  isAdmin: boolean;
  busy: boolean;
}) {
  const { engine, draft, onDraft, isAdmin } = props;
  const local = isLocalBase(engine.baseURL);
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border, #e8e8ef)', paddingTop: 10 }} data-testid={`llm-engine-${engine.id}`}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" data-testid={`llm-engine-${engine.id}-enabled`} checked={draft.enabled} disabled={!isAdmin}
            onChange={(e) => onDraft({ enabled: e.target.checked })} />
          <b>{draft.name || engine.name}</b>
        </label>
        {props.rank !== null && <span className="badge p2" data-testid={`llm-engine-${engine.id}-rank`}>调用顺序 {props.rank}</span>}
        <span className="dim" style={{ fontSize: 11 }}>{local ? '本地端点 · 无需密钥' : '云端端点 · 需 API Key'}</span>
        <span className="dim" style={{ fontSize: 11 }} data-testid={`llm-engine-${engine.id}-probe`}>{probeText(engine)}</span>
        <button type="button" className="btn" data-testid={`llm-engine-${engine.id}-remove`} disabled={!isAdmin || props.busy}
          title="从列表移除该引擎（不清除已保存的密钥文件）" onClick={props.onRemove}>移除</button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>服务地址（OpenAI 兼容）</div>
          <input data-testid={`llm-engine-${engine.id}-baseurl`} style={{ width: 260 }} value={draft.baseURL} disabled={!isAdmin}
            onChange={(e) => onDraft({ baseURL: e.target.value })} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>模型名</div>
          <input data-testid={`llm-engine-${engine.id}-model`} style={{ width: 180 }} value={draft.model} disabled={!isAdmin}
            placeholder="如 qwen2.5:7b / deepseek-chat" onChange={(e) => onDraft({ model: e.target.value })} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>连通拨测（真实 HTTP，延时参与排序）</div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn" data-testid={`llm-engine-${engine.id}-test`} disabled={!isAdmin || props.testing}
              onClick={props.onTest}>{props.testing ? '拨测中…' : '测试连通'}</button>
            {props.testResult && (
              <span className="dim" style={{ fontSize: 11 }} data-testid={`llm-engine-${engine.id}-test-result`}>
                {props.testResult.ok
                  ? props.testResult.enabled === false
                    ? `✅ 连通（${props.testResult.latencyMs ?? '?'}ms）—— 但尚未勾选「启用」，勾选后才会参与精炼排队`
                    : `✅ 连通（${props.testResult.latencyMs ?? '?'}ms）`
                  : `❌ ${props.testResult.error ?? '失败'}`}
              </span>
            )}
          </div>
        </div>
      </div>
      {engine.needsKey && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            API Key（只写不读回；{engine.keySet ? '已设置' : '未设置'}；留空 = 保持现有密钥）
          </div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            <input type="password" data-testid={`llm-engine-${engine.id}-key`} style={{ width: 320 }} value={props.keyDraft}
              disabled={!isAdmin} placeholder={engine.keySet ? '••••••••（已保存）' : 'sk-…'}
              onChange={(e) => props.onKeyDraft(e.target.value)} />
            {props.keyDraft && (
              <button type="button" className="btn" data-testid={`llm-engine-${engine.id}-key-save`} disabled={props.busy || !isAdmin}
                onClick={props.onSaveKey}>保存密钥</button>
            )}
            {engine.keySet && (
              <button type="button" className="btn" data-testid={`llm-engine-${engine.id}-key-clear`} disabled={props.busy || !isAdmin}
                title="清除该引擎已保存的密钥" onClick={props.onClearKey}>清除</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface EngineRowDraft {
  name: string;
  enabled: boolean;
  baseURL: string;
  model: string;
}

export function LlmEngineCard() {
  const { show } = useToast();
  const available = llmEngineAvailable();
  const { role, loading: sessionLoading } = useSessionContext();
  const isAdmin = role === 'admin';
  const [view, setView] = useState<LlmGatewaySnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, EngineRowDraft>>({});
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; latencyMs?: number; error?: string; enabled?: boolean } | null>>({});
  const [presetPick, setPresetPick] = useState('');
  const [custom, setCustom] = useState({ name: '', baseURL: '', model: '' });

  /** 拉配置：成功即以服务端为准；失败如实记下原因（不再停在「加载中…」假装还有希望） */
  const reload = useCallback(async () => {
    const r = await llmGetConfig();
    if (r.view) setView(r.view);
    setLoadError(r.error);
  }, []);

  useEffect(() => {
    if (!available) return;
    void reload();
  }, [available, reload]);

  /** 本地草稿与服务端视图同步（保存后以服务端为准，清掉该引擎草稿改动） */
  function draftOf(e: LlmEngineView): EngineRowDraft {
    return drafts[e.id] ?? { name: e.name, enabled: e.enabled, baseURL: e.baseURL, model: e.model };
  }

  async function apply(patch: LlmConfigPatch, okMsg?: string) {
    setBusy(true);
    const r = await llmSaveConfig(patch);
    setBusy(false);
    if (!r.ok) { show(`保存失败：${r.error ?? '未知错误'}`); return false; }
    if (r.view) setView(r.view);
    // 本次补丁涉及的引擎已以服务端为准；其它引擎的在编草稿保留（不因一次保存被抹掉）
    const touched = new Set<string>([
      ...(patch.engines ?? []).map((e) => e.id),
      ...(patch.remove ? [patch.remove] : []),
    ]);
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !touched.has(id))));
    setKeys({});
    show(okMsg ?? (r.view?.usable ? '已保存：写入记忆将逐层生成 L2–L6（按拨测延时排队调用）。' : '已保存（当前无可启用引擎，写入仍只落 L1）。'));
    return true;
  }

  async function testEngine(e: LlmEngineView) {
    setTesting((s) => ({ ...s, [e.id]: true }));
    const d = draftOf(e);
    // 拨测前先保存当前编辑（与批次31 口径一致）：主进程按落盘配置拨测，未保存的改动不生效
    if (draftsDirty(d, e)) await apply({ engines: [{ id: e.id, ...d }] });
    const r = await llmTestEngine(e.id);
    setTesting((s) => ({ ...s, [e.id]: false }));
    setTestResult((s) => ({ ...s, [e.id]: r }));
    await reload(); // 主进程把延时写回了配置，重拉以更新顺序徽标
  }

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
        <div className="note" data-testid="llm-load-failed">
          {loadError
            ? <>读不到引擎配置，因此下面没有引擎列表与添加入口。原因：{loadError}</>
            : '加载 LLM 配置中…'}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="btn" data-testid="llm-reload" onClick={() => void reload()}>重新加载</button>
          <span className="dim" style={{ fontSize: 11 }}>
            网关配置需登录会话读取、管理员保存；请先在首页用管理员账号登录后再回到本页。
          </span>
        </div>
      </div>
    );
  }

  const order = callOrder(view.engines);
  const usedPresets = new Set(view.engines.map((e) => e.id));
  const presets: LlmPresetView[] = view.presets ?? [];

  return (
    <div className="card" data-testid="llm-engine-card">
      <b>🧠 LLM 精炼引擎</b>
      <div className="note">
        写记忆时逐层生成 L2–L6，<b>不区分简单层/深入层由哪家做</b>：按各引擎<b>最近一次真实拨测延时</b>排队，
        最快的先用，调用失败自动回退下一个（未拨测的排在已拨测之后）。产物由内核按层规格硬校验，不合规如实判违规。
        网关当前状态：{view.usable ? '已启用' : '未启用（写入只落 L1）'}。<b>「测试连通」不要求先勾选「启用」</b>
        （批次34：拨测就是用来判断能不能连的，未启用的引擎照样真拨测）；它也会先把该行当前编辑保存下来再拨测。
        <b>只有勾选「启用」并保存后</b>，该引擎才参与精炼排队——拨测成功但没勾选时，结果会写明「连通但未启用」。
      </div>
      {!isAdmin && (
        <div className="note" data-testid="llm-admin-required" style={{ color: 'var(--warn, #b8860b)' }}>
          🔒 需管理员：增删引擎、改配置与连通拨测仅管理员可操作
          {sessionLoading ? '（正在确认登录身份…）' : role === 'member' ? '（当前账号为普通成员）' : '（当前未登录）'}。
        </div>
      )}

      {view.engines.length === 0 && (
        <div className="note" data-testid="llm-no-engine">还没有引擎：用下方「➕ 添加其他厂商 API」填名称 + 服务地址 + 模型名，或从预设快选添加。</div>
      )}

      <div
        className="row"
        data-testid="llm-add-section"
        style={{
          flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginTop: 12,
          border: '1px dashed var(--border, #e0e0e8)', borderRadius: 8, padding: '10px 12px',
        }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>➕ 添加其他厂商 API（任意 OpenAI 兼容服务）</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
            <input data-testid="llm-add-custom-name" style={{ width: 130 }} placeholder="名称，如 内部网关" value={custom.name}
              disabled={!isAdmin || busy} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            <input data-testid="llm-add-custom-baseurl" style={{ width: 260 }} placeholder="https://host 或 https://host/api/v1" value={custom.baseURL}
              disabled={!isAdmin || busy} onChange={(e) => setCustom({ ...custom, baseURL: e.target.value })} />
            <input data-testid="llm-add-custom-model" style={{ width: 150 }} placeholder="模型名（可留空后补）" value={custom.model}
              disabled={!isAdmin || busy} onChange={(e) => setCustom({ ...custom, model: e.target.value })} />
            <button type="button" className="btn primary" data-testid="llm-add-custom" disabled={!isAdmin || busy || !custom.name.trim() || !custom.baseURL.trim()}
              onClick={() => { void apply({ add: { ...custom } }, '已添加自定义引擎，可点「测试连通」真实拨测。'); setCustom({ name: '', baseURL: '', model: '' }); }}>
              ＋ 添加引擎
            </button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>或从预设快选</div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <select data-testid="llm-add-preset" value={presetPick} disabled={!isAdmin || busy}
              onChange={(e) => setPresetPick(e.target.value)}>
              <option value="">选择厂商…</option>
              {presets.filter((p) => !usedPresets.has(p.preset)).map((p) => (
                <option key={p.preset} value={p.preset}>{p.name}</option>
              ))}
            </select>
            <button type="button" className="btn" data-testid="llm-add-preset-btn" disabled={!isAdmin || busy || !presetPick}
              onClick={() => { void apply({ add: { preset: presetPick } }, '已添加引擎。'); setPresetPick(''); }}>添加</button>
          </div>
        </div>
      </div>

      {view.engines.map((e) => (
        <EngineRow
          key={e.id}
          engine={e}
          draft={draftOf(e)}
          rank={(() => { const i = order.findIndex((o) => o.id === e.id); return i < 0 ? null : i + 1; })()}
          isAdmin={isAdmin}
          busy={busy}
          keyDraft={keys[e.id] ?? ''}
          onKeyDraft={(v) => setKeys((s) => ({ ...s, [e.id]: v }))}
          onSaveKey={() => void apply({ key: { id: e.id, value: keys[e.id] ?? '' } }, `${e.name} 密钥已保存。`)}
          onClearKey={() => void apply({ key: { id: e.id, value: '' } }, `${e.name} 密钥已清除。`)}
          onDraft={(patch) => setDrafts((prev) => ({ ...prev, [e.id]: { ...draftOf(e), ...patch } }))}
          onTest={() => void testEngine(e)}
          testing={!!testing[e.id]}
          testResult={testResult[e.id] ?? null}
          onRemove={() => void apply({ remove: e.id }, `已移除 ${e.name}。`)}
        />
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" data-testid="llm-save" disabled={busy || !isAdmin}
          onClick={() => void apply({ engines: view.engines.map((e) => ({ id: e.id, ...draftOf(e) })) })}>
          {busy ? '保存中…' : '保存 LLM 配置'}
        </button>
        <span className="dim" style={{ fontSize: 11 }}>
          配置存 <code>llm-config.json</code>（不含密钥）；各引擎 Key 统一存 <code>llm-keys.json</code>（0600，仅主进程可读）。
        </span>
      </div>
    </div>
  );
}

function draftsDirty(d: EngineRowDraft, e: LlmEngineView): boolean {
  return d.name !== e.name || d.enabled !== e.enabled || d.baseURL.trim() !== e.baseURL.trim() || d.model.trim() !== e.model.trim();
}
