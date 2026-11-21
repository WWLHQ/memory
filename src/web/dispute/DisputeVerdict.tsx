// P7-T4 裁决操作组件（批次53-R 重做：截图目标版式 = 四等宽按钮 + 按钮下各一行灰注释）
// 每个裁决生成成对审计对象（18.4 约束5）。
// 批次48 A19：页面不再预生成 request_id —— 真实 id 由内核裁决调用返回（coreVerdict.kernel_request_ids），
// 预生成只能「预告」一个查无此链的假 id，已移除。
import type { ConflictRecord, Verdict } from './types.ts';
import { applyVerdict } from './logic.ts';

export const VERDICTS: { key: Verdict; label: string; cls: string; desc: string }[] = [
  { key: 'auto_override', label: '自动覆盖', cls: '', desc: '旧值 deprecated · 新值信任 +0.1' },
  { key: 'user_confirm', label: '人工确认', cls: 'primary', desc: '保留旧值 · 新值挂 dispute' },
  { key: 'merge', label: '合并', cls: '', desc: '两条均 deprecated · 生成合并记忆' },
  { key: 'hold', label: '挂起', cls: 'danger', desc: '维持 dispute 待后续裁决' },
];

interface Props {
  /** null = 队列未选中/空账本：面板与四项动作常驻，但禁用并写原因 */
  record: ConflictRecord | null;
  onVerdict: (v: Verdict, result: ReturnType<typeof applyVerdict>) => void;
}

export function DisputeVerdict({ record, onVerdict }: Props) {
  return (
    <div className="verdict" data-testid="verdict-panel">
      <div className="v-head">
        <b>{record ? `裁决 ${record.id}` : '裁决（未选中）'}</b>
        <span className="mid" data-testid="req-hint">request_id = 内核裁决返回（成功后见下方历史）</span>
      </div>
      <div className="v-grid" data-testid="verdict-buttons">
        {VERDICTS.map((vb) => (
          <div className="v-col" key={vb.key}>
            <button
              className={`v-btn ${vb.cls}`}
              data-testid={`verdict-${vb.key}`}
              title={record ? vb.desc : '请先在队列中选择一条冲突（未选中时不可裁决）'}
              disabled={!record}
              onClick={() => { if (record) onVerdict(vb.key, applyVerdict(record, vb.key)); }}
            >
              {vb.label}
            </button>
            <div className="v-cap">{vb.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
