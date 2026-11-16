// D1/D2 接入契约（2026-11-16 单拎修复）：
//  D1 = MCP 指令去环：不再让 Agent「多项目时先 list_projects 并向用户确认」（严格门禁下会硬拦），
//       改为「首步必须先 recall_memory + 本机默认业务项目 P1」。零内核改动，文案必须诚实。
//  D2 = 接入配方下发的 project_id 与内核真机账本逐字一致（大写 'P1'），
//       小写 'p1' 会静默写/查一个不存在的项目。badge 'p1' 是优先级徽标，与本契约无关，禁止误改。
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_INSTRUCTIONS, MCP_TOOLS } from '../../../core/memagent/mcpSchema.ts';
import { toServiceInput } from '../useBackendMirror.ts';
import type { UiAgentCard } from '../../../types/agentOnboard.ts';

function projectIdDesc(toolName: string): string {
  const tool = MCP_TOOLS.find((t) => t.name === toolName);
  const props = tool!.inputSchema.properties as unknown as Record<string, { description?: string }>;
  return props.project_id.description ?? '';
}

describe('D1 · MCP 指令去环（路径 A：纯文案，不改内核）', () => {
  it('不再指引「有多个项目时先调用 list_projects 并向用户确认」（该指引在严格门禁下必被硬拦）', () => {
    expect(MCP_INSTRUCTIONS).not.toContain('有多个项目时先调用 list_projects 并向用户确认');
    expect(MCP_INSTRUCTIONS).not.toContain('写入前如不确定项目，先 list_projects');
  });

  it('明确「本机默认业务项目 P1」+「首步必须先 recall_memory」+「切勿首步召回前先调 list_projects」', () => {
    expect(MCP_INSTRUCTIONS).toContain('本机默认业务项目 P1');
    expect(MCP_INSTRUCTIONS).toContain('必须先调用 recall_memory');
    expect(MCP_INSTRUCTIONS).toContain('切勿在首步召回前先调 list_projects');
  });

  it('recall_memory / write_memory 的 project_id 字段描述均含 P1，且不再写「先 list_projects」误导', () => {
    const recall = projectIdDesc('recall_memory');
    const write = projectIdDesc('write_memory');
    expect(recall).toContain('P1');
    expect(write).toContain('P1');
    // recall 旧文案「多项目时先 list_projects」、write 旧文案「可先 list_projects 查询」都已去环
    expect(recall).not.toContain('多项目时先 list_projects');
    expect(write).not.toContain('可先 list_projects 查询');
    // 去环后仍保留「首步召回后」的正确顺序口径
    expect(write).toContain('首步召回后');
  });

  it('既有回显契约关键词不受文案去环影响（回归护栏）', () => {
    expect(MCP_INSTRUCTIONS).toContain('优先调用');
    expect(MCP_INSTRUCTIONS).toContain('回退');
    expect(MCP_INSTRUCTIONS).toContain('display.markdown');
    expect(MCP_INSTRUCTIONS).toContain('就地标注 [n]');
  });
});

describe('D2 · 渲染层镜像下发 project_id 与内核账本逐字一致', () => {
  it('toServiceInput 产出 recall_memory / write_memory.project_id 均为大写 P1', () => {
    // 只放 toServiceInput 实际读取的字段；badge 故意用小写 'p1'（优先级徽标，非 project_id）
    const ui = {
      name: 'Claude Code', badge: 'p1', circuit: 'CLOSED',
      tools: { recall: { scene: 'default', mode: null, topk: 5 } },
      chan: { webhook: true, api: true },
    } as unknown as UiAgentCard;
    const input = toServiceInput(ui);
    expect(input.mcpTools!.recall_memory!.project_id).toBe('P1');
    expect(input.mcpTools!.write_memory!.project_id).toBe('P1');
  });

  it('优先级 badge 大小写与 project_id 互不影响：toServiceInput 的 priority 取 badge 大写，project_id 恒 P1', () => {
    const ui = {
      name: 'Claude Code', badge: 'p1', circuit: 'CLOSED',
      tools: { recall: { scene: 'default', mode: null, topk: 5 } },
      chan: { webhook: true, api: true },
    } as unknown as UiAgentCard;
    const input = toServiceInput(ui);
    expect(input.priority).toBe('P1');
    expect(input.mcpTools!.recall_memory!.project_id).toBe('P1');
  });
});

// ── D2 全仓统一护栏：源码里不得再出现「project_id 赋值为小写」──
// 只约束 project_id 值；badge 'p1' / CSS .badge.p1 / mem_id / request_id 等其它语义不受影响。
describe('D2 · 全仓 project_id 字面量统一（回归护栏）', () => {
  // __tests__ → AgentOnboard → web → src
  const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  // 拼接构造，避免本文件自身含被检测字面量而自命中；并显式豁免自身。
  const NEEDLE = new RegExp('project_id' + "\\s*:\\s*['\"]p1['\"]");

  function walk(dir: string, out: string[] = []): string[] {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs|js|jsx)$/.test(ent.name)) out.push(p);
    }
    return out;
  }

  it('src/ 下任何源码都不得把 project_id 写成小写 p1', () => {
    const self = fileURLToPath(import.meta.url);
    const files = walk(SRC_ROOT).filter((f) => resolve(f) !== resolve(self));
    // 防假绿：SRC_ROOT 若算错会扫成空集，断言必须确认真的覆盖了源码树。
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((f) => NEEDLE.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC_ROOT, f).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
