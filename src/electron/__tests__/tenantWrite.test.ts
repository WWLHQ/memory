// T2（管理员与成员权限设计 §6.1）：机器级 tenant.json 写口单测。
// 覆盖：writeTenant 合法写（含备份/原子内容/返回新旧值）、非法三元组拒绝、原文件缺失拒绝、
// 备份文件内容等于旧值、readTenantFile 三态（缺文件 null / 合法 / 损坏抛错）。
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateTenant, readTenantFile, writeTenant, TENANT_FILE_NAME } from '../tenantSource.ts';
import { classifiedPath, DATA_SUBDIRS } from '../../shared/dataLayout.ts';

const dirs: string[] = [];
function tmpRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'mam-tenant-write-'));
  for (const sub of Object.values(DATA_SUBDIRS)) mkdirSync(join(d, sub), { recursive: true });
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('T2 tenant.json 写口（§6.1）', () => {
  it('合法三元组：写入成功，返回新旧值，备份文件内容等于旧值，落盘内容含 schema 与新三元组', () => {
    const root = tmpRoot();
    const prev = loadOrCreateTenant(root); // 首建 u1/t1/e1
    const next = { user_id: 'u2', team_id: 't2', enterprise_id: 'e9' };
    const r = writeTenant(root, next);
    expect(r.prev).toEqual(prev);
    expect(r.next).toEqual(next);
    expect(existsSync(r.backupFile)).toBe(true);
    const backup = JSON.parse(readFileSync(r.backupFile, 'utf8'));
    expect(backup.user_id).toBe('u1');
    const now = JSON.parse(readFileSync(classifiedPath(root, TENANT_FILE_NAME), 'utf8'));
    expect(now).toEqual({ schema: 'tenant/1', ...next });
    // 临时文件不残留（原子写）
    expect(readdirSync(root).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('非法三元组（字段空 / 非对象 / 缺字段）一律拒绝，且不改文件', () => {
    const root = tmpRoot();
    loadOrCreateTenant(root);
    const before = readFileSync(classifiedPath(root, TENANT_FILE_NAME), 'utf8');
    for (const bad of [
      { user_id: '', team_id: 't', enterprise_id: 'e' },
      { user_id: 'u', team_id: 't' },
      'not-an-object',
      null,
      { user_id: 1, team_id: 't', enterprise_id: 'e' },
    ]) {
      expect(() => writeTenant(root, bad)).toThrow(/三元组不合法/);
    }
    expect(readFileSync(classifiedPath(root, TENANT_FILE_NAME), 'utf8')).toBe(before);
  });

  it('tenant.json 不存在时拒绝写（先重启首建，绝不无中生有）', () => {
    const root = tmpRoot();
    expect(() => writeTenant(root, { user_id: 'u2', team_id: 't2', enterprise_id: 'e2' })).toThrow(/不存在/);
  });

  it('readTenantFile 三态：缺文件 → null；合法 → 三元组；损坏 → 抛错', () => {
    const root = tmpRoot();
    expect(readTenantFile(root)).toBeNull();
    loadOrCreateTenant(root);
    expect(readTenantFile(root)).toEqual({ user_id: 'u1', team_id: 't1', enterprise_id: 'e1' });
    const other = tmpRoot();
    loadOrCreateTenant(other);
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(classifiedPath(other, TENANT_FILE_NAME), '{broken', 'utf8');
    expect(() => readTenantFile(other)).toThrow(/损坏/);
  });
});
