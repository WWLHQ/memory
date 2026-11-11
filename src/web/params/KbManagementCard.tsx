// 全局参数页（REQ-006 / P5）· 记忆库管理卡片
// 1. 数据存放位置（用户选定；更改时复制现有数据 + 自动重启 + 审计 + 日志）
// 2. 自动备份（备份位置 + 自动备份时间用户可设置）
// 桌面壳（native/bridge）= 完整功能；浏览器模式 = 诚实禁用。
import { useEffect, useState } from 'react';
import {
  backupAvailable, backupGetConfig, backupSaveConfig, backupChooseDir,
  backupRunNow, backupList,
  BACKUP_KIND_LABEL,
  type BackupConfigView, type BackupItem,
} from '../memory/backup.ts';
import {
  changeDataRoot, getDataRoot, openDataRoot, restoreDefaultDataRoot,
  type DataRootInfo,
} from '../memory/dataRoot.ts';
import { useSessionContext } from '../shared/session.ts';
import { useToast } from './useToast.tsx';

function pad2(n: number): string { return String(n).padStart(2, '0'); }

export function KbManagementCard() {
  const { show } = useToast();
  const available = backupAvailable();
  // 批次7：数据位置/备份属敏感操作，仅管理员可改（主进程 IPC 同样强制校验）
  const { role, loading: sessionLoading } = useSessionContext();
  const isAdmin = role === 'admin';
  const [cfg, setCfg] = useState<BackupConfigView | null>(null);
  const [rootInfo, setRootInfo] = useState<DataRootInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<BackupItem[]>([]);
  const [listDir, setListDir] = useState('');

  useEffect(() => {
    if (!available) return;
    let alive = true;
    void backupGetConfig().then((r) => { if (alive && r.ok && r.cfg) setCfg(r.cfg); });
    void getDataRoot().then((r) => { if (alive && r.ok && r.info) setRootInfo(r.info); });
    void backupList().then((r) => { if (alive && r.ok) { setItems(r.items ?? []); setListDir(r.dir ?? ''); } });
    return () => { alive = false; };
  }, [available]);

  async function save(patch: Partial<BackupConfigView>) {
    if (!cfg) return;
    setBusy(true);
    const r = await backupSaveConfig(patch);
    setBusy(false);
    if (!r.ok) { show(`保存失败：${r.error}`); return; }
    if (!r.cfg) { show('保存失败：宿主未返回配置'); return; }
    setCfg(r.cfg);
    show('备份设置已保存。');
  }

  async function chooseBackupDir() {
    setBusy(true);
    const r = await backupChooseDir();
    setBusy(false);
    if (r.ok && r.dir) {
      const g = await backupGetConfig();
      if (g.ok && g.cfg) setCfg(g.cfg);
      show(`备份位置已设为：${r.dir}`);
    } else if (!r.ok && r.error !== '已取消选择') {
      show(`选择目录失败：${r.error}`);
    }
  }

  async function runNow() {
    setBusy(true);
    const r = await backupRunNow();
    setBusy(false);
    if (!r.ok) { show(`备份失败：${r.error}`); return; }
    // 批次37-D：回执逐库说明——只说"已备份"会掩盖"其实只备了记忆库"
    const got = (r.receipt?.files ?? []).map((f) => BACKUP_KIND_LABEL[f.kind]);
    const lost = (r.receipt?.missing ?? []).map((k) => BACKUP_KIND_LABEL[k]);
    show([
      `已备份 ${got.length} 个文件：${got.join('、') || '（无）'}`,
      lost.length ? `本次未备（文件不存在）：${lost.join('、')}` : '',
    ].filter(Boolean).join(' · '));
    void backupList().then((res) => { if (res.ok) { setItems(res.items ?? []); setListDir(res.dir ?? ''); } });
  }

  async function changeRoot() {
    setBusy(true);
    const r = await changeDataRoot();
    setBusy(false);
    if (r.ok) {
      show(r.restartRequired
        ? '已登记新的数据位置：应用即将自动重启并复制现有数据（原位置保留）。'
        : '当前已是该数据位置。');
    } else if (!r.canceled) {
      show(`更改失败：${r.error ?? '未知错误'}`);
    }
  }

  async function restoreRoot() {
    setBusy(true);
    const r = await restoreDefaultDataRoot();
    setBusy(false);
    if (r.ok) {
      show(r.restartRequired
        ? '已登记恢复默认数据位置：应用即将自动重启并复制现有数据。'
        : '当前已在默认数据位置。');
    } else if (!r.canceled) {
      show(`恢复失败：${r.error ?? '未知错误'}`);
    }
  }

  async function openRoot() {
    const r = await openDataRoot();
    if (r.ok) show(`已打开：${r.path ?? rootInfo?.root ?? ''}`);
    else show(`无法打开目录：${r.error ?? '未知错误'}`);
  }

  if (!available) {
    return (
      <div className="card" data-testid="kb-mgmt-card" style={{ opacity: 0.6 }}>
        <b>🗄️ 记忆库管理</b>
        <div className="note">
          记忆库保存位置 / 自动备份仅在桌面壳（Electron）中可用；当前为浏览器模式，无本地文件能力。
          请安装 MultiAgent Memory 桌面版后使用。
        </div>
      </div>
    );
  }

  if (!cfg || !rootInfo) {
    return (
      <div className="card" data-testid="kb-mgmt-card">
        <b>🗄️ 记忆库管理</b>
        <div className="note">加载记忆库设置中…</div>
      </div>
    );
  }

  const timeLabel = `${pad2(cfg.hour)}:${pad2(cfg.minute)}`;
  const backupDirLabel = cfg.dir || `默认（${rootInfo.root}/backups）`;
  // 批次58：首启向导要求「备份必选」，常写的是分组目录（ledgerDir / l0Dir）。
  // 这里必须如实显示它们，否则卡片会拿「默认」冒充真实备份位置。
  const groupedHint = cfg.ledgerDir || cfg.l0Dir
    ? `分组备份位置（首启向导设置）：记忆库 → ${cfg.ledgerDir || backupDirLabel}；原数据库 → ${cfg.l0Dir || backupDirLabel}`
    : '';

  return (
    <div className="card" data-testid="kb-mgmt-card">
      <b>🗄️ 记忆库管理</b>
      <div className="note">数据存放位置 + 自动备份 · 桌面壳真实落盘（记忆库与 L0 原数据库、游标、日志、MCP 令牌、备份配置全部在数据目录下）</div>
      {!isAdmin && (
        <div className="note" data-testid="kb-admin-required" style={{ color: 'var(--warn, #b8860b)' }}>
          🔒 需管理员：更改数据位置与备份设置仅管理员可操作
          {sessionLoading ? '（正在确认登录身份…）' : role === 'member' ? '（当前账号为普通成员）' : '（当前未登录）'}。
        </div>
      )}

      {/* ── 1. 数据存放位置 ── */}
      <div style={{ marginTop: 10 }} data-testid="kb-data-root">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>数据存放位置（首次启动时选择）</div>
            <code style={{ fontSize: 12 }}>{rootInfo.root}{rootInfo.isDefault ? '（默认）' : ''}</code>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn" data-testid="kb-data-root-change" disabled={busy || !isAdmin}
              title={isAdmin ? '更改数据存放位置' : '需管理员权限'} onClick={() => void changeRoot()}>
              更改位置…
            </button>
            {!rootInfo.isDefault && (
              <button type="button" className="btn" data-testid="kb-data-root-restore" disabled={busy || !isAdmin}
                title={isAdmin ? '恢复默认数据位置' : '需管理员权限'} onClick={() => void restoreRoot()}>
                恢复默认
              </button>
            )}
            <button type="button" className="btn" data-testid="kb-data-root-open" disabled={busy} onClick={() => void openRoot()} title="用系统文件管理器打开数据目录">
              打开
            </button>
          </div>
        </div>
        <div className="note">
          当前生效记忆库：<code style={{ fontSize: 11 }}>{rootInfo.activeDbPath}</code>
        </div>
        {rootInfo.activeL0Path && (
          <div className="note" data-testid="kb-l0-path">
            L0 原数据库（密文独立存放）：<code style={{ fontSize: 11 }}>{rootInfo.activeL0Path}</code>
            {rootInfo.l0ReadOnly ? ' · 只读（被其它进程持有写锁，写入会被拒绝）' : ''}
          </div>
        )}
        {rootInfo.activeAuditPath && (
          <div className="note" data-testid="kb-audit-path">
            审计账本（追加式，自批次41 起不再混在记忆库文件里）：<code style={{ fontSize: 11 }}>{rootInfo.activeAuditPath}</code>
            {rootInfo.audit
              ? ` · 在档 ${rootInfo.audit.rows} 行 · 归档 ${rootInfo.audit.archive_files} 个文件 ${rootInfo.audit.archived_rows} 行`
              : ''}
            {rootInfo.audit && rootInfo.audit.skipped_lines > 0
              ? ` · 读不动的坏行 ${rootInfo.audit.skipped_lines}（只跳过、不删原件）`
              : ''}
            {rootInfo.audit?.corruption
              ? ` · 上次启动整档解析失败，原件已改名保留：${rootInfo.audit.corruption.backup_path ?? '（未能保留原件）'}`
              : ''}
          </div>
        )}
        <div className="note">
          动作日志（排查用）：<code style={{ fontSize: 11 }} data-testid="kb-actions-log">{rootInfo.actionsLogPath ?? `${rootInfo.root}/actions.log`}</code>
        </div>
        <div className="note">
          更改位置会复制现有数据到新目录（不覆盖、不删除原目录）并自动重启；记忆库、L0 原数据库与密钥环、审计账本、采集游标、main.log、MCP 令牌、备份配置等全部数据都随之前往。
        </div>
      </div>

      {/* ── 2. 自动备份 ── */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border, #e8e8ef)', paddingTop: 10 }} data-testid="kb-auto-backup">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            data-testid="backup-enabled"
            checked={cfg.enabled}
            disabled={!isAdmin}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          启用自动备份（每天固定时刻执行一次）
        </label>

        <div className="row" style={{ flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>备份位置</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <code style={{ fontSize: 11 }}>{backupDirLabel}</code>
              <button type="button" className="btn" data-testid="backup-choose-dir" disabled={busy || !isAdmin}
                title={isAdmin ? '选择备份目录' : '需管理员权限'} onClick={() => void chooseBackupDir()}>
                更改…
              </button>
            </div>
            {groupedHint && (
              <div className="note" data-testid="kb-backup-grouped" style={{ marginTop: 4 }}>
                {groupedHint}（「更改…」改的是共用目录，不会覆盖分组目录）
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>自动备份时间（每天）</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <select data-testid="backup-hour" value={cfg.hour} disabled={!isAdmin}
                onChange={(e) => void save({ hour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad2(h)}</option>)}
              </select>
              <span>:</span>
              <select data-testid="backup-minute" value={cfg.minute} disabled={!isAdmin}
                onChange={(e) => void save({ minute: Number(e.target.value) })}>
                {Array.from({ length: 60 }, (_, m) => <option key={m} value={m}>{pad2(m)}</option>)}
              </select>
              <span className="dim">= {timeLabel}</span>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>保留份数</div>
            <input
              type="number" min={1} max={50} data-testid="backup-keep" style={{ width: 60 }}
              value={cfg.keepCount} disabled={!isAdmin}
              onChange={(e) => void save({ keepCount: Number(e.target.value) || 7 })}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
          <button type="button" className="btn primary" data-testid="backup-run-now" disabled={busy || !isAdmin}
            title={isAdmin ? '立即执行一次备份' : '需管理员权限'} onClick={() => void runNow()}>
            {busy ? '备份中…' : '⚡ 立即备份一次'}
          </button>
          {cfg.lastRun ? (
            <span className="dim" style={{ fontSize: 11 }}>
              上次：{new Date(cfg.lastRun).toLocaleString()}（{cfg.lastOk ? '成功' : '失败'}）
            </span>
          ) : (
            <span className="dim" style={{ fontSize: 11 }}>尚未执行过备份</span>
          )}
        </div>

        {items.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>备份历史（{listDir}，最近 {items.length} 份）</div>
            <div data-testid="backup-list" style={{ maxHeight: 140, overflow: 'auto', fontSize: 11 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.name} style={{ borderBottom: '1px solid var(--border, #eee)' }}>
                      <td style={{ padding: '3px 6px', fontFamily: 'monospace' }}>{it.name}</td>
                      <td style={{ padding: '3px 6px', color: 'var(--muted)' }} data-testid="backup-item-kind">{BACKUP_KIND_LABEL[it.kind ?? 'ledger']}</td>
                      <td style={{ padding: '3px 6px', color: 'var(--muted)' }}>{new Date(it.time).toLocaleString()}</td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--muted)' }}>{(it.size / 1024).toFixed(1)} KB</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="note" style={{ fontSize: 11, marginTop: 8 }}>
          自动备份 = 主进程调度器每分钟检查，到设定时刻把<strong>记忆库（L1–L6）、L0 原数据库、L0 密钥环</strong>各复制一份到备份目录
          （带时间戳文件名，各自按保留份数清理；缺哪个源会在回执里点名）。
          备份配置存于 <code>backup-config.json</code>；操作全部写审计 + <code>main.log</code>。
          <strong> 注意</strong>：L0 备份里是密文，只有配合密钥环与 L0 密码（或恢复码）才能还原原文——三者请分开存放。
        </div>
      </div>
    </div>
  );
}
