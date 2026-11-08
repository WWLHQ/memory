// REQ-011 T3 过滤区（§2.1 六维）· p0 版式
import type { LogAction, LogFilter, LogForm, LogLevel } from './types.ts';
import { ACTION_LABEL, FORM_LABEL } from './labels.ts';

interface Props {
  filter: LogFilter;
  onChange: (f: LogFilter) => void;
  count: number;
}

const LEVELS: LogLevel[] = ['info', 'warn', 'error'];
const FORMS: LogForm[] = ['desktop', 'web', 'mobile', 'mac', 'linux', 'cli'];
const ACTIONS: LogAction[] = [
  'recall', 'write', 'graft', 'gc', 'sync_up', 'sync_down', 'sync_fail', 'sync_reconcile',
  'conflict_resolve', 'llm_proxy', 'llm_fallback', 'l0_view', 'l0_auth_request', 'l0_auth_grant',
  'l0_auth_revoke', 'security_change', 'login', 'team_assign',
];

export function LogFilterBar({ filter, onChange, count }: Props) {
  const toggleAction = (a: LogAction) => {
    const actions = filter.actions.includes(a) ? filter.actions.filter((x) => x !== a) : [...filter.actions, a];
    onChange({ ...filter, actions });
  };
  return (
    <div className="p0-card" data-testid="log-filter">
      <div className="p0-hd">
        <h3>过滤（§2.1）</h3>
        <span className="p0-sub" data-testid="log-count">命中 {count} 条</span>
        <span className="p0-right p0-tag info">error 恒置顶，不受时间窗过滤</span>
      </div>
      <div className="p0-row-actions" style={{ marginTop: 0 }}>
        <label className="p0-note" htmlFor="lf-level">级别</label>
        <select id="lf-level" className="p0-in" data-testid="lf-level" value={filter.level}
          onChange={(e) => onChange({ ...filter, level: e.target.value as LogFilter['level'] })}>
          <option value="all">全部</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <label className="p0-note" htmlFor="lf-form">端</label>
        <select id="lf-form" className="p0-in" data-testid="lf-form" value={filter.form}
          onChange={(e) => onChange({ ...filter, form: e.target.value as LogFilter['form'] })}>
          <option value="all">全部</option>
          {FORMS.map((f) => <option key={f} value={f}>{FORM_LABEL[f]}</option>)}
        </select>
        <label className="p0-note" htmlFor="lf-window">时间窗</label>
        <select id="lf-window" className="p0-in" data-testid="lf-window" value={filter.window}
          onChange={(e) => onChange({ ...filter, window: e.target.value as LogFilter['window'] })}>
          <option value="5min">近 5 分钟</option>
          <option value="1h">近 1 小时</option>
          <option value="24h">近 24 小时</option>
          <option value="7d">近 7 天</option>
        </select>
        <input
          className="p0-in" data-testid="lf-kw" placeholder="搜 request_id / 消息 / agent"
          value={filter.keyword}
          style={{ flex: 1, minWidth: 160 }}
          onChange={(e) => onChange({ ...filter, keyword: e.target.value })}
        />
        <label className="p0-note" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" data-testid="lf-abnormal" checked={filter.onlyAbnormal}
            onChange={(e) => onChange({ ...filter, onlyAbnormal: e.target.checked })} /> 仅异常
        </label>
      </div>
      <div className="p0-row-actions" data-testid="lf-actions" style={{ marginTop: 6 }}>
        <span className="p0-note">动作（多选）：</span>
        {ACTIONS.map((a) => (
          <label key={a} className="p0-note" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={filter.actions.includes(a)} onChange={() => toggleAction(a)} /> {ACTION_LABEL[a]}
          </label>
        ))}
      </div>
    </div>
  );
}
