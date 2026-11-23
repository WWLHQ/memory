// 大模型配置页（REQ-009 / P13）T4 编排
// auto 择优走内核 routeProxy（19.8 统一路由）；「模拟」是 dry-run，不写账本/不扣额度（Phase C3）；
// 保存 model_config 真落盘并重建内核；manual 的 R7/C11 约束在页面逻辑层。
// 反代理源与向量条数挂载时从真实账本回填。
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LlmUsage, ProxyAuditEntry, ProxySelectMode, ProxySource, UsageConfig, VectorModelKey } from './types.ts';
import {
  DEFAULT_VECTOR_KEY, USAGE_KEYS, USAGE_LABELS,
} from './catalog.ts';
import { manualPick, validatePriceCap, validateUsage, vectorInfo } from './logic.ts';
import {
  coreAuditTail, coreLoadProxyCaps, coreLoadSources, coreSaveConfig, coreSaveProxyCaps,
  coreSimulateAuto, coreVectorCount, coreVectorProbe,
} from './coreModels.ts';
import type { ProxyCaps } from '../../shared/proxyAccounting.ts';
import { getHostLlmSnapshot, hostLlmAvailable, refreshHostLlmSnapshotOnce } from '../hostLlm.ts';
import { hydrateUsages, readModelConfig } from './modelConfig.ts';
import { VectorCard } from './VectorCard.tsx';
import { LlmEngineCard } from '../params/LlmEngineCard.tsx';
import { LlmUsageTable } from './LlmUsageTable.tsx';
import { ProxyPanel } from './ProxyPanel.tsx';
import { BillingPanel, type ManualPatch } from './BillingPanel.tsx';
import { useToast } from './useToast.tsx';
import { hostCall } from '../../desktop/hostBridge.ts';
import '../shared/afPage.css';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';
import type { BillingEngineView } from '../../shared/billing.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import './extras.css';

const BILLING_TTL_DEFAULT = 10 * 60 * 1000;

interface BillingReply {
  ok: boolean;
  ttlMs?: number;
  asOf?: number;
  engines?: BillingEngineView[];
  error?: string;
}

export function ModelsPage() {
  useHostTheme();
  // 挂载即回填已落盘配置（Phase C3：刷新/重开页面后选择仍生效；API Key 不落盘）
  const [vectorKey, setVectorKey] = useState<VectorModelKey>(() => readModelConfig()?.vectorKey ?? DEFAULT_VECTOR_KEY);
  const [usages, setUsages] = useState<Record<LlmUsage, UsageConfig>>(() => hydrateUsages(readModelConfig()?.usages));
  const [sources, setSources] = useState<ProxySource[]>([]); // 真实源由挂载时 coreLoadSources 从快照回填；无网关 → 空态（3-C 补三态）
  const [gatewayState, setGatewayState] = useState<'configured' | 'unconfigured' | 'degraded'>('unconfigured');
  const [vectorCount, setVectorCount] = useState(0);
  const [selected, setSelected] = useState<string[]>([]); // 真实源挂载后由用户勾选；初始无伪造默认勾选
  const [selectMode, setSelectMode] = useState<ProxySelectMode>('auto');
  // 批次48 A24：封顶默认「未设置」（null），挂载时从参数快照回填；不回落写死的 0.01 / 2
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [costCap, setCostCap] = useState<number | null>(null);
  const [auditLog, setAuditLog] = useState<ProxyAuditEntry[]>([]);
  const [saving, setSaving] = useState(false);
  // 结构照定稿：3 个页签（引擎 / 计费 / 反向代理），只渲染当前页签
  const [tab, setTab] = useState(0);
  const { node: toast, show } = useToast();
  // 批次48 A31-c/A31-d：余额视图（逐字段 provenance）+ 手工兜底（配额/单价/余额）
  const [billingViews, setBillingViews] = useState<BillingEngineView[]>([]);
  const [billingTtl, setBillingTtl] = useState(BILLING_TTL_DEFAULT);
  const [billingAt, setBillingAt] = useState<number | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  const applyBillingReply = useCallback((r: BillingReply) => {
    if (!r.ok) {
      setBillingError(r.error ?? '余额查询失败');
      return;
    }
    setBillingError(null);
    setBillingViews(Array.isArray(r.engines) ? r.engines : []);
    if (typeof r.ttlMs === 'number') setBillingTtl(r.ttlMs);
    if (typeof r.asOf === 'number') setBillingAt(r.asOf);
  }, []);

  /** 余额视图：force=true 绕过 10 分钟 TTL（页面手动刷新）；浏览器模式不做伪 hostCall */
  const loadBilling = useCallback(async (force: boolean) => {
    if (!hostLlmAvailable()) return;
    setBillingLoading(true);
    try {
      const r = await hostCall<BillingReply>('llm:billing', [{ force }, getStoredSessionId()]);
      applyBillingReply(r);
    } catch (e) {
      setBillingError(`余额查询失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBillingLoading(false);
    }
  }, [applyBillingReply]);

  // 挂载：快照刷新（桌面壳）→ 三态判定 + 审计回显 + 真实用量 + 向量条数
  useEffect(() => {
    let alive = true;
    (async () => {
      if (hostLlmAvailable()) await refreshHostLlmSnapshotOnce(); // 桌面壳才刷新；浏览器静态环境跳过，避免伪 hostCall
      const snap = getHostLlmSnapshot();
      const [tail, srcs, count, caps] = await Promise.all([
        coreAuditTail(), coreLoadSources(), coreVectorCount(), coreLoadProxyCaps(),
      ]);
      if (!alive) return;
      setGatewayState(snap ? (snap.usable ? 'configured' : 'degraded') : 'unconfigured');
      if (tail.length > 0) setAuditLog(tail);
      setSources(srcs);
      setVectorCount(count);
      // 封顶回填：快照未设置 → 仍是 null，输入框显示「未设置」
      setPriceCap(caps.price_cap);
      setCostCap(caps.cost_cap);
      // A31-d：余额视图随页面挂载拉取（TTL 内复用缓存，不重复打厂商）
      void loadBilling(false);
    })().catch(() => { /* 账本/网关不可用：保持初始空用量与空审计（不伪造） */ });
    return () => { alive = false; };
  }, [loadBilling]);

  const vector = vectorInfo(vectorKey);

  // 深链：?tab=0..2（引擎 / 计费 / 反向代理），无参数 = 引擎
  useEffect(() => {
    const t = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tab') : null;
    const n = t === null ? NaN : Number(t);
    if (Number.isInteger(n) && n >= 0 && n <= 2) setTab(n);
  }, []);

  /** 场景卡动作：切页签并滚到真实面板 */
  const jumpTo = (i: number, testid: string) => {
    setTab(i);
    setTimeout(() => {
      document.querySelector(`[data-testid="${testid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  /** 真实刷新：宿主快照 + 源 + 向量条数 + 余额视图（force 绕过 TTL） */
  async function reloadAll() {
    try {
      if (hostLlmAvailable()) await refreshHostLlmSnapshotOnce();
      const snap = getHostLlmSnapshot();
      const [srcs, count] = await Promise.all([coreLoadSources(), coreVectorCount()]);
      setGatewayState(snap ? (snap.usable ? 'configured' : 'degraded') : 'unconfigured');
      setSources(srcs);
      setVectorCount(count);
      await loadBilling(true);
      show(`已重新读取：源 ${srcs.length} 个 / 向量 ${count} 条 / 余额视图已刷新`);
    } catch (e) {
      show(`刷新失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const usageErrors = useMemo(
    () => USAGE_KEYS.flatMap((u) => validateUsage(u, usages[u]).errors.map((e) => `${USAGE_LABELS[u]}: ${e}`)),
    [usages],
  );
  const capCheck = validatePriceCap(priceCap);

  const pushAudit = (e: ProxyAuditEntry) => setAuditLog((l) => [e, ...l].slice(0, 20));

  function patchUsage(u: LlmUsage, patch: Partial<UsageConfig>) {
    setUsages((m) => ({ ...m, [u]: { ...m[u], ...patch } }));
  }

  async function handleSave() {
    const errs = [...usageErrors, ...(capCheck.ok ? [] : [capCheck.msg])];
    if (errs.length > 0) {
      show(`保存被拒绝：${errs[0]}`);
      return;
    }
    setSaving(true);
    try {
      const out = await coreSaveConfig(vectorKey, vector.label, vector.dims, usages);
      pushAudit(out.entry);
      const durable = out.persisted ? '已持久化' : '仅本次运行生效（localStorage 不可用/配额满）';
      show(`已保存 model_config：向量=${vector.label}（${vector.dims} 维）· ${durable} · 重嵌入 ${out.reembedded} 条 · 4 用途校验通过 · fallback_local 恒开`);
    } catch (e) {
      show(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  /** 封顶变更即落参数快照（值未变不写）；真实路由与模拟随后都读同一份快照 */
  async function persistCaps(next: ProxyCaps) {
    try {
      await coreSaveProxyCaps(next);
    } catch (e) {
      show(`封顶保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function handlePriceCap(v: number | null) {
    setPriceCap(v);
    void persistCaps({ price_cap: v, cost_cap: costCap });
  }

  function handleCostCap(v: number | null) {
    setCostCap(v);
    void persistCaps({ price_cap: priceCap, cost_cap: v });
  }

  async function handleSimulate() {
    if (selectMode === 'auto') {
      // 内核统一路由（19.8）预览：先免费 → 低价 ≤ cap → cost_cap → 回退本地
      // 批次48 A24：不传页面状态，直接读参数快照 —— 与内核真实路由同一份取值
      const out = await coreSimulateAuto();
      show(out.source
        ? `dry-run（未写账本）：auto 将命中 ${out.source.agent}/${out.source.model} · 预估 ¥${out.cost.toFixed(4)} —— ${out.reason}`
        : `dry-run（未写账本）：将回退本地 —— ${out.reason}`);
      return;
    }
    // manual：R7/C11 约束在页面逻辑层；同样只预览，不写账本、不扣额度
    const pool = sources.filter((s) => selected.includes(s.agent));
    const r = manualPick(pool, priceCap, Date.now());
    const cost = r.source && r.source.price !== null ? r.source.price / 1000 : 0;
    show(r.source
      ? `dry-run（未写账本）：manual 将命中 ${r.source.agent}/${r.source.model} · 预估 ¥${cost.toFixed(4)} —— ${r.reason}`
      : `dry-run（未写账本）：将回退本地 —— ${r.reason}`);
  }

  /** A31-c：手工兜底（余额/日配额/单价）写 llm-config.json，仅管理员；写完刷新快照与视图（TTL 内不重复打厂商） */
  async function saveManualBilling(id: string, patch: ManualPatch) {
    try {
      const r = await hostCall<{ ok: boolean; error?: string }>('llm:configSet', [
        { engines: [{ id, billing: patch }] }, getStoredSessionId(),
      ]);
      if (!r.ok) { show(`手工配置保存失败：${r.error ?? '未知错误'}`); return; }
      await refreshHostLlmSnapshotOnce();
      await loadBilling(false);
    } catch (e) {
      show(`手工配置保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** A31-b：独立 billing 凭据（仅管理员；openrouter 的 management key 必须放这里）；明文不回显 */
  async function setBillingKey(id: string, value: string) {
    try {
      const r = await hostCall<BillingReply>('llm:billingKey', [{ id, value }, getStoredSessionId()]);
      applyBillingReply(r);
      if (!r.ok) { show(`凭据保存失败：${r.error ?? '未知错误'}`); return; }
      show(value ? '凭据已保存，已重新查询余额' : '凭据已清除');
      await refreshHostLlmSnapshotOnce();
    } catch (e) {
      show(`凭据保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="p0-page af-page" data-testid="models-page">
      <div className="af-head" data-testid="models-head">
        <h1>大模型配置</h1>
        <span className="sub">
          向量模型 + LLM 四用途（计费）+ 反代理映射 · 配置落盘 localStorage（API Key 仅内存 R2）· 模拟 = dry-run · fallback_local 恒开（R3）
        </span>
        <span className="right">
          <span className="p0-tag info">cap 与内核路由同源</span>
          <button type="button" className="btn" data-testid="models-reload" onClick={() => void reloadAll()}>重新读取</button>
        </span>
      </div>

      {/* ── 摘要读数条（宿主快照 / 内核源 / 余额视图真实回执） ── */}
      <section className="af-panel" data-testid="models-readout">
        <div className="af-ph"><h3>模型摘要</h3><span className="hint">宿主快照 + 内核账本 · 非示例数据</span></div>
        <div className="af-pb">
          <div className="af-g4">
            <div className="af-stat">
              <div className="k">向量模型 <span>model_config</span></div>
              <div className="v sm">{vector.label}</div>
              <div className="d mut">{vector.dims} 维 · 账本向量 {vectorCount} 条</div>
            </div>
            <div className="af-stat">
              <div className="k">网关状态 <span>llm snapshot</span></div>
              <div className={`v sm${gatewayState === 'degraded' ? ' bad' : ''}`}>
                {gatewayState === 'configured' ? '可用' : gatewayState === 'degraded' ? '降级' : '未配置'}
              </div>
              <div className={gatewayState === 'configured' ? 'd' : 'd mut'}>
                {gatewayState === 'configured' ? '宿主快照有可用网关' : '未配置/降级 → 路由回退本地'}
              </div>
            </div>
            <div className="af-stat">
              <div className="k">反代理源 <span>sources</span></div>
              <div className="v">{sources.length}</div>
              <div className="d mut">路由 {selectMode === 'auto' ? 'auto（内核统一路由）' : `manual · 勾选 ${selected.length}`}</div>
            </div>
            <div className="af-stat">
              <div className="k">配置校验 <span>4 用途</span></div>
              <div className={`v${usageErrors.length ? ' bad' : ''}`}>{usageErrors.length}</div>
              <div className={usageErrors.length ? 'd bad' : 'd'}>
                {usageErrors.length ? usageErrors[0] : `本地 ${USAGE_KEYS.filter((u) => usages[u].local).length} / 网络 ${USAGE_KEYS.filter((u) => usages[u].net).length} 用途已开`}
              </div>
            </div>
          </div>
          <p className="af-note">来源：宿主 llm 快照、内核 model_config / 反代理源 / 向量条数、llm:billing 回执；取不到显示未配置。</p>
        </div>
      </section>

      {/* ── 场景分组：清单路由 / 单价配额 / 精炼引擎 / 连接测试 ── */}
      <div className="af-g2" data-testid="models-groups">
        <section className="af-panel" data-testid="models-group-route">
          <div className="af-ph"><h3>模型清单与路由</h3><span className="hint">P13 · 19.8</span></div>
          <div className="af-pb">
            <p className="af-q">请求最终落到哪个模型，auto / manual 各自怎么选？</p>
            <div className="af-mini">
              <span>源 <b>{sources.length}</b></span>
              <span>模式 <b>{selectMode}</b></span>
              <span>免费优先 <b>恒开</b></span>
              <span>封顶 <b>{priceCap === null ? '未设置' : `¥${priceCap}`}</b></span>
            </div>
            <p className="af-note">来源：内核反代理源 + 封顶快照；dry-run 与真实路由同源。</p>
            <div className="af-actions">
              <button type="button" className="btn primary" data-testid="models-dry-run" onClick={() => void handleSimulate()}>dry-run 模拟路由</button>
              <button type="button" className="btn" data-testid="models-jump-proxy" onClick={() => jumpTo(2, 'models-sec-proxy')}>打开反向代理</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="models-group-billing">
          <div className="af-ph"><h3>按引擎的手工兜底单价 / 配额</h3><span className="hint">llm-config.json</span></div>
          <div className="af-pb">
            <p className="af-q">余额 / 日配额查不到时，手工兜底的单价与额度是什么？</p>
            <div className="af-mini">
              <span>引擎视图 <b>{billingViews.length}</b></span>
              <span>TTL <b>{Math.round(billingTtl / 60000)} 分钟</b></span>
              <span>最近查询 <b>{billingAt ? new Date(billingAt).toLocaleTimeString('zh-CN', { hour12: false }) : '未查询'}</b></span>
              <span className={billingError ? 'bad' : ''}>错误 <b className={billingError ? 'bad' : ''}>{billingError ?? '无'}</b></span>
            </div>
            <p className="af-note">来源：llm:billing 回执；手工单价写 llm-config.json（仅管理员）。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="models-refresh-billing" disabled={billingLoading} onClick={() => void loadBilling(true)}>
                {billingLoading ? '查询中…' : '刷新余额（绕过 TTL）'}
              </button>
              <button type="button" className="btn" data-testid="models-jump-billing" onClick={() => jumpTo(1, 'models-sec-billing')}>打开计费</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="models-group-refine">
          <div className="af-ph"><h3>LLM 精炼引擎</h3><span className="hint">已迁入本页</span></div>
          <div className="af-pb">
            <p className="af-q">L1–L5 精炼用的引擎与通道在哪里配？</p>
            <div className="af-mini">
              <span>位置 <b>引擎页</b></span>
              <span>校验错误 <b className={usageErrors.length ? 'bad' : ''}>{usageErrors.length}</b></span>
              <span>全局参数页 <b>不再重复出现</b></span>
            </div>
            <p className="af-note">来源：本页 LlmEngineCard（已迁入）；与四用途同一份配置 + 内核快照。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="models-jump-refine" onClick={() => jumpTo(0, 'llm-engine-card')}>打开精炼引擎</button>
            </div>
          </div>
        </section>

        <section className="af-panel" data-testid="models-group-conn">
          <div className="af-ph"><h3>连接测试与真实失败原因</h3><span className="hint">快照 / 余额 / 向量探针</span></div>
          <div className="af-pb">
            <p className="af-q">网关通不通，失败时是哪个环节、什么原因？</p>
            <div className="af-mini">
              <span>网关 <b>{gatewayState}</b></span>
              <span>余额查询 <b>{billingError ? '失败' : billingAt ? '成功' : '未查询'}</b></span>
              <span>向量库 <b>{vectorCount} 条</b></span>
              <span className={billingError ? 'bad' : ''}>失败原因 <b className={billingError ? 'bad' : ''}>{billingError ?? '无'}</b></span>
            </div>
            <p className="af-note">失败原因原样展示宿主 / 厂商回执，不包装；无宿主通道时标注未配置。</p>
            <div className="af-actions">
              <button type="button" className="btn" data-testid="models-test-conn" onClick={() => void reloadAll()}>测试连接（刷新快照 + 余额）</button>
              <a className="btn" data-testid="models-jump-audit" href="../audit.html">查看路由审计</a>
            </div>
          </div>
        </section>
      </div>

      {usageErrors.length > 0 && (
        <div className="p0-banner err" data-testid="usage-errors">
          ⚠ 校验未过：
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {usageErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="p0-tabs" role="tablist" data-testid="models-tabs">
        {['引擎', '计费', '反向代理'].map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`mtab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}</button>
        ))}
      </div>

      {tab === 0 && (
      <div className="p0-sec" data-testid="models-sec-engine">
        <div className="p0-sec-hd">
          <h3>引擎</h3>
          <span className="p0-tag">向量模型 · 宿主网关真实引擎</span>
        </div>
        {/* 2026-11-22 用户要求：本页签内容回退到本轮改动前（取消页签内两列网格，恢复整宽纵向排列） */}
        <VectorCard
          value={vectorKey}
          onChange={setVectorKey}
          count={vectorCount}
          onToast={show}
          onProbe={(apiKey) => coreVectorProbe(vectorKey, apiKey)}
          saving={saving}
        />
        {/* 2026-11-21 用户要求：LLM 精炼引擎整块从「参数」迁到这里，与向量模型同属引擎配置 */}
        <LlmEngineCard />
        <div className="card" data-testid="engine-summary">
          <b>引擎概览（宿主网关真实快照）</b>
          <div className="note">引擎清单见「反向代理 · 来源映射」，此处只给网关汇总。</div>
          <div className="row" style={{ gap: 22, marginTop: 8 }}>
            <span data-testid="engine-gateway-state">
              网关：<b>{gatewayState === 'configured' ? '已配置可用' : gatewayState === 'degraded' ? '配置存在但不可用' : '未接入 / 未配置'}</b>
            </span>
            <span data-testid="engine-count">
              可用引擎：<b>{sources.length}</b> 个
            </span>
            <span>
              选择模式：<b>{selectMode === 'auto' ? 'auto 择优' : 'manual 手选'}</b>
            </span>
            <span>
              成本上限：<b>{costCap === null ? '未设置' : `¥${costCap}`}</b> / 日
            </span>
          </div>
        </div>
      </div>
      )}

      {tab === 1 && (
      <div className="p0-sec" data-testid="models-sec-billing">
        <div className="p0-sec-hd">
          <h3>计费</h3>
          <span className="p0-tag">四用途 · 余额 provenance · 手工单价/配额</span>
        </div>
        <LlmUsageTable usages={usages} onChange={patchUsage} />
        <BillingPanel
          views={billingViews}
          ttlMs={billingTtl}
          fetchedAt={billingAt}
          loading={billingLoading}
          error={billingError}
          hostAvailable={hostLlmAvailable()}
          onRefresh={() => { void loadBilling(true); }}
          onSaveManual={(id, patch) => { void saveManualBilling(id, patch); }}
          onSetKey={(id, value) => { void setBillingKey(id, value); }}
        />

        {/* 2026-11-22 用户要求：本页签内容回退到本轮改动前（取消页签内两列网格，恢复整宽纵向排列） */}
        <div className="card models-audit" data-testid="audit-echo">
            <b>审计回显（R10 / 4.3）</b>
            <div className="note">保存写 param_save；真实调用写 llm_proxy/llm_fallback；dry-run 不写账本。</div>
            {auditLog.length === 0 && <div className="dim" style={{ padding: '6px 0' }}>暂无本会话审计条目</div>}
            {auditLog.map((e, i) => (
              <div className="aentry" key={`${e.at}-${i}`} data-testid={`audit-entry-${i}`}>
                {e.event === 'model_config' ? (
                  <>
                    <span className="aev">model_config</span>
                    <span className="adim">vector={e.vector ?? '未记录'}{e.dims === null ? '' : `（${e.dims} 维）`}</span>
                    <span className="adim">重嵌入 {e.reembedded ?? '未记录'} 条</span>
                    <span className="adim">{e.persisted === null ? '持久化：未记录' : e.persisted ? '已持久化' : '仅本次运行'}</span>
                  </>
                ) : (
                  <>
                    <span className="aev">{e.llm_proxy_source === 'agent:local' ? 'local 回退' : 'llm_proxy'}</span>
                    <span className="adim">llm_proxy_source={e.llm_proxy_source}</span>
                    <span className="adim">cost={e.cost === null ? '未记录（usage/单价未设置）' : `¥${e.cost.toFixed(4)}（usage × 单价推算，非厂商账单）`}</span>
                    <span className="adim">mode={e.mode}</span>
                  </>
                )}
              </div>
            ))}
        </div>

        <div className="card">
            <b>保存</b>
            <div className="note">保存后写 param_save 审计；price_cap 校验不过会拒绝保存。</div>
            <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 14 }}>
              <button className="btn" data-testid="save-config" onClick={handleSave}>保存 model_config</button>
              <span className="dim">price_cap 校验：{priceCap === null ? '未设置' : capCheck.ok ? '通过' : capCheck.msg}</span>
            </div>
        </div>
      </div>
      )}

      {tab === 2 && (
      <div className="p0-sec" data-testid="models-sec-proxy">
        <div className="p0-sec-hd">
          <h3>反向代理</h3>
          <span className="p0-tag">来源映射 · price_cap / cost_cap（与内核路由同源）</span>
        </div>
        <ProxyPanel
          state={gatewayState}
          sources={sources}
          selected={selected}
          selectMode={selectMode}
          priceCap={priceCap}
          costCap={costCap}
          onToggleSource={(a) => setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]))}
          onSelectMode={setSelectMode}
          onPriceCap={handlePriceCap}
          onCostCap={handleCostCap}
          onSimulate={handleSimulate}
        />
      </div>
      )}
      {toast}
    </div>
  );
}
