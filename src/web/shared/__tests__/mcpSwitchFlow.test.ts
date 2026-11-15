// T4 回归加固 · 客户端 MCP 开关「三层闭环」端到端。
// 真读真写临时 home（与 electron/mcpClients.test.ts 同口径），把 T1 检测 / T2 一键 / T3 派生
// 三层的真实模块串起来，证明整条链路真的闭环，而不是各层单测各自绿。
//
// 重点回归的诚实边界：一键后**文件确实被清掉禁用标记**（复扫 disabled 消失、state 仍 wired），
// 但运行中的客户端尚未重读配置 —— UI 必须显示「待生效」而非跳绿「已接入」。
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MCP_ENDPOINT, scanMcpClients, enableMcpClient } from '../../../electron/mcpClients.ts';
import { deriveMcpSwitch } from '../mcpSwitch.ts';

const TOKEN = 'test-token-not-real';
const homes: string[] = [];

function tempHome(): string {
  const h = mkdtempSync(join(tmpdir(), 'mcp-switch-flow-'));
  homes.push(h);
  return h;
}

afterEach(() => {
  for (const h of homes) {
    try { rmSync(h, { recursive: true, force: true }); } catch { /* 已清理 */ }
  }
  homes.length = 0;
});

/** 与 electron 测试同形态的 WorkBuddy mcp.json：含一条已禁用 / 未禁用的本服务条目 */
function wbConfig(disabled?: unknown): string {
  const entry: Record<string, unknown> = {
    type: 'http', url: MCP_ENDPOINT,
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Memagent-Client': 'workbuddy' },
    keepMe: 'preserve',
  };
  if (disabled !== undefined) entry.disabled = disabled;
  return `${JSON.stringify({
    version: 1,
    mcpServers: {
      'wb-other': { command: 'npx', args: ['-y', 'wb-mcp'] },
      'MultiAgent Memory': entry,
    },
  }, null, 2)}\n`;
}

function writeWb(home: string, text: string): void {
  const dir = join(home, '.workbuddy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'mcp.json'), text, 'utf8');
}

/** 对齐 web 层 loadMcpPanel 的映射口径：只取 id + 显式 true 的 disabled */
function toWebRows(home: string) {
  return scanMcpClients({ home, appData: home }).clients
    .map((c) => ({ id: c.id, disabled: c.disabled === true ? true : undefined }));
}

describe('T4 回归加固 · 三层闭环（检测→派生→一键→复扫→诚实待生效）', () => {
  it('禁用配置：扫描带 disabled → 派生 off 且可一键；一键后文件真的干净（复扫→ok），但 UI 须显示待生效不跳绿', () => {
    const home = tempHome();
    writeWb(home, wbConfig(true));

    // ① 检测层（T1）：扫描确读到显式禁用的标记
    const scan = scanMcpClients({ home, appData: home });
    const wb = scan.clients.find((c) => c.id === 'workbuddy');
    expect(wb?.disabled).toBe(true);

    // ② 展示层（T3）：web 映射后派生 —— 服务端在线 + 确读到已禁用 → off，且能一键
    const off = deriveMcpSwitch({ healthOk: true, mcpOk: true, clients: toWebRows(home), pending: false });
    expect(off.view).toBe('off');
    expect(off.canEnable).toBe(true);
    expect(off.enableId).toBe('workbuddy');

    // ③ 一键层（T2）：只清标记（真实写盘）
    const r = enableMcpClient('workbuddy', { home, appData: home });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);

    // ④ 复扫：文件**确实**干净（证明一键是真改文件，不是嘴上说）
    const after = scanMcpClients({ home, appData: home });
    const wbAfter = after.clients.find((c) => c.id === 'workbuddy');
    expect(wbAfter?.disabled).toBeUndefined();
    expect(wbAfter?.state).toBe('wired');

    // ⑤ 诚实边界：文件虽干净，但运行中的客户端尚未重读 → UI 不跳绿
    const reRows = toWebRows(home);
    expect(deriveMcpSwitch({ healthOk: true, mcpOk: true, clients: reRows, pending: false }).view).toBe('ok');
    // 一键后 UI 置 pending → 仍显示「待生效」，绝不谎称「已接入」
    expect(deriveMcpSwitch({ healthOk: true, mcpOk: true, clients: reRows, pending: true }).view).toBe('pending');
  });

  it('一键是幂等的：已无禁用标记时再点一键 → changed:false、不写盘、不产生备份', () => {
    const home = tempHome();
    writeWb(home, wbConfig(true));
    expect(enableMcpClient('workbuddy', { home, appData: home }).changed).toBe(true);

    const fileBefore = readFileSync(join(home, '.workbuddy', 'mcp.json'), 'utf8');
    const second = enableMcpClient('workbuddy', { home, appData: home });
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeUndefined();
    expect(readFileSync(join(home, '.workbuddy', 'mcp.json'), 'utf8')).toBe(fileBefore);
  });

  it('其它字段 / 其它客户端 / 顶层键在清标记后逐字保留（一键不破坏配置）', () => {
    const home = tempHome();
    const original = wbConfig(true);
    writeWb(home, original);
    enableMcpClient('workbuddy', { home, appData: home });

    const parsed = JSON.parse(readFileSync(join(home, '.workbuddy', 'mcp.json'), 'utf8')) as {
      version: number; mcpServers: Record<string, Record<string, unknown>>;
    };
    const entry = parsed.mcpServers['MultiAgent Memory'];
    expect(entry).not.toHaveProperty('disabled');        // 只删了标记
    expect(entry.type).toBe('http');
    expect(entry.url).toBe(MCP_ENDPOINT);
    expect(entry.keepMe).toBe('preserve');               // 条目其它字段保留
    expect(parsed.mcpServers['wb-other']).toEqual({ command: 'npx', args: ['-y', 'wb-mcp'] }); // 其它客户端保留
    expect(parsed.version).toBe(1);                      // 顶层键保留
  });

  it('服务端离线优先于已禁用：即使读到 disabled 也只显示 down 且不可一键', () => {
    const home = tempHome();
    writeWb(home, wbConfig(true));
    const s = deriveMcpSwitch({ healthOk: false, mcpOk: true, clients: toWebRows(home), pending: false });
    expect(s.view).toBe('down');
    expect(s.canEnable).toBe(false);
  });

  it('读不到配置（mcpOk=false）→ unknown，不冒充已连接', () => {
    const s = deriveMcpSwitch({ healthOk: true, mcpOk: false, clients: [], pending: false });
    expect(s.view).toBe('unknown');
    expect(s.canEnable).toBe(false);
  });
});
