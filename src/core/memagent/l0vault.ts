// L0Vault（§4.4）：主进程独占的 L0 密钥环 —— DEK 只在内存，密码经 PBKDF2 派生 KEK 包裹 DEK。
//
// 职责边界（唯一事实源，页面不得自行实现 L0 口令/遮罩）：
//   · 写入：seal() 用写密钥缓存加密 L0（未解锁 → E_L0_LOCKED，绝不落明文）
//   · 查阅：unlock() 凭管理密码或该账号一次性授权密码解锁 → l0_session_id（仅内存）
//            decrypt() 只认连续会话；5 分钟无操作 → 会话与 wrapped DEK 一起作废
//   · 管理：申请/发放/拒绝/撤销/重启/锁屏/休眠/写密钥缓存/旧数据迁移，全部落审计
//
// 红线：密码、DEK、wrapped DEK 明文不进日志/审计/URL；审计只记 grant_id/user_id/动作/结果。
// 落盘：l0-keyring.json 由注入的 L0KeyringStore 原子写入；锁定态由 L0LockStore 维护（l0:<user_id>）。
import type { L0Wrap } from './crypto.ts';
import {
  decryptL0, decryptL0WithKey, deriveKek, encryptL0WithKey, generateDek, newWrapSalt,
  parseL0Envelope, parseL0EnvelopeV2, randomBytes, unwrapSecret, wrapSecret,
} from './crypto.ts';
import { MemAgentError } from './errors.ts';
import {
  createKeyringSecrets, generateRecoveryCode, keyringFingerprint, RECOVERY_BAD_CODE, unwrapDekWithRecovery,
  wrapDekWithRecovery,
} from './l0Recovery.ts';
import { ulid } from './ulid.ts';
import type {
  AuditRecord, Form, L0AccessRequest, L0AccessRequestResult, L0AdminPort, L0GrantReq, L0GrantResult,
  L0GrantStatus, L0GrantView, L0HeartbeatResult, L0MigrationReport, L0MigrationResult, L0RequestView,
  L0UnlockReq, L0UnlockResult, L0VaultStatus, StorageBackend,
} from './types.ts';

export type { L0MigrationReport } from './types.ts';

/** 连续查阅空闲上限（§4.4.3：5 分钟无操作自动锁定） */
export const L0_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
/** 同一账号连续密码错误上限（§4.4.3：5 次 → 15 分钟） */
export const L0_MAX_FAILURES = 5;
export const L0_LOCK_MS = 15 * 60 * 1000;
/** 管理密码/授权密码最短长度（§4.4.1） */
export const L0_MIN_SECRET_LEN = 8;

/** 恢复码签发结果：码明文只在这一刻存在，调用方渲染成恢复卡后就不再有任何接口能取回它 */
export interface L0RecoveryIssue {
  recovery_code: string;
  /** 卡与库的对应指纹（公开材料派生，仅用于让用户分清几张卡各开哪个库） */
  fingerprint: string;
  created_at: number;
}

/** ---------- 落盘结构（l0-keyring.json，§4.4.8） ---------- */

export interface L0GrantRecord {
  grant_id: string;
  grantee_user_id: string;
  scope_project_ids: string[];
  /** wrapped DEK；过期/撤销/消费后删除（绝不保留可复用密钥） */
  wrap?: L0Wrap;
  status: L0GrantStatus;
  created_at: number;
  last_view_at?: number;
  expires_at?: number;
  request_id?: string;
}

/**
 * 批次37-G：L0 恢复码记录（同一个 DEK 的第二份包裹）。
 * 一次性口径：`revoked_at` 一旦置真，这条恢复码就永久失效（用过即作废），换新码会新增一条覆盖。
 * 这里只存**包裹结果**（salt/iv/tag/ct），恢复码明文从不落盘——丢了就只能重新生成。
 */
export interface L0RecoveryRecord {
  wrap: L0Wrap;
  created_at: number;
  /** 用过后作废的时刻；未置真表示当前这张卡仍有效 */
  revoked_at?: number;
}

export interface L0RequestRecord {
  request_id: string;
  user_id: string;
  project_ids: string[];
  reason?: string;
  status: 'pending' | 'granted' | 'denied';
  created_at: number;
  decided_by?: string;
  decided_at?: number;
  grant_id?: string;
}

export interface L0Keyring {
  v: 2;
  admin_wrap?: L0Wrap;
  /** 批次37-G：忘记管理密码时唯一的找回通道（一次性恢复码） */
  recovery?: L0RecoveryRecord;
  grants: L0GrantRecord[];
  requests: L0RequestRecord[];
  updated_at: number;
}

/** keyring 持久化端口（桌面端 = 数据根 l0-keyring.json 原子写） */
export interface L0KeyringStore {
  read(): Promise<L0Keyring | null>;
  write(keyring: L0Keyring): Promise<void>;
}

/** 密码失败锁定端口（桌面端 = home-locks.json 的 l0:<user_id> 项） */
export interface L0LockState {
  fails: number;
  locked_until: number;
}

export interface L0LockStore {
  read(key: string): Promise<L0LockState | null>;
  write(key: string, state: L0LockState): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface L0AuditSink {
  appendAudit(a: AuditRecord): Promise<void>;
}

export interface L0VaultOptions {
  keyring: L0KeyringStore;
  locks: L0LockStore;
  audit: L0AuditSink;
  /** 迁移旧数据用（§4.4.6）；仅主进程装配，缺省时 migrate() 显式 E_NOT_IMPLEMENTED */
  storage?: StorageBackend;
  form?: Form;
  now?: () => number;
  idleTimeoutMs?: number;
  maxFailures?: number;
  lockDurationMs?: number;
}

/** 查阅会话（仅主进程内存，重启即失效） */
export interface L0SessionInfo {
  grant_id?: string;
  user_id: string;
  scope_project_ids: string[];
  expires_at: number;
}

interface L0Session extends L0SessionInfo {
  l0_session_id: string;
  created_at: number;
  last_activity_at: number;
}

const emptyKeyring = (): L0Keyring => ({ v: 2, grants: [], requests: [], updated_at: 0 });

/** 系统随机授权密码（24 位 hex；只一次性返回，不落盘不进日志） */
function randomSecret(): string {
  return Array.from(randomBytes(12), (b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeScope(scope: string[]): string[] {
  const list = scope.map((s) => String(s ?? '').trim()).filter(Boolean);
  return [...new Set(list)];
}

/**
 * L0Vault：实现内核 L0Port（seal/decrypt/sessionInfo）与 L0AdminPort（申请/发放/解锁/锁定/状态），
 * 另提供管理密码设置/轮换、写密钥、重启/锁屏/休眠钩子与旧数据迁移。
 */
export class L0Vault implements L0AdminPort {
  private readonly keyring: L0KeyringStore;
  private readonly locks: L0LockStore;
  private readonly auditSink: L0AuditSink;
  private readonly storage?: StorageBackend;
  private readonly form?: Form;
  private readonly clock: () => number;
  private readonly idleTimeoutMs: number;
  private readonly maxFailures: number;
  private readonly lockDurationMs: number;

  /** 查阅用 DEK（只在有连续会话时存在） */
  private viewDek: Uint8Array | null = null;
  /** 写入用 DEK（只供 seal；与查阅路径互不替代，§4.4.4） */
  private writeDek: Uint8Array | null = null;
  private sessions = new Map<string, L0Session>();

  constructor(opts: L0VaultOptions) {
    this.keyring = opts.keyring;
    this.locks = opts.locks;
    this.auditSink = opts.audit;
    this.storage = opts.storage;
    this.form = opts.form;
    this.clock = opts.now ?? (() => Date.now());
    this.idleTimeoutMs = opts.idleTimeoutMs ?? L0_IDLE_TIMEOUT_MS;
    this.maxFailures = opts.maxFailures ?? L0_MAX_FAILURES;
    this.lockDurationMs = opts.lockDurationMs ?? L0_LOCK_MS;
  }

  // ─── 持久化与审计 ────────────────────────────────────────────────────────────

  private async load(): Promise<L0Keyring> {
    const k = await this.keyring.read();
    if (!k || k.v !== 2) return emptyKeyring();
    return {
      v: 2,
      admin_wrap: k.admin_wrap,
      // 批次37-G：白名单式读取必须带上 recovery，否则每次 load 都把恢复码静默丢掉 → 用户以为设过却找不回
      recovery: k.recovery?.wrap?.salt && k.recovery?.wrap?.ct ? { ...k.recovery } : undefined,
      grants: Array.isArray(k.grants) ? k.grants : [],
      requests: Array.isArray(k.requests) ? k.requests : [],
      updated_at: k.updated_at ?? 0,
    };
  }

  private async save(k: L0Keyring): Promise<void> {
    k.updated_at = this.clock();
    await this.keyring.write(k);
  }

  private async audit(
    action: AuditRecord['action'],
    detail: Record<string, unknown>,
    extra: { request_id?: string; user_id?: string } = {},
  ): Promise<void> {
    await this.auditSink.appendAudit({
      request_id: extra.request_id ?? `req_${ulid(this.clock())}`,
      action,
      ts: this.clock(),
      form: this.form,
      user_id: extra.user_id,
      detail: { ...detail, form: this.form },
    });
  }

  private lockKey(user_id: string): string {
    return `l0:${user_id}`;
  }

  private async assertNotLocked(user_id: string): Promise<void> {
    const st = await this.locks.read(this.lockKey(user_id));
    if (!st) return;
    const now = this.clock();
    if (st.locked_until > now) {
      await this.audit('l0_auth_fail', {
        user_id, reason: 'locked', locked_until: st.locked_until,
      }, { user_id });
      throw new MemAgentError('E_AUTH_L0', `L0 密码错误次数过多，账号已锁定至 ${new Date(st.locked_until).toISOString()}（§4.4.3）`);
    }
    if (st.locked_until && st.locked_until <= now) {
      await this.locks.clear(this.lockKey(user_id));
    }
  }

  private async clearFailures(user_id: string): Promise<void> {
    await this.locks.clear(this.lockKey(user_id));
  }

  /** 记一次密码错误；第 5 次 → 锁定 15 分钟，并作废对应 grant（§4.4.3） */
  private async recordBadPassword(user_id: string, grantId?: string): Promise<void> {
    const key = this.lockKey(user_id);
    const st = (await this.locks.read(key)) ?? { fails: 0, locked_until: 0 };
    st.fails += 1;
    const locked = st.fails >= this.maxFailures;
    if (locked) st.locked_until = this.clock() + this.lockDurationMs;
    await this.locks.write(key, st);
    await this.audit('l0_auth_fail', {
      grant_id: grantId, user_id, reason: 'bad_password', fails: st.fails,
      locked_until: locked ? st.locked_until : undefined,
    }, { user_id });
    if (!locked || !grantId) return;

    const k = await this.load();
    const g = k.grants.find((x) => x.grant_id === grantId);
    if (g && (g.status === 'active' || g.status === 'consumed')) {
      g.status = 'revoked';
      delete g.wrap;
      await this.save(k);
      await this.audit('l0_auth_revoke', {
        grant_id: g.grant_id, admin_user_id: 'system', reason: 'bad_password_5',
      });
    }
  }

  // ─── 会话与空闲回收 ──────────────────────────────────────────────────────────

  private createSession(user_id: string, scope: string[], grantId?: string): L0Session {
    const now = this.clock();
    const s: L0Session = {
      l0_session_id: `l0s_${ulid(now)}`,
      grant_id: grantId,
      user_id,
      scope_project_ids: [...scope],
      expires_at: now + this.idleTimeoutMs,
      created_at: now,
      last_activity_at: now,
    };
    this.sessions.set(s.l0_session_id, s);
    return s;
  }

  private dropSession(id: string): void {
    this.sessions.delete(id);
    if (this.sessions.size === 0) this.viewDek = null;
  }

  /** 过期会话回收：清会话 + 作废 grant + 删除 wrapped DEK + 审计（§4.4.3） */
  async sweep(): Promise<void> {
    const now = this.clock();
    const expired = [...this.sessions.values()].filter((s) => now - s.last_activity_at >= this.idleTimeoutMs);
    if (expired.length === 0) return;
    for (const s of expired) this.dropSession(s.l0_session_id);

    const k = await this.load();
    let changed = false;
    for (const s of expired) {
      const g = s.grant_id ? k.grants.find((x) => x.grant_id === s.grant_id) : undefined;
      if (g && g.status !== 'expired' && g.status !== 'revoked') {
        g.status = 'expired';
        delete g.wrap;
        changed = true;
      }
      await this.audit('l0_auth_expire', {
        grant_id: s.grant_id, user_id: s.user_id, reason: 'idle_5min',
      }, { user_id: s.user_id });
    }
    if (changed) await this.save(k);
  }

  // ─── 管理密码与写密钥 ────────────────────────────────────────────────────────

  /** 首次设置管理密码：生成 DEK 并包裹；设置后写密钥即在内存（§4.4.1） */
  async setupAdminPassword(password: string, admin_user_id: string): Promise<void> {
    if (typeof password !== 'string' || password.length < L0_MIN_SECRET_LEN) {
      throw new MemAgentError('E_AUTH_L0', `管理密码须 ≥${L0_MIN_SECRET_LEN} 位（§4.4.1）`);
    }
    const k = await this.load();
    if (k.admin_wrap) {
      throw new MemAgentError('E_AUTH_L0', '管理密码已设置：轮换请使用「修改管理密码」（§4.4.1）');
    }
    const dek = generateDek();
    const salt = newWrapSalt();
    const wrap: L0Wrap = { salt, ...(await wrapSecret(dek, await deriveKek(password, salt))) };
    k.admin_wrap = wrap;
    await this.save(k);
    this.writeDek = dek;
    await this.audit('security_change', { admin_user_id, op: 'l0_admin_setup' });
  }

  /** 轮换管理密码：用旧密码解出 DEK，再以新密码重新包裹（不轮换 DEK 本身） */
  async changeAdminPassword(oldPassword: string, newPassword: string, admin_user_id: string): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < L0_MIN_SECRET_LEN) {
      throw new MemAgentError('E_AUTH_L0', `管理密码须 ≥${L0_MIN_SECRET_LEN} 位（§4.4.1）`);
    }
    const k = await this.load();
    if (!k.admin_wrap) {
      throw new MemAgentError('E_L0_NO_GRANT', '管理密码尚未设置：请先完成 L0 初始化（§4.4.1）');
    }
    await this.assertNotLocked(admin_user_id);
    let dek: Uint8Array;
    try {
      dek = await unwrapSecret(k.admin_wrap, await deriveKek(oldPassword, k.admin_wrap.salt));
    } catch {
      await this.recordBadPassword(admin_user_id);
      throw new MemAgentError('E_AUTH_L0', '管理密码错误（§4.4.1）');
    }
    await this.clearFailures(admin_user_id);
    const salt = newWrapSalt();
    k.admin_wrap = { salt, ...(await wrapSecret(dek, await deriveKek(newPassword, salt))) };
    await this.save(k);
    this.writeDek = dek;
    await this.audit('security_change', { admin_user_id, op: 'l0_admin_rotate' });
  }

  // ─── 批次37-G：L0 恢复码（忘记管理密码的唯一找回通道，一次性） ───────────────

  /**
   * 首启/初始化：一次建好 DEK + 管理密码包 + 恢复码包。
   * 恢复码由本模块生成（256bit 随机），**只在这次**返回明文；调用方必须把它渲染成恢复卡并
   * 让用户导出到数据根之外，否则向导不放行（用户拍板：强制先导出才能继续）。
   * 已设过管理密码时拒绝——轮换走 changeAdminPassword，重建走不了（DEK 不可换，换了旧密文全废）。
   */
  async initL0WithRecovery(req: { password: string; admin_user_id: string }): Promise<L0RecoveryIssue> {
    if (typeof req.password !== 'string' || req.password.length < L0_MIN_SECRET_LEN) {
      throw new MemAgentError('E_AUTH_L0', `管理密码须 ≥${L0_MIN_SECRET_LEN} 位（§4.4.1）`);
    }
    const k = await this.load();
    if (k.admin_wrap) {
      throw new MemAgentError('E_AUTH_L0', '管理密码已设置：如需换恢复码请用「重新生成恢复码」（§4.4.1）');
    }
    const created = await createKeyringSecrets(req.password, generateRecoveryCode());
    k.admin_wrap = created.admin_wrap;
    k.recovery = { wrap: created.recovery_wrap, created_at: this.clock() };
    await this.save(k);
    this.writeDek = created.dek;
    await this.audit('security_change', {
      admin_user_id: req.admin_user_id, op: 'l0_recovery_created',
      fingerprint: keyringFingerprint(k.admin_wrap, k.recovery.wrap),
    });
    return {
      recovery_code: created.recovery_code,
      fingerprint: keyringFingerprint(k.admin_wrap, k.recovery.wrap),
      created_at: k.recovery.created_at,
    };
  }

  /** 恢复码现状：只回「有没有、什么时候建的、是否已作废」，绝不回显码本身 */
  async recoveryStatus(): Promise<{
    has_recovery: boolean; created_at: number; revoked_at: number; fingerprint: string;
  }> {
    const k = await this.load();
    const r = k.recovery;
    return {
      has_recovery: Boolean(r && !r.revoked_at),
      created_at: r?.created_at ?? 0,
      revoked_at: r?.revoked_at ?? 0,
      fingerprint: keyringFingerprint(k.admin_wrap ?? null, r?.wrap ?? null),
    };
  }

  /**
   * 忘记管理密码 → 用恢复码找回并当场设新密码。
   * 「验证」是唯一目的：真的拿码去解 recovery_wrap，解不开就按口令错误处理（同一套 5 次锁定），
   * 绝不做「先收下再说」。成功后旧码立即作废 + 换新码，返回的**新码**必须重新导出恢复卡。
   */
  async recoverWithCode(req: { code: string; newPassword: string; admin_user_id: string }): Promise<L0RecoveryIssue> {
    if (typeof req.newPassword !== 'string' || req.newPassword.length < L0_MIN_SECRET_LEN) {
      throw new MemAgentError('E_AUTH_L0', `新管理密码须 ≥${L0_MIN_SECRET_LEN} 位（§4.4.1）`);
    }
    const k = await this.load();
    const r = k.recovery;
    if (!r) {
      throw new MemAgentError('E_L0_NO_GRANT', '本机从未生成过 L0 恢复码：无法用恢复码找回（§4.4.1）');
    }
    if (r.revoked_at) {
      throw new MemAgentError('E_AUTH_L0', '这张恢复卡已作废（一次性）：请使用最新一次导出的那张（§4.4.1）');
    }
    await this.assertNotLocked(req.admin_user_id);
    let dek: Uint8Array;
    try {
      dek = await unwrapDekWithRecovery(r.wrap, req.code);
    } catch {
      // 与密码错误同一条锁定链路：恢复码也是凭据，可以被暴力试探，一样 5 次锁 15 分钟
      await this.recordBadPassword(req.admin_user_id);
      throw new MemAgentError('E_AUTH_L0', RECOVERY_BAD_CODE);
    }
    await this.clearFailures(req.admin_user_id);
    const oldFingerprint = keyringFingerprint(k.admin_wrap ?? null, r.wrap);
    // 旧码当场被新码覆盖（一条记录只存当前有效的那张卡）——不留「旧码还能用」的窗口
    const newCode = generateRecoveryCode();
    const salt = newWrapSalt();
    k.admin_wrap = { salt, ...(await wrapSecret(dek, await deriveKek(req.newPassword, salt))) };
    const next: L0RecoveryRecord = { wrap: await wrapDekWithRecovery(dek, newCode), created_at: this.clock() };
    k.recovery = next;
    await this.save(k);
    this.writeDek = dek;
    await this.audit('security_change', {
      admin_user_id: req.admin_user_id, op: 'l0_recovered',
      old_fingerprint: oldFingerprint,
      fingerprint: keyringFingerprint(k.admin_wrap, next.wrap),
    });
    return { recovery_code: newCode, fingerprint: keyringFingerprint(k.admin_wrap, next.wrap), created_at: next.created_at };
  }

  /**
   * 主动换一张恢复卡（比如卡被人看过、或者只是想要新的）。
   * 需要当前写密钥在内存（= 已解锁），否则等于给拿着文件的人免密发码——一律拒绝。
   */
  async rotateRecoveryCode(req: { admin_user_id: string }): Promise<L0RecoveryIssue> {
    if (!this.writeDek) {
      throw new MemAgentError('E_L0_LOCKED', '换发恢复码需先解锁 L0 写密钥（§4.4.4）');
    }
    const k = await this.load();
    if (!k.admin_wrap) {
      throw new MemAgentError('E_L0_NO_GRANT', '管理密码尚未设置：请先完成 L0 初始化（§4.4.1）');
    }
    const oldFingerprint = keyringFingerprint(k.admin_wrap, k.recovery?.wrap ?? null);
    const newCode = generateRecoveryCode();
    const next: L0RecoveryRecord = { wrap: await wrapDekWithRecovery(this.writeDek, newCode), created_at: this.clock() };
    k.recovery = next;
    await this.save(k);
    await this.audit('security_change', {
      admin_user_id: req.admin_user_id, op: 'l0_recovery_rotated',
      old_fingerprint: oldFingerprint,
      fingerprint: keyringFingerprint(k.admin_wrap, next.wrap),
    });
    return { recovery_code: newCode, fingerprint: keyringFingerprint(k.admin_wrap, next.wrap), created_at: next.created_at };
  }

  /** 后台写入解锁：只缓存写密钥，不能用于查阅明文（§4.4.4） */
  async unlockWrite(req: { password: string; admin_user_id: string }): Promise<void> {
    const k = await this.load();
    if (!k.admin_wrap) {
      throw new MemAgentError('E_L0_NO_GRANT', '管理密码尚未设置：请先完成 L0 初始化（§4.4.1）');
    }
    await this.assertNotLocked(req.admin_user_id);
    let dek: Uint8Array;
    try {
      dek = await unwrapSecret(k.admin_wrap, await deriveKek(req.password, k.admin_wrap.salt));
    } catch {
      await this.recordBadPassword(req.admin_user_id);
      throw new MemAgentError('E_AUTH_L0', '管理密码错误（§4.4.4）');
    }
    await this.clearFailures(req.admin_user_id);
    this.writeDek = dek;
    await this.audit('security_change', { admin_user_id: req.admin_user_id, op: 'l0_write_unlock' });
  }

  /** 手动锁定写密钥（查阅会话不受影响；两者互不替代，§4.4.4） */
  async lockWrite(req: { admin_user_id: string }): Promise<void> {
    if (!this.writeDek) return;
    this.writeDek = null;
    await this.audit('security_change', { admin_user_id: req.admin_user_id, op: 'l0_write_lock' });
  }

  // ─── L0Port：写入与查阅 ─────────────────────────────────────────────────────

  /** 批次44-D4：写密钥当前是否在内存（供 get_write_status 探锁；L0Port.isWriteUnlocked） */
  isWriteUnlocked(): boolean {
    return this.writeDek !== null;
  }

  /** 写入加密：只认写密钥缓存；未解锁 → E_L0_LOCKED（绝不落明文/伪造密文） */
  async seal(plain: string): Promise<string> {
    if (!this.writeDek) {
      throw new MemAgentError('E_L0_LOCKED', 'L0 写密钥未解锁：请管理员在安全页解锁后再写入（§4.4.4）');
    }
    return encryptL0WithKey(plain, this.writeDek);
  }

  /** 连续会话解密；会话无效/过期 → E_L0_EXPIRED，scope 不含项目 → E_L0_NO_GRANT */
  async decrypt(req: { l0_session_id: string; project_id: string; mem_id: string; envelope: string }): Promise<string> {
    await this.sweep();
    const s = this.sessions.get(req.l0_session_id);
    if (!s) {
      throw new MemAgentError('E_L0_EXPIRED', 'L0 查阅会话不存在或已过期：5 分钟无操作自动锁定，请重新申请（§4.4.3）');
    }
    if (!s.scope_project_ids.includes('*') && !s.scope_project_ids.includes(req.project_id)) {
      throw new MemAgentError('E_L0_NO_GRANT', `该 L0 授权不含项目 ${req.project_id}（scope 校验，§4.4.2）`);
    }
    if (!this.viewDek) {
      this.dropSession(s.l0_session_id);
      throw new MemAgentError('E_L0_EXPIRED', 'L0 查阅密钥已清理，请重新解锁（§4.4.3）');
    }
    const plain = await decryptL0WithKey(req.envelope, this.viewDek);
    s.last_activity_at = this.clock();
    s.expires_at = s.last_activity_at + this.idleTimeoutMs;
    return plain;
  }

  async sessionInfo(l0_session_id: string): Promise<L0SessionInfo> {
    await this.sweep();
    const s = this.sessions.get(l0_session_id);
    if (!s) {
      throw new MemAgentError('E_L0_EXPIRED', 'L0 查阅会话不存在或已过期（§4.4.3）');
    }
    return {
      grant_id: s.grant_id,
      user_id: s.user_id,
      scope_project_ids: [...s.scope_project_ids],
      expires_at: s.expires_at,
    };
  }

  // ─── L0AdminPort：申请 / 发放 / 解锁 / 心跳 / 锁定 / 状态 ────────────────────

  async requestAccess(req: L0AccessRequest & { user_id: string }): Promise<L0AccessRequestResult> {
    const project_ids = normalizeScope(req.project_ids ?? []);
    if (!req.user_id) throw new MemAgentError('E_AUTH_L0', 'L0 申请缺少 user_id');
    if (project_ids.length === 0) throw new MemAgentError('E_AUTH_L0', 'L0 申请须至少指定 1 个项目（§4.4.2）');
    const k = await this.load();
    const request_id = `req_${ulid(this.clock())}`;
    k.requests.push({
      request_id, user_id: req.user_id, project_ids, reason: req.reason,
      status: 'pending', created_at: this.clock(),
    });
    await this.save(k);
    await this.audit('l0_auth_request', {
      request_id, user_id: req.user_id, project_ids, reason: req.reason,
    }, { request_id, user_id: req.user_id });
    return { request_id, status: 'pending' };
  }

  async listRequests(): Promise<L0RequestView[]> {
    const k = await this.load();
    return k.requests.map((r) => ({ ...r, project_ids: [...r.project_ids] }));
  }

  async listGrants(): Promise<L0GrantView[]> {
    await this.sweep();
    const k = await this.load();
    return k.grants.map((g) => ({
      grant_id: g.grant_id,
      grantee_user_id: g.grantee_user_id,
      scope_project_ids: [...g.scope_project_ids],
      status: g.status,
      created_at: g.created_at,
      last_view_at: g.last_view_at,
      expires_at: g.expires_at,
      request_id: g.request_id,
    }));
  }

  /** 管理员发放授权：用当前缓存的 DEK 以该账号一次性密码包裹（密码不落盘） */
  async grantAccess(req: L0GrantReq & { admin_user_id: string }): Promise<L0GrantResult> {
    await this.sweep();
    const dek = this.writeDek ?? this.viewDek;
    if (!dek) {
      throw new MemAgentError('E_L0_LOCKED', 'L0 写密钥未解锁：请先用管理密码解锁写密钥后再发放授权（§4.4.2）');
    }
    const scope = normalizeScope(req.scope_project_ids ?? []);
    if (!req.grantee_user_id) throw new MemAgentError('E_AUTH_L0', 'grantee_user_id 必填（§4.4.2）');
    if (scope.length === 0) throw new MemAgentError('E_AUTH_L0', 'scope_project_ids 须至少包含 1 个项目（§4.4.2）');
    const provided = typeof req.password === 'string' && req.password.length > 0 ? req.password : undefined;
    if (provided && provided.length < L0_MIN_SECRET_LEN) {
      throw new MemAgentError('E_AUTH_L0', `授权密码须 ≥${L0_MIN_SECRET_LEN} 位（§4.4.2）`);
    }
    const password = provided ?? randomSecret();

    const k = await this.load();
    if (req.request_id) {
      const r = k.requests.find((x) => x.request_id === req.request_id);
      if (!r) throw new MemAgentError('E_AUTH_L0', 'L0 申请不存在');
      if (r.status !== 'pending') throw new MemAgentError('E_AUTH_L0', `L0 申请已处理：${r.status}`);
    }

    const salt = newWrapSalt();
    const wrap: L0Wrap = { salt, ...(await wrapSecret(dek, await deriveKek(password, salt))) };
    const grant: L0GrantRecord = {
      grant_id: `grant_${ulid(this.clock())}`,
      grantee_user_id: req.grantee_user_id,
      scope_project_ids: scope,
      wrap,
      status: 'active',
      created_at: this.clock(),
      request_id: req.request_id,
    };
    k.grants.push(grant);
    if (req.request_id) {
      const r = k.requests.find((x) => x.request_id === req.request_id)!;
      r.status = 'granted';
      r.decided_by = req.admin_user_id;
      r.decided_at = this.clock();
      r.grant_id = grant.grant_id;
    }
    await this.save(k);
    await this.audit('l0_auth_grant', {
      grant_id: grant.grant_id, grantee_user_id: grant.grantee_user_id,
      scope_project_ids: grant.scope_project_ids, admin_user_id: req.admin_user_id,
      request_id: req.request_id,
    }, { request_id: req.request_id });

    return {
      grant_id: grant.grant_id,
      grantee_user_id: grant.grantee_user_id,
      scope_project_ids: [...grant.scope_project_ids],
      status: grant.status,
      created_at: grant.created_at,
      request_id: grant.request_id,
      password: provided ? undefined : password,
    };
  }

  async denyRequest(req: { request_id: string; admin_user_id: string; reason?: string }): Promise<void> {
    const k = await this.load();
    const r = k.requests.find((x) => x.request_id === req.request_id);
    if (!r) throw new MemAgentError('E_AUTH_L0', 'L0 申请不存在');
    if (r.status !== 'pending') throw new MemAgentError('E_AUTH_L0', `L0 申请已处理：${r.status}`);
    r.status = 'denied';
    r.decided_by = req.admin_user_id;
    r.decided_at = this.clock();
    await this.save(k);
    await this.audit('l0_auth_deny', {
      request_id: r.request_id, admin_user_id: req.admin_user_id, reason: req.reason,
    }, { request_id: r.request_id, user_id: r.user_id });
  }

  async revokeGrant(req: { grant_id: string; admin_user_id: string; reason?: string }): Promise<void> {
    const k = await this.load();
    const g = k.grants.find((x) => x.grant_id === req.grant_id);
    if (!g) throw new MemAgentError('E_AUTH_L0', 'L0 授权不存在');
    if (g.status === 'revoked' || g.status === 'expired') return;
    g.status = 'revoked';
    delete g.wrap;
    await this.save(k);
    for (const s of this.sessions.values()) {
      if (s.grant_id === req.grant_id) this.dropSession(s.l0_session_id);
    }
    await this.audit('l0_auth_revoke', {
      grant_id: g.grant_id, admin_user_id: req.admin_user_id, reason: req.reason,
    });
  }

  /**
   * 解锁查阅：管理员（无 grant_id，管理密码）或被授权账号（grant_id + 一次性密码）。
   * 成功 → 创建连续会话；grant 立即消费并删除 wrapped DEK（一次性，§4.4.2）。
   */
  async unlock(req: L0UnlockReq & { user_id: string }): Promise<L0UnlockResult> {
    await this.sweep();
    await this.assertNotLocked(req.user_id);
    if (typeof req.password !== 'string' || req.password.length === 0) {
      throw new MemAgentError('E_AUTH_L0', 'L0 解锁须提供密码（§4.4.3）');
    }
    const k = await this.load();

    // 管理员直接查阅：管理密码解 admin_wrap
    if (!req.grant_id) {
      if (!k.admin_wrap) {
        await this.audit('l0_auth_fail', { user_id: req.user_id, reason: 'no_grant' }, { user_id: req.user_id });
        throw new MemAgentError('E_L0_NO_GRANT', '管理密码未设置：仅管理员可凭管理密码直接查阅（§4.4.2）');
      }
      let dek: Uint8Array;
      try {
        dek = await unwrapSecret(k.admin_wrap, await deriveKek(req.password, k.admin_wrap.salt));
      } catch {
        await this.recordBadPassword(req.user_id);
        throw new MemAgentError('E_AUTH_L0', '管理密码错误（§4.4.3）');
      }
      await this.clearFailures(req.user_id);
      this.viewDek = dek;
      const s = this.createSession(req.user_id, ['*']);
      return { l0_session_id: s.l0_session_id, expires_at: s.expires_at, idle_timeout_ms: this.idleTimeoutMs };
    }

    const g = k.grants.find((x) => x.grant_id === req.grant_id);
    if (!g) {
      await this.audit('l0_auth_fail', {
        grant_id: req.grant_id, user_id: req.user_id, reason: 'no_grant',
      }, { user_id: req.user_id });
      throw new MemAgentError('E_L0_NO_GRANT', 'L0 授权不存在（§4.4.2）');
    }
    if (g.grantee_user_id !== req.user_id) {
      await this.audit('l0_auth_fail', {
        grant_id: g.grant_id, user_id: req.user_id, reason: 'wrong_user',
      }, { user_id: req.user_id });
      throw new MemAgentError('E_AUTH_L0', '该 L0 授权不属于当前账号（§4.4.2）');
    }
    if (g.status !== 'active' || !g.wrap) {
      await this.audit('l0_auth_fail', {
        grant_id: g.grant_id, user_id: req.user_id, reason: 'expired', status: g.status,
      }, { user_id: req.user_id });
      throw new MemAgentError('E_L0_EXPIRED', 'L0 授权已过期/已使用/已撤销，请重新申请（§4.4.2）');
    }

    let dek: Uint8Array;
    try {
      dek = await unwrapSecret(g.wrap, await deriveKek(req.password, g.wrap.salt));
    } catch {
      await this.recordBadPassword(req.user_id, g.grant_id);
      throw new MemAgentError('E_AUTH_L0', 'L0 授权密码错误（§4.4.3）');
    }
    await this.clearFailures(req.user_id);
    // 一次性：解锁即消费，wrapped DEK 立刻删除（再次查阅须重新申请）
    g.status = 'consumed';
    g.last_view_at = this.clock();
    g.expires_at = this.clock() + this.idleTimeoutMs;
    delete g.wrap;
    await this.save(k);

    this.viewDek = dek;
    const s = this.createSession(req.user_id, g.scope_project_ids, g.grant_id);
    return {
      l0_session_id: s.l0_session_id,
      grant_id: g.grant_id,
      expires_at: s.expires_at,
      idle_timeout_ms: this.idleTimeoutMs,
    };
  }

  async heartbeat(l0_session_id: string): Promise<L0HeartbeatResult> {
    await this.sweep();
    const s = this.sessions.get(l0_session_id);
    if (!s) {
      throw new MemAgentError('E_L0_EXPIRED', 'L0 查阅会话已过期（5 分钟无操作自动锁定，§4.4.3）');
    }
    s.last_activity_at = this.clock();
    s.expires_at = s.last_activity_at + this.idleTimeoutMs;
    return { expires_at: s.expires_at, idle_timeout_ms: this.idleTimeoutMs };
  }

  /** 用户主动结束查阅：清会话 + 作废 grant + 删除 wrapped DEK */
  async lock(l0_session_id: string): Promise<void> {
    await this.sweep();
    const s = this.sessions.get(l0_session_id);
    if (!s) return;
    this.dropSession(l0_session_id);
    if (s.grant_id) {
      const k = await this.load();
      const g = k.grants.find((x) => x.grant_id === s.grant_id);
      if (g && (g.status === 'active' || g.status === 'consumed')) {
        g.status = 'expired';
        delete g.wrap;
        await this.save(k);
      }
    }
    await this.audit('l0_auth_expire', {
      grant_id: s.grant_id, user_id: s.user_id, reason: 'user_closed',
    }, { user_id: s.user_id });
  }

  async status(): Promise<L0VaultStatus> {
    await this.sweep();
    const k = await this.load();
    return {
      has_admin_wrap: Boolean(k.admin_wrap),
      write_unlocked: this.writeDek !== null,
      active_sessions: this.sessions.size,
      active_grants: k.grants.filter((g) => g.status === 'active').length,
    };
  }

  // ─── 生命周期钩子（重启 / 锁屏 / 休眠 / 退出） ───────────────────────────────

  /** 应用重启：所有未消费授权作废 + 删除 wrapped DEK + 会话/密钥清空（§4.4.3） */
  async onAppRestart(): Promise<void> {
    const victims = [...this.sessions.values()];
    this.sessions.clear();
    this.viewDek = null;
    this.writeDek = null;

    const k = await this.load();
    const actives = k.grants.filter((g) => g.status === 'active' || g.status === 'consumed');
    // 会话已随重启消失：逐会话取证
    for (const s of victims) {
      await this.audit('l0_auth_expire', {
        grant_id: s.grant_id, l0_session_id: s.l0_session_id, user_id: s.user_id, reason: 'app_restart',
      }, { user_id: s.user_id });
    }
    if (actives.length > 0) {
      for (const g of actives) {
        g.status = 'expired';
        delete g.wrap;
        if (!victims.some((s) => s.grant_id === g.grant_id)) {
          await this.audit('l0_auth_expire', {
            grant_id: g.grant_id, l0_session_id: '', user_id: g.grantee_user_id, reason: 'app_restart',
          }, { user_id: g.grantee_user_id });
        }
      }
      await this.save(k);
    }
  }

  /** 锁屏/休眠：清全部查阅会话 + 写密钥，作废授权（两者互不替代，§4.4.4） */
  async onSecurityLock(reason: 'screen_lock' | 'suspend'): Promise<void> {
    const hadWrite = this.writeDek !== null;
    const victims = [...this.sessions.values()];
    this.sessions.clear();
    this.viewDek = null;
    this.writeDek = null;

    const k = await this.load();
    const actives = k.grants.filter((g) => g.status === 'active' || g.status === 'consumed');
    for (const s of victims) {
      await this.audit('l0_auth_expire', {
        grant_id: s.grant_id, user_id: s.user_id, reason,
      }, { user_id: s.user_id });
    }
    if (actives.length > 0) {
      for (const g of actives) {
        g.status = 'expired';
        delete g.wrap;
        if (!victims.some((s) => s.grant_id === g.grant_id)) {
          await this.audit('l0_auth_expire', {
            grant_id: g.grant_id, user_id: g.grantee_user_id, reason,
          }, { user_id: g.grantee_user_id });
        }
      }
      await this.save(k);
    }
    if (hadWrite) {
      await this.audit('security_change', { admin_user_id: 'system', op: reason });
    }
  }

  /** 应用退出：只清内存密钥，不落盘（重启后由 onAppRestart 统一作废授权） */
  async onExit(): Promise<void> {
    const hadWrite = this.writeDek !== null;
    this.sessions.clear();
    this.viewDek = null;
    this.writeDek = null;
    if (hadWrite) {
      await this.audit('security_change', { admin_user_id: 'system', op: 'l0_write_lock' });
    }
  }

  // ─── 旧数据迁移（§4.4.6） ───────────────────────────────────────────────────

  /**
   * 迁移 content_orig 明文与 v1 信封 → v2；幂等可重跑。
   * 失败条目保留并标记 l0_migration_pending（页面显式告警），绝不丢数据、不记密码。
   */
  async migrateLegacy(storage: StorageBackend, opts: { admin_user_id: string; oldPassword?: string }): Promise<L0MigrationReport> {
    if (!this.writeDek) {
      throw new MemAgentError('E_L0_LOCKED', 'L0 写密钥未解锁：请管理员先解锁写密钥再迁移（§4.4.6）');
    }
    const report: L0MigrationReport = { scanned: 0, migrated_orig: 0, migrated_v1: 0, pending: 0, skipped: 0 };
    const mems = await storage.listMemories({});
    for (const m of mems) {
      report.scanned++;
      let next = m;
      let changed = false;
      let failed = false;

      if (m.content_orig) {
        next = { ...next, content_l0_enc: await this.seal(m.content_orig), content_orig: undefined };
        changed = true;
        report.migrated_orig++;
      } else if (m.content_l0_enc && !parseL0EnvelopeV2(m.content_l0_enc)) {
        const v1 = parseL0Envelope(m.content_l0_enc);
        if (v1 && opts.oldPassword) {
          try {
            const plain = await decryptL0(m.content_l0_enc, opts.oldPassword);
            next = { ...next, content_l0_enc: await this.seal(plain) };
            changed = true;
            report.migrated_v1++;
          } catch {
            failed = true;
          }
        } else {
          failed = true;
        }
      }

      if (failed) {
        report.pending++;
        if (!m.l0_migration_pending) {
          next = { ...next, l0_migration_pending: true };
          changed = true;
        }
      } else if (!changed) {
        report.skipped++;
      } else if (next.l0_migration_pending) {
        next = { ...next, l0_migration_pending: undefined };
      }

      if (changed) {
        next = { ...next, version: m.version + 1, updated_at: this.clock() };
        await storage.putMemory(next);
      }
    }
    await this.audit('security_change', {
      admin_user_id: opts.admin_user_id,
      op: 'l0_migrate',
      scanned: report.scanned,
      migrated_orig: report.migrated_orig,
      migrated_v1: report.migrated_v1,
      pending: report.pending,
    });
    return report;
  }

  /** L0AdminPort 入口：用装配时注入的存储后端迁移；桌面端 IPC 会先做迁移前备份（§4.4.6） */
  async migrate(req: { admin_user_id: string; oldPassword?: string }): Promise<L0MigrationResult> {
    if (!this.storage) {
      throw new MemAgentError('E_NOT_IMPLEMENTED', 'L0 迁移未接线：缺少存储后端（仅桌面端主进程装配）');
    }
    return { report: await this.migrateLegacy(this.storage, req) };
  }
}
