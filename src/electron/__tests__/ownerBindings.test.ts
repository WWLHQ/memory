// OB-1：个人记忆账号绑定真源文件（ownerBindings.ts）单测。
// 口径：缺失 = []（合法常态）；损坏 fail-closed 抛错；写口 = 校验 + 备份 + 原子写 + 0600；
// 重复拒绝：同账号重复（歧义）与同目标重复（并号）都拒。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOwnerBindings, writeOwnerBindings, normalizeOwnerBindingsInput, OWNER_BINDINGS_SCHEMA } from '../ownerBindings.ts';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mam-owner-bindings-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadOwnerBindings（读取口）', () => {
  it('文件缺失 → 空表（「未配置」是合法常态，不抛错、不首建）', () => {
    expect(loadOwnerBindings(root)).toEqual([]);
    expect(existsSync(join(root, 'personal-owner-bindings.json'))).toBe(false);
  });

  it('裸数组形态（历史/手写）→ 正常解析', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(root, 'personal-owner-bindings.json'), JSON.stringify([{ account: 'alice', kernel_user_id: 'u1' }]), 'utf8');
    expect(loadOwnerBindings(root)).toEqual([{ account: 'alice', kernel_user_id: 'u1' }]);
  });

  it('规范文档形态 { schema, bindings } → 正常解析', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(
      join(root, 'personal-owner-bindings.json'),
      JSON.stringify({ schema: OWNER_BINDINGS_SCHEMA, bindings: [{ account: 'alice', kernel_user_id: 'u1' }] }),
      'utf8',
    );
    expect(loadOwnerBindings(root)).toEqual([{ account: 'alice', kernel_user_id: 'u1' }]);
  });

  it('非 JSON → 抛错（fail-closed，绝不静默忽略绑定）', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(root, 'personal-owner-bindings.json'), '{not-json', 'utf8');
    expect(() => loadOwnerBindings(root)).toThrow(/损坏/);
  });

  it('schema 未知 → 抛错（不猜版本）', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(root, 'personal-owner-bindings.json'), JSON.stringify({ schema: 'owner-bindings/9', bindings: [] }), 'utf8');
    expect(() => loadOwnerBindings(root)).toThrow(/schema 未知/);
  });

  it('项缺 account / kernel_user_id → 抛错（复用 env 解析器同一口径）', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(root, 'personal-owner-bindings.json'), JSON.stringify([{ account: 'alice' }]), 'utf8');
    expect(() => loadOwnerBindings(root)).toThrow(/account 与 kernel_user_id/);
  });
});

describe('normalizeOwnerBindingsInput（校验口）', () => {
  it('重复账号 → 拒绝（同一账号只能有一条绑定）', () => {
    expect(() => normalizeOwnerBindingsInput([
      { account: 'alice', kernel_user_id: 'u1' },
      { account: 'alice', kernel_user_id: 'u2' },
    ])).toThrow(/出现多次/);
  });

  it('重复目标 → 拒绝（多账号并号禁止）', () => {
    expect(() => normalizeOwnerBindingsInput([
      { account: 'alice', kernel_user_id: 'u1' },
      { account: 'bob', kernel_user_id: 'u1' },
    ])).toThrow(/并号/);
  });
});

describe('writeOwnerBindings（写口）', () => {
  it('首次配置（无旧文件）：直接原子写，prev=[]，无备份文件', () => {
    const r = writeOwnerBindings(root, [{ account: 'alice', kernel_user_id: 'u1' }]);
    expect(r.prev).toEqual([]);
    expect(r.next).toEqual([{ account: 'alice', kernel_user_id: 'u1' }]);
    expect(r.backupFile).toBe('');
    const raw = JSON.parse(readFileSync(join(root, 'personal-owner-bindings.json'), 'utf8'));
    expect(raw.schema).toBe(OWNER_BINDINGS_SCHEMA);
    expect(raw.bindings).toEqual([{ account: 'alice', kernel_user_id: 'u1' }]);
  });

  it('改写已有文件：先备份到 backups/owner-bindings/ 且备份内容 = 旧值，再写新值', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(
      join(root, 'personal-owner-bindings.json'),
      JSON.stringify({ schema: OWNER_BINDINGS_SCHEMA, bindings: [{ account: 'old', kernel_user_id: 'u1' }] }),
      'utf8',
    );
    const r = writeOwnerBindings(root, [{ account: 'new', kernel_user_id: 'u1' }]);
    expect(r.prev).toEqual([{ account: 'old', kernel_user_id: 'u1' }]);
    expect(existsSync(r.backupFile)).toBe(true);
    expect(JSON.parse(readFileSync(r.backupFile, 'utf8')).bindings).toEqual([{ account: 'old', kernel_user_id: 'u1' }]);
    const dir = join(root, 'backups', 'owner-bindings');
    expect(readdirSync(dir).length).toBe(1);
  });

  it('非法输入（缺字段）→ 抛错且不落盘', () => {
    expect(() => writeOwnerBindings(root, [{ account: 'alice' }])).toThrow(/account 与 kernel_user_id/);
    expect(existsSync(join(root, 'personal-owner-bindings.json'))).toBe(false);
  });
});
