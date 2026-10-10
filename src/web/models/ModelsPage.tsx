// 大模型配置页（REQ-009 / P13）T4 编排
// auto 择优走内核 routeProxy（19.8 统一路由）；模拟/保存写内核审计账本，回显从内核流加载；
// manual 的 R7/C11 选择约束在页面逻辑层。初始渲染用种子，内容一致无跳变。
import { useEffect, useMemo, useState } from 'react';
import type { LlmUsage, ProxyAuditEntry, ProxySelectMode, ProxySource, UsageConfig, VectorModelKey } from './types.ts';
import { SEED_SOURCES, SEED_USAGES, SEED_VECTOR_COUNT, SEED_VECTOR_KEY, USAGE_KEYS, USAGE_LABELS } from './seed.ts';
import { manualPick, validatePriceCap, validateUsage, vectorInfo } from './logic.ts';
import { coreAuditProxy, coreAuditTail, coreSaveConfig, coreSimulateAuto } from './coreModels.ts';
import { VectorCard } from './VectorCard.tsx';
import { LlmUsageTable } from './LlmUsageTable.tsx';
import { ProxyPanel } from './ProxyPanel.tsx';
import { useToast } from './useToast.tsx';
import './extras.css';

export function ModelsPage() {
  const [vectorKey, setVectorKey] = useState<VectorModelKey>(SEED_VECTOR_KEY);
  const [usages, setUsages] = useState<Record<LlmUsage, UsageConfig>>({ ...SEED_USAGES });
  const [sources, setSources] = useState<ProxySource[]>(SEED_SOURCES.map((s) => ({ ...s })));
  const [selected, setSelected] = useState<string[]>(['claude-code']);
  const [selectMode, setSelectMode] = useState<ProxySelectMode>('auto');
  const [priceCap, setPriceCap] = useState(0.01);
  const [costCap, setCostCap] = useState(2);
  const [auditLog, setAuditLog] = useState<ProxyAuditEntry[]>([]);
  const { node: toast, show } = useToast();

  // 审计回显 = 内核审计流（挂载加载本会话历史）
  useEffect(() => {
    let alive = true;
    coreAuditTail().then((tail) => { if (alive && tail.length > 0) setAuditLog(tail); });
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
    const entry = await coreSaveConfig(vector.label, vector.dims);
    pushAudit(entry);
    show(`已保存 model_config：向量=${vector.label}（${vector.dims} 维）· 4 用途校验通过 · fallback_local 恒开`);
  }

  async function handleSimulate() {
    if (selectMode === 'auto') {
      // 内核统一路由（19.8）：先免费 → 低价 ≤ cap → cost_cap → 回退本地
      const out = await coreSimulateAuto(priceCap, costCap);
      if (out.source) {
        setSources((ss) => ss.map((s) => (s.agent === out.source!.agent ? { ...s, used: s.used + 1 } : s)));
        pushAudit(out.audit);
        show(`auto 命中：${out.source.agent}/${out.source.model} · 花费 ¥${out.cost.toFixed(4)} —— ${out.reason}`);
      } else {
        pushAudit(out.audit);
        show(`回退本地：${out.reason}`);
      }
      return;
    }
    // manual：R7/C11 约束在页面逻辑层，审计写内核
    const pool = sources.filter((s) => selected.includes(s.agent));
    const r = manualPick(pool, priceCap, Date.now());
    const cost = r.source ? r.source.price / 1000 : 0;
    if (r.source) {
      setSources((ss) => ss.map((s) => (s.agent === r.source!.agent ? { ...s, used: s.used + 1 } : s)));
    }
    const entry = await coreAuditProxy(r.source, cost, r.source ? 'manual' : 'local');
    pushAudit(entry);
    show(r.source
      ? `manual 命中：${r.source.agent}/${r.source.model} · 花费 ¥${cost.toFixed(4)} —— ${r.reason}`
      : `回退本地：${r.reason}`);
  }

  return (
    <div className="wrap" data-testid="models-page">
      <h1>🧬 大模型配置页 <span className="badge p2">REQ-009 · P13</span></h1>
      <div className="sub">向量模型 + LLM 四用途 + 反代理映射 · 本地内存态为真相 · fallback_local 恒开（R3）</div>

      {usageErrors.length > 0 && (
        <div className="card" data-testid="usage-errors" style={{ borderColor: 'var(--danger,#ff5d5d)' }}>
          ⚠ 校验未过：
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {usageErrors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <VectorCard value={vectorKey} onChange={setVectorKey} count={SEED_VECTOR_COUNT} onToast={show} />
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
        <div className="note">保存写 model_config；每次代理调用写 llm_proxy（含 llm_proxy_source / 花费 / 模式）。</div>
        {auditLog.length === 0 && <div className="dim" style={{ padding: '6px 0' }}>暂无本会话审计条目</div>}
        {auditLog.map((e, i) => (
          <div className="aentry" key={`${e.at}-${i}`} data-testid={`audit-entry-${i}`}>
            <span className="aev">{e.llm_proxy_source.startsWith('agent:local') && e.cost === 0 ? 'model_config' : 'llm_proxy'}</span>
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
