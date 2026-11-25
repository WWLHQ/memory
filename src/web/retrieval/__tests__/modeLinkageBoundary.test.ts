// P0-1 跨层边界锁定：critical + minimal 在两条入口的有意差异。
// 用户 2026-11-25 拍板「保持原型，只补测试与文档」——本文件钉住差异本身，
// 任一侧被单方面改动都会红，避免"修了一边却制造新口径分裂"。
import { describe, it, expect } from 'vitest';
import { resolveModeLinkage } from '../logic.ts';
import { resolveMode } from '../../../core/memagent/recallModes.ts';

describe('critical + minimal：Web 回落自动 / 内核降事实优先（有意差异，勿单方修改）', () => {
  it('Web 侧按原型回落到 null（自动）并提示 16.5', () => {
    const r = resolveModeLinkage('critical', 'minimal');
    expect(r.mode).toBeNull();
    expect(r.toast).toContain('16.5');
  });

  it('内核侧按 16.5 红线降为 fact_first，并如实标注 viaFallback', () => {
    const r = resolveMode({ query: '核对发布流程是否报错', scene: 'critical', explicitMode: 'minimal' });
    expect(r.mode).toBe('fact_first');
    expect(r.viaFallback).toBe(true);
    expect(r.reason).toContain('critical');
  });

  it('差异成因：Web 回落 null 后内核走自动分流，critical 候选集无 minimal，不会执行极简', () => {
    const auto = resolveMode({ query: '核对发布流程是否报错', scene: 'critical', explicitMode: null });
    expect(auto.mode).not.toBe('minimal');
    expect(auto.viaFallback).not.toBe(true);
  });
});
