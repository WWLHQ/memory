// 宿主真扫（discover 真实化）· 纯匹配层单测：进程/MCP 指纹归并 + 去重优先级。
// 不依赖 node IO（listProcessNames/detectMcpEntries 在 electron 层），本文件只测纯函数。
import { describe, expect, it } from 'vitest';
import {
  matchAgentsFromProcesses,
  matchAgentsFromMcp,
  matchAgentsFromConfigFiles,
  mergeHostAgents,
  AGENT_FINGERPRINTS,
} from '../hostScan.ts';

describe('hostScan 纯匹配（宿主真扫 → agent 指纹）', () => {
  it('真实进程表命中已知 agent（如 Claude Code 的 node 宿主 + deepseek）', () => {
    const found = matchAgentsFromProcesses(['node.exe', 'claude-code', 'deepseek-harness', 'chrome.exe']);
    // 按指纹 p0→p3 顺序命中：deepseek(p0) 在前、Claude(p1) 在后
    expect(found.map((f) => f.name)).toEqual(['deepseek harness', 'Claude Code']);
    // 命中项必须带真实来源（可溯源），不造假
    expect(found.every((f) => f.source.length > 0)).toBe(true);
    expect(found[0].badge).toBe('p0');
    expect(found[1].badge).toBe('p1');
  });

  it('无命中 → 空数组（绝不造假 agent）', () => {
    expect(matchAgentsFromProcesses(['chrome.exe', 'notepad.exe'])).toEqual([]);
    expect(matchAgentsFromProcesses([])).toEqual([]);
  });

  it('MCP 配置命中按 mcp: 前缀溯源', () => {
    const found = matchAgentsFromMcp(['codex-mcp', 'deepseek']);
    expect(found.map((f) => [f.name, f.signal])).toEqual([
      ['deepseek harness', 'mcp'],
      ['Codex', 'mcp'],
    ]);
  });

  it('merge 去重：同名 agent proc 优先于 mcp，badge 升序', () => {
    const procHits = matchAgentsFromProcesses(['claude-code']);
    const mcpHits = matchAgentsFromMcp(['claude', 'codex']);
    const merged = mergeHostAgents(procHits, mcpHits);
    // Claude 同名 → 仅保留 proc 来源（proc 优先）
    const claude = merged.find((m) => m.name === 'Claude Code')!;
    expect(claude.signal).toBe('proc');
    // 去重后唯一
    expect(merged.filter((m) => m.name === 'Claude Code')).toHaveLength(1);
    // badge 升序（p1 Claude 在前，p2 Codex 在后）
    expect(merged[0].name).toBe('Claude Code');
    expect(merged[1].name).toBe('Codex');
  });

  it('已知指纹 12 个（MVP 4 + 扩展 8），MVP 顺序 p0/p1/p2/p3 在前', () => {
    expect(AGENT_FINGERPRINTS).toHaveLength(12);
    expect(AGENT_FINGERPRINTS.slice(0, 4).map((f) => f.badge)).toEqual(['p0', 'p1', 'p2', 'p3']);
    // 扩展指纹全为 P3（WorkBuddy / Gemini CLI / Qwen Code / Amp / iFlow CLI / Qoder CN / Trae Code CN / Zcode）
    expect(AGENT_FINGERPRINTS.slice(4).every((f) => f.badge === 'p3')).toBe(true);
    expect(['WorkBuddy', 'Gemini CLI', 'Qwen Code', 'Amp', 'iFlow CLI', 'Qoder CN', 'Trae Code CN', 'Zcode'])
      .toEqual(AGENT_FINGERPRINTS.slice(4).map((f) => f.name));
  });

  it('配置文件命中（spawn 被拦截时的兜底真扫路）：按 config: 前缀溯源', () => {
    const found = matchAgentsFromConfigFiles([
      'C:\\Users\\me\\.claude.json',
      'C:\\Users\\me\\.codex',
      'C:\\Users\\me\\.cursor',
    ]);
    expect(found.map((f) => [f.name, f.signal])).toEqual([
      ['Claude Code', 'config'],
      ['Codex', 'config'],
      ['Cursor', 'config'],
    ]);
    expect(found[0].source).toContain('config:');
  });

  it('配置文件无命中 → 空数组（不造假）', () => {
    expect(matchAgentsFromConfigFiles(['C:\\Users\\me\\Documents\\notes.txt'])).toEqual([]);
    expect(matchAgentsFromConfigFiles([])).toEqual([]);
  });

  it('merge 三路：proc 优先于 mcp 优先于 config', () => {
    const procHits = matchAgentsFromProcesses(['claude-code']);
    const mcpHits = matchAgentsFromMcp(['claude']);
    const cfgHits = matchAgentsFromConfigFiles(['C:\\Users\\me\\.claude.json']);
    const merged = mergeHostAgents(procHits, mcpHits, cfgHits);
    const claude = merged.find((m) => m.name === 'Claude Code')!;
    expect(claude.signal).toBe('proc'); // proc 优先
    expect(merged.filter((m) => m.name === 'Claude Code')).toHaveLength(1);
  });

  it('merge 仅 config 路（spawn 全被拦截）时仍能给出真实 agent', () => {
    const merged = mergeHostAgents([], [], matchAgentsFromConfigFiles(['/home/me/.claude.json', '/home/me/.codex']));
    expect(merged.map((m) => m.name)).toEqual(['Claude Code', 'Codex']);
    expect(merged.every((m) => m.signal === 'config')).toBe(true);
  });
});
