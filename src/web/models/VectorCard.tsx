// P13-T3 向量模型卡：切换联动 dims/deploy；换维度 → 重建提示 + 估时；重建中禁切换（R5）；连通测试
import { useState } from 'react';
import type { VectorModelKey } from './types.ts';
import { VECTOR_MODELS } from './seed.ts';
import { rebuildEta, vectorInfo } from './logic.ts';

interface Props {
  value: VectorModelKey;
  onChange: (k: VectorModelKey) => void;
  /** 已入库向量条数（估时用） */
  count: number;
  onToast: (msg: string) => void;
}

export function VectorCard({ value, onChange, count, onToast }: Props) {
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const info = vectorInfo(value);

  function handleSelect(next: VectorModelKey) {
    if (rebuilding) return; // R5：重建中禁止切换
    if (next === value) return;
    const from = vectorInfo(value);
    const to = vectorInfo(next);
    if (from.dims !== to.dims) {
      const eta = rebuildEta(from.dims, to.dims, count);
      const ok = window.confirm(
        `维度将从 ${from.dims} 变为 ${to.dims}，已入库的 ${count} 条向量索引需全量重建。\n预计耗时约 ${eta} 分钟，期间检索不可用。确认切换？`,
      );
      if (!ok) return;
      setRebuilding(true);
      setProgress(0);
      onChange(next);
      // 演示用模拟重建进度（真实实现由后台任务驱动）
      const timer = window.setInterval(() => {
        setProgress((p) => {
          if (p >= 100) {
            window.clearInterval(timer);
            setRebuilding(false);
            onToast(`向量索引重建完成：${to.label} · ${to.dims} 维`);
            return 0;
          }
          return p + 25;
        });
      }, 400);
    } else {
      onChange(next);
    }
  }

  return (
    <div className="card" data-testid="vector-card">
      <b>向量模型</b>
      <div className="note">嵌入维度决定索引结构，换维度需重建索引（9.x）；重建期间禁止再次切换（R5）。</div>
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <select
          data-testid="vector-select"
          value={value}
          disabled={rebuilding}
          onChange={(e) => handleSelect(e.target.value as VectorModelKey)}
          style={{ flex: 1 }}
        >
          {VECTOR_MODELS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        <button className="btn" data-testid="vector-ping" onClick={() => onToast(`连通测试通过：${info.label}（${info.dims} 维 · ${info.deploy}）`)}>
          连通测试
        </button>
      </div>
      <div className="row" style={{ gap: 18, marginTop: 8 }}>
        <span data-testid="vector-dims">维度：<b>{info.dims}</b></span>
        <span data-testid="vector-deploy">部署：{info.deploy}{info.needsKey ? '（云端 · 需配 API Key）' : ''}</span>
      </div>
      {info.needsKey && (
        <div className="row" style={{ marginTop: 8 }}>
          <input data-testid="vector-key" type="password" placeholder="云端模型 API Key" style={{ flex: 1 }} />
        </div>
      )}
      {rebuilding && (
        <div data-testid="rebuild-banner" style={{ marginTop: 10 }}>
          ⏳ 索引重建中（{progress}%）—— 切换已锁定（R5）
          <div style={{ background: 'var(--border,#2a3442)', height: 6, borderRadius: 3, marginTop: 6 }}>
            <div style={{ background: 'var(--accent,#4f8cff)', height: 6, borderRadius: 3, width: `${progress}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
