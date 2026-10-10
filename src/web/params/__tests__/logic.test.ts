import { describe, it, expect } from 'vitest';
import {
  speedToHalfLife, retentionToArchive, validateWeights, payloadOrdered,
  validateKbRow, validateNM, validateAll, auditParams,
} from '../logic.ts';
import { DEFAULT_CONFIG, DEFAULT_DEV, SEED_KB_POLICIES } from '../seed.ts';


describe('档位折算（17.6）', () => {
  it('遗忘速度 → 半衰期', () => {
    expect(speedToHalfLife('slow')).toBe(60);
    expect(speedToHalfLife('mid')).toBe(30);
    expect(speedToHalfLife('fast')).toBe(7);
  });
  it('保留时长 → 归档阈值', () => {
    expect(retentionToArchive('long')).toBe(365);
    expect(retentionToArchive('months')).toBe(180);
    expect(retentionToArchive('weeks')).toBe(90);
    expect(retentionToArchive('short')).toBe(30);
  });
});

describe('validateWeights（2.4.3）', () => {
  it('和=1.0 通过（默认 0.35+0.30+0.15+0.20）', () => {
    expect(validateWeights(DEFAULT_DEV.weights)).toBeNull();
  });
  it('和≠1 拒绝', () => {
    const w = { w_f: 0.5, w_i: 0.3, w_c: 0.15, w_a: 0.2 };
    expect(validateWeights(w)).toContain('1.0');
  });
  it('负数拒绝', () => {
    const w = { w_f: -0.35, w_i: 0.65, w_c: 0.35, w_a: 0.35 };
    expect(validateWeights(w)).toContain('不可为负');
  });
});

describe('payloadOrdered（2.4.1）', () => {
  it('默认三档递增通过', () => {
    expect(payloadOrdered(DEFAULT_DEV.payload)).toBeNull();
  });
  it('非递增拒绝', () => {
    expect(payloadOrdered({ soft: 2000, warn: 2000, break: 3000 })).toContain('递增');
  });
});

describe('validateKbRow / validateNM', () => {
  it('半衰期/归档 >0', () => {
    expect(validateKbRow({ kb: 'x', half_life_days: 30, archive_days: 180, merge_on: true })).toBeNull();
    expect(validateKbRow({ kb: 'x', half_life_days: 0, archive_days: 180, merge_on: true })).toContain('半衰期');
  });
  it('N<M（9.10）', () => {
    expect(validateNM(90, 180)).toBeNull();
    expect(validateNM(180, 90)).toContain('小于');
  });
});

describe('validateAll / auditParams', () => {
  it('默认全量通过', () => {
    expect(validateAll(DEFAULT_CONFIG, SEED_KB_POLICIES, DEFAULT_DEV)).toEqual([]);
  });
  it('关自动整理出现警示', () => {
    const errs = validateAll({ ...DEFAULT_CONFIG, auto_organize: false }, SEED_KB_POLICIES, DEFAULT_DEV);
    expect(errs.some((e) => e.includes('自动整理'))).toBe(true);
  });
  it('审计对象 G6', () => {
    const a = auditParams('req_p1', ['遗忘速度=快']);
    expect(a.action).toBe('params_change');
    expect(a.request_id).toBe('req_p1');
    expect(a.note).toContain('遗忘速度');
  });
});

describe('种子覆盖', () => {
  it('六类知识库', () => {
    expect(SEED_KB_POLICIES.length).toBe(6);
  });
});

describe('类型完整性（DevParams 引用防悬空）', () => {
  it('cold 补查 dormant ≥ cold', () => {
    expect(DEFAULT_DEV.cold.dormant_sim).toBeGreaterThanOrEqual(DEFAULT_DEV.cold.cold_sim);
  });
});
