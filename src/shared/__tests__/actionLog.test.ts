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
      recovery_code: 'recovery-code-plain',
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
    // 批次37-G：L0 恢复码与密码同级，绝不进日志
    expect(out.recovery_code).toBe('***');
    expect(out.user).toBe('alice');
    expect(JSON.stringify(out)).not.toContain('plain-secret');
    expect(JSON.stringify(out)).not.toContain('sk-live');
    expect(JSON.stringify(out)).not.toContain('recovery-code-plain');
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

describe('批次27 P2-10：值形态兜底脱敏（键名不敏感但值是密钥形态）', () => {
  it('裸字符串里的 Bearer / JWT / 厂商密钥前缀被替换为 ***', () => {
    expect(sanitizeActionDetail('Authorization was Bearer abc123def456ghi7')).toBe('Authorization was ***');
    expect(sanitizeActionDetail('token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'))
      .toBe('token=***');
    expect(sanitizeActionDetail('key sk-proj-AbCdEfGhIjKlMnOpQrSt')).toBe('key ***');
    expect(sanitizeActionDetail('aws AKIAIOSFODNN7EXAMPLE creds')).toBe('aws *** creds');
    expect(sanitizeActionDetail('slack xoxb-123456789012-abcdef')).toBe('slack ***');
    expect(JSON.stringify(sanitizeActionDetail('Bearer abc123def456ghi7'))).not.toContain('abc123def456ghi7');
  });

  it('普通文本不被误伤（不做语义猜测）', () => {
    expect(sanitizeActionDetail('skype meeting at 3pm')).toBe('skype meeting at 3pm');
    expect(sanitizeActionDetail('version v1.2.3.4 released')).toBe('version v1.2.3.4 released');
    expect(sanitizeActionDetail('用户 admin 登录成功')).toBe('用户 admin 登录成功');
  });

  it('数组元素与嵌套结构中的密钥形态值同样被遮蔽', () => {
    const out = sanitizeActionDetail([
      'Bearer abc123def456ghi7',
      { note: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c' },
    ]) as unknown[];
    expect(out[0]).toBe('***');
    expect((out[1] as { note: string }).note).toBe('***');
  });

  it('scope/action/request_id 注入归一化：换行/中括号/中文不再能伪造日志行', () => {
    const entry = createActionLogEntry(
      'ui\nevil] [error] [x:y',
      'click] [error] fake',
      null,
      { requestId: 'req/../..abc$%123', now: 0 },
    );
    const line = formatActionLine(entry);
    expect(line.includes('\n')).toBe(false);
    // 整行仍恰好是 4 段 [..] + detail 的结构：除时间/级别外不再出现多余 [..] 段
    expect(line.startsWith('[1970-01-01T00:00:00.000Z] [info] [')).toBe(true);
    expect(entry.scope).toBe('ui_evil___error___x:y');
    expect(entry.action).toBe('click___error__fake');
    expect(entry.request_id).toBe('req______abc__123');
  });

  it('超长 scope/action/request_id 被截断（40/80/80）', () => {
    const entry = createActionLogEntry('s'.repeat(60), 'a'.repeat(120), null, {
      requestId: 'r'.repeat(100),
      now: 0,
    });
    expect(entry.scope.length).toBe(40);
    expect(entry.action.length).toBe(80);
    expect(entry.request_id!.length).toBe(80);
  });
});
