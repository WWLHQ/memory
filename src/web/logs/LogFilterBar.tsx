// REQ-011 T3 过滤区（§2.1 六维）
import type { LogAction, LogFilter, LogForm, LogLevel } from './types.ts';
import { ACTION_LABEL, FORM_LABEL } from './seed.ts';

interface Props {
  filter: LogFilter;
  onChange: (f: LogFilter) => void;
  count: number;
}

const LEVELS: LogLevel[] = ['info', 'warn', 'error'];
const FORMS: LogForm[] = ['desktop', 'web', 'mobile', 'mac', 'linux', 'cli'];
const ACTIONS: LogAction[] = ['recall', 'write', 'gc', 'sync_up', 'sync_down', 'sync_fail', 'sync_reconcile', 'conflict_resolve', 'llm_proxy', 'llm_fallback', 'l0_view', 'login', 'team_assign'];

export function LogFilterBar({ filter, onChange, count }: Props) {
  const toggleAction = (a: LogAction) => {
    const actions = filter.actions.includes(a) ? filter.actions.filter((x) => x !== a) : [...filter.actions, a];
    onChange({ ...filter, actions });
  };
  return (
    <div className="card" data-testid="log-filter">
      <div className="row-head"><b>过滤（§2.1）</b><span className="dim" data-testid="log-count">命中 {count} 条</span></div>
      <div className="row">
        <label style={{ fontSize: 12 }}>级别</label>
        <select data-testid="lf-level" value={filter.level} onChange={(e) => onChange({ ...filter, level: e.target.value as LogFilter['level'] })}>
          <option value="all">全部</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <label style={{ fontSize: 12 }}>端</label>
        <select data-testid="lf-form" value={filter.form} onChange={(e) => onChange({ ...filter, form: e.target.value as LogFilter['form'] })}>
          <option value="all">全部</option>
          {FORMS.map((f) => <option key={f} value={f}>{FORM_LABEL[f]}</option>)}
        </select>
        <label style={{ fontSize: 12 }}>时间窗</label>
        <select data-testid="lf-window" value={filter.window} onChange={(e) => onChange({ ...filter, window: e.target.value as LogFilter['window'] })}>
          <option value="5min">近 5 分钟</option>
          <option value="1h">近 1 小时</option>
          <option value="24h">近 24 小时</option>
          <option value="7d">近 7 天</option>
        </select>
        <input
          data-testid="lf-kw" placeholder="搜 request_id / 消息 / agent"
          value={filter.keyword}
          style={{ flex: 1, minWidth: 160, background: 'var(--panel2)', color: 'var(--txt)', border: '1px solid var(--line)', borderRadius: 8, padding: 6 }}
          onChange={(e) => onChange({ ...filter, keyword: e.target.value })}
        />
        <label style={{ fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" data-testid="lf-abnormal" checked={filter.onlyAbnormal} onChange={(e) => onChange({ ...filter, onlyAbnormal: e.target.checked })} /> 仅异常
        </label>
      </div>
      <div className="row" data-testid="lf-actions">
        <span className="dim">动作（多选）：</span>
        {ACTIONS.map((a) => (
          <label key={a} style={{ fontSize: 11, cursor: 'pointer' }}>
            <input type="checkbox" checked={filter.actions.includes(a)} onChange={() => toggleAction(a)} /> {ACTION_LABEL[a]}
          </label>
        ))}
      </div>
    </div>
  );
}
