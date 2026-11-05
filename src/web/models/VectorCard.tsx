// P13-T3 向量模型卡：切换联动 dims/deploy；换维度需保存后按新维度重建（R5）。
// 「探测本地后端」只验证内核内置 hash 嵌入后端能否产出指定维度的向量，不验证所选模型权重、也不测云端通道。
import { useState } from 'react';
import type { VectorModelKey } from './types.ts';
import { VECTOR_MODELS } from './catalog.ts';
import { rebuildEta, vectorInfo } from './logic.ts';

interface Props {
  value: VectorModelKey;
  onChange: (k: VectorModelKey) => void;
  /** 已入库向量条数（估时用） */
  count: number;
  onToast: (msg: string) => void;
  /** 本地嵌入后端探测（ok=true 仅代表 hash 后端可用；所选模型权重/云端通道未接入，不得谎报模型连通） */
  onProbe: (apiKey: string) => Promise<{ ok: boolean; message: string }>;
  /** 保存落盘/重嵌入进行中（R5：此时禁止再次切换） */
  saving?: boolean;
}

export function VectorCard({ value, onChange, count, onToast, onProbe, saving = false }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [probing, setProbing] = useState(false);
  const info = vectorInfo(value);

  function handleSelect(next: VectorModelKey) {
    if (saving) return; // R5：重建中禁止切换
    if (next === value) return;
    const from = vectorInfo(value);
    const to = vectorInfo(next);
    if (from.dims !== to.dims) {
      const eta = rebuildEta(from.dims, to.dims, count);
      const ok = window.confirm(
        `维度将从 ${from.dims} 变为 ${to.dims}，保存后已入库的 ${count} 条记忆需按新维度重嵌入。\n预计耗时约 ${eta} 分钟，期间检索不可用。确认切换？`,
      );
      if (!ok) return;
      onChange(next);
      onToast(`已选择 ${to.label}（${to.dims} 维）：点击「保存 model_config」后按新维度重嵌入并生效`);
      return;
    }
    onChange(next);
  }

  async function handleProbe() {
    if (probing) return;
    setProbing(true);
    try {
      const r = await onProbe(apiKey);
      // ok=true 只说明内核内置 hash 后端能产出向量；所选向量模型的权重与云端通道均未接入，
      // 因此不得用「测试通过」这类会被读成「模型已连通」的结论前缀。
      onToast(`${r.ok ? '本地 hash 后端可用（非所选模型连通）' : '模型连通未验证'}：${r.message}`);
    } finally {
      setProbing(false);
    }
  }

  return (
    <div className="card" data-testid="vector-card">
      <b>向量模型</b>
      <div className="note">
        嵌入维度决定索引结构，换维度需重建索引（9.x）；重建期间禁止再次切换（R5）。
        当前嵌入由内核 JsVectorBackend（hash 起步实现）执行，模型名用于维度/部署声明，本地权重与云端通道尚未接入。
        「探测本地后端」只验证内核 hash 后端能否产出指定维度向量，不代表所选模型权重已加载或云端通道已连通。
      </div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <select
          data-testid="vector-select"
          value={value}
          disabled={saving}
          onChange={(e) => handleSelect(e.target.value as VectorModelKey)}
          style={{ flex: 1 }}
        >
          {VECTOR_MODELS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        <button className="btn" data-testid="vector-ping" disabled={probing} onClick={handleProbe}>
          {probing ? '探测中…' : '探测本地后端'}
        </button>
      </div>
      <div className="row" style={{ gap: 18, marginTop: 8 }}>
        <span data-testid="vector-dims">维度：<b>{info.dims}</b></span>
        <span data-testid="vector-deploy">部署：{info.deploy}{info.needsKey ? '（云端 · 需配 API Key）' : ''}</span>
      </div>
      {info.needsKey && (
        <div className="row" style={{ marginTop: 8 }}>
          <input
            data-testid="vector-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="云端模型 API Key（仅内存，不落盘 · R2）"
            style={{ flex: 1 }}
          />
        </div>
      )}
      {saving && (
        <div data-testid="rebuild-banner" style={{ marginTop: 10 }}>
          ⏳ 正在按当前维度重嵌入已入库记忆并重建内核…（切换已锁定 · R5）
        </div>
      )}
    </div>
  );
}
