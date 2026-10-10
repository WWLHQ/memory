// P5-T3 知识库策略表（17.6 六类，逐行可编辑，保存前校验数值区间）
import type { KbPolicyRow } from './types.ts';
import { validateKbRow } from './logic.ts';

interface Props {
  rows: KbPolicyRow[];
  onChange: (next: KbPolicyRow[], changed: string) => void;
}

export function KbPolicyTable({ rows, onChange }: Props) {
  const patch = (i: number, p: Partial<KbPolicyRow>, label: string) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...p } : r));
    onChange(next, label);
  };
  return (
    <div className="card" data-testid="kb-table">
      <b>知识库策略表（17.6）</b>
      <div className="note">六类知识库分别控制遗忘与归档；行内即改，保存前校验。</div>
      <table className="ltable">
        <thead>
          <tr><th>知识库</th><th>半衰期（天）</th><th>归档阈值（天）</th><th>自动合并</th><th>校验</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const err = validateKbRow(r);
            return (
              <tr key={r.kb} data-testid={`kb-row-${i}`}>
                <td>{r.kb}</td>
                <td>
                  <input
                    type="number" min={1} value={r.half_life_days} style={{ width: 72 }}
                    data-testid={`kb-hl-${i}`}
                    onChange={(e) => patch(i, { half_life_days: Number(e.target.value) }, `${r.kb} 半衰期=${e.target.value}d`)}
                  />
                </td>
                <td>
                  <input
                    type="number" min={1} value={r.archive_days} style={{ width: 72 }}
                    data-testid={`kb-ar-${i}`}
                    onChange={(e) => patch(i, { archive_days: Number(e.target.value) }, `${r.kb} 归档=${e.target.value}d`)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox" checked={r.merge_on} data-testid={`kb-merge-${i}`}
                    onChange={(e) => patch(i, { merge_on: e.target.checked }, `${r.kb} 合并=${e.target.checked ? '开' : '关'}`)}
                  />
                </td>
                <td>{err ? <span className="status deprecated" data-testid={`kb-err-${i}`}>{err}</span> : <span className="dim">✓</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
