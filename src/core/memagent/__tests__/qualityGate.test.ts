// L0→L1 质量门（§2.1 清洗红线）单测
import { describe, it, expect } from 'vitest';
import { checkL0ToL1Quality, filteredAuditDetail } from '../qualityGate.ts';

describe('checkL0ToL1Quality', () => {
  it('空内容 / 纯空白 → 拦截', () => {
    expect(checkL0ToL1Quality('')).toEqual({ ok: false, reason: '空内容' });
    expect(checkL0ToL1Quality('   \n\t  ')).toEqual({ ok: false, reason: '空内容' });
    expect(checkL0ToL1Quality(undefined as unknown as string)).toEqual({ ok: false, reason: '空内容' });
  });

  it('纯寒暄/确认语 → 拦截', () => {
    expect(checkL0ToL1Quality('好的').ok).toBe(false);
    expect(checkL0ToL1Quality('OK').ok).toBe(false);
    expect(checkL0ToL1Quality('嗯嗯').ok).toBe(false);
    expect(checkL0ToL1Quality('收到！').ok).toBe(false);
    expect(checkL0ToL1Quality('哈哈').ok).toBe(false);
    expect(checkL0ToL1Quality('👍').ok).toBe(false);
    expect(checkL0ToL1Quality('了解').ok).toBe(false);
  });

  it('纯数字 / 纯标点 / 分隔线 → 拦截', () => {
    expect(checkL0ToL1Quality('12345').ok).toBe(false);
    expect(checkL0ToL1Quality('---------').ok).toBe(false);
    expect(checkL0ToL1Quality('=====').ok).toBe(false);
    expect(checkL0ToL1Quality('！！！！！！！！！！！！').ok).toBe(false);
  });

  it('噪声规则按脱敏后文本匹配：裸链接脱敏后只剩占位符 → 拦截', () => {
    expect(checkL0ToL1Quality('https://example.com/a/b/c').ok).toBe(false);
    expect(checkL0ToL1Quality('postgres://user:pass@db:5432/app').ok).toBe(false);
  });

  it('脱敏后只剩占位符（有效字符不足）→ 拦截', () => {
    // 脱敏后变成 联系人{NAME} 等占位符，无有效信息
    expect(checkL0ToL1Quality('联系人：张三').ok).toBe(false);
  });

  it('有效技术内容 → 通过，返回脱敏后 L1 内容', () => {
    const raw = '部署步骤：1. 先用 Docker Compose 起 postgres 和 redis，2. 配置 .env 的 DATABASE_URL，3. 跑迁移脚本，4. 健康检查 /health 返回 200 即成功。若 502 检查 nginx upstream 超时配置（proxy_read_timeout 默认 60s 偏短，建议 120s）。';
    const r = checkL0ToL1Quality(raw);
    expect(r.ok).toBe(true);
    expect(r.content).toBeTruthy();
    expect(r.content!.length).toBeGreaterThan(10);
  });

  it('含敏感信息的内容：脱敏后仍有效 → 通过（脱敏产物干净）', () => {
    const raw = '服务地址 tcp://10.0.0.1:5432 的 postgres 连接串，api_key 为 sk-abcdefghijklmnop123，生产环境需轮换密钥。';
    const r = checkL0ToL1Quality(raw);
    expect(r.ok).toBe(true);
    // 脱敏产物不应含明文密钥/地址
    expect(r.content!).not.toMatch(/sk-abcdefghijklmnop123/);
    expect(r.content!).not.toMatch(/10\.0\.0\.1/);
  });

  it('纯 import / require 行（无逻辑）→ 拦截', () => {
    expect(checkL0ToL1Quality("import { foo } from 'bar';").ok).toBe(false);
    expect(checkL0ToL1Quality("const x = require('lodash');").ok).toBe(false);
    expect(checkL0ToL1Quality("import path from 'node:path';").ok).toBe(false);
  });
});

describe('批次10 元信息噪声（问候 / 身份询问 / 助手自述与能力清单）', () => {
  it('纯打招呼 / 问候+客套 → 拦截', () => {
    expect(checkL0ToL1Quality('你好').ok).toBe(false);
    expect(checkL0ToL1Quality('你好呀！').ok).toBe(false);
    expect(checkL0ToL1Quality('Hello there!').ok).toBe(false);
    expect(checkL0ToL1Quality('你好，有什么可以帮您的吗').ok).toBe(false);
    expect(checkL0ToL1Quality('你好，有什么可以帮您的吗').reason).toContain('询问');
  });

  it('纯身份/能力询问（不是真实技术问题）→ 拦截', () => {
    const ask = checkL0ToL1Quality('你好呀，请问你是什么模型呢');
    expect(ask.ok).toBe(false);
    expect(ask.reason).toContain('询问');
    expect(checkL0ToL1Quality('请问你能帮我做哪些工作呢').ok).toBe(false);
    expect(checkL0ToL1Quality('我是哪个模型').ok).toBe(false);
  });

  it('助手自我介绍 / 能力清单（多子句）→ 拦截', () => {
    const intro = checkL0ToL1Quality('你好，我是 DeepSeek，我可以帮你写代码、分析数据、回答问题。');
    expect(intro.ok).toBe(false);
    expect(intro.reason).toContain('助手');
    const list = checkL0ToL1Quality('我可以帮你做以下工作：\n1. 写代码\n2. 分析数据\n3. 回答问题');
    expect(list.ok).toBe(false);
    expect(checkL0ToL1Quality('我是 Claude，由 Anthropic 开发').ok).toBe(false);
    expect(checkL0ToL1Quality('作为 AI 助手，我可以帮你写代码、分析数据、回答问题。').ok).toBe(false);
    expect(checkL0ToL1Quality("I'm an AI assistant, I can help you with coding, data analysis, and answering questions.").ok).toBe(false);
  });

  it('含具体技术内容 → 放行（不误伤真实问题/方案）', () => {
    expect(checkL0ToL1Quality('你能帮我排查 Redis 连接池超时吗').ok).toBe(true);
    expect(checkL0ToL1Quality('我可以帮你优化 PostgreSQL 的索引配置').ok).toBe(true);
    expect(checkL0ToL1Quality('你好，部署前请检查 nginx upstream 超时配置').ok).toBe(true);
    expect(checkL0ToL1Quality('用户登录失败，错误码 E_AUTH').ok).toBe(true);
  });
});

describe('filteredAuditDetail', () => {
  it('返回拦截审计字段（含预览 + 原因 + 长度）', () => {
    const d = filteredAuditDetail('好的好的好的', '纯寒暄/确认语，无信息量');
    expect(d.action).toBe('filtered_l0_to_l1');
    expect(d.reason).toBe('纯寒暄/确认语，无信息量');
    expect(d.content_preview).toContain('好的');
    expect(d.content_length).toBeGreaterThan(0);
  });

  it('超长内容预览截断到 60 字 + …', () => {
    const long = 'a'.repeat(200);
    const d = filteredAuditDetail(long, '有效内容不足');
    expect(String(d.content_preview)).toHaveLength(61); // 60 + …
    expect(String(d.content_preview).endsWith('…')).toBe(true);
  });

  it('预览取脱敏后文本：不泄露姓名/电话/密钥', () => {
    const d = filteredAuditDetail('联系人：张三 电话 13800138000 api_key=abcd1234', '有效内容不足');
    expect(String(d.content_preview)).not.toContain('张三');
    expect(String(d.content_preview)).not.toContain('13800138000');
    expect(String(d.content_preview)).not.toContain('abcd1234');
    expect(String(d.content_preview)).toContain('[姓名]');
    expect(d.masked).toBe(true);
  });
});
