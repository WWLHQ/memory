// 大模型配置页（REQ-009 / P13）T4 编排
// auto 择优走内核 routeProxy（19.8 统一路由）；「模拟」是 dry-run，不写账本/不扣额度（Phase C3）；
// 保存 model_config 真落盘并重建内核；manual 的 R7/C11 约束在页面逻辑层。
// 反代理源与向量条数挂载时从真实账本回填。
import { useEffect, useMemo, useState } from 'react';
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
import { useToast } from './useToast.tsx';
import './extras.css';

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
    })().catch(() => { /* 账本/网关不可用：保持初始空用量与空审计（不伪造） */ });
    return () => { alive = false; };
  }, []);

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

  return (
    <div className="wrap" data-testid="models-page">
      <h1>🧬 大模型配置页 <span className="badge p2">REQ-009 · P13</span></h1>
      <div className="sub">向量模型 + LLM 四用途 + 反代理映射 · 配置落盘 localStorage（API Key 仅内存，R2）· 模拟为 dry-run · fallback_local 恒开（R3）</div>

      {usageErrors.length > 0 && (
        <div className="card" data-testid="usage-errors" style={{ borderColor: 'var(--danger,#ff5d5d)' }}>
          ⚠ 校验未过：
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {usageErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <VectorCard
        value={vectorKey}
        onChange={setVectorKey}
        count={vectorCount}
        onToast={show}
        onProbe={(apiKey) => coreVectorProbe(vectorKey, apiKey)}
        saving={saving}
      />
      <LlmUsageTable usages={usages} onChange={patchUsage} />
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
                <span className="adim">cost={e.cost === null ? '未记录（usage/单价未设置）' : `¥${e.cost.toFixed(4)}`}</span>
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
      {toast}
    </div>
  );
}
