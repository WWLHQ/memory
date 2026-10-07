// 效果证据 · 用户可感知的「省」与「快」（19.1 / 9.x / 2.4.x / 19.8 反代理）
// ⚠ 结构与文案严格对齐原型 renderGains() / GAINS。
import type { Gain } from '../../types/agentOnboard.ts';

interface Props {
  gains: Gain[];
}

export function Gains({ gains }: Props) {
  return (
    <div className="gains" id="gains">
      {gains.map((g) => (
        <div className="gain" key={g.title}>
          <h3>{g.icon} {g.title}</h3>
          <div className="big">{g.big}</div>
          {/* desc 含 <b> 强调标记：按原型保留富文本 */}
          <div className="desc" dangerouslySetInnerHTML={{ __html: g.desc }} />
          <div className="src">依据：{g.src}</div>
        </div>
      ))}
    </div>
  );
}