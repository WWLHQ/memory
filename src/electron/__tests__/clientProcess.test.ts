// T6 · 桌面客户端运行态匹配（纯函数，不依赖真实进程表）
import { describe, expect, it } from 'vitest';
import { CLIENT_PROCESS_NAMES, matchRunningClients, normalizeProcessName, probeRunningClients, resetProcessCache } from '../clientProcess.ts';

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

  // 2026-11-28 真机纠错：本机 tasklist 实测为 "Qoder CN.exe" 与 "WorkBuddy-app.exe"，
  // 旧白名单按 qoder.exe / workbuddy.exe 精确比对 → 应用开着也全报「未启动」。现按归一化名比对。
  it('本机真实进程名（Qoder CN.exe / WorkBuddy-app.exe）必须判为已启动', () => {
    const r = matchRunningClients(['Qoder CN.exe', 'WorkBuddy-app.exe', 'explorer.exe']);
    expect(r['qoder-cn']).toBe(true);
    expect(r['deepseek-harness']).toBe(true);
    expect(r.workbuddy).toBe(true);
    expect(r['claude-code']).toBe(false);
  });

  it('归一化不做子串：codex-windows-sandbox-service 不算 codex 在运行（避免误报已启动）', () => {
    const r = matchRunningClients(['codex-windows-sandbox-service.exe']);
    expect(r.codex).toBe(false);
  });

  it('normalizeProcessName：去 .exe / 小写 / 压空格', () => {
    expect(normalizeProcessName('Qoder CN.exe')).toBe('qoder cn');
    expect(normalizeProcessName('  WorkBuddy-APP.EXE ')).toBe('workbuddy-app');
    expect(normalizeProcessName('codex-windows-sandbox-service')).toBe('codex-windows-sandbox-service');
  });

  it('映射表包含所有已确认 exe 名的客户端（含 claude-code / codex）', () => {
    expect(Object.keys(CLIENT_PROCESS_NAMES).sort()).toEqual(
      ['claude-code', 'codex', 'cursor', 'deepseek-harness', 'qoder-cn', 'trae-cn', 'workbuddy', 'zcode'],
    );
  });
});

// 2026-11-22 启动提速：tasklist 同步耗时约 0.5s，10s 内复用缓存；空表不缓存（下次重试）。
describe('T6 · probeRunningClients 进程表缓存', () => {
  it('10s 内重复探测只调一次进程表；过期后重新探测', () => {
    resetProcessCache();
    let calls = 0;
    const lister = () => { calls += 1; return ['WorkBuddy.exe']; };
    expect(probeRunningClients({ now: 1_000, lister }).workbuddy).toBe(true);
    expect(probeRunningClients({ now: 5_000 }).workbuddy).toBe(true);
    expect(probeRunningClients({ now: 10_999 }).workbuddy).toBe(true);
    expect(calls).toBe(1);
    probeRunningClients({ now: 12_000, lister });
    expect(calls).toBe(2);
    resetProcessCache();
  });

  it('空表（tasklist 失败）不缓存，下次照常重试', () => {
    resetProcessCache();
    let calls = 0;
    const lister = () => { calls += 1; return []; };
    expect(probeRunningClients({ now: 1_000, lister })).toEqual({});
    expect(probeRunningClients({ now: 2_000, lister })).toEqual({});
    expect(calls).toBe(2);
    resetProcessCache();
  });
});
