// 批次45-A1 单一租户真源：tenant.json 首建/复用/损坏三态 + 缺省三元组与存量账本一致性锁定。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateTenant, TENANT_FILE_NAME, TENANT_SCHEMA } from '../tenantSource.ts';
import { DEFAULT_TENANT, normalizeTenantTriple } from '../../shared/tenantDefaults.ts';

let root: string;
let cleanup: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tenant-src-'));
  cleanup.push(dir);
  return dir;
}

describe('批次45-A1 tenant.json 单一租户真源', () => {
  beforeEach(() => { root = tempRoot(); });
  afterEach(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); cleanup = []; });

  it('缺省三元组与存量账本硬编码一致（45-A2 存量迁移近零的前提，锁定不许漂移）', () => {
    expect(DEFAULT_TENANT).toEqual({ user_id: 'u1', team_id: 't1', enterprise_id: 'e1' });
  });

  it('首建：文件不存在 → 返回规范缺省三元组并落盘（含 schema，0600）', () => {
    const t = loadOrCreateTenant(root);
    expect(t).toEqual({ user_id: 'u1', team_id: 't1', enterprise_id: 'e1' });
    const file = join(root, TENANT_FILE_NAME);
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    expect(parsed).toEqual({ schema: TENANT_SCHEMA, ...DEFAULT_TENANT });
    // Windows 下 chmod 尽力而为：POSIX 才断言 0600
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('复用：文件已存在且合法 → 原样返回，不重写为缺省值', () => {
    const file = join(root, TENANT_FILE_NAME);
    writeFileSync(file, JSON.stringify({ schema: TENANT_SCHEMA, user_id: 'u_carol', team_id: 't_x', enterprise_id: 'e_x' }));
    const t = loadOrCreateTenant(root);
    expect(t).toEqual({ user_id: 'u_carol', team_id: 't_x', enterprise_id: 'e_x' });
    expect(JSON.parse(readFileSync(file, 'utf8')).user_id).toBe('u_carol'); // 未被改写
  });

  it('损坏 fail-fast：非 JSON → 抛「租户真源损坏」，绝不静默重造身份', () => {
    writeFileSync(join(root, TENANT_FILE_NAME), '{ not json');
    expect(() => loadOrCreateTenant(root)).toThrow(/租户真源损坏/);
  });

  it('损坏 fail-fast：字段缺失（缺 enterprise_id）→ 抛错，不回落缺省值', () => {
    writeFileSync(join(root, TENANT_FILE_NAME), JSON.stringify({ user_id: 'u_carol', team_id: 't_x' }));
    expect(() => loadOrCreateTenant(root)).toThrow(/租户真源损坏/);
  });

  it('损坏 fail-fast：字段为空字符串 → 抛错', () => {
    writeFileSync(join(root, TENANT_FILE_NAME), JSON.stringify({ user_id: '', team_id: 't_x', enterprise_id: 'e_x' }));
    expect(() => loadOrCreateTenant(root)).toThrow(/租户真源损坏/);
  });

  it('normalizeTenantTriple：非对象/数组/数字字段 → null；多余字段（schema）忽略', () => {
    expect(normalizeTenantTriple(null)).toBeNull();
    expect(normalizeTenantTriple('x')).toBeNull();
    expect(normalizeTenantTriple([1, 2])).toBeNull();
    expect(normalizeTenantTriple({ user_id: 1, team_id: 't', enterprise_id: 'e' })).toBeNull();
    expect(normalizeTenantTriple({ schema: 'tenant/1', user_id: 'u1', team_id: 't1', enterprise_id: 'e1' }))
      .toEqual({ user_id: 'u1', team_id: 't1', enterprise_id: 'e1' });
  });
});
