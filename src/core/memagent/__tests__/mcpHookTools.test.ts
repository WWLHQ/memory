// 钩子健康度自检：core 层纯逻辑，零真实 IO（读文件与时间全部注入）。
// 核心断言：**「没记录」绝不等于「正常」**——这正是历史钩子静默失效的成因。
import { describe, it, expect } from 'vitest';
import {
  HOOK_STATUS_STALE_MS, hookReasonZh, runHookStatusTool, type HookStatusDeps,
} from '../mcpHookTools.ts';
import { buildHookRunState, serializeHookRunState, type HookFailReason } from '../recallPrelude.ts';

const FILE = 'C:\\data\\recall-hook-status.json';
const NOW = Date.parse('2026-11-16T10:00:00.000Z');

function deps(raw: string | null, nowMs = NOW): HookStatusDeps {
  return {
    statusFilePath: FILE,
    now: () => nowMs,
    readText: () => {
      if (raw === null) {
        const err = new Error('ENOENT: no such file or directory') as Error & { code?: string };
        err.code = 'ENOENT';
        throw err;
      }
      return raw;
    },
  };
}

const stateAt = (iso: string, status: 'ok' | 'empty' | 'failed', hits = 0, reason?: HookFailReason): string =>
  serializeHookRunState(buildHookRunState(status, iso, hits, reason));

describe('recall_hook_status · 钩子健康度自检', () => {
  it('状态文件不存在 → never_ran（钩子从没跑过，这是最危险的结论，不能当正常）', () => {
    const r = runHookStatusTool(deps(null));
    expect(r.verdict).toBe('never_ran');
    expect(r.last_run).toBeNull();
    expect(r.age_ms).toBeNull();
    expect(r.status_file).toBe(FILE);
    expect(r.summary).toContain('从未记录到钩子执行');
    expect(r.summary).toContain('完全没有生效');
    // never_ran 必须要求 Agent 向用户明说，不能静默
    expect(r.advice).toContain('本轮强制召回未生效');
    // ENOENT 属正常语义，不该当读错误报
    expect(r.probe_error).toBeUndefined();
  });

  it('最近一次成功 → verdict=ok 且带上注入条数，且不打扰用户', () => {
    const r = runHookStatusTool(deps(stateAt('2026-11-16T09:58:00.000Z', 'ok', 3)));
    expect(r.verdict).toBe('ok');
    expect(r.last_run?.hits).toBe(3);
    expect(r.summary).toContain('注入 3 条');
    expect(r.age_ms).toBe(120_000);
    expect(r.advice).toContain('无需额外提示');
  });

  it('零命中是正常表现，不判失败', () => {
    const r = runHookStatusTool(deps(stateAt('2026-11-16T09:59:30.000Z', 'empty')));
    expect(r.verdict).toBe('empty');
    expect(r.summary).toContain('不代表失败');
    expect(r.advice).toBe('钩子工作正常，无需额外提示用户。');
  });

  it('最近一次失败 → verdict=failed，原因译成人话并强制告知用户', () => {
    const r = runHookStatusTool(deps(stateAt('2026-11-16T09:55:00.000Z', 'failed', 0, 'rpc_error')));
    expect(r.verdict).toBe('failed');
    expect(r.last_run?.reason).toBe('rpc_error');
    expect(r.summary).toContain('连不上记忆库服务');
    expect(r.summary).toContain('没有生效');
    expect(r.advice).toContain('必须如实告知用户');
  });

  it('超过 12 小时无新记录 → stale（钩子可能被卸载/配置被改）', () => {
    const old = new Date(NOW - HOOK_STATUS_STALE_MS - 60_000).toISOString();
    const r = runHookStatusTool(deps(stateAt(old, 'ok', 2)));
    expect(r.verdict).toBe('stale');
    expect(r.age_ms).toBeGreaterThan(HOOK_STATUS_STALE_MS);
    expect(r.summary).toContain('此后没有新记录');
    expect(r.advice).toContain('本轮强制召回未生效');
  });

  it('状态文件内容损坏 → never_ran + probe_error（不冒充「没有记录」也不冒充「正常」）', () => {
    const r = runHookStatusTool(deps('{not json'));
    expect(r.verdict).toBe('never_ran');
    expect(r.last_run).toBeNull();
    expect(r.probe_error).toContain('无法解析');
    expect(r.summary).toContain('没有可信的钩子执行记录');
    expect(r.advice).toContain('必须如实告知用户');
  });

  it('读文件权限类错误 → never_ran + probe_error（保留原因，不吞异常）', () => {
    const r = runHookStatusTool({
      statusFilePath: FILE,
      now: () => NOW,
      readText: () => {
        const err = new Error('EACCES: permission denied') as Error & { code?: string };
        err.code = 'EACCES';
        throw err;
      },
    });
    expect(r.verdict).toBe('never_ran');
    expect(r.probe_error).toContain('EACCES');
    expect(r.ok).toBe(true);
  });

  it('失败原因枚举全部有中文说法，未知值不裸奔英文', () => {
    const reasons: HookFailReason[] = [
      'empty_input', 'bad_event', 'loopback_guard', 'token_missing', 'rpc_error', 'bad_response', 'unknown',
    ];
    for (const reason of reasons) {
      const zh = hookReasonZh(reason);
      expect(zh).not.toBe(reason);
      expect(zh).toMatch(/[\u4e00-\u9fa5]/);
    }
    expect(hookReasonZh('some_new_reason')).toBe('未知原因');
    expect(hookReasonZh(undefined)).toBe('未知原因');
  });
});
