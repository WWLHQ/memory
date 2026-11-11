// 首启向导（批次37-B 建；批次58 按定稿图逐字重做版式）。
// 【版式红线】严格照定稿图：标题条 + setupDone 胶囊 + 三步绿框进度 + 三张白卡（①两库位置 ②L0 管理密码 ③恢复卡预览）
// + 底部固定条 + 三段状态栏。不自创进度 chip、不加彩色状态块、不改两列字段布局、不改按钮形态。
// 图中示例值（D:\MemoryData / a3f9-c21e / 11,958 行）一律换成主进程真回读，绝不拿假数冒充真实读数。
//
// 用户上一条明确要求保留的两项，以**图中同款控件**落位，不引入新视觉语言：
//   备份路径（必选）→ ① 卡内第三行「两列目录字段 + 选择目录」，选完即落盘；
//   精炼大模型（可选）→ ③ 卡之后追加一张**同款白卡** ④，跳过确认弹窗同款卡片。
// 门禁仍在主进程：setup:finish 要「密码已设 + 备份至少一处 + 本次真导出过恢复卡」；页面按钮不是唯一防线。
// 三条红线不变：码明文只显一次、没导出不给进、密码与卡同时丢失 L0 不可恢复必须摆在明面。
import { useCallback, useEffect, useState } from 'react';
import { hostCall, hostCapability } from '../../desktop/hostBridge.ts';
import { useHostTheme } from '../shared/hostTheme.ts';
import './setupPage.css';

const errText = (e: unknown): string => String((e as Error)?.message ?? e);
/** 定稿图口径：≥12 位 · 大小写+数字+符号（比内核 L0_MIN_SECRET_LEN=8 更严，不冲突） */
const MIN_PW = 12;
const strongPw = (v: string): boolean =>
  v.length >= MIN_PW && /[A-Z]/.test(v) && /[a-z]/.test(v) && /[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v);

interface FileState { path: string; exists: boolean; bytes: number }
interface BackupState {
  ledger_dir: string;
  l0_dir: string;
  shared_dir: string;
  default_dir: string;
  enabled: boolean;
  hour: number;
  minute: number;
  keep_count: number;
}
interface LlmEngineView { id: string; name: string; model: string; enabled: boolean; keySet: boolean; lastProbeOk: boolean | null; lastLatencyMs: number | null }
interface LlmPresetView { preset: string; name: string; baseURL: string; model: string; needsKey: boolean }
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
  backup: BackupState;
  llm: { usable: boolean; skipped: boolean; engines: LlmEngineView[]; presets: LlmPresetView[] };
  error?: string;
}
interface Issued {
  ok: boolean;
  recovery_code?: string;
  recovery_code_grouped?: string;
  fingerprint?: string;
  created_at?: number;
  error?: string;
}
interface ExportResult {
  ok: boolean;
  file_name?: string;
  inside_data_root?: boolean;
  canceled?: boolean;
  error?: string;
}
interface FinishResult { ok: boolean; next_url?: string; error?: string }
interface ProbeResult {
  ok: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
  engine?: { id: string; name: string; model: string };
}

export function SetupPage({ onNavigate }: { onNavigate?: (url: string) => void }) {
  useHostTheme();
  const hostReady = hostCapability() !== 'none';
  const [state, setState] = useState<SetupState | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** 本次真的导出过的卡文件名（来自主进程回执） */
  const [exportedFile, setExportedFile] = useState<string | null>(null);

  const [bk, setBk] = useState<{ ledger: string; l0: string }>({ ledger: '', l0: '' });
  const [bkMsg, setBkMsg] = useState<string | null>(null);

  const [llm, setLlm] = useState({ preset: '', name: '', baseURL: '', model: '', apiKey: '' });
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [llmMsg, setLlmMsg] = useState<string | null>(null);
  const [askSkip, setAskSkip] = useState(false);

  const refresh = useCallback(async () => {
    if (!hostReady) return;
    try {
      const res = await hostCall<SetupState>('setup:state');
      setState(res);
      if (!res?.ok) setErr(res?.error ?? '首启进度读取失败');
      else setBk({ ledger: res.backup?.ledger_dir ?? '', l0: res.backup?.l0_dir ?? '' });
    } catch (e) {
      setState(null);
      setErr(`首启进度读取失败：${errText(e)}`);
    }
  }, [hostReady]);

  useEffect(() => { void refresh(); }, [refresh]);

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
      else { afterIssue(res); setPw(''); setPw2(''); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const regenCode = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<Issued>('setup:regenCode', [pw]);
      if (!res?.ok) setErr(res?.error ?? '重新生成失败');
      else { afterIssue(res); setPw(''); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const exportCard = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<ExportResult>('setup:exportCard');
      if (res?.canceled) setExportMsg('已取消保存：恢复码还在内存里，可以再点一次导出。');
      else if (!res?.ok) setExportMsg(`导出失败：${res?.error ?? '未知原因'}`);
      else {
        setExportedFile(res.file_name ?? null);
        setExportMsg(res.inside_data_root
          ? `已导出「${res.file_name}」，但它和数据根在同一目录——同一次事故里会一起没，请另存一份到别处。`
          : `已导出「${res.file_name}」：请把这张卡放到与这台电脑分开的地方。`);
      }
      await refresh();
    } catch (e) { setExportMsg(`导出失败：${errText(e)}`); } finally { setBusy(false); }
  };

  /** ① 卡「选择目录」：改选两库位置后由主进程写指针并重启（路径在 app ready 前解析） */
  const reselectDirs = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<{ ok: boolean; canceled?: boolean; error?: string }>('setup:reselectDirs');
      if (!res?.ok) { setErr(res?.error ?? '未改选目录'); setBusy(false); }
      // ok=true 时主进程已安排重启，页面不需要再操作
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };

  /** ① 卡第三行「选择目录」：选中即落盘（图中没有额外的保存按钮，不另造控件） */
  const chooseBackupDir = async (group: 'ledger' | 'l0') => {
    setErr(null);
    setBkMsg(null);
    try {
      const picked = await hostCall<{ ok: boolean; canceled?: boolean; dir?: string; error?: string }>('setup:chooseBackupDir', [group]);
      if (picked?.canceled) { setBkMsg('已取消选择：位置未变。'); return; }
      if (!picked?.ok || !picked.dir) { setErr(picked?.error ?? '目录不可用'); return; }
      const next = group === 'ledger' ? { ...bk, ledger: picked.dir } : { ...bk, l0: picked.dir };
      setBk(next);
      const saved = await hostCall<{ ok: boolean; warnings?: string[]; error?: string }>('setup:setBackup', [
        { ledgerDir: next.ledger, l0Dir: next.l0 },
      ]);
      if (!saved?.ok) { setErr(saved?.error ?? '备份设置没保存'); return; }
      setBkMsg(saved.warnings?.length
        ? `已保存，但 ${saved.warnings.join('；')}`
        : `已保存到 ${picked.dir}（并开启每日定时备份）`);
      await refresh();
    } catch (e) { setErr(errText(e)); }
  };

  const llmDraft = () => ({
    preset: llm.preset || undefined,
    name: llm.name || undefined,
    baseURL: llm.baseURL || undefined,
    model: llm.model || undefined,
    apiKey: llm.apiKey || undefined,
  });

  const testLlm = async () => {
    setProbeBusy(true); setErr(null); setLlmMsg(null); setProbe(null);
    try {
      const res = await hostCall<ProbeResult>('setup:llmTest', [llmDraft()]);
      setProbe(res);
      if (!res?.ok) setErr(res?.error ?? '测试未通过');
    } catch (e) { setProbe({ ok: false, error: errText(e) }); setErr(errText(e)); }
    finally { setProbeBusy(false); }
  };

  const saveLlm = async () => {
    setSaveBusy(true); setErr(null); setLlmMsg(null);
    try {
      // 主进程会**再拨测一次**才落盘：页面上的「通过」不能当作写盘许可
      const res = await hostCall<ProbeResult & { usable?: boolean }>('setup:llmSave', [llmDraft()]);
      if (!res?.ok) { setErr(res?.error ?? '保存失败'); setProbe({ ok: false, error: res?.error }); return; }
      setProbe(res);
      setLlmMsg(`已保存并启用：${res.engine?.name ?? ''} · ${res.engine?.model ?? ''}（${res.latencyMs ?? 0} ms）。L2–L5 精炼层从现在起可以生成。`);
      await refresh();
    } catch (e) { setErr(errText(e)); } finally { setSaveBusy(false); }
  };

  const finish = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await hostCall<FinishResult>('setup:finish');
      if (!res?.ok || !res.next_url) { setErr(res?.error ?? '首启设置未完成'); setBusy(false); return; }
      (onNavigate ?? ((u: string) => window.location.replace(u)))(res.next_url);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };

  /** 「不添加精炼大模型」：确认=记下跳过（必需项齐时直接进应用），否=回去继续配 */
  const confirmSkipLlm = async () => {
    setAskSkip(false);
    setErr(null);
    try {
      const res = await hostCall<{ ok: boolean; error?: string }>('setup:skipLlm');
      if (!res?.ok) { setErr(res?.error ?? '无法记录跳过'); return; }
      await refresh();
      if (requiredDone) await finish();
      else setLlmMsg('已记下「不加精炼模型」。上面还有必需步骤没完成，完成后即可进入应用。');
    } catch (e) { setErr(errText(e)); }
  };

  const copyCode = async () => {
    const code = issued?.recovery_code ?? '';
    if (!code || !navigator.clipboard?.writeText) {
      setErr('本环境不能一键复制：请用「导出恢复卡」保存到文件。');
      return;
    }
    try { await navigator.clipboard.writeText(code); setCopied(true); setErr(null); }
    catch (e) { setErr(`复制失败：${errText(e)}`); }
  };

  if (!hostReady) {
    return (
      <div className="sw-page">
        <div className="sw-card" data-testid="setup-unavailable">
          当前是纯浏览器模式，没有桌面主进程：库位置、L0 管理密码与恢复卡都要靠主进程的真文件与真密钥环，
          这里做不了，也不会假装设置成功。请打开桌面应用完成首启设置。
        </div>
      </div>
    );
  }

  const step1Done = Boolean(state?.dirs_set);
  const step2Done = Boolean(state?.has_admin_password);
  const step3Done = Boolean(state?.card_exported);
  const cardShown = Boolean(issued?.recovery_code);
  const backupDone = Boolean(state?.backup && (state.backup.ledger_dir || state.backup.l0_dir));
  const llmConfigured = Boolean(state?.llm?.usable);
  const llmSkipped = Boolean(state?.llm?.skipped);
  const engines = state?.llm?.engines ?? [];
  const presets = state?.llm?.presets ?? [];
  const activePreset = presets.find((p) => p.preset === llm.preset) ?? null;
  const custom = !activePreset;
  const pwOk = strongPw(pw) && pw === pw2;

  // 门禁：两库位置 + 备份（必选）+ L0 管理密码 + 恢复卡导出；精炼模型可选，不在其列
  const requiredDone = step1Done && backupDone && step2Done && step3Done;
  const requiredCount = [step1Done, backupDone, step2Done, step3Done].filter(Boolean).length;

  /** 图中三格进度：文案逐字照图，状态由 setup:state 真值决定（未完成 = 灰框，不冒充绿框） */
  const progress = [
    {
      n: '①', title: '两库位置', ok: step1Done && backupDone, testid: 'setup-chip-①',
      line2: step1Done ? 'ledgerDir · l0Dir 已选定' : 'ledgerDir · l0Dir 待选定',
      line3: backupDone ? '绝对路径 · 拒 UNC/相对 · 可写探针通过 · 备份目录已设' : '绝对路径 · 拒 UNC/相对 · 可写探针通过 · 备份目录未设',
    },
    {
      n: '②', title: 'L0 管理密码', ok: step2Done, testid: 'setup-chip-②',
      line2: step2Done ? '密钥环已有 admin_wrap' : '密钥环尚无 admin_wrap',
      line3: '更硬的本机判据：不设会话，只认密钥环',
    },
    {
      n: '③', title: '恢复卡', ok: step3Done, testid: 'setup-chip-③',
      line2: step3Done ? '本次真导出过一张' : '本次还没导出',
      line3: 'setup:finish 只在真导出后才落 setupDone',
    },
  ];

  return (
    <div className="sw-page" data-testid="setup-page">
      {/* ── 标题条（图中：左标题 / 右上胶囊） ───────────────────── */}
      <header className="sw-head">
        <h1>首启强制向导</h1>
        <span className="sw-badge" data-testid="setup-done-badge">setupDone = {state?.setup_done ? 'true' : 'false'}</span>
      </header>
      <p className="sw-lead" data-testid="setup-intro">
        三件事全做完才放行数据面：两库位置 · L0 管理密码 · 恢复卡导出，门禁在主进程判定，绕过页面也进不了数据面；升级的老指针同样强制。
      </p>

      {err && <div className="sw-error" role="alert" data-testid="setup-error">⚠️ {err}</div>}

      {/* ── 进度（图中：三张绿框卡） ───────────────────────────── */}
      <section className="sw-card sw-progress" data-testid="setup-progress">
        <div className="sw-cap">进度 · 三步全部完成才可进入应用</div>
        <div className="sw-progress-grid">
          {progress.map((p) => (
            <div key={p.n} className={`sw-progress-item${p.ok ? ' ok' : ''}`} data-testid={p.testid}>
              <div className="sw-progress-title"><span className="sw-check">{p.ok ? '✓' : '○'}</span> {p.n} {p.title} {p.ok ? '✓' : ''}</div>
              <div className="sw-progress-l2">{p.line2}</div>
              <div className="sw-progress-l3">{p.line3}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── ① 两个库的位置（图中：两列字段 + 橙色注记） ─────────── */}
      <section className="sw-card" data-testid="setup-step-dirs">
        <div className="sw-cap">① 两个库的位置（可同可不同 · 密钥环与 L0 库同目录）</div>
        <div className="sw-two-col">
          <div className="sw-col">
            <label className="sw-label" htmlFor="sw-dir-ledger">L1–L6 记忆库目录（ledgerDir · audit.jsonl 同目录）</label>
            <div className="sw-input-row">
              <input id="sw-dir-ledger" className="sw-input" data-testid="setup-dir-ledger" readOnly
                value={state?.ledger_dir ?? '读取中…'} />
              <button className="sw-btn" data-testid="setup-reselect-dirs" disabled={!step1Done || busy}
                onClick={() => void reselectDirs()}>选择目录</button>
            </div>
          </div>
          <div className="sw-col">
            <label className="sw-label" htmlFor="sw-dir-l0">L0 原数据库目录（l0Dir · l0-keyring.json 同目录）</label>
            <div className="sw-input-row">
              <input id="sw-dir-l0" className="sw-input" data-testid="setup-dir-l0" readOnly
                value={state?.l0_dir ?? '读取中…'} />
              <button className="sw-btn" data-testid="setup-reselect-dirs-2" disabled={!step1Done || busy}
                onClick={() => void reselectDirs()}>选择目录</button>
            </div>
          </div>
        </div>
        <div className="sw-note-orange" data-testid="setup-dir-files">
          改选后需重启才生效（路径在 app ready 前解析）；目录校验与备份目录共用同一真源，拒绝则如实报错不落配置。
          {state ? `（记忆库 ${state.ledger_file.path}${state.ledger_file.exists ? ' · 已有文件，本次直接沿用，不覆盖' : ' · 新库，首次写入时创建'}；原数据库 ${state.l0_file.path}${state.l0_file.exists ? ' · 已有文件，本次直接沿用，不覆盖' : ' · 新库，首次写入时创建'}；${state.same_dir ? '同一目录（可以，两个仍是两个文件）' : '分开存放'}；密钥环 l0-keyring.json 与原数据库同目录）` : ' · 读取中…'}
        </div>

        {/* 新增（必选）：两处备份目录，沿用图中同一套「两列目录字段 + 选择目录」 */}
        <div className="sw-two-col sw-backup-row" data-testid="setup-step-backup">
          <div className="sw-col">
            <label className="sw-label" htmlFor="sw-bk-ledger">记忆库备份目录（必选 · 审计账本同处）</label>
            <div className="sw-input-row">
              <input id="sw-bk-ledger" className="sw-input" data-testid="setup-backup-ledger" readOnly
                value={bk.ledger || '未设置'} placeholder="未设置" />
              <button className="sw-btn" data-testid="setup-backup-choose-ledger" onClick={() => void chooseBackupDir('ledger')}>选择目录</button>
            </div>
          </div>
          <div className="sw-col">
            <label className="sw-label" htmlFor="sw-bk-l0">原数据库备份目录（必选 · 密钥环同处）</label>
            <div className="sw-input-row">
              <input id="sw-bk-l0" className="sw-input" data-testid="setup-backup-l0" readOnly
                value={bk.l0 || '未设置'} placeholder="未设置" />
              <button className="sw-btn" data-testid="setup-backup-choose-l0" onClick={() => void chooseBackupDir('l0')}>选择目录</button>
            </div>
          </div>
        </div>
        {bkMsg && <div className="sw-note-orange" data-testid="setup-backup-msg">{bkMsg}</div>}
      </section>

      {/* ── ② 设置 L0 管理密码（图中：两列输入 + 主按钮 + 底注） ── */}
      <section className="sw-card" data-testid="setup-step-password">
        <div className="sw-cap">② 设置 L0 管理密码</div>
        {step2Done ? (
          <div className="sw-two-col" data-testid="setup-regen-form">
            <div className="sw-col">
              <label className="sw-label" htmlFor="sw-regen-pw" data-testid="setup-pw-set">本机已设置 L0 管理密码（旧码当场作废）</label>
              <div className="sw-input-row">
                <input id="sw-regen-pw" className="sw-input" type="password" data-testid="setup-regen-pw"
                  value={pw} placeholder="L0 管理密码" onChange={(e) => setPw(e.target.value)} />
                <button className="sw-btn" data-testid="setup-regen" disabled={pw.length < 8 || busy}
                  onClick={() => void regenCode()}>重新生成恢复码</button>
              </div>
            </div>
            <div className="sw-col" />
          </div>
        ) : (
          <>
            <div className="sw-two-col" data-testid="setup-pw-form">
              <div className="sw-col">
                <label className="sw-label" htmlFor="sw-pw">管理密码（≥12 位 · 大小写+数字+符号）</label>
                <div className="sw-input-row">
                  <input id="sw-pw" className="sw-input" type="password" data-testid="setup-pw"
                    value={pw} placeholder="••••••••••••" onChange={(e) => setPw(e.target.value)} />
                </div>
              </div>
              <div className="sw-col">
                <label className="sw-label" htmlFor="sw-pw2">确认密码</label>
                <div className="sw-input-row">
                  <input id="sw-pw2" className="sw-input" type="password" data-testid="setup-pw2"
                    value={pw2} placeholder="••••••••" onChange={(e) => setPw2(e.target.value)} />
                </div>
              </div>
            </div>
            <div className="sw-btn-row">
              <button className="sw-btn primary" data-testid="setup-pw-submit" disabled={!pwOk || busy}
                onClick={() => void submitPassword()}>设置密码并生成恢复码</button>
            </div>
          </>
        )}
        <div className="sw-note" data-testid="setup-pw-why">
          同一个 DEK 包两份：admin_wrap（密码派生 KEK）+ recovery_wrap（恢复码派生 KEK）；恢复码是 32 字节随机数，不是密码衍生物。
        </div>
      </section>

      {/* ── ③ 恢复卡预览（图中：右对齐两行 + 代码块 + 按钮 + 红框） ── */}
      <section className="sw-card" data-testid="setup-step-card">
        <div className="sw-cap">③ 恢复卡预览 · 明文只出现这一次</div>
        <div className="sw-kv">
          <span>密钥环指纹</span><code className="sw-mono" data-testid="setup-fingerprint">{issued?.fingerprint || state?.fingerprint || '尚未生成'}</code>
        </div>
        <div className="sw-kv">
          <span>对应文件</span><code className="sw-mono" data-testid="setup-card-file">{exportedFile ?? '尚未导出（导出后这里显示真实文件名）'}</code>
        </div>
        <pre className="sw-code" data-testid={cardShown ? 'setup-code' : undefined}>
{cardShown
  ? `MultiAgent Memory · L0 恢复卡（一次性）
恢复码: ${issued?.recovery_code_grouped ?? ''}
密钥环: ${issued?.fingerprint ?? state?.fingerprint ?? '尚未生成'} · 生成: ${issued?.created_at ? new Date(issued.created_at).toLocaleString('zh-CN') : '本次会话'}
用途: 安全页 + L0 恢复 → 输入恢复码（用过即作废并换新码）`
  : state?.card_pending
    ? '本次已有待导出的恢复卡（码明文不再回显），可直接点导出；若要重新看码只能换发新码。'
    : '还没有恢复码：先完成第 ② 步（或点「重新生成恢复码」）。'}
        </pre>
        {cardShown && <div className="sw-note" data-testid="setup-code-once">这段明文只在这次生成时显示，关掉本页就再也看不到——所以下一步必须真的存下来。</div>}
        {state?.card_pending && !cardShown && <div className="sw-note" data-testid="setup-card-pending">码明文不再回显，可直接导出。</div>}
        {!cardShown && !state?.card_pending && <div className="sw-note" data-testid="setup-card-none">尚未生成恢复码。</div>}
        <div className="sw-btn-row" data-testid={cardShown ? 'setup-card-body' : undefined}>
          <button className="sw-btn" data-testid="setup-copy" onClick={() => void copyCode()}>{copied ? '已复制到剪贴板' : '复制'}</button>
          <button className="sw-btn primary" data-testid="setup-export" disabled={busy} onClick={() => void exportCard()}>
            「另存为…」（保存对话框 · 不需要管理员）
          </button>
        </div>
        {exportMsg && <div className="sw-note" data-testid="setup-export-result">{exportMsg}</div>}
        {!step3Done && <div className="sw-note" data-testid="setup-not-exported">尚未导出：不导出这张卡就不能进入应用。</div>}
        <div className="sw-danger" data-testid="setup-card-warning">
          恢复卡明文只在发码那一次出现，绝不进日志与审计。管理密码与恢复卡同时丢失 = L0 原数据库不可恢复，请打印/抄存/放密码管理器，与密钥环分开存放。
        </div>
      </section>

      {/* ── ④ 精炼大模型（可选）：与图中步骤卡完全同款，不引入新视觉语言 ── */}
      <section className="sw-card" data-testid="setup-step-llm">
        <div className="sw-cap">④ 精炼大模型（可选 · 拨测通过才保存）</div>
        {llmConfigured && (
          <div className="sw-note" data-testid="setup-llm-existing">
            已有可用引擎：{engines.filter((e) => e.enabled).map((e) => `${e.name} · ${e.model || '(未填模型)'}`).join('；') || '（无已启用引擎）'}
          </div>
        )}
        <div className="sw-two-col">
          <div className="sw-col">
            <label className="sw-label" htmlFor="sw-llm-preset">厂商 / 端点</label>
            <div className="sw-input-row">
              <select id="sw-llm-preset" className="sw-input" data-testid="setup-llm-preset"
                value={activePreset ? activePreset.preset : ''}
                onChange={(e) => {
                  const p = presets.find((x) => x.preset === e.target.value) ?? null;
                  setProbe(null);
                  setLlm((c) => ({ ...c, preset: p?.preset ?? '', model: p?.model ?? '', baseURL: p?.baseURL ?? '', name: p?.name ?? '' }));
                }}>
                <option value="">自定义（OpenAI 兼容）</option>
                {presets.map((p) => <option key={p.preset} value={p.preset}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="sw-col">
            <label className="sw-label" htmlFor="sw-llm-model">模型名</label>
            <div className="sw-input-row">
              <input id="sw-llm-model" className="sw-input" data-testid="setup-llm-model" value={llm.model}
                placeholder={activePreset?.model || '例：deepseek-chat'}
                onChange={(e) => { setProbe(null); setLlm((c) => ({ ...c, model: e.target.value })); }} />
            </div>
          </div>
        </div>
        {custom && (
          <div className="sw-two-col">
            <div className="sw-col">
              <label className="sw-label" htmlFor="sw-llm-name">引擎名称</label>
              <div className="sw-input-row">
                <input id="sw-llm-name" className="sw-input" data-testid="setup-llm-name" value={llm.name}
                  placeholder="例：公司内网 vLLM" onChange={(e) => { setProbe(null); setLlm((c) => ({ ...c, name: e.target.value })); }} />
              </div>
            </div>
            <div className="sw-col">
              <label className="sw-label" htmlFor="sw-llm-base">baseURL（不含 /chat/completions）</label>
              <div className="sw-input-row">
                <input id="sw-llm-base" className="sw-input" data-testid="setup-llm-base" value={llm.baseURL}
                  placeholder="http://127.0.0.1:8000/v1" onChange={(e) => { setProbe(null); setLlm((c) => ({ ...c, baseURL: e.target.value })); }} />
              </div>
            </div>
          </div>
        )}
        <div className="sw-two-col">
          <div className="sw-col">
            <label className="sw-label" htmlFor="sw-llm-key">API Key</label>
            <div className="sw-input-row">
              <input id="sw-llm-key" className="sw-input" type="password" data-testid="setup-llm-key" value={llm.apiKey}
                placeholder={activePreset && !activePreset.needsKey ? '本地端点无需密钥，可留空' : '只存在本机 llm-keys.json，不进日志'}
                onChange={(e) => { setProbe(null); setLlm((c) => ({ ...c, apiKey: e.target.value })); }} />
            </div>
          </div>
          <div className="sw-col" />
        </div>
        <div className="sw-btn-row">
          <button className="sw-btn" data-testid="setup-llm-test" disabled={probeBusy || saveBusy} onClick={() => void testLlm()}>
            {probeBusy ? '正在测试…' : '测试连通'}
          </button>
          <button className="sw-btn primary" data-testid="setup-llm-save" disabled={!probe?.ok || saveBusy || probeBusy} onClick={() => void saveLlm()}>
            {saveBusy ? '复测并保存…' : '保存并启用'}
          </button>
          {probe && (
            <span className={probe.ok ? 'sw-note sw-ok' : 'sw-note sw-bad'} data-testid="setup-llm-probe">
              {probe.ok ? `✅ 连通（${probe.latencyMs ?? 0} ms · ${probe.model ?? ''}）` : `❌ ${probe.error ?? '不通'}`}
            </span>
          )}
        </div>
        <div className="sw-btn-row">
          <button className="sw-link" data-testid="setup-llm-skip" onClick={() => setAskSkip(true)}>暂时不添加精炼大模型</button>
        </div>
        {llmMsg && <div className="sw-note" data-testid="setup-llm-msg">{llmMsg}</div>}
      </section>

      {/* ── 底部固定条（图中：三个 ✓ + 说明 + 进入应用） ───────── */}
      <footer className="sw-foot" data-testid="setup-step-finish">
        <div className="sw-foot-l">
          <span className="sw-dots">
            {progress.map((p) => <span key={p.n} className={`sw-dot${p.ok ? ' ok' : ''}`}>{p.ok ? '✓' : p.n}</span>)}
          </span>
          <span className="sw-foot-txt">
            {step3Done ? '本次已导出 · ' : ''}
            {requiredDone ? '三步全 ✓ → setupDone 置真，主窗口不再挡在向导。' : `必需项还差 ${4 - requiredCount} 项`}
            {llmSkipped && !llmConfigured ? ' · 精炼模型已跳过' : ''}
          </span>
        </div>
        <div className="sw-foot-r">
          {!requiredDone && <span className="sw-foot-hint" data-testid="setup-finish-hint">四项必需完成后才可点</span>}
          <button className="sw-btn primary" data-testid="setup-finish" disabled={!requiredDone || busy} onClick={() => void finish()}>
            进入应用 →
          </button>
        </div>
      </footer>

      {/* ── 状态栏（图中三段；示例假数换成主进程真回读） ───────── */}
      <div className="sw-status" data-testid="setup-statusbar">
        <span>数据根 · 记忆库 <code className="sw-mono">{state?.ledger_file.path ?? '读取中…'}</code> · 原数据库 <code className="sw-mono">{state?.l0_file.path ?? '读取中…'}</code> · 备份 {state?.backup?.ledger_dir || state?.backup?.l0_dir ? `${state.backup.ledger_dir || '未设'} | ${state.backup.l0_dir || '未设'}` : '未设置'}</span>
        <span>全部读数来自主进程 setup:state 回读</span>
        <span>MultiAgent Memory v0.1.0 · 首启强制向导</span>
      </div>

      {/* ── 跳过确认：同款白卡，不引入新控件语言 ───────────────── */}
      {askSkip && (
        <div className="sw-mask" data-testid="setup-skip-dialog" role="dialog" aria-modal="true">
          <div className="sw-card sw-modal">
            <div className="sw-cap">不添加精炼大模型？</div>
            <div className="sw-note">
              没有精炼模型，本次<b>无法生成 L2–L5 精炼记忆层</b>（会话摘要 / 得失分析 / 模式归纳 / 洞察提炼），
              检索用的 L6 投影索引同样生成不出来。
            </div>
            <div className="sw-note">
              记忆仍会以 <b>L1 原文</b>入库并可检索，只是没有逐层压缩后的高密度版本；之后可在「模型与成本」页补配。
            </div>
            <div className="sw-btn-row">
              <button className="sw-btn" data-testid="setup-skip-cancel" onClick={() => setAskSkip(false)}>否，继续设置大模型</button>
              <button className="sw-btn primary" data-testid="setup-skip-confirm" onClick={() => void confirmSkipLlm()}>确认，仍然进入应用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
