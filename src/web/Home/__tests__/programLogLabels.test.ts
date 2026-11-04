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
    // 批次41-A：审计账本六个键都必须有中文标题（日志页人话视图不能只露 kernel:audit:*）
    expect(actionTitle('kernel', 'audit:log-open')).toContain('内核审计账本已打开');
    expect(actionTitle('kernel', 'audit:log-migrated')).toContain('搬进审计账本');
    expect(actionTitle('kernel', 'audit:log-bad-lines')).toContain('解析不出来的行');
    expect(actionTitle('kernel', 'audit:log-corrupt')).toContain('整档读不认');
    expect(actionTitle('kernel', 'audit:log-backup')).toContain('搬移历史审计前的备份');
    expect(actionTitle('kernel', 'audit:log-migrate-skipped')).toContain('本次没搬历史审计');
    // 批次41-R：明细页查看事件双写进 actions.log 后，人话视图必须认得这个键
    expect(actionTitle('mcp', 'recall_detail_view')).toContain('召回明细页');
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

  it('批次40-C：补炼一行的「停在哪、为什么停」要进人话摘要（值只有层名与英文码，无正文）', () => {
    const note = detailNote('{"mem_id":"mem_x","ok":true,"refined_by":"llm_partial","to_layer":"L3",'
      + '"layers":3,"targets":4,"llm_calls":2,"code":null,"stop_layer":"L3","stop_code":"too_short","ms":28123}');
    expect(note).toContain('mem_id=mem_x');
    expect(note).toContain('to_layer=L3');
    expect(note).toContain('stop_layer=L3');
    expect(note).toContain('stop_code=too_short');
    expect(note).toContain('refined_by=llm_partial');
  });

  it('批次41-R：明细页查看事件只带 outcome（一次性 id 与正文都不在值里）', () => {
    expect(detailNote('{"outcome":"ok","id":"dmZ8gmrCURLtNquDq5WqFg","html":"<details>正文</details>"}'))
      .toBe('outcome=ok');
  });

  it('批次41-A：审计账本的计数与位置进人话摘要，且不带任何审计正文', () => {
    const note = detailNote('{"path":"D:/data/audit.jsonl","rows":11666,"bytes":0,'
      + '"migrated_rows":11666,"legacy_rows_in_ledger":0,"archive_files":1,"archived_rows":900,'
      + '"skipped_lines":2,"readonly":false,"detail":{"content":"这段不该出现在摘要里"}}', 400);
    expect(note).toContain('path=D:/data/audit.jsonl');
    expect(note).toContain('rows=11666');
    expect(note).toContain('migrated_rows=11666');
    expect(note).toContain('skipped_lines=2');
    expect(note).not.toContain('这段不该出现在摘要里');   // detail 里的正文不被抬进摘要
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
