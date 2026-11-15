// T6 · 桌面客户端运行态匹配（纯函数，不依赖真实进程表）
import { describe, expect, it } from 'vitest';
import { CLIENT_PROCESS_NAMES, matchRunningClients } from '../clientProcess.ts';

describe('T6 · matchRunningClients', () => {
  it('进程表里出现 WorkBuddy.exe → workbuddy 已启动、qoder 未启动', () => {
    const r = matchRunningClients(['WorkBuddy.exe', 'explorer.exe']);
    expect(r.workbuddy).toBe(true);
    expect(r['qoder-cn']).toBe(false);
    expect(r.cursor).toBe(false);
  });

  it('大小写不敏感（workbuddy.exe / WORKBUDDY.EXE 都算）', () => {
    expect(matchRunningClients(['workbuddy.exe']).workbuddy).toBe(true);
    expect(matchRunningClients(['WORKBUDDY.EXE']).workbuddy).toBe(true);
  });

  it('deepseek harness 随宿主 Qoder：qoder.exe 在 → 两者都在', () => {
    const r = matchRunningClients(['Qoder.exe']);
    expect(r['qoder-cn']).toBe(true);
    expect(r['deepseek-harness']).toBe(true);
  });

  it('桌面版 Claude Code / Codex 也判运行态（claude.exe / codex.exe）', () => {
    const r = matchRunningClients(['claude.exe', 'codex.exe']);
    expect(r['claude-code']).toBe(true);
    expect(r.codex).toBe(true);
  });

  it('无可靠桌面进程的 Gemini CLI / Qwen 不给运行态（不在结果里，绝不误报未启动）', () => {
    const r = matchRunningClients(['node.exe']);
    expect('gemini-cli' in r).toBe(false);
    expect('qwen-code' in r).toBe(false);
  });

  it('映射表包含所有已确认 exe 名的客户端（含 claude-code / codex）', () => {
    expect(Object.keys(CLIENT_PROCESS_NAMES).sort()).toEqual(
      ['claude-code', 'codex', 'cursor', 'deepseek-harness', 'qoder-cn', 'trae-cn', 'workbuddy', 'zcode'],
    );
  });
});
