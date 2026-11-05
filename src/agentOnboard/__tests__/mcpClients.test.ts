// MCP 客户端配方纯函数单测（批次15）：片段生成 / 真实状态探测 / JSON 合并
// 覆盖正常、拒绝（冲突/无法解析/不支持）与边界（大小写头、TOML 子表、未变化不重写）。
import { describe, expect, test } from 'vitest';
import {
  MCP_CLIENT_SPECS, MCP_ENDPOINT, buildMcpEntry, mergeMcpJsonConfig, mergeMcpTomlConfig,
  probeClientConfig, probeJsonConfig, probeTomlConfig, renderMcpSnippet, specOfMcpClient,
} from '../mcpClients.ts';

const TOKEN = 'test-token-abc123';
const EP = MCP_ENDPOINT;
const qoder = specOfMcpClient('qoder-cn');
const cursor = specOfMcpClient('cursor');
const claude = specOfMcpClient('claude-code');
const codex = specOfMcpClient('codex');
const trae = specOfMcpClient('trae-cn');

describe('配方常量', () => {
  test('端点固定 127.0.0.1:8204/mcp；客户端 id 唯一', () => {
    expect(EP).toBe('http://127.0.0.1:8204/mcp');
    expect(new Set(MCP_CLIENT_SPECS.map((s) => s.id)).size).toBe(MCP_CLIENT_SPECS.length);
    // 批次27：Trae CN 实机确认稳定配置路径（Roaming 下 mcpServers JSON），升级为可自动写入
    expect(MCP_CLIENT_SPECS.find((s) => s.id === 'trae-cn')?.configPath).toBe('%APPDATA%/Trae CN/User/mcp.json');
    expect(MCP_CLIENT_SPECS.find((s) => s.id === 'codex')?.format).toBe('toml');
  });

  test('批次27：JSON/TOML 已知结构客户端均可一键写入，仅 zcode 仍只给指引', () => {
    for (const id of ['qoder-cn', 'claude-code', 'cursor', 'gemini-cli', 'qwen-code', 'codex', 'trae-cn', 'workbuddy']) {
      expect(specOfMcpClient(id).writable).toBe(true);
      expect(specOfMcpClient(id).connectHint.length).toBeGreaterThan(0);
    }
    // 批次28-D：workbuddy 实机确认 ~/.workbuddy/mcp.json（应用内编辑器直显该路径）→ 升级可写；
    // zcode 配置存应用内部存储（IndexedDB）无稳定文件可合并 → 只读 + 手工指引；
    // deepseek-harness 宿主继承可写——一键接入委托宿主 qoder-cn 真实写入。
    expect(specOfMcpClient('zcode').writable).toBe(false);
    expect(specOfMcpClient('zcode').connectHint.length).toBeGreaterThan(0);
    const dsh = specOfMcpClient('deepseek-harness');
    expect(dsh.writable).toBe(true);
    expect(dsh.inheritsFrom).toBe('qoder-cn');
    expect(dsh.configPath).toBeNull();
    const wb = specOfMcpClient('workbuddy');
    expect(wb.configPath).toBe('~/.workbuddy/mcp.json');
    expect(wb.format).toBe('json');
    expect(wb.entryStyle).toBe('type+url');
  });

  test('未知客户端 → 明确报错（不静默落到默认配方）', () => {
    expect(() => specOfMcpClient('nope')).toThrow('未知 MCP 客户端');
  });
});

describe('buildMcpEntry / renderMcpSnippet', () => {
  test('三种条目风格字段正确（批次41-X：请求头带令牌 + 显式身份头，值为本配方 id）', () => {
    expect(buildMcpEntry(qoder, EP, TOKEN)).toEqual({
      type: 'http', url: EP, headers: { Authorization: `Bearer ${TOKEN}`, 'X-Memagent-Client': 'qoder-cn' },
    });
    expect(buildMcpEntry(cursor, EP, TOKEN)).toEqual({
      url: EP, headers: { Authorization: `Bearer ${TOKEN}`, 'X-Memagent-Client': 'cursor' },
    });
    const gemini = specOfMcpClient('gemini-cli');
    expect(buildMcpEntry(gemini, EP, TOKEN)).toEqual({
      httpUrl: EP, headers: { Authorization: `Bearer ${TOKEN}`, 'X-Memagent-Client': 'gemini-cli' },
    });
  });

  test('JSON 片段可解析且含唯一令牌、serverKey 正确', () => {
    const text = renderMcpSnippet(claude, EP, TOKEN);
    const parsed = JSON.parse(text) as { mcpServers: Record<string, { url: string; headers: { Authorization: string } }> };
    expect(parsed.mcpServers.memagent.url).toBe(EP);
    expect(parsed.mcpServers.memagent.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(text.match(new RegExp(TOKEN, 'g'))).toHaveLength(1);
  });

  test('TOML 片段：url + http_headers 同段', () => {
    const text = renderMcpSnippet(codex, EP, TOKEN);
    expect(text).toContain('[mcp_servers.multiagent_memory]');
    expect(text).toContain(`url = "${EP}"`);
    expect(text).toContain(`Authorization = "Bearer ${TOKEN}"`);
  });

  test('Zcode 片段升级为可粘贴 JSON（与 WorkBuddy 同构，批次28-E）；无文件面 → 仍不代写', () => {
    const zcode = specOfMcpClient('zcode');
    const text = renderMcpSnippet(zcode, EP, TOKEN);
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    const parsed = JSON.parse(text) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(parsed.mcpServers['MultiAgent Memory']).toEqual({
      type: 'http', url: EP, headers: { Authorization: `Bearer ${TOKEN}`, 'X-Memagent-Client': 'zcode' },
    });
    expect(zcode.writable).toBe(false);
    expect(zcode.configPath).toBeNull();
    // WorkBuddy / Trae 同为 mcpServers 结构
    const wbText = renderMcpSnippet(specOfMcpClient('workbuddy'), EP, TOKEN);
    expect(() => JSON.parse(wbText) as unknown).not.toThrow();
    expect(wbText).toContain(`Bearer ${TOKEN}`);
    const traeText = renderMcpSnippet(trae, EP, TOKEN);
    expect(() => JSON.parse(traeText) as unknown).not.toThrow();
    expect(traeText).toContain(`Bearer ${TOKEN}`);
  });
});

describe('probeJsonConfig', () => {
  test('null → no_config', () => {
    expect(probeJsonConfig(null, qoder, EP)).toEqual({ state: 'no_config', hasAuth: false });
  });

  test('坏 JSON / 顶层非对象 → invalid', () => {
    expect(probeJsonConfig('{bad', qoder, EP).state).toBe('invalid');
    expect(probeJsonConfig('[]', qoder, EP).state).toBe('invalid');
  });

  test('无 mcpServers / 无本条目 → missing_entry', () => {
    expect(probeJsonConfig('{}', qoder, EP).state).toBe('missing_entry');
    expect(probeJsonConfig(JSON.stringify({ mcpServers: { other: {} } }), qoder, EP).state).toBe('missing_entry');
  });

  test('端点正确 + Bearer 头 → wired（大小写头名均可）', () => {
    const base = { type: 'http', url: EP, headers: { Authorization: `Bearer ${TOKEN}` } };
    expect(probeJsonConfig(JSON.stringify({ mcpServers: { 'MultiAgent Memory': base } }), qoder, EP).state).toBe('wired');
    const lower = { url: EP, headers: { authorization: `bearer  ${TOKEN}` } };
    expect(probeJsonConfig(JSON.stringify({ mcpServers: { 'MultiAgent Memory': lower } }), qoder, EP).state).toBe('wired');
  });

  test('端点正确但缺/空 Authorization → missing_auth（会 401）', () => {
    const noAuth = { type: 'http', url: EP };
    expect(probeJsonConfig(JSON.stringify({ mcpServers: { 'MultiAgent Memory': noAuth } }), qoder, EP)).toEqual({
      state: 'missing_auth', hasAuth: false, hasClientId: false, foundUrl: EP,
    });
    const empty = { url: EP, headers: { Authorization: '   ' } };
    expect(probeJsonConfig(JSON.stringify({ mcpServers: { 'MultiAgent Memory': empty } }), qoder, EP).state).toBe('missing_auth');
  });

  test('同名条目指向其它端点 → conflict 且回传实际端点', () => {
    const other = { type: 'http', url: 'http://127.0.0.1:9999/mcp' };
    const r = probeJsonConfig(JSON.stringify({ mcpServers: { 'MultiAgent Memory': other } }), qoder, EP);
    expect(r.state).toBe('conflict');
    expect(r.foundUrl).toBe('http://127.0.0.1:9999/mcp');
  });

  test('httpUrl 风格客户端同样识别', () => {
    const gemini = specOfMcpClient('gemini-cli');
    const entry = { httpUrl: EP, headers: { Authorization: `Bearer ${TOKEN}` } };
    expect(probeJsonConfig(JSON.stringify({ mcpServers: { 'MultiAgent Memory': entry } }), gemini, EP).state).toBe('wired');
  });
});

describe('probeTomlConfig', () => {
  test('null → no_config；无段 → missing_entry', () => {
    expect(probeTomlConfig(null, codex, EP).state).toBe('no_config');
    expect(probeTomlConfig('model = "x"\n', codex, EP).state).toBe('missing_entry');
  });

  test('同行 http_headers → wired', () => {
    const text = `[mcp_servers.multiagent_memory]\nurl = "${EP}"\nhttp_headers = { Authorization = "Bearer ${TOKEN}" }\n`;
    expect(probeTomlConfig(text, codex, EP).state).toBe('wired');
  });

  test('子表 [.http_headers] → wired；遇到下一个其它段即停', () => {
    const text = [
      '[mcp_servers.multiagent_memory]',
      `url = "${EP}"`,
      '[mcp_servers.multiagent_memory.http_headers]',
      `Authorization = "Bearer ${TOKEN}"`,
      '[other]',
      'Authorization = "Bearer nope"',
    ].join('\n');
    expect(probeTomlConfig(text, codex, EP).state).toBe('wired');
  });

  test('缺头 → missing_auth；端点不同 → conflict', () => {
    expect(probeTomlConfig(`[mcp_servers.multiagent_memory]\nurl = "${EP}"\n`, codex, EP).state).toBe('missing_auth');
    const r = probeTomlConfig('[mcp_servers.multiagent_memory]\nurl = "http://x/mcp"\n', codex, EP);
    expect(r.state).toBe('conflict');
    expect(r.foundUrl).toBe('http://x/mcp');
  });
});

describe('probeClientConfig', () => {
  test('批次27：Trae 走 JSON 探测；批次28-B 起动态配置面按格式探测、仅未知格式 manual', () => {
    expect(probeClientConfig(trae, null, EP).state).toBe('no_config');
    expect(probeClientConfig(trae, '{bad', EP).state).toBe('invalid');
    // WorkBuddy：configPath=null 但有动态配置面（JSON）→ 按格式探测，不再整体 manual
    expect(probeClientConfig(specOfMcpClient('workbuddy'), null, EP).state).toBe('no_config');
    expect(probeClientConfig(specOfMcpClient('workbuddy'), '{"any":true}', EP).state).toBe('missing_entry');
    // Zcode 批次28-E 升级 format json（片段与 WorkBuddy 同构）：按格式探测得 no_config；
    // 「需手工」由 electron 扫描层因 configPath=null 判定（scanMcpClients 无路径一律 manual），探测层不再兜 manual
    expect(probeClientConfig(specOfMcpClient('zcode'), null, EP).state).toBe('no_config');
    expect(specOfMcpClient('zcode').configPath).toBeNull();
    // deepseek-harness（format unknown）探测层仍 manual；实际状态由宿主继承逻辑覆盖
    expect(probeClientConfig(specOfMcpClient('deepseek-harness'), null, EP).state).toBe('manual');
  });
});

describe('mergeMcpJsonConfig', () => {
  test('空配置 → 新建 mcpServers 条目', () => {
    const { text, changed } = mergeMcpJsonConfig(null, qoder, EP, TOKEN);
    expect(changed).toBe(true);
    expect(probeJsonConfig(text, qoder, EP).state).toBe('wired');
  });

  test('保留其它服务器/字段/请求头，只补本条目', () => {
    const original = {
      theme: 'dark',
      mcpServers: {
        other: { url: 'http://other/mcp' },
        'MultiAgent Memory': {
          type: 'http', url: EP, qoder_url: 'x',
          headers: { 'X-Custom': '1' },
        },
      },
    };
    const { text, changed } = mergeMcpJsonConfig(JSON.stringify(original, null, 2), qoder, EP, TOKEN);
    expect(changed).toBe(true);
    const parsed = JSON.parse(text) as typeof original;
    expect(parsed.theme).toBe('dark');
    expect(parsed.mcpServers.other.url).toBe('http://other/mcp');
    const entry = parsed.mcpServers['MultiAgent Memory'] as Record<string, unknown>;
    expect(entry.qoder_url).toBe('x');
    expect((entry.headers as Record<string, string>)['X-Custom']).toBe('1');
    expect((entry.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test('已是最新（同一令牌）→ changed=false 且原样返回文本', () => {
    const text = renderMcpSnippet(qoder, EP, TOKEN);
    const r = mergeMcpJsonConfig(text, qoder, EP, TOKEN);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(text);
  });

  test('同名条目指向其它端点 → E_CONFIG_CONFLICT（拒绝覆盖）', () => {
    const text = JSON.stringify({ mcpServers: { 'MultiAgent Memory': { url: 'http://other/mcp' } } });
    expect(() => mergeMcpJsonConfig(text, qoder, EP, TOKEN)).toThrow('E_CONFIG_CONFLICT');
  });

  test('坏 JSON / 顶层数组 → E_CONFIG_INVALID', () => {
    expect(() => mergeMcpJsonConfig('{bad', qoder, EP, TOKEN)).toThrow('E_CONFIG_INVALID');
    expect(() => mergeMcpJsonConfig('[]', qoder, EP, TOKEN)).toThrow('E_CONFIG_INVALID');
  });

  test('TOML 客户端不走 JSON 合并（E_UNSUPPORTED_CLIENT）', () => {
    expect(() => mergeMcpJsonConfig(null, codex, EP, TOKEN)).toThrow('E_UNSUPPORTED_CLIENT');
  });
});

describe('mergeMcpTomlConfig（批次23：Codex 等 TOML 客户端）', () => {
  test('空配置 → 新建 [mcp_servers.<key>] 段（url + http_headers）', () => {
    const { text, changed } = mergeMcpTomlConfig(null, codex, EP, TOKEN);
    expect(changed).toBe(true);
    expect(text).toContain('[mcp_servers.multiagent_memory]');
    expect(text).toContain(`url = "${EP}"`);
    expect(probeTomlConfig(text, codex, EP).state).toBe('wired');
  });

  test('保留其它段与字段，只补齐本段 Authorization', () => {
    const original = [
      'model = "gpt-5"',
      '',
      '[other]',
      'key = "keep"',
      '',
      '[mcp_servers.multiagent_memory]',
      `url = "${EP}"`,
      '',
      '[mcp_servers.other]',
      'url = "http://other/mcp"',
    ].join('\n');
    const { text, changed } = mergeMcpTomlConfig(original, codex, EP, TOKEN);
    expect(changed).toBe(true);
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain('[other]\nkey = "keep"');
    expect(text).toContain('[mcp_servers.other]\nurl = "http://other/mcp"');
    expect(probeTomlConfig(text, codex, EP).state).toBe('wired');
    expect(text.match(new RegExp(TOKEN, 'g'))).toHaveLength(1);
  });

  test('已有内联 http_headers：保留其它头、只替换 Authorization', () => {
    const original = [
      '[mcp_servers.multiagent_memory]',
      `url = "${EP}"`,
      'http_headers = { "X-Custom" = "1", Authorization = "Bearer old" }',
    ].join('\n');
    const { text } = mergeMcpTomlConfig(original, codex, EP, TOKEN);
    expect(text).toContain('"X-Custom" = "1"');
    expect(text).toContain(`Authorization = "Bearer ${TOKEN}"`);
    expect(text).not.toContain('Bearer old');
  });

  test('子表 [.http_headers]：缺 Authorization 时补在子表内', () => {
    const original = [
      '[mcp_servers.multiagent_memory]',
      `url = "${EP}"`,
      '[mcp_servers.multiagent_memory.http_headers]',
      '"X-Custom" = "1"',
    ].join('\n');
    const { text } = mergeMcpTomlConfig(original, codex, EP, TOKEN);
    expect(probeTomlConfig(text, codex, EP).state).toBe('wired');
    expect(text).toContain('"X-Custom" = "1"');
  });

  test('同名段指向其它端点 → E_CONFIG_CONFLICT（拒绝覆盖）', () => {
    const text = `[mcp_servers.multiagent_memory]\nurl = "http://other/mcp"\n`;
    expect(() => mergeMcpTomlConfig(text, codex, EP, TOKEN)).toThrow('E_CONFIG_CONFLICT');
  });

  test('已是最新（同一令牌）→ changed=false 且原样返回文本', () => {
    const text = renderMcpSnippet(codex, EP, TOKEN);
    const r = mergeMcpTomlConfig(text, codex, EP, TOKEN);
    expect(r.changed).toBe(false);
    expect(r.text).toBe(text);
  });

  test('保留 CRLF 行尾；JSON 客户端不走 TOML 合并', () => {
    const text = `[mcp_servers.multiagent_memory]\r\nurl = "${EP}"\r\n`;
    const { text: out } = mergeMcpTomlConfig(text, codex, EP, TOKEN);
    expect(out.includes('\r\n')).toBe(true);
    expect(() => mergeMcpTomlConfig(null, qoder, EP, TOKEN)).toThrow('E_UNSUPPORTED_CLIENT');
  });
});
