// 批次17：程序运行日志窗口纯函数（解析 / UTC+08:00 时间 / 诊断文本）；批次19 起用于日志记录页。
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildDiagnostics,
  copyText,
  countErrors,
  formatLocalDateTime,
  formatLogClock,
  parseProgramLogLine,
} from '../programLog.ts';

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe('parseProgramLogLine', () => {
  it('解析标准 info 行（scope:action + request_id + detail）', () => {
    const l = parseProgramLogLine(
      '[2026-10-30T16:27:18.000Z] [info] [ipc:storage:listMemories] [req_1] {"ms":3}',
    );
    expect(l.ts).toBe('2026-10-30T16:27:18.000Z');
    expect(l.level).toBe('info');
    expect(l.scope).toBe('ipc');
    expect(l.action).toBe('storage:listMemories');
    expect(l.message).toBe('{"ms":3}');
  });

  it('解析 error 行；detail 为空时 message 为空', () => {
    const l = parseProgramLogLine('[2026-10-30T16:27:18.000Z] [error] [ui:script_error]');
    expect(l.level).toBe('error');
    expect(l.scope).toBe('ui');
    expect(l.action).toBe('script_error');
    expect(l.message).toBe('');
  });

  it('畸形行不丢弃：level=unknown，原文截断展示', () => {
    const l = parseProgramLogLine('plain text without format', 10);
    expect(l.level).toBe('unknown');
    expect(l.scope).toBe('');
    expect(l.message).toBe('plain text…');
    expect(l.raw).toBe('plain text without format');
  });

  it('超长 detail 截断，但 raw 保留完整（复制诊断用）', () => {
    const raw = `[2026-10-30T16:27:18.000Z] [warn] [host:scan] ${'x'.repeat(300)}`;
    const l = parseProgramLogLine(raw, 20);
    expect(l.message).toBe(`${'x'.repeat(20)}…`);
    expect(l.raw).toBe(raw);
  });
});

describe('时间展示（固定 UTC+08:00，不依赖机器时区）', () => {
  it('ISO UTC → HH:mm:ss（跨日正确进位）', () => {
    expect(formatLogClock('2026-10-30T16:27:18.000Z')).toBe('00:27:18');
  });

  it('null / 非法时间 → 占位', () => {
    expect(formatLogClock(null)).toBe('--:--:--');
    expect(formatLogClock('not-a-date')).toBe('--:--:--');
  });

  it('诊断时间戳为 UTC+08:00 的 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatLocalDateTime(new Date('2026-10-30T16:27:18.000Z'))).toBe('2026-10-31 00:27:18');
  });
});

describe('错误统计与诊断文本', () => {
  const lines = [
    parseProgramLogLine('[2026-10-30T16:00:00.000Z] [info] [ui:page_view]'),
    parseProgramLogLine('[2026-10-30T16:00:01.000Z] [warn] [home:fallback] {"x":1}'),
    parseProgramLogLine('[2026-10-30T16:00:02.000Z] [error] [ipc:storage:listMemories] {"error":"boom"}'),
  ];

  it('只把 error 计为问题（warn 仅高亮）', () => {
    expect(countErrors(lines)).toBe(1);
  });

  it('诊断文本含本地时间、页面、日志路径与原始日志行', () => {
    const text = buildDiagnostics({
      path: 'C:\\data\\actions.log',
      lines,
      page: 'index.html',
      now: new Date('2026-10-30T16:27:18.000Z'),
    });
    expect(text).toContain('MultiAgent Memory 程序诊断信息');
    expect(text).toContain('时间: 2026-10-31 00:27:18 (+08:00)');
    expect(text).toContain('页面: index.html');
    expect(text).toContain('日志文件: C:\\data\\actions.log');
    expect(text).toContain('[ipc:storage:listMemories]');
  });

  it('未初始化路径显示「(未初始化)」，不伪造路径', () => {
    const text = buildDiagnostics({ path: null, lines: [], page: 'index.html', now: new Date(0) });
    expect(text).toContain('日志文件: (未初始化)');
  });
});

describe('copyText', () => {
  it('优先 Clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await expect(copyText('diagnostics')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('diagnostics');
  });

  it('Clipboard API 拒绝时回退；无回退能力则诚实返回 false', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    await expect(copyText('x')).resolves.toBe(false);
    expect(exec).toHaveBeenCalledWith('copy');
  });
});
