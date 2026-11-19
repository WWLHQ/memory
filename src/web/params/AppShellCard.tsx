// 阶段 A · 参数页「后台常驻」卡片：托盘常驻 + 开机自启两个二选一开关。
//
// 三条纪律（都来自本项目踩过的坑）：
//   ① 徽标显示主进程回执的**真值**（托盘是否真建了 / 系统登录项是否真写了），不是「你点了启用」；
//   ② 无常驻则自启禁用，并在页面说明原因——两者是联动关系，不是两个独立开关；
//   ③ 保存失败要报出来并回读真值，不能点了按钮就当生效。
//
// 没有对应原型（design/ui/ 下无「托盘/自启」原型）：交互沿用同页既有二选一组件（rh-pick / rh-choice），
// 保证与本页「硬前置召回」卡视觉一致，不另造一套控件。
import { useCallback, useEffect, useState } from 'react';
import { appShellAvailable, appShellSet, appShellState, type AppShellStateView } from './appShell.ts';
import './recallHard.css';

function Pick(props: {
  label: string;
  on: boolean;
  disabled: boolean;
  testId: string;
  onPick: (on: boolean) => void;
}) {
  const { label, on, disabled, testId, onPick } = props;
  return (
    <span className="rh-pick" role="radiogroup" aria-label={label} data-testid={testId}>
      <button
        type="button"
        className={`rh-choice${on ? ' active' : ''}`}
        data-value="on"
        aria-pressed={on}
        disabled={disabled}
        onClick={() => onPick(true)}
      >
        启用
      </button>
      <button
        type="button"
        className={`rh-choice${on ? '' : ' active'}`}
        data-value="off"
        aria-pressed={!on}
        disabled={disabled}
        onClick={() => onPick(false)}
      >
        不启用
      </button>
    </span>
  );
}

const errText = (e: unknown): string => String((e as Error)?.message ?? e);

export function AppShellCard() {
  const [state, setState] = useState<AppShellStateView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = appShellAvailable();

  const load = useCallback(async () => {
    if (!available) return;
    const r = await appShellState();
    if (r.ok && r.state) { setState(r.state); setErr(null); }
    else setErr(r.error);
  }, [available]);

  useEffect(() => { void load(); }, [load]);

  const pick = async (patch: { keepInTray?: boolean; autoStart?: boolean }) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await appShellSet(patch);
      if (r.state) setState(r.state);          // 失败也要回填真值，绝不让按钮停在「看起来成功了」
      if (!r.ok) setErr(r.error);
    } catch (e) {
      setErr(errText(e));
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!available) {
    return (
      <div className="card rh-card" data-testid="app-shell-card">
        <div className="rh-h">后台常驻<span className="rh-ref">托盘常驻 / 开机自启</span></div>
        <div className="note" data-testid="app-shell-unavailable">
          当前不是桌面宿主环境：这两项由主进程执行（改窗口生命周期、写系统登录项），浏览器模式没有它。
        </div>
      </div>
    );
  }

  const st = state;
  const autoDisabled = busy || !st || st.keepInTray === false;

  return (
    <div className="card rh-card" data-testid="app-shell-card">
      <div className="rh-h">
        后台常驻
        <span className="rh-ref">托盘常驻 / 开机自启</span>
      </div>
      <div className="note">
        自动采集要「一直在跑」，所以关窗不该退出、开机要自己起来。
        两项都可单独关掉：关掉托盘常驻即回到「关窗就退出」的旧行为（开机自启会同时关闭，避免开机后打不开）。
      </div>

      {!st && !err && <div className="note" data-testid="app-shell-loading">正在读取本机真实状态…</div>}
      {err && <div className="rh-err" data-testid="app-shell-err">{err}</div>}

      {st && (
        <>
          <div className="rh-layer" data-testid="as-keep">
            <div className="rh-head">
              <span className="rh-name">关窗后留在托盘</span>
              <span className={`rh-st ${st.trayActive ? 'on' : 'idle'}`} data-testid="as-keep-st">
                {st.trayActive ? '托盘已建' : '托盘未建'}
              </span>
            </div>
            <div className="rh-desc">
              关闭主窗口只隐藏，本机服务与后台采集继续跑；要彻底退出请用托盘菜单里的「退出」。
            </div>
            <div className="rh-foot">
              <Pick
                label="关窗后留在托盘"
                on={st.keepInTray}
                disabled={busy}
                testId="as-keep-pick"
                onPick={(on) => void pick({ keepInTray: on })}
              />
              <span className="rh-state" data-testid="as-keep-state">
                {st.keepInTray ? '当前：关窗只隐藏' : '当前：关窗即退出'}
              </span>
            </div>
          </div>

          <div className="rh-layer" data-testid="as-auto">
            <div className="rh-head">
              <span className="rh-name">开机自动启动</span>
              <span className={`rh-st ${st.autoStart ? 'on' : 'idle'}`} data-testid="as-auto-st">
                {st.applied === true ? '系统已写入' : st.applied === false ? '系统未写入' : '无法确认'}
              </span>
            </div>
            <div className="rh-desc">
              开机后静默进托盘、不弹窗，采集自己开始。需要先开启「关窗后留在托盘」，否则开机后没有入口。
            </div>
            <div className="rh-foot">
              <Pick
                label="开机自动启动"
                on={st.autoStart}
                disabled={autoDisabled}
                testId="as-auto-pick"
                onPick={(on) => void pick({ autoStart: on })}
              />
              <span className="rh-state" data-testid="as-auto-state">
                {st.keepInTray === false
                  ? '需先开启托盘常驻'
                  : st.autoStart ? '当前：开机自启已开' : '当前：不开机自启'}
              </span>
            </div>
            {st.autostartNote && <div className="rh-line" data-testid="as-auto-note">{st.autostartNote}</div>}
            {st.keepInTray && st.autoStart && st.applied === false && (
              <div className="rh-warn" data-testid="as-auto-mismatch">
                配置里已开启，但系统登录项里查不到——换机/重装后需要重新保存一次才会写入。
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
