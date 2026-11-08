// 首启向导（批次37-B）：把「两个库放在哪 + L0 管理密码 + 恢复卡导出」三件事一次性逼完，走完才放行主界面。
// 为什么要在主进程设闸而不是这里：门禁判据是数据位置指针里的 setupDone 与密钥环有没有 admin_wrap，
// 页面只是载体——就算用户手输 overview.html，setup:finish 之外的每条通道都有各自的闸门（见 main.ts §6e）。
// 三条红线在 UI 上的落点：
// 1) 恢复码明文只在「生成那一次」的返回值里出现，本页面不留副本、不写 localStorage，切步骤就丢；
// 2) 没导出恢复卡就不给「进入应用」（用户拍板：强制先导出才能继续）；
// 3) 管理密码 + 恢复码同时丢失 = L0 原文不可恢复，本应用没有后门——这句话必须让用户看见，不能塞进折叠区。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
const MIN_PW = 8;
const fmtBytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

interface FileState { path: string; exists: boolean; bytes: number }

interface SetupState {
  ok: boolean;
  setup_done: boolean;
  dirs_set: boolean;
  ledger_dir: string;
  l0_dir: string;
  same_dir: boolean;
  ledger_file: FileState;
  l0_file: FileState;
  has_admin_password: boolean;
  has_recovery: boolean;
  card_pending: boolean;
  card_exported: boolean;
  fingerprint: string;
  error?: string;
}

/** 发码回执：码明文只在这里出现一次（之后任何接口都只回状态） */
interface Issued {
  ok: boolean;
  recovery_code?: string;
  recovery_code_grouped?: string;
  fingerprint?: string;
  error?: string;
}

interface ExportResult {
  ok: boolean;
  file_name?: string;
  inside_data_root?: boolean;
  canceled?: boolean;
  error?: string;
}

interface FinishResult {
  ok: boolean;
  next_url?: string;
  error?: string;
}

export function SetupPage({ onNavigate }: { onNavigate?: (url: string) => void }) {
  const hostReady = hostCapability() !== 'none';
  const [state, setState] = useState<SetupState | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 定稿 3 页签：① 存储 / ② 模型 / ③ 安全 */
  const [tab, setTab] = useState(0);

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    try {
      const res = await hostCall<SetupState>('setup:state');
      setState(res);
      if (!res?.ok) setErr(res?.error ?? '首启进度读取失败');
    } catch (e) {
      setState(null);
      setErr(`首启进度读取失败：${errText(e)}`);
    }
  }, [hostReady]);

  useEffect(() => { void refresh(); }, [refresh]);

  /** 发码三选一（首次设密码 / 密码已设但卡没导出）统一收口：只在这里展示明文，切步即丢 */
  const afterIssue = (res: Issued) => {
    setIssued(res);
    setExportMsg(null);
    setCopied(false);
    void refresh();
  };

  const submitPassword = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<Issued>('setup:setL0Password', [pw]);
      if (!res?.ok) setErr(res?.error ?? '设置失败');
      else {
        afterIssue(res);
        setPw('');
        setPw2('');
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const regenCode = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<Issued>('setup:regenCode', [pw]);
      if (!res?.ok) setErr(res?.error ?? '重新生成失败');
      else {
        afterIssue(res);
        setPw('');
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCard = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<ExportResult>('setup:exportCard');
      if (res?.canceled) setExportMsg('已取消保存：恢复码还在内存里，可以再点一次导出。');
      else if (!res?.ok) setExportMsg(`导出失败：${res?.error ?? '未知原因'}`);
      else {
        setExportMsg(res.inside_data_root
          ? `已导出「${res.file_name}」，但它和数据根在同一目录——同一次事故里会一起没，请另存一份到别处。`
          : `已导出「${res.file_name}」：请把这张卡放到与这台电脑分开的地方。`);
      }
      await refresh();
    } catch (e) {
      setExportMsg(`导出失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const reselectDirs = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<{ ok: boolean; canceled?: boolean; error?: string }>('setup:reselectDirs');
      if (!res?.ok) {
        setErr(res?.error ?? '未改选目录');
        setBusy(false);
      }
      // ok=true 时主进程已安排重启，页面不需要再操作
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<FinishResult>('setup:finish');
      if (!res?.ok || !res.next_url) {
        setErr(res?.error ?? '首启设置未完成');
        setBusy(false);
        return;
      }
      // 地址由主进程给（backend/agentBackend 端口参数只有它知道）；导航动作可由测试注入
      (onNavigate ?? ((u: string) => window.location.replace(u)))(res.next_url);
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  };

  const copyCode = async () => {
    const code = issued?.recovery_code ?? '';
    if (!code || !navigator.clipboard?.writeText) {
      setErr('本环境不能一键复制：请用「导出恢复卡」保存到文件。');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setErr(null);
    } catch (e) {
      setErr(`复制失败：${errText(e)}`);
    }
  };

  if (!hostReady) {
    return (
      <div className="wrap">
        <h2>首启设置</h2>
        <div className="card" data-testid="setup-unavailable">
          当前是纯浏览器模式，没有桌面主进程：库位置、L0 管理密码与恢复卡都要靠主进程的真文件与真密钥环，
          这里做不了，也不会假装设置成功。请打开桌面应用完成首启设置。
        </div>
      </div>
    );
  }

  const step1Done = Boolean(state?.dirs_set);
  const step2Done = Boolean(state?.has_admin_password);
  const cardShown = Boolean(issued?.recovery_code);
  const step3Done = Boolean(state?.card_exported);
  const pwOk = pw.length >= MIN_PW && pw === pw2;

  return (
    <div className="wrap">
      <h2>首次启动设置</h2>
      <p className="sub" data-testid="setup-intro">
        这个应用把每条记忆的<strong>可检索正文（L1–L6 记忆库）</strong>和<strong>加密原文（L0 原数据库）</strong>
        分在两个文件里存。下面三步走完才能进入应用：<strong>① 两个库放在哪 ② L0 管理密码 ③ 导出恢复卡</strong>。
        中途取消就退出，不会带着半配置继续跑。
      </p>
      {err && <div className="card" data-testid="setup-error" style={{ color: 'var(--warn)' }}>⚠️ {err}</div>}

      <div className="p0-tabs" role="tablist" data-testid="setup-tabs">
        {['① 存储', '② 模型', '③ 安全'].map((label, i) => (
          <button
            key={label} type="button" role="tab" aria-selected={tab === i}
            className={`p0-tab${tab === i ? ' active' : ''}`}
            data-testid={`setup-tab-${i}`} data-tab={i}
            onClick={() => setTab(i)}
          >{label}</button>
        ))}
      </div>

      <div hidden={tab !== 0} data-testid="setup-panel-0">
      {/* ── ① 两个库的位置 ─────────────────────────────────────── */}
      <div className="card" data-testid="setup-step-dirs">
        <div className="row">
          <span className={step1Done ? 'status active' : 'status'}>{step1Done ? '① 已完成' : '① 待完成'}</span>
          <strong>两个库存放目录</strong>
        </div>
        {!state && <p className="dim" data-testid="setup-dirs-loading">读取中…</p>}
        {state ? (
          <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '6px 12px', fontSize: 12, margin: '10px 0' }}>
            <b>L1–L6 记忆库</b>
            <span>
              <code className="mid">{state.ledger_file.path}</code>
              {state.ledger_file.exists ? `（已有文件，${fmtBytes(state.ledger_file.bytes)}，本次直接沿用，不覆盖）` : '（新库，首次写入时创建）'}
            </span>
            <b>L0 原数据库</b>
            <span>
              <code className="mid">{state.l0_file.path}</code>
              {state.l0_file.exists ? `（已有文件，${fmtBytes(state.l0_file.bytes)}，本次直接沿用，不覆盖）` : '（新库，首次写入时创建）'}
              {' · '}密钥环 l0-keyring.json 与原数据库同目录
            </span>
            <b>是否同一目录</b>
            <span>{state.same_dir ? '同一目录（可以，两个仍是两个文件）' : '分开存放'}</span>
          </div>
        ) : null}
        <p className="note" data-testid="setup-dirs-note">
          目录是在启动时的系统对话框里选的（文件名固定，不可改）。选错了可以在这里重选：
          只会写回指针并重启，<strong>不删任何原文件</strong>——下一轮启动会把库文件补送到新目录（目标已有同名文件则不动）。
        </p>
        <div className="row">
          <button className="btn" data-testid="setup-reselect-dirs" disabled={!step1Done || busy} onClick={() => void reselectDirs()}>
            重选目录并重启
          </button>
        </div>
      </div>
      </div>

      {/* ── ② 模型（定稿页签；程序首启向导无该步骤，如实说明） ───────── */}
      <div hidden={tab !== 1} data-testid="setup-panel-1">
        <div className="card" data-testid="setup-step-model">
          <div className="row">
            <span className="status">程序无该步骤</span>
            <strong>模型引擎</strong>
          </div>
          <p className="note" data-testid="setup-model-note">
            定稿把「至少一个引擎通过连通性测试」放在首启第②步，但本程序的首启 IPC 只有
            <code> setup:state / setL0Password / regenCode / exportCard / reselectDirs / finish</code>，
            <strong>没有 setup:model 这类通道</strong>；模型引擎由管理员登录后在「模型与成本」页通过
            <code> llm:*</code> 接口配置与拨测（需要管理员会话，首启阶段未登录，故此处不伪造通过）。
          </p>
          <div className="note" data-testid="setup-model-deviation">
            偏差如实列出：定稿 = 三步含模型测试；程序 = 存储 → L0 密码 → 恢复卡导出，模型配置在登录后。
            这里不提供假的「测试通过」按钮，避免把未发生的连通性当成功。
          </div>
        </div>
      </div>

      <div hidden={tab !== 2} data-testid="setup-panel-2">
      {/* ── ② L0 管理密码 ─────────────────────────────────────── */}
      <div className="card" data-testid="setup-step-password">
        <div className="row">
          <span className={step2Done ? 'status active' : 'status'}>{step2Done ? '② 已完成' : '② 待完成'}</span>
          <strong>设置 L0 管理密码</strong>
        </div>
        <p className="note" data-testid="setup-pw-why">
          L0 原数据库里的每条原文都用一把随机数据密钥（DEK）加密，而这把密钥本身由这个管理密码包住。
          写入 L0 需要它，忘记它就只能靠下面那张恢复卡。密码<strong>不落盘、不进日志</strong>，本页面也不保存。
        </p>
        {step2Done ? (
          <p data-testid="setup-pw-set">本机已设置 L0 管理密码。如果上一轮的恢复卡没导出就退出了，用该密码在下面重新生成一张新码（旧码当场作废）。</p>
        ) : (
          <div className="row" data-testid="setup-pw-form">
            <input type="password" data-testid="setup-pw" value={pw} placeholder={`管理密码（≥${MIN_PW} 位）`} onChange={(e) => setPw(e.target.value)} style={{ minWidth: 240 }} />
            <input type="password" data-testid="setup-pw2" value={pw2} placeholder="再输入一次" onChange={(e) => setPw2(e.target.value)} style={{ minWidth: 240 }} />
            <button className="btn primary" data-testid="setup-pw-submit" disabled={!pwOk || busy} onClick={() => void submitPassword()}>
              设置并生成恢复码
            </button>
          </div>
        )}
        {step2Done && (
          <div className="row" data-testid="setup-regen-form">
            <input type="password" data-testid="setup-regen-pw" value={pw} placeholder="L0 管理密码" onChange={(e) => setPw(e.target.value)} style={{ minWidth: 240 }} />
            <button className="btn" data-testid="setup-regen" disabled={pw.length < MIN_PW || busy} onClick={() => void regenCode()}>
              重新生成恢复码
            </button>
          </div>
        )}
      </div>

      {/* ── ③ 恢复卡 ─────────────────────────────────────────── */}
      <div className="card" data-testid="setup-step-card">
        <div className="row">
          <span className={step3Done ? 'status active' : 'status'}>{step3Done ? '③ 已完成' : '③ 待完成'}</span>
          <strong>导出 L0 恢复卡</strong>
          {state?.fingerprint ? <span className="badge p2">指纹 {state.fingerprint}</span> : null}
        </div>
        <p className="note" data-testid="setup-card-warning">
          恢复码是忘记管理密码时<strong>唯一</strong>的找回通道：它由随机 256 位生成，不是你密码的衍生物，弱密码也连累不到它。
          口径两条：<strong>① 用过一次即作废</strong>，用过必须换新码并重新导出；
          <strong> ② 管理密码和这张卡同时丢失，L0 原文就不可恢复——本应用没有任何后门或万能密钥。</strong>
          请把它存到与这台电脑分开的地方（U 盘 / 打印 / 密码管理器）。
        </p>
        {cardShown ? (
          <div data-testid="setup-card-body">
            <pre className="mid" data-testid="setup-code" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 12, border: '1px solid var(--line)', borderRadius: 8 }}>
              {issued?.recovery_code_grouped}
            </pre>
            <div className="row">
              <button className="btn" data-testid="setup-copy" onClick={() => void copyCode()}>
                {copied ? '已复制到剪贴板' : '复制恢复码'}
              </button>
              <button className="btn primary" data-testid="setup-export" disabled={busy} onClick={() => void exportCard()}>
                导出恢复卡（另存为）
              </button>
            </div>
            <p className="dim" data-testid="setup-code-once">这段明文只在这次生成时显示，关掉本页就再也看不到——所以下一步必须真的存下来。</p>
          </div>
        ) : state?.card_pending ? (
          <p data-testid="setup-card-pending">本次已有待导出的恢复卡（码明文不再回显），可直接点导出；若要重新看码只能换发新码。</p>
        ) : (
          <p data-testid="setup-card-none">还没有恢复码：先完成第 ② 步（或点「重新生成恢复码」）。</p>
        )}
        {exportMsg && <p data-testid="setup-export-result">{exportMsg}</p>}
        {!step3Done && <p className="dim" data-testid="setup-not-exported">尚未导出：不导出这张卡就不能进入应用。</p>}
      </div>

      <div className="card" data-testid="setup-step-finish">
        <div className="row">
          <button
            className="btn primary"
            data-testid="setup-finish"
            disabled={!(step1Done && step2Done && step3Done) || busy}
            onClick={() => void finish()}
          >
            完成设置并进入应用
          </button>
          {!(step1Done && step2Done && step3Done) && <span className="dim" data-testid="setup-finish-hint">三步都完成后才可点</span>}
        </div>
      </div>
      </div>
    </div>
  );
}
