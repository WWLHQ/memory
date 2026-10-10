// P7-T4 裁决操作组件
// 选中冲突下展示 4 种裁决（9.7 三模式 + 保留），每个裁决生成成对审计对象（18.4 约束5）。
import type { ConflictRecord, Verdict } from './types.ts';
import { applyVerdict } from './logic.ts';

export const VERDICTS: { key: Verdict; label: string; cls: string; desc: string }[] = [
  { key: 'auto_override', label: '自动覆盖', cls: 'primary', desc: '旧值 deprecated，新值信任 +0.1，回填 replaced_by' },
  { key: 'user_confirm', label: '人工确认', cls: '', desc: '保留旧值，新值挂 dispute' },
  { key: 'merge', label: '合并', cls: '', desc: '两条均 deprecated，生成合并记忆占位' },
  { key: 'hold', label: '挂起', cls: 'danger', desc: '维持 dispute 待后续裁决' },
];

interface Props {
  record: ConflictRecord;
  requestSeq: number;
  onVerdict: (v: Verdict, result: ReturnType<typeof applyVerdict>, reqId: string) => void;
}

export function DisputeVerdict({ record, requestSeq, onVerdict }: Props) {
  return (
    <div className="verdict" data-testid="verdict-panel">
      <div className="row-head">
        <b>裁决 {record.id}</b>
        <span className="mid">req = req_d{requestSeq}（18.2-E 链路）</span>
      </div>
      <div className="verdict" data-testid="verdict-buttons">
        {VERDICTS.map((vb) => (
          <button
            key={vb.key}
            className={`btn ${vb.cls}`}
            data-testid={`verdict-${vb.key}`}
            title={vb.desc}
            onClick={() => onVerdict(vb.key, applyVerdict(record, vb.key), `req_d${requestSeq}`)}
          >
            {vb.label}
          </button>
        ))}
      </div>
      <div className="note" data-testid="verdict-note">{VERDICTS.map((v) => `${v.label}：${v.desc}`).join('；')}</div>
    </div>
  );
}
