// 批次62 · 硬前置召回 A/B/C 配置真源单测：
// 默认值、坏结构归一、patch 校验（显式非法字段必须拒绝，不静默吞掉）、base_url 口径。
// 2026-11-16 权限下放：成员可改 A / C，B 仍限管理员 —— 字段级判定必须是这一份单一真源。
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_RECALL_HARD_CONFIG, MEMBER_EDITABLE_KEYS, memberForbiddenFields,
  normalizeRecallHardConfig, parseRecallHardPatch,
  recallHardBaseUrl, validRecallHardPort, validRecallUpstream,
} from '../recallHardConfig.ts';

describe('批次62 · recallHardConfig 配置真源', () => {
  test('默认值：A 开 / B 关（需上游）/ C 开，端口 8300', () => {
    expect(DEFAULT_RECALL_HARD_CONFIG).toEqual({
      a_hook: true, b_gateway: false, b_upstream: '', b_port: 8300, c_strict_gate: true,
    });
  });

  test('坏结构一律回默认，不抛错', () => {
    for (const raw of [null, undefined, 42, 'x', [], true]) {
      expect(normalizeRecallHardConfig(raw)).toEqual({ ...DEFAULT_RECALL_HARD_CONFIG });
    }
  });

  test('只接受合法字段；非法端口与超长上游回默认值', () => {
    const cfg = normalizeRecallHardConfig({
      a_hook: false, b_gateway: true, b_upstream: 'https://api.example.com/v1', b_port: 0, c_strict_gate: 'yes',
    });
    expect(cfg.a_hook).toBe(false);
    expect(cfg.b_gateway).toBe(true);
    expect(cfg.b_upstream).toBe('https://api.example.com/v1');
    expect(cfg.b_port).toBe(8300); // 0 不是合法端口 → 回默认，不写坏值
    expect(cfg.c_strict_gate).toBe(true); // 非布尔不认
    expect(normalizeRecallHardConfig({ b_upstream: `https://x.test/${'a'.repeat(2100)}` }).b_upstream).toBe('');
  });

  test('上游只认 http/https 绝对地址（挡 javascript: / 相对 / 空）', () => {
    expect(validRecallUpstream('http://127.0.0.1:11434/v1')).toBe(true);
    expect(validRecallUpstream('https://api.deepseek.com')).toBe(true);
    expect(validRecallUpstream('javascript:alert(1)')).toBe(false);
    expect(validRecallUpstream('/v1/chat')).toBe(false);
    expect(validRecallUpstream('')).toBe(false);
    expect(validRecallUpstream(123)).toBe(false);
  });

  test('端口只认 1–65535 的整数', () => {
    expect(validRecallHardPort(8300)).toBe(true);
    expect(validRecallHardPort(1)).toBe(true);
    expect(validRecallHardPort(65535)).toBe(true);
    expect(validRecallHardPort(0)).toBe(false);
    expect(validRecallHardPort(65536)).toBe(false);
    expect(validRecallHardPort(8300.5)).toBe(false);
    expect(validRecallHardPort('8300')).toBe(false);
  });

  test('base_url 固定 loopback（网关只监听 127.0.0.1）', () => {
    expect(recallHardBaseUrl(8300)).toBe('http://127.0.0.1:8300/v1');
  });

  test('patch：只挑显式给出的字段，未提到的字段不出现在 patch 里', () => {
    const r = parseRecallHardPatch({ a_hook: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.patch)).toEqual(['a_hook']);
  });

  test('patch：非法值直接拒绝，不静默吞掉', () => {
    for (const bad of [{ a_hook: 'yes' }, { b_gateway: 1 }, { c_strict_gate: null },
      { b_upstream: 'ftp://x' }, { b_upstream: 42 }, { b_port: 0 }, { b_port: '8300' }]) {
      const r = parseRecallHardPatch(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseRecallHardPatch(null).ok).toBe(false);
    expect(parseRecallHardPatch([]).ok).toBe(false);
  });

  test('patch：上游首尾空格被裁掉（粘贴常带空格）', () => {
    const r = parseRecallHardPatch({ b_upstream: '  https://api.example.com  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.b_upstream).toBe('https://api.example.com');
  });
});

describe('2026-11-16 · 成员可配置范围（A / C 下放，B 限管理员）', () => {
  test('成员可改字段只有 A 宿主钩子与 C 内核门禁', () => {
    expect([...MEMBER_EDITABLE_KEYS]).toEqual(['a_hook', 'c_strict_gate']);
  });

  test('只改 A / C → 没有禁改字段（成员放行）', () => {
    expect(memberForbiddenFields({ a_hook: false })).toEqual([]);
    expect(memberForbiddenFields({ c_strict_gate: false })).toEqual([]);
    expect(memberForbiddenFields({ a_hook: true, c_strict_gate: false })).toEqual([]);
    expect(memberForbiddenFields({})).toEqual([]);
  });

  test('碰 B 的任何字段 → 逐字段点名拒绝（不静默只改一半）', () => {
    expect(memberForbiddenFields({ b_gateway: true })).toEqual(['b_gateway']);
    expect(memberForbiddenFields({ b_upstream: 'https://x.test' })).toEqual(['b_upstream']);
    expect(memberForbiddenFields({ b_port: 8301 })).toEqual(['b_port']);
    // 混合 patch：A / C 合法也必须整单拒绝，由调用方给出明确错误，避免「改了一半」
    expect(memberForbiddenFields({ a_hook: false, b_gateway: true }))
      .toEqual(['b_gateway']);
  });

  test('未知字段一律算禁改（白名单制，向前兼容新增字段默认限管理员）', () => {
    expect(memberForbiddenFields({ d_new_layer: true })).toEqual(['d_new_layer']);
  });
});
