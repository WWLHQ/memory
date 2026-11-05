// MCP 客户端 node 层单测（批次15）：临时 home 真读真写
// 覆盖：状态扫描（已接入/缺令牌/无配置/冲突/无法解析/需手工）、备份 + 原子写入、拒绝覆盖、令牌不外泄。
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MCP_ENDPOINT, expandHome, scanMcpClients, snippetForClient, wireMcpClient } from '../mcpClients.ts';

const TOKEN = 'node-token-xyz789';
const temps: string[] = [];

function tempHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'mam-mcpclients-'));
  temps.push(d);
  return d;
}
function write(home: string, rel: string, text: string): string {
  const path = join(home, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
  return path;
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function statusOf(home: string, id: string, opts: { currentToken?: string; recallEvidence?: readonly { ts: number; client?: unknown }[] } = {}) {
  // appData 也指到临时目录：隔离本机真实的 %APPDATA%/Trae CN/User/mcp.json
  return scanMcpClients({ home, appData: home, ...opts }).clients.find((c) => c.id === id)!;
}

describe('scanMcpClients', () => {
  test('无任何配置：所有客户端如实报告 no_config / manual，且不含令牌', () => {
    const home = tempHome();
    const scan = scanMcpClients({ home, appData: home });
    expect(scan.endpoint).toBe(MCP_ENDPOINT);
    expect(scan.clients.length).toBeGreaterThanOrEqual(10);

    const qoder = scan.clients.find((c) => c.id === 'qoder-cn')!;
    expect(qoder.state).toBe('no_config');
    expect(qoder.installed).toBe(false);
    expect(qoder.displayPath).toBe('~/.qoder-cn/settings.json');

    // 批次27：Trae CN 有稳定配置路径（%APPDATA%），临时 home/appData 下为 no_config
    const trae = scan.clients.find((c) => c.id === 'trae-cn')!;
    expect(trae.state).toBe('no_config');
    expect(trae.displayPath).toBe('%APPDATA%/Trae CN/User/mcp.json');
    expect(trae.path).toBe(join(home, 'Trae CN/User/mcp.json'));

    const dump = JSON.stringify(scan);
    expect(dump).not.toContain(TOKEN);
    expect(dump).not.toContain('Bearer ');
  });

  test('已接入 / 缺令牌 / 冲突 / 无法解析 按真实文件内容判定', () => {
    const home = tempHome();
    write(home, '.qoder-cn/settings.json', JSON.stringify({
      mcpServers: { 'MultiAgent Memory': { type: 'http', url: MCP_ENDPOINT, headers: { Authorization: `Bearer ${TOKEN}` } } },
    }));
    // Claude Code 实测缺陷复现：条目存在但没有 headers → 401
    write(home, '.claude.json', JSON.stringify({
      mcpServers: { memagent: { type: 'http', url: MCP_ENDPOINT } },
    }));
    write(home, '.cursor/mcp.json', JSON.stringify({
      mcpServers: { 'MultiAgent Memory': { url: 'http://127.0.0.1:9999/mcp' } },
    }));
    write(home, '.gemini/settings.json', '{bad');
    write(home, '.codex/config.toml', [
      '[mcp_servers.multiagent_memory]',
      `url = "${MCP_ENDPOINT}"`,
      `http_headers = { Authorization = "Bearer ${TOKEN}" }`,
      '',
    ].join('\n'));

    expect(statusOf(home, 'qoder-cn').state).toBe('wired');
    expect(statusOf(home, 'qoder-cn').hasAuth).toBe(true);
    expect(statusOf(home, 'qoder-cn').installed).toBe(true);

    expect(statusOf(home, 'claude-code').state).toBe('missing_auth');
    expect(statusOf(home, 'claude-code').hasAuth).toBe(false);

    const cursor = statusOf(home, 'cursor');
    expect(cursor.state).toBe('conflict');
    expect(cursor.foundUrl).toBe('http://127.0.0.1:9999/mcp');

    expect(statusOf(home, 'gemini-cli').state).toBe('invalid');
    expect(statusOf(home, 'gemini-cli').error).toBeTruthy();

    expect(statusOf(home, 'codex').state).toBe('wired');

    // 扫描结果（渲染层可见）绝不带令牌
    expect(JSON.stringify(scanMcpClients({ home, appData: home }))).not.toContain(TOKEN);
  });

  test('超过 8 MiB 的配置 → invalid（拒绝读写）', () => {
    const home = tempHome();
    const huge = `{"pad":"${'x'.repeat(8 * 1024 * 1024 + 10)}"}`;
    write(home, '.qoder-cn/settings.json', huge);
    const st = statusOf(home, 'qoder-cn');
    expect(st.state).toBe('invalid');
    expect(st.error).toContain('8 MiB');
  });
});

describe('snippetForClient', () => {
  test('JSON/TOML/手工 三种片段都含真实令牌（仅返回给调用方）', () => {
    expect(snippetForClient('qoder-cn', TOKEN)).toContain(`Bearer ${TOKEN}`);
    expect(snippetForClient('codex', TOKEN)).toContain('http_headers');
    expect(snippetForClient('trae-cn', TOKEN)).toContain(TOKEN);
    expect(() => snippetForClient('nope', TOKEN)).toThrow('未知 MCP 客户端');
  });
});

describe('wireMcpClient', () => {
  test('无配置 → 新建目录/文件并写入（无备份），扫描转为 wired', () => {
    const home = tempHome();
    const r = wireMcpClient('cursor', TOKEN, { home, now: Date.UTC(2026, 9, 30, 16, 0, 0) });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.path).toBe(join(home, '.cursor/mcp.json'));
    expect(r.backupPath).toBeUndefined();
    expect(existsSync(r.path!)).toBe(true);

    const text = readFileSync(r.path!, 'utf8');
    expect(text).toContain(`Bearer ${TOKEN}`);
    expect(statusOf(home, 'cursor').state).toBe('wired');
    // 返回值不含令牌
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });

  test('缺令牌 → 备份原文件后补齐 Authorization；再次执行幂等', () => {
    const home = tempHome();
    const original = JSON.stringify({ mcpServers: { memagent: { type: 'http', url: MCP_ENDPOINT } } }, null, 2);
    const path = write(home, '.claude.json', original);

    const r = wireMcpClient('claude-code', TOKEN, { home, now: Date.UTC(2026, 9, 30, 16, 30, 0) });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeTruthy();
    expect(readFileSync(r.backupPath!, 'utf8')).toBe(original);
    expect(statusOf(home, 'claude-code').state).toBe('wired');

    const again = wireMcpClient('claude-code', TOKEN, { home });
    expect(again).toMatchObject({ ok: true, changed: false, path });
    const backups = readdirSync(home).filter((f) => f.startsWith('.claude.json.bak-'));
    expect(backups).toHaveLength(1); // 幂等：不重复备份
  });

  test('同名条目指向其它端点 → 拒绝写入，文件保持原样', () => {
    const home = tempHome();
    const original = JSON.stringify({ mcpServers: { 'MultiAgent Memory': { url: 'http://other/mcp' } } });
    const path = write(home, '.cursor/mcp.json', original);
    const r = wireMcpClient('cursor', TOKEN, { home });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('拒绝覆盖');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  test('无法解析 → 拒绝写入，绝不改坏文件', () => {
    const home = tempHome();
    write(home, '.qoder-cn/settings.json', '{bad');
    const r = wireMcpClient('qoder-cn', TOKEN, { home });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('无法解析');
    expect(readFileSync(join(home, '.qoder-cn/settings.json'), 'utf8')).toBe('{bad');
  });

  test('TOML 客户端（Codex）：无配置 → 新建并写入；缺令牌 → 备份后补齐；幂等', () => {
    const home = tempHome();
    const first = wireMcpClient('codex', TOKEN, { home, now: Date.UTC(2026, 9, 30, 16, 0, 0) });
    expect(first.ok).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.path).toBe(join(home, '.codex/config.toml'));
    expect(first.backupPath).toBeUndefined();
    expect(statusOf(home, 'codex').state).toBe('wired');
    expect(JSON.stringify(first)).not.toContain(TOKEN);

    const again = wireMcpClient('codex', TOKEN, { home });
    expect(again).toMatchObject({ ok: true, changed: false });
  });

  test('TOML 已有其它段/缺 Authorization → 备份后只补本段，其它配置不动', () => {
    const home = tempHome();
    const original = ['model = "gpt-5"', '', '[mcp_servers.multiagent_memory]', `url = "${MCP_ENDPOINT}"`, '', '[other]', 'key = "keep"', ''].join('\n');
    const path = write(home, '.codex/config.toml', original);
    const r = wireMcpClient('codex', TOKEN, { home, now: Date.UTC(2026, 9, 30, 17, 0, 0) });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeTruthy();
    expect(readFileSync(r.backupPath!, 'utf8')).toBe(original);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain('[other]\nkey = "keep"');
    expect(statusOf(home, 'codex').state).toBe('wired');
  });

  test('TOML 同名段指向其它端点 → 拒绝写入，文件保持原样', () => {
    const home = tempHome();
    const original = '[mcp_servers.multiagent_memory]\nurl = "http://other/mcp"\n';
    const path = write(home, '.codex/config.toml', original);
    const r = wireMcpClient('codex', TOKEN, { home });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('拒绝覆盖');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  test('无稳定配置路径客户端 → 拒绝自动写入（诚实提示手工；deepseek-harness 宿主继承委托见 28-B 组）', () => {
    const home = tempHome();
    expect(wireMcpClient('zcode', TOKEN, { home })).toMatchObject({ ok: false });
  });
});

// ── 批次26-B P2-15：备份含明文令牌，最多保留 3 份，旧份自动清理；不留 .tmp 残留 ──
describe('wireMcpClient P2-15 备份清理', () => {
  test('连续 5 次写入 → 只保留最新 3 份备份，无 .tmp 残留', () => {
    const home = tempHome();
    for (let i = 0; i < 5; i++) {
      // 每轮把文件退回「缺令牌」状态，迫使 wire 重新备份 + 写入
      write(home, '.claude.json', JSON.stringify({ mcpServers: { memagent: { type: 'http', url: MCP_ENDPOINT } } }));
      const r = wireMcpClient('claude-code', TOKEN, { home, now: Date.UTC(2026, 9, 30, 16, i, 0) });
      expect(r.ok).toBe(true);
      expect(r.changed).toBe(true);
    }
    const backups = readdirSync(home).filter((f) => f.startsWith('.claude.json.bak-')).sort();
    expect(backups).toHaveLength(3);
    // 保留的是时间戳最新的 3 份（最旧两份已被清理）
    expect(backups[0]).toContain('2026-10-30T16-02');
    expect(backups[2]).toContain('2026-10-30T16-04');
    expect(readdirSync(home).some((f) => f.includes('.tmp-'))).toBe(false);
  });
});

// ── 批次27：用户验收反馈「一键适配全部只出片段没真接入」——
// ① Trae CN 实机确认稳定配置 %APPDATA%/Trae CN/User/mcp.json，升级为可自动写入；
// ② 「已接入」须校验配置内令牌与当前 mcp-token.txt 一致，过期降级 missing_auth 让一键适配修复。
describe('批次27 Trae CN 真写', () => {
  test('%APPDATA% 路径展开', () => {
    expect(expandHome('%APPDATA%/Trae CN/User/mcp.json', '/h', '/a')).toBe(join('/a', 'Trae CN/User/mcp.json'));
    expect(expandHome('~/.x', '/h', '/a')).toBe(join('/h', '.x'));
  });

  test('Trae：已有其它服务器 → missing_entry；一键写入保留原条目并补本服务；复扫 wired', () => {
    const home = tempHome();
    const traeDir = join(home, 'Trae CN', 'User');
    mkdirSync(traeDir, { recursive: true });
    const original = JSON.stringify({ mcpServers: { 'mcp-obsidian': { command: 'npx', args: ['-y', 'obsidian-mcp'] } } }, null, 2);
    writeFileSync(join(traeDir, 'mcp.json'), original, 'utf8');

    expect(statusOf(home, 'trae-cn').state).toBe('missing_entry');
    expect(statusOf(home, 'trae-cn').installed).toBe(true);

    const r = wireMcpClient('trae-cn', TOKEN, { home, appData: home, now: Date.UTC(2026, 9, 31, 10, 0, 0) });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeTruthy();
    expect(readFileSync(r.backupPath!, 'utf8')).toBe(original);
    expect(JSON.stringify(r)).not.toContain(TOKEN);

    const text = readFileSync(join(traeDir, 'mcp.json'), 'utf8');
    const parsed = JSON.parse(text) as { mcpServers: Record<string, { url?: string; command?: string; headers?: Record<string, string> }> };
    expect(parsed.mcpServers['mcp-obsidian'].command).toBe('npx'); // 其它条目原样保留
    expect(parsed.mcpServers['MultiAgent Memory'].url).toBe(MCP_ENDPOINT);
    expect(parsed.mcpServers['MultiAgent Memory'].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(statusOf(home, 'trae-cn').state).toBe('wired');
  });

  test('Trae：同名条目指向其它端点 → 拒绝覆盖', () => {
    const home = tempHome();
    const original = JSON.stringify({ mcpServers: { 'MultiAgent Memory': { url: 'http://other/mcp' } } });
    const path = write(home, 'Trae CN/User/mcp.json', original);
    const r = wireMcpClient('trae-cn', TOKEN, { home, appData: home });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('拒绝覆盖');
    expect(readFileSync(path, 'utf8')).toBe(original);
  });
});

// ── 批次28-B/28-D：三个客户端的再审查 ——
// ① WorkBuddy：28-D 实机确认稳定配置 ~/.workbuddy/mcp.json（应用内编辑器直显该路径）→ 升级可写（备份+合并）；
// ② deepseek harness：无独立配置面，MCP 随宿主 Qoder 下发 → inheritsFrom，一键接入委托宿主真实写入；
// ③ Zcode：配置存应用内部存储（表单/JSON 两种方式，无文件路径）→ 保持手工指引（诚实，不伪造）。
describe('批次28-B/28-D 三客户端再审查', () => {
  test('WorkBuddy：~/.workbuddy/mcp.json 按内容判定状态；一键写入备份+合并保留其它条目，复扫 wired', () => {
    const home = tempHome();
    expect(statusOf(home, 'workbuddy').state).toBe('no_config');

    const original = JSON.stringify({ mcpServers: { 'wb-other': { command: 'npx', args: ['-y', 'wb-mcp'] } } }, null, 2);
    write(home, '.workbuddy/mcp.json', original);
    expect(statusOf(home, 'workbuddy', { currentToken: TOKEN }).state).toBe('missing_entry');
    expect(statusOf(home, 'workbuddy').path).toContain(join('.workbuddy', 'mcp.json'));

    const r = wireMcpClient('workbuddy', TOKEN, { home, now: Date.UTC(2026, 9, 31, 14, 0, 0) });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeTruthy();
    expect(readFileSync(r.backupPath!, 'utf8')).toBe(original);
    expect(JSON.stringify(r)).not.toContain(TOKEN);

    const parsed = JSON.parse(readFileSync(join(home, '.workbuddy', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { type?: string; url?: string; command?: string; headers?: Record<string, string> }>;
    };
    expect(parsed.mcpServers['wb-other'].command).toBe('npx'); // 其它条目原样保留
    expect(parsed.mcpServers['MultiAgent Memory'].type).toBe('http');
    expect(parsed.mcpServers['MultiAgent Memory'].url).toBe(MCP_ENDPOINT);
    expect(parsed.mcpServers['MultiAgent Memory'].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(statusOf(home, 'workbuddy', { currentToken: TOKEN }).state).toBe('wired');

    // 同名条目指向其它端点 → 拒绝覆盖
    const conflict = wireMcpClient('workbuddy', TOKEN, {
      home: (() => {
        const h = tempHome();
        write(h, '.workbuddy/mcp.json', JSON.stringify({ mcpServers: { 'MultiAgent Memory': { type: 'http', url: 'http://other/mcp' } } }));
        return h;
      })(),
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toContain('拒绝覆盖');
  });

  test('deepseek harness：宿主 Qoder 已接入 → 如实 wired；宿主未接入 → 指引一键适配宿主', () => {
    const home = tempHome();
    expect(statusOf(home, 'deepseek-harness').state).toBe('manual');
    expect(statusOf(home, 'deepseek-harness').note).toContain('尚未接入');

    write(home, '.qoder-cn/settings.json', JSON.stringify({
      mcpServers: { 'MultiAgent Memory': { type: 'http', url: MCP_ENDPOINT, headers: { Authorization: `Bearer ${TOKEN}` } } },
    }));
    const dsh = statusOf(home, 'deepseek-harness', { currentToken: TOKEN });
    expect(dsh.state).toBe('wired');
    expect(dsh.hasAuth).toBe(true);
    expect(dsh.note).toContain('Qoder');
  });

  test('deepseek harness 一键接入 = 委托宿主 qoder-cn 真实写入（备份 + 合并），复扫两者 wired', () => {
    const home = tempHome();
    write(home, '.qoder-cn/settings.json', JSON.stringify({ theme: 'dark', mcpServers: {} }));

    const r = wireMcpClient('deepseek-harness', TOKEN, { home, appData: home, currentToken: TOKEN, now: Date.UTC(2026, 9, 31, 12, 0, 0) });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.backupPath).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain(TOKEN);

    const parsed = JSON.parse(readFileSync(join(home, '.qoder-cn', 'settings.json'), 'utf8')) as {
      theme?: string;
      mcpServers: Record<string, { url?: string; headers?: Record<string, string> }>;
    };
    expect(parsed.theme).toBe('dark'); // 宿主其它配置原样保留
    expect(parsed.mcpServers['MultiAgent Memory']?.url).toBe(MCP_ENDPOINT);
    expect(statusOf(home, 'qoder-cn', { currentToken: TOKEN }).state).toBe('wired');
    expect(statusOf(home, 'deepseek-harness', { currentToken: TOKEN }).state).toBe('wired');
  });

  test('Zcode：应用内部存储（表单/JSON）无文件面 → 保持手工（不伪造接入）', () => {
    const home = tempHome();
    const z = statusOf(home, 'zcode');
    expect(z.writable).toBe(false);
    expect(z.state).toBe('manual');
  });
});

describe('批次27 令牌过期检测（防假「已接入」）', () => {
  test('配置内令牌 ≠ 当前令牌 → 降级 missing_auth 并提示可修复；一键写入补齐后复扫 wired', () => {
    const home = tempHome();
    write(home, '.qoder-cn/settings.json', JSON.stringify({
      mcpServers: { 'MultiAgent Memory': { type: 'http', url: MCP_ENDPOINT, headers: { Authorization: 'Bearer stale-token' } } },
    }));

    // 不传 currentToken（旧口径）：仍报 wired；传了才校验
    expect(statusOf(home, 'qoder-cn').state).toBe('wired');
    const stale = statusOf(home, 'qoder-cn', { currentToken: TOKEN });
    expect(stale.state).toBe('missing_auth');
    expect(stale.hasAuth).toBe(true);
    expect(stale.note).toContain('不一致');
    expect(JSON.stringify(stale)).not.toContain('stale-token');

    const r = wireMcpClient('qoder-cn', TOKEN, { home, currentToken: TOKEN });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(statusOf(home, 'qoder-cn', { currentToken: TOKEN }).state).toBe('wired');
  });

  test('配置内令牌与当前一致 → 保持 wired（不误报）', () => {
    const home = tempHome();
    write(home, '.codex/config.toml', [
      '[mcp_servers.multiagent_memory]',
      `url = "${MCP_ENDPOINT}"`,
      `http_headers = { Authorization = "Bearer ${TOKEN}" }`,
      '',
    ].join('\n'));
    expect(statusOf(home, 'codex', { currentToken: TOKEN }).state).toBe('wired');
  });
});

describe('applyRecallEvidence（批次30：审计证据升级）', () => {
  test('configPath 为 null 的 Zcode：manual + 真实调用审计 → wired（以审计为准）', () => {
    const home = tempHome();
    mkdirSync(join(home, '.zcode'), { recursive: true });
    const zc = statusOf(home, 'zcode', {
      recallEvidence: [{ ts: Date.now(), client: 'zcode/0.16.9' }],
    });
    expect(zc.state).toBe('wired');
    expect(zc.hasAuth).toBe(true);
    expect(zc.note).toContain('审计检测到真实调用 1 次');
    expect(zc.note).toContain('以审计为准');
  });

  test('调用方名不匹配（UA 兜底串 / 未知客户端）不升级', () => {
    const home = tempHome();
    const zc = statusOf(home, 'zcode', {
      recallEvidence: [{ ts: Date.now(), client: 'Cursor (UA)' }, { ts: Date.now(), client: 'unknown-agent/1.0' }],
    });
    expect(zc.state).toBe('manual');
  });

  test('conflict / invalid：文件真实存在但有错 → 审计不替代修复，保持原状', () => {
    const home = tempHome();
    write(home, '.qoder-cn/settings.json', JSON.stringify({
      mcpServers: { 'MultiAgent Memory': { type: 'http', url: 'http://127.0.0.1:9999/mcp' } },
    }));
    const q = statusOf(home, 'qoder-cn', {
      recallEvidence: [{ ts: Date.now(), client: 'qoder/1.0' }],
    });
    expect(q.state).toBe('conflict');
  });

  test('deepseek harness：auditClientIds 命中 dsh-mcp-client → 即使宿主未接入也升级 wired', () => {
    const home = tempHome();
    mkdirSync(join(home, '.dsh'), { recursive: true });
    const dsh = statusOf(home, 'deepseek-harness', {
      recallEvidence: [{ ts: Date.now(), client: 'dsh-mcp-client/0.0.1' }],
    });
    expect(dsh.state).toBe('wired');
    expect(dsh.note).toContain('审计检测到真实调用');
  });

  test('无证据 / 空数组：完全不影响原判定', () => {
    const home = tempHome();
    expect(statusOf(home, 'zcode').state).toBe('manual');
    expect(statusOf(home, 'zcode', { recallEvidence: [] }).state).toBe('manual');
  });
});

// 批次41-X：显式身份头 X-Memagent-Client —— 一键接入写入、扫描如实报告、缺头可补写。
// 这一条消除的是 41-S 方案 B 的残留：通用 UA（Node/Electron 都发 `node`）上「最后一次 initialize 赢」
// 会把甲客户端的调用记到乙名下（连带把乙升级成「已接入」以及发错展示档位）。
describe('批次41-X 显式身份头（写入 + 检出 + 补写）', () => {
  const HEADER = 'X-Memagent-Client';

  function jsonEntry(withHeader: boolean, token = TOKEN): Record<string, unknown> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (withHeader) headers[HEADER] = 'qoder-cn';
    return { type: 'http', url: MCP_ENDPOINT, headers };
  }

  test('老配置（有令牌、无身份头）→ 仍 wired，但 hasClientId=false 且给出「补身份头」说明', () => {
    const home = tempHome();
    write(home, '.qoder-cn/settings.json', JSON.stringify({ mcpServers: { 'MultiAgent Memory': jsonEntry(false) } }));
    const q = statusOf(home, 'qoder-cn', { currentToken: TOKEN });
    expect(q.state).toBe('wired');
    expect(q.hasClientId).toBe(false);
    expect(q.note).toContain(HEADER);
    expect(q.note).toContain('补身份头');
  });

  test('41-X 之后写入的配置 → hasClientId=true，不再提示补写', () => {
    const home = tempHome();
    write(home, '.qoder-cn/settings.json', JSON.stringify({ mcpServers: { 'MultiAgent Memory': jsonEntry(true) } }));
    const q = statusOf(home, 'qoder-cn', { currentToken: TOKEN });
    expect(q.state).toBe('wired');
    expect(q.hasClientId).toBe(true);
    expect(q.note ?? '').not.toContain('补身份头');
  });

  test('对「已接入但缺身份头」执行一键接入 → 备份后补写该头，复扫 hasClientId=true 且令牌不动', () => {
    const home = tempHome();
    const path = write(home, '.qoder-cn/settings.json', JSON.stringify({ mcpServers: { 'MultiAgent Memory': jsonEntry(false) } }, null, 2));
    const r = wireMcpClient('qoder-cn', TOKEN, { home, appData: home, currentToken: TOKEN });
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.backupPath && existsSync(r.backupPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, { headers: Record<string, string> }> };
    const headers = parsed.mcpServers['MultiAgent Memory'].headers;
    expect(headers[HEADER]).toBe('qoder-cn');
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(statusOf(home, 'qoder-cn', { currentToken: TOKEN }).hasClientId).toBe(true);
    // 幂等：再点一次不重复写盘
    const again = wireMcpClient('qoder-cn', TOKEN, { home, appData: home, currentToken: TOKEN });
    expect(again.changed).toBe(false);
  });

  test('TOML（Codex）：已有 Authorization 缺身份头 → 补写该头且保留原有头，复扫 hasClientId=true', () => {
    const home = tempHome();
    const path = write(home, '.codex/config.toml', [
      'model = "gpt-5"',
      '',
      '[mcp_servers.multiagent_memory]',
      `url = "${MCP_ENDPOINT}"`,
      'http_headers = { "X-Custom" = "1", Authorization = "Bearer old" }',
      '',
    ].join('\n'));
    const before = statusOf(home, 'codex');
    expect(before.state).toBe('wired');
    expect(before.hasClientId).toBe(false);
    const r = wireMcpClient('codex', TOKEN, { home, appData: home, currentToken: TOKEN });
    expect(r.ok).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain(`${HEADER} = "codex"`);
    expect(text).toContain('"X-Custom" = "1"');
    expect(text.match(new RegExp(TOKEN, 'g'))).toHaveLength(1);
    expect(statusOf(home, 'codex').hasClientId).toBe(true);
  });

  test('审计证据升级来的 wired（Zcode 无文件面）→ 身份头无从判定，留 undefined（不谎报缺/有）', () => {
    const home = tempHome();
    const zc = statusOf(home, 'zcode', { recallEvidence: [{ ts: Date.now(), client: 'zcode/0.16.9' }] });
    expect(zc.state).toBe('wired');
    expect(zc.hasClientId).toBeUndefined();
  });
});
