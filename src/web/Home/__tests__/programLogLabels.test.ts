// 批次24：程序运行日志「人话」翻译层单测。
// 覆盖三种路径：字典命中 / 未收录 action（原样带出，不编「未知操作」）/ 畸形行（未格式化输出）。
import { describe, it, expect } from 'vitest';
import {
  LEVEL_LABEL,
  actionTitle,
  detailNote,
  humanizeProgramLog,
} from '../programLogLabels.ts';
import { parseProgramLogLine } from '../programLog.ts';

describe('actionTitle', () => {
  it('精确字典命中：直接用中文动作说明', () => {
    expect(actionTitle('home', 'login_fail')).toBe('登录失败');
    expect(actionTitle('kernel', 'legacy:demote')).toBe('遗留账本清理完成');
  });

  it('IPC 通道命中：作用域中文 + 通道说明', () => {
    expect(actionTitle('ipc', 'storage:putMemory')).toBe('主进程：保存记忆');
    expect(actionTitle('host', 'legacy:scan')).toBe('宿主桥：预览遗留账本脏行');
  });

  it('字典未收录：原样带出动作名，绝不编造成「未知操作」', () => {
    expect(actionTitle('ui', 'brand_new_step')).toBe('界面操作：brand_new_step');
    // 未知作用域同样不丢信息
    expect(actionTitle('', 'x')).toBe('日志：x');
  });
});

describe('detailNote', () => {
  it('抽关键字段拼摘要，按 NOTE_KEYS 优先级排序', () => {
    const note = detailNote('{"ms":12,"page":"logs","testid":"btnX","error":"boom"}');
    expect(note).toBe('boom · page=logs · testid=btnX · ms=12');
  });

  it('非 JSON 结构（纯文本错误输出）：原样带出，不加工', () => {
    expect(detailNote('Uncaught TypeError: x is not a function')).toBe('Uncaught TypeError: x is not a function');
  });

  it('空 detail 返回空串；超长截断加省略号', () => {
    expect(detailNote('   ')).toBe('');
    const long = `{"path":"${'d'.repeat(300)}"}`;
    expect(detailNote(long, 40).length).toBeLessThanOrEqual(41);
    expect(detailNote(long, 40).endsWith('…')).toBe(true);
  });

  it('只按优先级挑字段：未列入 NOTE_KEYS 的键不抢占摘要', () => {
    expect(detailNote('{"client":"Qoder/9.9.9","token":"***"}')).toBe('client=Qoder/9.9.9');
  });
});

describe('humanizeProgramLog', () => {
  it('正常行：中文标题 + 字段摘要 + 原始 scope:action 随行保留', () => {
    const line = parseProgramLogLine(
      '[2026-10-30T16:00:00.000Z] [error] [home:login_fail] [req_1] {"reason":"origin_blocked","origin":"http://127.0.0.1:5180"}',
    );
    const h = humanizeProgramLog(line);
    expect(h.title).toBe('登录失败');
    expect(h.note).toBe('origin_blocked · origin=http://127.0.0.1:5180');
    expect(h.level).toBe(LEVEL_LABEL.error);
    expect(h.code).toBe('home:login_fail');
  });

  it('畸形行：不丢弃，标为未格式化输出并原样带出正文', () => {
    const line = parseProgramLogLine('this is not an action log line');
    const h = humanizeProgramLog(line);
    expect(h.title).toBe('未格式化输出');
    expect(h.note).toBe('this is not an action log line');
    expect(h.level).toBe(LEVEL_LABEL.unknown);
    expect(h.code).toBe('');
  });

  it('未收录动作：标题保留原始 action，摘要保留字段', () => {
    const line = parseProgramLogLine('[2026-10-30T16:00:00.000Z] [warn] [ui:nope] [r] {"count":3}');
    const h = humanizeProgramLog(line);
    expect(h.title).toBe('界面操作：nope');
    expect(h.note).toBe('count=3');
    expect(h.level).toBe('提醒');
  });
});
