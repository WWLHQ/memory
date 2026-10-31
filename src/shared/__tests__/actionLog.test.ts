// 批次7：动作日志统一格式与脱敏（shared/actionLog）单测。
// 重点：敏感字段绝不落盘、循环/深度/超长安全、行格式稳定（便于 grep 与 LLM 检索）。
import { describe, it, expect } from 'vitest';
import {
  sanitizeActionDetail,
  createActionLogEntry,
  formatActionLine,
} from '../actionLog.ts';

describe('sanitizeActionDetail：脱敏', () => {
  it('密码/令牌/密钥类字段整体替换为 ***，值绝不出现', () => {
    const out = sanitizeActionDetail({
      password: 'plain-secret',
      newPassword: 'another-secret',
      token: 'tok_123',
      Authorization: 'Bearer abc',
      apiKey: 'sk-live-xxx',
      'api-key': 'sk-live-yyy',
      credential: 'cred',
      cookie: 'sid=1',
      session_id: 'sess-1',
      user: 'alice',
    }) as Record<string, unknown>;

    expect(out.password).toBe('***');
    expect(out.newPassword).toBe('***');
    expect(out.token).toBe('***');
    expect(out.Authorization).toBe('***');
    expect(out.apiKey).toBe('***');
    expect(out['api-key']).toBe('***');
    expect(out.credential).toBe('***');
    expect(out.cookie).toBe('***');
    expect(out.session_id).toBe('***');
    expect(out.user).toBe('alice');
    expect(JSON.stringify(out)).not.toContain('plain-secret');
    expect(JSON.stringify(out)).not.toContain('sk-live');
  });

  it('嵌套对象的敏感字段同样脱敏', () => {
    const out = sanitizeActionDetail({ nested: { deeper: { api_key: 'k', ok: 1 } } }) as {
      nested: { deeper: { api_key: string; ok: number } };
    };
    expect(out.nested.deeper.api_key).toBe('***');
    expect(out.nested.deeper.ok).toBe(1);
  });

  it('原始值/字符串/大整数/函数/undefined 的降级行为', () => {
    expect(sanitizeActionDetail(null)).toBeNull();
    expect(sanitizeActionDetail(42)).toBe(42);
    expect(sanitizeActionDetail(true)).toBe(true);
    expect(sanitizeActionDetail(10n)).toBe('10');
    expect(sanitizeActionDetail(() => 1)).toBe('[function]');
    expect(sanitizeActionDetail(Symbol('x'))).toBe('[symbol]');
    expect(sanitizeActionDetail(undefined)).toBeUndefined();
    const obj = sanitizeActionDetail({ keep: 1, drop: undefined }) as Record<string, unknown>;
    expect(obj).toEqual({ keep: 1 });
  });

  it('Error → {name,message}；超长字符串截断到 500 + 省略号', () => {
    expect(sanitizeActionDetail(new TypeError('boom'))).toEqual({ name: 'TypeError', message: 'boom' });
    const long = 'x'.repeat(600);
    const s = sanitizeActionDetail({ msg: long }) as { msg: string };
    expect(s.msg.length).toBe(501);
    expect(s.msg.endsWith('…')).toBe(true);
  });

  it('数组截断到 20 项并标记剩余数量', () => {
    const arr = Array.from({ length: 25 }, (_, i) => i);
    const out = sanitizeActionDetail(arr) as unknown[];
    expect(out.length).toBe(21);
    expect(out[20]).toBe('…(5 more)');
  });

  it('嵌套深度超过 4 层 → [depth-limit]（防巨额对象拖垮日志）', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = sanitizeActionDetail(deep) as { a: { b: { c: { d: unknown } } } };
    expect(out.a.b.c.d).toBe('[depth-limit]');
  });

  it('循环引用不抛错，输出 [circular]', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = sanitizeActionDetail(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[circular]');
  });

  it('Map / Set 转为可序列化结构', () => {
    expect(sanitizeActionDetail(new Map([['k', 'v']]))).toEqual({ k: 'v' });
    expect(sanitizeActionDetail(new Set([1, 2]))).toEqual([1, 2]);
  });
});

describe('createActionLogEntry / formatActionLine：统一行格式', () => {
  it('固定时间与 requestId → 行格式稳定', () => {
    const entry = createActionLogEntry('ipc', 'storage:putMemory', { mem_id: 'm1' }, {
      now: Date.parse('2026-10-30T08:00:00.000Z'),
      requestId: 'req_abc',
    });
    expect(formatActionLine(entry)).toBe(
      '[2026-10-30T08:00:00.000Z] [info] [ipc:storage:putMemory] [req_abc] {"mem_id":"m1"}',
    );
  });

  it('level 缺省 info；无 detail 时不追加 JSON', () => {
    const entry = createActionLogEntry('ui', 'page_view', undefined, { now: 0 });
    expect(entry.level).toBe('info');
    expect(formatActionLine(entry)).toBe('[1970-01-01T00:00:00.000Z] [info] [ui:page_view]');
  });

  it('detail 保持单行（字符串内换行被 JSON 转义，不破坏按行 grep）', () => {
    const entry = createActionLogEntry('ui', 'click', { text: 'line1\nline2' }, { now: 0 });
    const line = formatActionLine(entry);
    expect(line.includes('\n')).toBe(false);
    expect(line).toContain('line1\\nline2');
  });

  it('scope/action 为空时回退 unknown（日志不能出现空标签）', () => {
    const entry = createActionLogEntry('', '', null, { now: 0 });
    expect(entry.scope).toBe('unknown');
    expect(entry.action).toBe('unknown');
  });

  it('detail 中的敏感字段在入口处即已脱敏', () => {
    const entry = createActionLogEntry('home', 'login', { account: 'admin', password: 'Admin@123456' }, { now: 0 });
    expect(JSON.stringify(entry)).not.toContain('Admin@123456');
    expect((entry.detail as Record<string, unknown>).password).toBe('***');
  });
});
