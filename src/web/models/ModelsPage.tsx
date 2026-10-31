// 大模型配置页（REQ-009 / P13）T4 编排
// auto 择优走内核 routeProxy（19.8 统一路由）；「模拟」是 dry-run，不写账本/不扣额度（Phase C3）；
// 保存 model_config 真落盘并重建内核；manual 的 R7/C11 约束在页面逻辑层。
// 反代理源与向量条数挂载时从真实账本回填。
import { useEffect, useMemo, useState } from 'react';
import type { LlmUsage, ProxyAuditEntry, ProxySelectMode, ProxySource, UsageConfig, VectorModelKey } from './types.ts';
import {
  DEFAULT_VECTOR_KEY, PROXY_CATALOG, USAGE_KEYS, USAGE_LABELS,
} from './catalog.ts';
import { manualPick, validatePriceCap, validateUsage, vectorInfo } from './logic.ts';
import { coreAuditTail, coreLoadSources, coreSaveConfig, coreSimulateAuto, coreVectorCount, coreVectorProbe } from './coreModels.ts';
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
  const [sources, setSources] = useState<ProxySource[]>(
    PROXY_CATALOG.map((c) => ({ ...c, used: 0 })),
  );
  const [vectorCount, setVectorCount] = useState(0);
  const [selected, setSelected] = useState<string[]>(['claude-code']);
  const [selectMode, setSelectMode] = useState<ProxySelectMode>('auto');
  const [priceCap, setPriceCap] = useState(0.01);
  const [costCap, setCostCap] = useState(2);
  const [auditLog, setAuditLog] = useState<ProxyAuditEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const { node: toast, show } = useToast();

  // 挂载：审计回显 + 当日已用量 + 向量条数，全部来自真实账本
  useEffect(() => {
    let alive = true;
    Promise.all([coreAuditTail(), coreLoadSources(), coreVectorCount()])
      .then(([tail, srcs, count]) => {
        if (!alive) return;
        if (tail.length > 0) setAuditLog(tail);
        setSources(srcs);
        setVectorCount(count);
      })
      .catch(() => { /* 账本不可用：保持初始空用量与空审计（不伪造） */ });
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

  async function handleSimulate() {
    if (selectMode === 'auto') {
      // 内核统一路由（19.8）预览：先免费 → 低价 ≤ cap → cost_cap → 回退本地
      const out = await coreSimulateAuto(priceCap, costCap);
      show(out.source
        ? `dry-run（未写账本）：auto 将命中 ${out.source.agent}/${out.source.model} · 预估 ¥${out.cost.toFixed(4)} —— ${out.reason}`
        : `dry-run（未写账本）：将回退本地 —— ${out.reason}`);
      return;
    }
    // manual：R7/C11 约束在页面逻辑层；同样只预览，不写账本、不扣额度
    const pool = sources.filter((s) => selected.includes(s.agent));
    const r = manualPick(pool, priceCap, Date.now());
    const cost = r.source ? r.source.price / 1000 : 0;
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
        sources={sources}
        selected={selected}
        selectMode={selectMode}
        priceCap={priceCap}
        costCap={costCap}
        onToggleSource={(a) => setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]))}
        onSelectMode={setSelectMode}
        onPriceCap={setPriceCap}
        onCostCap={setCostCap}
        onSimulate={handleSimulate}
      />

      <div className="card models-audit" data-testid="audit-echo">
        <b>审计回显（R10 / 4.3）</b>
        <div className="note">保存 model_config 写 param_save 审计；真实代理调用写 llm_proxy/llm_fallback；「模拟」为 dry-run，不写账本。</div>
        {auditLog.length === 0 && <div className="dim" style={{ padding: '6px 0' }}>暂无本会话审计条目</div>}
        {auditLog.map((e, i) => (
          <div className="aentry" key={`${e.at}-${i}`} data-testid={`audit-entry-${i}`}>
            <span className="aev">{e.kind === 'model_config' ? 'model_config' : e.llm_proxy_source === 'agent:local' ? 'local 回退' : 'llm_proxy'}</span>
            <span className="adim">llm_proxy_source={e.llm_proxy_source}</span>
            <span className="adim">cost=¥{e.cost.toFixed(4)}</span>
            <span className="adim">mode={e.mode}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <b>保存</b>
        <div className="row" style={{ marginTop: 8, alignItems: 'center', gap: 14 }}>
          <button className="btn" data-testid="save-config" onClick={handleSave}>保存 model_config</button>
          <span className="dim">price_cap 校验：{capCheck.ok ? '通过' : capCheck.msg}</span>
        </div>
      </div>
      {toast}
    </div>
  );
}
