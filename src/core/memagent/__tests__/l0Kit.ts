// L0 测试装配（§4.4）：内存 keyring/锁定表 + 真 L0Vault；测试与生产共用同一实现。
// 时钟可注入（clock.t），用于验证 5 分钟空闲锁定、15 分钟失败锁定等时间语义。
import {
  L0Vault, type L0Keyring, type L0KeyringStore, type L0LockState, type L0LockStore,
} from '../l0vault.ts';
import type { AuditRecord, StorageBackend } from '../types.ts';

export const TEST_ADMIN_PW = 'adminpass-1';
export const TEST_ADMIN_ID = 'admin';
export const TEST_GRANT_PW = 'grantpass-1';

export class MemoryKeyringStore implements L0KeyringStore {
  value: L0Keyring | null = null;
  writes = 0;

  async read(): Promise<L0Keyring | null> {
    return this.value ? JSON.parse(JSON.stringify(this.value)) as L0Keyring : null;
  }

  async write(k: L0Keyring): Promise<void> {
    this.value = JSON.parse(JSON.stringify(k)) as L0Keyring;
    this.writes += 1;
  }
}

export class MemoryLockStore implements L0LockStore {
  map = new Map<string, L0LockState>();

  async read(key: string): Promise<L0LockState | null> {
    const v = this.map.get(key);
    return v ? { ...v } : null;
  }

  async write(key: string, state: L0LockState): Promise<void> {
    this.map.set(key, { ...state });
  }

  async clear(key: string): Promise<void> {
    this.map.delete(key);
  }
}

export interface TestVault {
  vault: L0Vault;
  keyring: MemoryKeyringStore;
  locks: MemoryLockStore;
  audits: AuditRecord[];
  clock: { t: number };
}

/** 已设置管理密码（写密钥已在内存）的测试钥匙环；audit 缺省收集到 audits 数组 */
export async function createTestVault(opts: {
  audit?: { appendAudit(a: AuditRecord): Promise<void> };
  storage?: StorageBackend;
  idleTimeoutMs?: number;
  maxFailures?: number;
  lockDurationMs?: number;
  setup?: boolean;
} = {}): Promise<TestVault> {
  const keyring = new MemoryKeyringStore();
  const locks = new MemoryLockStore();
  const audits: AuditRecord[] = [];
  const clock = { t: 1_800_000_000_000 };
  const vault = new L0Vault({
    keyring,
    locks,
    audit: opts.audit ?? { appendAudit: async (a) => { audits.push(a); } },
    storage: opts.storage,
    form: 'desktop',
    now: () => clock.t,
    idleTimeoutMs: opts.idleTimeoutMs,
    maxFailures: opts.maxFailures,
    lockDurationMs: opts.lockDurationMs,
  });
  if (opts.setup !== false) await vault.setupAdminPassword(TEST_ADMIN_PW, TEST_ADMIN_ID);
  return { vault, keyring, locks, audits, clock };
}
