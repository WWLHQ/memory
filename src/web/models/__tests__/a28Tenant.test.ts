// 批次48 A28：模型配置 storage key 加租户/用户维度；旧 key 一次性迁移；空租户回退缺省 key。
import { beforeEach, describe, expect, it } from 'vitest';
import { clearModelConfig, readModelConfig, tenantStorageKey, writeModelConfig } from '../modelConfig.ts';

const LEGACY = 'mam.modelConfig.v1';
const TENANT = 'mam.tenant.v1';
const CFG = { vectorKey: 'bge-m3' as const, dims: 1024, updatedAt: 1 };

function setTenant(user: string, team: string, ent: string): void {
  localStorage.setItem(TENANT, JSON.stringify({ user_id: user, team_id: team, enterprise_id: ent }));
}

beforeEach(() => {
  localStorage.clear();
});

describe('A28 租户维度 key', () => {
  it('key 含企业/团队/用户三维度，且不同租户隔离', () => {
    setTenant('uA', 'tA', 'eA');
    expect(tenantStorageKey()).toBe(`${LEGACY}:e=eA:t=tA:u=uA`);
    writeModelConfig(CFG);
    expect(localStorage.getItem(`${LEGACY}:e=eA:t=tA:u=uA`)).toContain('bge-m3');

    setTenant('uB', 'tB', 'eB');
    expect(readModelConfig()).toBeNull(); // 不串读别人的模型配置
    setTenant('uA', 'tA', 'eA');
    expect(readModelConfig()).toEqual(CFG);
  });

  it('空租户回退缺省 key（旧 key），读写照常', () => {
    // 未写任何租户 → 空租户
    expect(tenantStorageKey()).toBe(LEGACY);
    writeModelConfig(CFG);
    expect(localStorage.getItem(LEGACY)).toContain('bge-m3');
    expect(readModelConfig()).toEqual(CFG);
  });
});

describe('A28 旧 key 一次性迁移', () => {
  it('租户 key 为空、旧 key 有数据 → 读取时迁移并删除旧 key', () => {
    localStorage.setItem(LEGACY, JSON.stringify(CFG));
    setTenant('uA', 'tA', 'eA');
    expect(readModelConfig()).toEqual(CFG);
    expect(localStorage.getItem(LEGACY)).toBeNull(); // 旧 key 已删，只迁一次
    expect(localStorage.getItem(`${LEGACY}:e=eA:t=tA:u=uA`)).toContain('bge-m3');
  });

  it('迁移后切到其它租户 → 也拿不到（旧 key 已删，不会二次迁移）', () => {
    localStorage.setItem(LEGACY, JSON.stringify(CFG));
    setTenant('uA', 'tA', 'eA');
    readModelConfig();
    setTenant('uB', 'tB', 'eB');
    expect(readModelConfig()).toBeNull();
  });

  it('租户 key 已有数据时不覆盖、不迁移旧 key', () => {
    setTenant('uA', 'tA', 'eA');
    writeModelConfig(CFG);
    localStorage.setItem(LEGACY, JSON.stringify({ ...CFG, vectorKey: 'ds', dims: 768 }));
    expect(readModelConfig()?.vectorKey).toBe('bge-m3');
    expect(localStorage.getItem(LEGACY)).not.toBeNull(); // 未被动过
  });
});

describe('A28 clearModelConfig', () => {
  it('清掉旧 key 与所有租户维度 key', () => {
    setTenant('uA', 'tA', 'eA');
    writeModelConfig(CFG);
    localStorage.setItem(LEGACY, JSON.stringify(CFG));
    clearModelConfig();
    expect(readModelConfig()).toBeNull();
    expect(Object.keys(localStorage).filter((k) => k.startsWith(LEGACY))).toHaveLength(0);
  });
});
