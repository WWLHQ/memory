// L0 密钥环落盘适配（§4.4.8）：l0-keyring.json 原子写（temp → fsync → rename），
// 锁定态复用 home 的锁定表（home-locks.json 的 l0:<user_id> 项，与登录锁定同文件不同 key）。
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { L0Keyring, L0KeyringStore, L0LockStore } from '../core/memagent/l0vault.ts';
import type { HomeServer } from '../home/server.ts';

/** 原子写：先写临时文件并 fsync，再 rename 覆盖（崩溃窗口不产生半截 JSON） */
export async function writeFileAtomic(file: string, data: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, data, { encoding: 'utf8', mode });
  const fh = await open(tmp, 'r+');
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmp, file);
}

export function createL0KeyringStore(file: string): L0KeyringStore {
  return {
    async read(): Promise<L0Keyring | null> {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as L0Keyring;
      } catch {
        return null;
      }
    },
    async write(keyring: L0Keyring): Promise<void> {
      await writeFileAtomic(file, JSON.stringify(keyring));
    },
  };
}

/** 委托 home server 的锁定表（内存 + home-locks.json 持久化，避免两个写者互相覆盖） */
export function createHomeLockStore(home: () => HomeServer | null): L0LockStore {
  return {
    async read(key: string) {
      const s = home()?.getLockState(key);
      if (!s) return null;
      return { fails: s.failCount, locked_until: s.lockedUntil ?? 0 };
    },
    async write(key: string, state) {
      home()?.setLockState(key, {
        failCount: state.fails,
        lockedUntil: state.locked_until > 0 ? state.locked_until : undefined,
      });
    },
    async clear(key: string) {
      home()?.clearLockState(key);
    },
  };
}

/** 备份/清理遗留临时文件（启动时清理崩溃残留，避免无限堆积） */
export async function cleanupTempFiles(file: string): Promise<void> {
  const dir = dirname(file);
  const base = basename(file);
  try {
    const entries = await readdir(dir);
    for (const e of entries) {
      if (e.startsWith(`${base}.tmp-`)) {
        await unlink(join(dir, e)).catch(() => undefined);
      }
    }
  } catch {
    /* 目录不存在：首次启动无需清理 */
  }
}
