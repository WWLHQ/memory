// P5-T3 知识库策略表（17.6 六类）—— 阶段5-E / B9：内核 policyFor() 的只读镜像。
// 旧版是可编辑偏好表：六行用原型期编造的中文分类与另一套数值，保存进 params:v1: 偏好记忆
// 却从不驱动遗忘执行，用户会误以为改了就生效。现改为内核真实策略的只读展示：不提供输入框，
// 也不从偏好快照回填，展示值恒等于内核当下实际生效的策略（单一真源）。
import { CATEGORY_LABEL, kernelKbPolicies } from './defaults.ts';
import type { Category } from '../../core/memagent/types.ts';

export function KbPolicyTable() {
  const rows = kernelKbPolicies();
  return (
    <div className="card" data-testid="kb-table">
      <b>知识库策略表（17.6）· 内核实际生效值</b>
      <div className="note">
        六行直接读内核 <code>policyFor(category)</code>，分类键与数值都与遗忘引擎同源；本表只读，不是可编辑的偏好设置。
      </div>
      <div className="note dim" data-testid="kb-honesty-note">
        半衰期与「自动合并」确由内核读取（新鲜度打分 / 合并分桶）；归档阈值列是内核策略表里的规格值，
        但当前层迁移按固定 3/30/90 天判定，<b>内核未使用该值</b>，不驱动归档。
        「自动合并」列只标 <code>auto_merge === true</code> 的类别，<code>cautious</code>（偏好）按不自动合并处理。
        参数页「保存全局参数」写的是偏好快照，不会改写这里的策略。
      </div>
      <table className="ltable">
        <thead>
          <tr><th>知识库</th><th>半衰期（天）</th><th>归档阈值（天·内核未使用）</th><th>自动合并</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.kb} data-testid={`kb-row-${i}`}>
              <td>{CATEGORY_LABEL[r.kb as Category] ?? r.kb}</td>
              <td data-testid={`kb-hl-${i}`}>{r.half_life_days}</td>
              <td data-testid={`kb-ar-${i}`}>{r.archive_days}</td>
              <td data-testid={`kb-merge-${i}`}>{r.merge_on ? '开' : '关'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
