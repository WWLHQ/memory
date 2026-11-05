// 批次46-D6-1：项目注册表验收（StorageBackend.createProject / getProject / listProjects）。
// 跨三种后端（InMemory / FileStorage / SqliteStorage）跑同一套核心 AC，确保契约一致。
// SqliteStorage 依赖 node:sqlite（仅 Node 运行时），故本文件用 node 环境。
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorage, StorageLockedError } from '../fileStorage.ts';
import { InMemoryStorage } from '../storage.ts';
import { SqliteStorage } from '../sqliteStorage.ts';
import type { CreateProjectInput, ProjectRecord, StorageBackend } from '../types.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'd6-projects-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function input(id: string, over: Partial<CreateProjectInput> = {}): CreateProjectInput {
  return { project_id: id, created_by: 'u-admin', ...over };
}

/** 各后端的构造工厂：reopen 返回同一持久化位置的「新实例」（InMemory 不持久化，单独处理） */
function backends(): Record<string, () => { storage: StorageBackend; reopen: () => StorageBackend; persistent: boolean }> {
  return {
    InMemory: () => {
      const s = new InMemoryStorage();
      return { storage: s, reopen: () => new InMemoryStorage(), persistent: false };
    },
    File: () => {
      const db = join(dir, `mem-${Math.random().toString(36).slice(2)}.db.json`);
      return { storage: new FileStorage(db), reopen: () => new FileStorage(db), persistent: true };
    },
    Sqlite: () => {
      const db = join(dir, `mem-${Math.random().toString(36).slice(2)}.db`);
      return { storage: new SqliteStorage(db), reopen: () => new SqliteStorage(db), persistent: true };
    },
  };
}

function byId(recs: ProjectRecord[]): Record<string, ProjectRecord> {
  return Object.fromEntries(recs.map((r) => [r.project_id, r]));
}

describe('D6-1 项目注册表 · 核心 AC（三后端一致）', () => {
  const cases = backends();
  for (const [name, make] of Object.entries(cases)) {
    describe(name, () => {
      let storage: StorageBackend;
      beforeEach(() => {
        const made = make();
        storage = made.storage;
      });
      afterEach(() => {
        // Sqlite/File 需释放句柄（WAL/文件锁），否则 afterEach 删临时目录会 EBUSY
        if ('close' in storage && typeof (storage as { close?: unknown }).close === 'function') {
          (storage as { close(): void }).close();
        }
      });

      it('createProject 默认 kind=general，回写 created_at/created_by', async () => {
        const rec = await storage.createProject(input('P1'));
        expect(rec.project_id).toBe('P1');
        expect(rec.kind).toBe('general');
        expect(rec.created_by).toBe('u-admin');
        expect(typeof rec.created_at).toBe('number');
        expect(rec.created_at).toBeGreaterThan(0);
      });

      it('createProject 显式 kind/owner/display_name 原样回写', async () => {
        const rec = await storage.createProject(input('P-user-1', {
          kind: 'user', owner_user_id: 'u-7', display_name: '我的项目',
        }));
        expect(rec.kind).toBe('user');
        expect(rec.owner_user_id).toBe('u-7');
        expect(rec.display_name).toBe('我的项目');
      });

      it('createProject 拒绝空 / 纯空白 project_id', async () => {
        await expect(storage.createProject(input('   '))).rejects.toThrow(/不能为空/);
        await expect(storage.createProject(input(''))).rejects.toThrow(/不能为空/);
      });

      it('createProject 重复 id → 抛「项目已存在」，不覆盖', async () => {
        await storage.createProject(input('P-dup', { kind: 'shared' }));
        await expect(storage.createProject(input('P-dup', { kind: 'archive' })))
          .rejects.toThrow(/项目已存在/);
        // 原记录不被覆盖
        const got = await storage.getProject('P-dup');
        expect(got?.kind).toBe('shared');
      });

      it('getProject 命中 / 未命中', async () => {
        expect(await storage.getProject('nope')).toBeNull();
        await storage.createProject(input('P-x'));
        const got = await storage.getProject('P-x');
        expect(got?.project_id).toBe('P-x');
      });

      it('listProjects 全量 + kind 过滤 + owner 过滤', async () => {
        await storage.createProject(input('shared-1', { kind: 'shared' }));
        await storage.createProject(input('shared-2', { kind: 'shared' }));
        await storage.createProject(input('user-a', { kind: 'user', owner_user_id: 'u-a' }));
        await storage.createProject(input('user-b', { kind: 'user', owner_user_id: 'u-b' }));
        await storage.createProject(input('archive-1', { kind: 'archive' }));

        const all = byId(await storage.listProjects());
        expect(Object.keys(all).sort()).toEqual(
          ['archive-1', 'shared-1', 'shared-2', 'user-a', 'user-b'].sort(),
        );

        const shared = byId(await storage.listProjects({ kind: 'shared' }));
        expect(Object.keys(shared).sort()).toEqual(['shared-1', 'shared-2']);

        const ua = byId(await storage.listProjects({ owner_user_id: 'u-a' }));
        expect(Object.keys(ua)).toEqual(['user-a']);
      });

      it('listProjects 组合过滤（kind + owner）', async () => {
        await storage.createProject(input('ua-1', { kind: 'user', owner_user_id: 'u-a' }));
        await storage.createProject(input('ua-2', { kind: 'shared', owner_user_id: 'u-a' }));
        await storage.createProject(input('ub-1', { kind: 'user', owner_user_id: 'u-b' }));
        const r = byId(await storage.listProjects({ kind: 'user', owner_user_id: 'u-a' }));
        expect(Object.keys(r)).toEqual(['ua-1']);
      });
    });
  }
});

describe('D6-1 项目注册表 · 持久化（File / Sqlite）', () => {
  it('FileStorage：创建后 close 再开新实例，项目仍在', async () => {
    const db = join(dir, 'persist-file.db.json');
    const s1 = new FileStorage(db);
    await s1.createProject(input('P1', { kind: 'shared', display_name: '长期共享' }));
    await s1.createProject(input('P2', { kind: 'user', owner_user_id: 'u-9' }));
    s1.close();

    const s2 = new FileStorage(db);
    expect((await s2.getProject('P1'))?.display_name).toBe('长期共享');
    expect((await s2.getProject('P2'))?.owner_user_id).toBe('u-9');
    expect((await s2.listProjects({ kind: 'shared' })).map((p) => p.project_id)).toEqual(['P1']);
    s2.close();
  });

  it('FileStorage：旧库（无 projects 字段）打开不报错，listProjects 为空', async () => {
    const db = join(dir, 'legacy.db.json');
    const s0 = new FileStorage(db);
    await s0.putMemory({ mem_id: 'm1', project_id: 'P-old' } as never);
    s0.close();
    const s1 = new FileStorage(db); // 旧库没有 projects，load 应兜底 {} 不抛
    expect(await s1.listProjects()).toEqual([]);
    expect(await s1.getProject('P-old')).toBeNull();
    s1.close();
  });

  it('SqliteStorage：创建后关闭再开新实例，项目仍在', async () => {
    const db = join(dir, 'persist-sql.db');
    const s1 = new SqliteStorage(db);
    await s1.createProject(input('P1', { kind: 'archive' }));
    await s1.createProject(input('P2', { kind: 'user', owner_user_id: 'u-3' }));
    s1.close();

    const s2 = new SqliteStorage(db);
    expect((await s2.getProject('P1'))?.kind).toBe('archive');
    expect((await s2.getProject('P2'))?.owner_user_id).toBe('u-3');
    expect((await s2.listProjects({ kind: 'user' })).map((p) => p.project_id)).toEqual(['P2']);
    s2.close();
  });
});

describe('D6-1 项目注册表 · FileStorage 只读镜像（批次28-A）', () => {
  it('只读构造 / 写锁降级：createProject 抛 StorageLockedError，不静默假成功', async () => {
    const db = join(dir, 'readonly.db.json');
    const writer = new FileStorage(db);
    await writer.createProject(input('P-w'));
    writer.close();

    const ro = new FileStorage(db, { readonly: true, reloadOnMtime: true });
    expect(ro.readOnly).toBe(true);
    await expect(ro.createProject(input('P-ro'))).rejects.toThrow(StorageLockedError);
    await expect(ro.createProject(input('P-ro'))).rejects.toThrow(/只读模式/);
    // 只读镜像仍可读得到写方已落盘的项目
    expect((await ro.getProject('P-w'))?.project_id).toBe('P-w');
    ro.close();
  });

  it('reloadOnMtime：写方新增项目后，镜像读操作可见（mtime 触发重载）', async () => {
    const db = join(dir, 'reload.db.json');
    const writer = new FileStorage(db);
    await writer.createProject(input('P-1'));

    const mirror = new FileStorage(db, { readonly: true, reloadOnMtime: true });
    expect((await mirror.getProject('P-1'))?.project_id).toBe('P-1');

    await writer.createProject(input('P-2', { kind: 'shared' }));
    expect((await mirror.getProject('P-2'))?.project_id).toBe('P-2');
    expect((await mirror.listProjects({ kind: 'shared' })).map((p) => p.project_id)).toEqual(['P-2']);
    writer.close();
    mirror.close();
  });
});
