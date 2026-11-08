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
import { LlmUsageTable } from './LlmUsageTable.tsx';
import { ProxyPanel } from './ProxyPanel.tsx';
import { BillingPanel, type ManualPatch } from './BillingPanel.tsx';
import { useToast } from './useToast.tsx';
import { hostCall } from '../../desktop/hostBridge.ts';
import { getStoredSessionId } from '../Home/crossTabAuth.ts';
import type { BillingEngineView } from '../../shared/billing.ts';
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
    <div className="p0-page" data-testid="models-page">
      <div className="p0-hd">
        <h2>🧬 模型与成本</h2>
        <span className="p0-tag">REQ-009 · P13</span>
        <span className="p0-tag info">cap 与内核路由同源</span>
      </div>
      <div className="sub">向量模型 + LLM 四用途（计费）+ 反代理映射（引擎）· 配置落盘 localStorage（API Key 仅内存，R2）· 模拟为 dry-run · fallback_local 恒开（R3）</div>

      {usageErrors.length > 0 && (
        <div className="p0-banner err" data-testid="usage-errors">
          ⚠ 校验未过：
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {usageErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="p0-sec" data-testid="models-sec-engine">
        <div className="p0-sec-hd">
          <h3>一、引擎</h3>
          <span className="p0-tag">向量模型 · 宿主网关真实引擎</span>
        </div>
        <VectorCard
          value={vectorKey}
          onChange={setVectorKey}
          count={vectorCount}
          onToast={show}
          onProbe={(apiKey) => coreVectorProbe(vectorKey, apiKey)}
          saving={saving}
        />
        <div className="card" data-testid="engine-summary">
          <b>引擎概览（宿主网关真实快照）</b>
          <div className="note">
            引擎清单（名称/模型/单价/今日已用）在第三段「反向代理 · 来源映射」逐行呈现，避免同一组引擎在两段重复；
            此处只给网关口径的汇总，全部来自真实快照与账本，未接入即空态。
          </div>
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

      <div className="p0-sec" data-testid="models-sec-billing">
        <div className="p0-sec-hd">
          <h3>二、计费</h3>
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

        <div className="card models-audit" data-testid="audit-echo">
          <b>审计回显（R10 / 4.3）</b>
          <div className="note">保存 model_config 写 param_save 审计；真实代理调用写 llm_proxy/llm_fallback；「模拟」为 dry-run，不写账本。回显按账本真实事件类型，配置保存不冒充代理调用。</div>
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
          <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 14 }}>
            <button className="btn" data-testid="save-config" onClick={handleSave}>保存 model_config</button>
            <span className="dim">price_cap 校验：{priceCap === null ? '未设置' : capCheck.ok ? '通过' : capCheck.msg}</span>
          </div>
        </div>
      </div>

      <div className="p0-sec" data-testid="models-sec-proxy">
        <div className="p0-sec-hd">
          <h3>三、反向代理</h3>
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
      {toast}
    </div>
  );
}
