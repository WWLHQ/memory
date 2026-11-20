// 无状态 ID 对账改造的红灯测试（方案 specs/reports/WEBCHAT-ID-RECONCILE-PLAN.md §7）。
// 核心不变量：会话 ID 是唯一主键；文件系统即账本；删文件重采；无游标。
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sanitizeConversationId,
  conversationIdFromUrl,
  webchatExportFileName,
  pickNewChatsById,
  listCollectedIds,
  type DriverChat,
} from '../webchatIdReconcile.ts';
import { handleExportRequest } from '../webchatIngest.ts';

const chat = (id: string, text = 'hello'): DriverChat => ({
  id,
  title: `会话-${id}`,
  url: `https://chat.deepseek.com/a/chat/s/${id}`,
  path: `/a/chat/s/${id}`,
  messages: [{ role: 'user', text }],
  key: `key:${id}`,
  sig: `sig:${text}`,
  markdown: `# 会话\n\n${text}`,
});

describe('T6/T7 · ID 提取与 sanitize', () => {
  it('deepseek URL 提出稳定 ID', () => {
    expect(conversationIdFromUrl('https://chat.deepseek.com/a/chat/s/01bd655d-490e-4cb2-acac-0f0274a603fe'))
      .toBe('01bd655d-490e-4cb2-acac-0f0274a603fe');
  });

  it('豆包 / 文心一言的数字会话 ID 也能提取（迁移清单要覆盖它们）', () => {
    expect(conversationIdFromUrl('https://www.doubao.com/chat/38452627118216962'))
      .toBe('38452627118216962');
    expect(conversationIdFromUrl('https://wenxin.baidu.com/search/13006829546652823379?enter_type=sidebar_dialog'))
      .toBe('13006829546652823379');
  });

  it('非标准 URL 回落 null，由调用方退化处理', () => {
    expect(conversationIdFromUrl('https://example.com/chat/abc?x=1')).toBeNull();
    expect(conversationIdFromUrl('')).toBeNull();
  });

  it('非法字符与路径穿越被净化，超长截断到 80', () => {
    expect(sanitizeConversationId('../../evil')).toBe('.._.._evil');
    expect(sanitizeConversationId('a/b\\c:d')).toBe('a_b_c_d');
    expect(sanitizeConversationId('')).toBe('');
    expect(sanitizeConversationId('x'.repeat(200)).length).toBe(80);
  });
});

describe('T1/T7 · 文件命名与幂等落盘', () => {
  it('有 ID 时文件名就是 <sanitized-id>.md，与时间戳无关', () => {
    const a = webchatExportFileName(1700000000000, '01bd655d-490e-4cb2-acac-0f0274a603fe');
    const b = webchatExportFileName(1800000000000, '01bd655d-490e-4cb2-acac-0f0274a603fe');
    expect(a).toBe('01bd655d-490e-4cb2-acac-0f0274a603fe.md');
    expect(b).toBe(a); // 同一会话，任何时间导出都是同一文件名 → 幂等
  });

  it('无 ID 时回落时间戳文件名（兼容旧插件/其他站点）', () => {
    expect(webchatExportFileName(1700000000000)).toMatch(/^\d{8}-\d{6}\.md$/);
  });

  it('ingest 幂等：同一 ID 导出两次 → 同一个文件被覆盖，不留 -1 副本（T1 落盘侧）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idingest-'));
    const opts = {
      token: 'tok',
      resolveExportDir: () => dir,
      mkdirp: (p: string) => { mkdirSync(p, { recursive: true }); },
      writeFile: (p: string, d: string) => writeFileSync(p, d, 'utf8'),
    };
    try {
      const id = 'abc-123def';
      const payload = {
        site: 'deepseek', markdown: '# 会话\n第一版',
        conversationId: id, exportedAt: 1700000000000,
      };
      const r1 = handleExportRequest(opts, { authorization: 'Bearer tok' }, payload);
      const r2 = handleExportRequest(opts, { authorization: 'Bearer tok' }, { ...payload, markdown: '# 会话\n第二版' });
      expect(r1.body.path).toBe(r2.body.path);
      expect(r1.body.path).toContain(`${id}.md`);
      expect(readdirSync(join(dir, 'deepseek'))).toEqual([`${id}.md`]); // 只有一份
      expect(readFileSync(r2.body.path!, 'utf8')).toContain('第二版'); // 覆盖生效
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('T1：正文改一行，ID 不变 → 仍判为已采（不重复导出）', () => {
    const existing = new Set(['01bd655d-490e-4cb2-acac-0f0274a603fe.md']);
    const c = chat('01bd655d-490e-4cb2-acac-0f0274a603fe', 'hello 改了一行');
    expect(pickNewChatsById([c], existing)).toHaveLength(0);
  });

  it('T3：删掉该会话的文件 → 重新判为待采', () => {
    const existing = new Set<string>(); // 模拟用户删了文件
    const c = chat('01bd655d-490e-4cb2-acac-0f0274a603fe');
    expect(pickNewChatsById([c], existing)).toHaveLength(1);
  });
});

describe('T2/T5 · 按 ID 集合去重（无游标）', () => {
  it('新会话插到列表顶部仍被发现', () => {
    const existing = new Set(['old-id.md']);
    const fresh = chat('brand-new-id');
    const old = chat('old-id');
    const picked = pickNewChatsById([fresh, old], existing);
    expect(picked.map((c) => c.id)).toEqual(['brand-new-id']);
  });

  it('一批里同一 ID 出现两次只采一次', () => {
    const picked = pickNewChatsById([chat('dup'), chat('dup')], new Set());
    expect(picked).toHaveLength(1);
  });

  it('无 ID 的 chat 按 title 退化，仍幂等', () => {
    const noId = { ...chat(''), id: '' };
    expect(pickNewChatsById([noId], new Set([`title:${noId.title}.md`]))).toHaveLength(0);
    expect(pickNewChatsById([noId], new Set())).toHaveLength(1);
  });
});

describe('T5 · 无状态不变量（源码级变异锁）', () => {
  it('采集器不再写位置游标、不再写内容指纹账，改用 ID 差集', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'electron', 'webchatAutoCollect.ts'), 'utf8');
    expect(src).not.toContain('state.cursors[');
    expect(src).not.toContain('state.doneKeys[chat.key]');
    expect(src).toContain('pickNewChatsById');
    expect(src).toContain('conversationId: chat.id || undefined');
    // 迁移已实跑：跳过键只能来自文件系统，绝不能再读旧内容账（否则删文件重采失效）
    expect(src).not.toContain('Object.keys(state.doneKeys)');
    // 没有 `## 用户` 的旧坏文件必须自动重采，不能永久占着已采账
    expect(src).toContain('requireUserMessage: true');
  });

  it('驱动恒从侧栏顶部开始，且发现上限提到 1000', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'electron', 'webchatAutoConfig.ts'), 'utf8');
    expect(src).toContain('const startAt = 0;');
    expect(src).toContain('{ max: 1000 }');
    // 缺用户提问的会话必须被硬拦，不能再"补抽失败也导出"
    expect(src).toContain("why = 'missing-user';");
    expect(src).toContain('scrollChatToTop()');
  });
});

describe('T4 · 扫目录得已采 ID 集合', () => {
  it('只读 .md 文件名，忽略诊断/备份文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idrec-'));
    try {
      writeFileSync(join(dir, 'id-one.md'), 'x');
      writeFileSync(join(dir, 'id-two.md'), 'x');
      writeFileSync(join(dir, 'debug.html'), 'x');
      writeFileSync(join(dir, 'notes.txt'), 'x');
      expect([...listCollectedIds(dir)].sort()).toEqual(['id-one.md', 'id-two.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('空目录返回空集合', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idrec-'));
    try {
      expect([...listCollectedIds(dir)]).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requireUserMessage：只有助手的旧坏文件不算已采，下一轮自动重采覆盖', () => {
    const dir = mkdtempSync(join(tmpdir(), 'idrec-user-'));
    try {
      writeFileSync(join(dir, 'good-id.md'), '# 导出\n\n## 用户\n你好\n\n## 助手\n答\n');
      writeFileSync(join(dir, 'bad-id.md'), '# 导出\n\n## 助手\n答\n');
      expect([...listCollectedIds(dir)].sort()).toEqual(['bad-id.md', 'good-id.md']);
      expect([...listCollectedIds(dir, { requireUserMessage: true })]).toEqual(['good-id.md']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
