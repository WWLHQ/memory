// LLM 精炼网关单测（批次32 多引擎版）：本机 mock 三个 OpenAI 兼容引擎（node:http），
// 覆盖：按最近拨测延时排序调用（不分层绑厂商）、逐个顺序回退、Authorization 只发给 needsKey 引擎、
// chatEndpoint 版本段规则、全失败错误文本不含密钥、配置/密钥落盘回读与批次31 旧形状迁移、
// mergeLlmConfig 增删改、拨测结果写回口径、testEngine 诚实失败、层级规格提示词。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import {
  LEGACY_DEEPSEEK_KEY_FILE, LLM_CONFIG_FILE, LLM_KEYS_FILE, LLM_PRESETS, LlmGatewayProvider, applyProbeResult, applyProxyAccounting,
  buildLayerPrompt, chatEndpoint, defaultLlmConfig, keyExists, llmEngineViews, loadLlmConfig, loadLlmGateway,
  loadLlmKeys, mergeLlmConfig, saveLlmConfig, saveLlmKey, testEngine,
  type LlmEngineConfig, type LlmGatewayConfig,
} from '../llmGateway.ts';
import { UNSET_PROXY_ACCOUNTING } from '../../shared/proxyAccounting.ts';

const KEY = 'sk-test-key-abcdef123456';
const KEYS = { deepseek: KEY, kimi: KEY }; // ollama 本地端点不需要密钥
const CTX = { request_id: 'r-test', usage: 'write' };
let temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mam-llmgw-'));
  temps.push(d);
  return d;
}
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });

// ── mock 引擎服务器 ────────────────────────────────────────────────────────────

interface Captured { engine: string; url: string; auth: string | null; body: { model?: string; messages?: { content?: string }[] } }
const captures: Captured[] = [];
const failing = new Set<string>(); // 放 engine 名 → 该引擎所有请求 500
const noUsage = new Set<string>(); // 放 engine 名 → 该引擎响应不带 usage
/** mock 上游真实 usage（批次48 A24：内核据此记账，不再按字符数估算） */
const MOCK_TOKENS = 12;

function chatServer(engine: string): Server {
  return createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const auth = req.headers.authorization ?? null;
      let body: Captured['body'] = {};
      try { body = JSON.parse(raw); } catch { /* 空体 */ }
      captures.push({ engine, url: req.url ?? '', auth, body });
      if (failing.has(engine)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock engine exploded' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: `mock-${engine}-out` } }],
        ...(noUsage.has(engine) ? {} : { usage: { total_tokens: MOCK_TOKENS } }),
      }));
    });
  });
}

const srv: Record<string, Server> = {};
const base: Record<string, string> = {};

beforeAll(async () => {
  for (const name of ['ollama', 'deepseek', 'kimi']) {
    const s = chatServer(name);
    srv[name] = s;
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    base[name] = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  }
});
afterAll(() => { for (const s of Object.values(srv)) s.close(); });

/** 取预设骨架后按覆盖项替换（baseURL 一律指到本机 mock） */
function eng(id: string, over: Partial<LlmEngineConfig> = {}): LlmEngineConfig {
  const preset = LLM_PRESETS.find((p) => p.preset === id)!;
  return {
    id: preset.preset, name: preset.name, enabled: true, baseURL: base[id], model: `${id}-mock`,
    needsKey: preset.needsKey, lastLatencyMs: null, lastProbeAt: null, lastProbeOk: null, ...over,
  };
}

/** 三引擎默认可用配置（Ollama 无密钥、DeepSeek/Kimi 需密钥） */
function cfg(over: Partial<LlmEngineConfig> = {}): LlmGatewayConfig {
  return { engines: [eng('ollama', over), eng('deepseek', over), eng('kimi', over)] };
}

beforeEach(() => { captures.length = 0; failing.clear(); noUsage.clear(); });

// ── 路由：哪个能用、哪个快用哪个 ───────────────────────────────────────────────

describe('LlmGatewayProvider 延时排序路由（批次32：取消 L2/深层的厂商绑定）', () => {
  test('最近拨测最快的引擎先被调用；同一口径对所有层生效', async () => {
    const c = cfg();
    c.engines[1].lastLatencyMs = 900; // deepseek
    c.engines[2].lastLatencyMs = 100; // kimi（最快）
    const p = new LlmGatewayProvider(c, KEYS);
    expect(await p.refineLayer('', 'L2', '上游 L1 文本', 'fact', CTX)).toBe('mock-kimi-out');
    expect(await p.refineLayer('', 'L5', '上游 L4 文本', 'insight', CTX)).toBe('mock-kimi-out');
    expect(captures.map((x) => x.engine)).toEqual(['kimi', 'kimi']);
  });

  test('未拨测的引擎排在已拨测之后；同延时（含同为未拨测）按列表顺序稳定排列', async () => {
    const c = cfg();
    c.engines[1].lastLatencyMs = 50; // 只有 deepseek 拨过
    await expect(new LlmGatewayProvider(c, KEYS).refineLayer('', 'L2', '文本', 'fact', CTX))
      .resolves.toBe('mock-deepseek-out');
    captures.length = 0;
    // 全部未拨测 → 列表顺序（ollama 在前）
    await new LlmGatewayProvider(cfg(), KEYS).refineLayer('', 'L3', '文本', 'fact', CTX);
    expect(captures[0].engine).toBe('ollama');
  });

  test('请求体带模型名与层级提示词；需密钥引擎带 Bearer，本地 Ollama 绝不带 Authorization', async () => {
    const c = cfg();
    c.engines[2].lastLatencyMs = 10; // kimi 最快
    c.engines[1].lastLatencyMs = 20;
    c.engines[0].lastLatencyMs = 900; // 本地 Ollama 排最后
    const p = new LlmGatewayProvider(c, { ...KEYS, ollama: KEY }); // 即便误存了 ollama 密钥也不发
    await p.refineLayer('', 'L4', '上游文本ABC', 'fact', CTX);
    const sent = captures.find((x) => x.engine === 'kimi')!;
    expect(sent.auth).toBe(`Bearer ${KEY}`);
    expect(sent.body.model).toBe('kimi-mock');
    expect(sent.body.messages?.[0].content).toContain('上游文本ABC');
    captures.length = 0;
    failing.add('kimi');
    failing.add('deepseek');
    await p.refineLayer('', 'L4', '上游文本ABC', 'fact', CTX); // 回退到本地 Ollama
    const last = captures[captures.length - 1];
    expect(last.engine).toBe('ollama');
    expect(last.auth).toBeNull();
  });

  test('最快引擎失败 → 顺序回退下一个；再次失败 → 继续回退（不做硬层级上限）', async () => {
    const c = cfg();
    c.engines[1].lastLatencyMs = 900;
    c.engines[2].lastLatencyMs = 100;
    const p = new LlmGatewayProvider(c, KEYS);
    failing.add('kimi');
    expect(await p.refineLayer('', 'L3', '文本', 'pitfall', CTX)).toBe('mock-deepseek-out');
    expect(captures.map((x) => x.engine)).toEqual(['kimi', 'deepseek']);
    captures.length = 0;
    failing.add('deepseek');
    expect(await p.refineLayer('', 'L3', '文本', 'pitfall', CTX)).toBe('mock-ollama-out');
    expect(captures.map((x) => x.engine)).toEqual(['kimi', 'deepseek', 'ollama']);
  });

  test('单条引擎预算（批次39 D 拍板）：试满即失败，排在预算后的引擎一次都不碰', async () => {
    const c = cfg();
    c.engines[1].lastLatencyMs = 100; // deepseek 最快
    c.engines[2].lastLatencyMs = 200; // kimi 次之
    c.engines[0].lastLatencyMs = 900; // ollama 排最后，且它是唯一不会挂的
    failing.add('deepseek');
    failing.add('kimi');
    const p = new LlmGatewayProvider(c, KEYS, undefined, 2);
    await expect(p.refineLayer('', 'L2', '文本', 'fact', CTX)).rejects.toThrow(/引擎预算 2 个已用完，还有 1 个未试/);
    expect(captures.map((x) => x.engine)).toEqual(['deepseek', 'kimi']);
    // 默认预算 = 3（REFINE_MAX_ENGINES_PER_CALL）：同样的三引擎全部会被试到
    captures.length = 0;
    await new LlmGatewayProvider(c, KEYS).refineLayer('', 'L2', '文本', 'fact', CTX).catch(() => undefined);
    expect(captures.map((x) => x.engine)).toEqual(['deepseek', 'kimi', 'ollama']);
  });

  test('全部引擎失败 → 抛聚合错误（每档原因都在）且错误文本绝不含密钥', async () => {
    for (const name of ['ollama', 'deepseek', 'kimi']) failing.add(name);
    const p = new LlmGatewayProvider(cfg(), KEYS);
    try {
      await p.refineLayer('', 'L3', '文本', 'fact', { request_id: 'r-err', usage: 'write' });
      expect.unreachable();
    } catch (e) {
      const msg = String((e as Error).message);
      expect(msg).toMatch(/LLM 精炼失败（L3，request_id=r-err）/);
      expect(msg).not.toContain(KEY);
      expect(msg.match(/mock engine exploded/g)?.length).toBe(3);
    }
  });

  test('不具备条件的引擎被跳过：未启用 / 未填模型 / needsKey 但没配密钥', async () => {
    const c = cfg();
    c.engines[0].enabled = false; // ollama 未启用
    c.engines[1].model = ''; // deepseek 没填模型
    const p = new LlmGatewayProvider(c, { deepseek: KEY }); // kimi 无密钥
    expect(p.usable()).toBe(false);
    await expect(p.refineLayer('', 'L2', '文本', 'fact', CTX)).rejects.toThrow(/无可用引擎/);
    expect(captures).toHaveLength(0);

    const partial = cfg();
    partial.engines[2].enabled = false;
    const p2 = new LlmGatewayProvider(partial, { deepseek: KEY });
    expect(await p2.refineLayer('', 'L2', '文本', 'fact', CTX)).toBe('mock-ollama-out');
    expect(captures.map((x) => x.engine)).toEqual(['ollama']);
  });
});

// ── Provider 元数据（内核 routeProxy 19.8）────────────────────────────────────

describe('LlmGatewayProvider usable/listModels/call', () => {
  test('listModels 只列可调用引擎；本地=free/不限量；云端需参数页配置单价+配额（未设置不入路由）', () => {
    expect(new LlmGatewayProvider(defaultLlmConfig(), {}).usable()).toBe(false);
    expect(new LlmGatewayProvider(defaultLlmConfig(), {}).listModels()).toEqual([]);
    const engines = [
      eng('ollama', { baseURL: 'http://127.0.0.1:11434/v1' }),
      eng('deepseek', { baseURL: 'https://api.deepseek.com' }),
      eng('kimi', { baseURL: 'http://localhost:8080/v1' }),
    ];
    // 批次48 A16：默认未配置 → 云端源不进入路由（不再用 0.01 / 100000 占位数字）
    applyProxyAccounting(UNSET_PROXY_ACCOUNTING);
    expect(new LlmGatewayProvider({ engines }, KEYS).listModels().map((m) => m.model))
      .toEqual(['ollama-mock', 'kimi-mock']);

    applyProxyAccounting({ price_cny_per_kcall: 0.02, daily_quota: 5000 });
    // 档位按主机名判定（本机引擎常带 /v1 路径），与是否真的拨过无关
    const models = new LlmGatewayProvider({ engines }, KEYS).listModels();
    expect(models.map((m) => m.model)).toEqual(['ollama-mock', 'deepseek-mock', 'kimi-mock']);
    expect(models.map((m) => m.tier)).toEqual(['free', 'cheap', 'free']);
    expect(models[0].price).toBe(0);
    expect(models[0].quota).toBe(Number.POSITIVE_INFINITY);
    expect(models[1].price).toBe(0.02);
    expect(models[1].quota).toBe(5000);
    // 远端引擎缺密钥 → 不入表
    expect(new LlmGatewayProvider(cfg(), { deepseek: KEY }).listModels().map((m) => m.model))
      .toEqual(['ollama-mock', 'deepseek-mock']);
    applyProxyAccounting(UNSET_PROXY_ACCOUNTING); // 不把全局配置泄漏给后续用例
  });

  test('call（judge/rerank 用途）走同一套延时优先并回真实 usage tokens', async () => {
    const c = cfg();
    c.engines[2].lastLatencyMs = 10;
    const r = await new LlmGatewayProvider(c, KEYS).call('', '原始提示词', { request_id: 'r', usage: 'judge' });
    expect(r.text).toBe('mock-kimi-out');
    expect(r.tokens).toBe(MOCK_TOKENS);
    expect(captures[0].engine).toBe('kimi');
    // 批次48 A24：响应无 usage → 回 0，绝不按 text.length/2 估算
    captures.length = 0;
    noUsage.add('kimi');
    const r2 = await new LlmGatewayProvider(c, KEYS).call('', '原始提示词', { request_id: 'r', usage: 'judge' });
    expect(r2.tokens).toBe(0);
  });

  test('takeUsage：精炼累计真实 usage，取用即清零；上游无 usage 如实 null', async () => {
    const c = cfg();
    const p = new LlmGatewayProvider(c, KEYS);
    expect(p.takeUsage()).toBeNull(); // 尚未调用
    await p.refineLayer('', 'L2', '文本', 'fact', CTX);
    await p.refineLayer('', 'L3', '文本', 'fact', CTX);
    expect(p.takeUsage()).toEqual({ tokens: MOCK_TOKENS * 2 });
    expect(p.takeUsage()).toBeNull(); // 已取用清零

    noUsage.add('ollama');
    const only = new LlmGatewayProvider({ engines: [eng('ollama')] }, {});
    await only.refineLayer('', 'L2', '文本', 'fact', CTX);
    expect(only.takeUsage()).toEqual({ tokens: null }); // 不猜、不估算
  });
});

// ── OpenAI 兼容端点拼接 ────────────────────────────────────────────────────────

describe('chatEndpoint（版本段规则）', () => {
  test('无版本段补 /v1/chat/completions；已带 /vN 直接接 /chat/completions', () => {
    expect(chatEndpoint('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(chatEndpoint('https://api.deepseek.com/')).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(chatEndpoint('https://open.bigmodel.cn/api/paas/v4')).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    expect(chatEndpoint('https://dashscope.aliyuncs.com/compatible-mode')).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(chatEndpoint('https://openrouter.ai/api/v1///')).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  test('真实拨到 mock 引擎时请求路径就是拼出来的端点（含自定义 /api/paas/v4 形态）', async () => {
    const v4 = eng('kimi', { baseURL: `${base.kimi}/api/paas/v4` });
    await new LlmGatewayProvider({ engines: [v4] }, KEYS).call('', 'ping', { request_id: 'r', usage: 'call' });
    expect(captures[0].url).toBe('/api/paas/v4/chat/completions');
  });
});

// ── 落盘（配置无密钥 / 密钥集中 0600 文件 + 批次31 只读兜底）───────────────────

describe('配置与密钥落盘', () => {
  test('saveLlmConfig/loadLlmConfig 引擎列表回读一致；配置文件永不含密钥', () => {
    const dir = tempDir();
    saveLlmConfig(dir, cfg());
    const loaded = loadLlmConfig(dir);
    expect(loaded.engines.map((e) => e.id)).toEqual(['ollama', 'deepseek', 'kimi']);
    expect(loaded.engines[2].model).toBe('kimi-mock');
    saveLlmKey(dir, 'kimi', KEY);
    expect(JSON.parse(readFileSync(join(dir, LLM_CONFIG_FILE), 'utf8'))).not.toHaveProperty('kimi');
    expect(readFileSync(join(dir, LLM_CONFIG_FILE), 'utf8')).not.toContain(KEY);
  });

  test('批次31 旧形状 {ollama,deepseek} 读出即迁移为引擎列表，needsKey 按预设校正', () => {
    const dir = tempDir();
    writeFileSync(join(dir, LLM_CONFIG_FILE), JSON.stringify({
      ollama: { enabled: true, baseURL: 'http://127.0.0.1:11434/', model: 'qwen2.5:7b' },
      deepseek: { enabled: true, baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
    }), 'utf8');
    const migrated = loadLlmConfig(dir);
    expect(migrated.engines.map((e) => [e.id, e.enabled, e.baseURL, e.needsKey])).toEqual([
      ['ollama', true, 'http://127.0.0.1:11434', false],
      ['deepseek', true, 'https://api.deepseek.com', true],
    ]);
  });

  test('非法字段钳回：非布尔 enabled→false、缺 id/重复 id 丢弃、空列表回默认、预设 needsKey 不被用户改坏', () => {
    const dir = tempDir();
    writeFileSync(join(dir, LLM_CONFIG_FILE), JSON.stringify({
      engines: [
        { id: '', enabled: true, baseURL: 'http://x' },
        { id: 'deepseek', enabled: 'yes', baseURL: 'https://api.deepseek.com///', model: 'deepseek-chat', needsKey: false },
        { id: 'deepseek', enabled: true, model: 'dup' },
        { id: 'my-gateway', enabled: true, baseURL: 'http://127.0.0.1:9999', model: 'm', needsKey: false },
      ],
    }), 'utf8');
    const clamped = loadLlmConfig(dir);
    expect(clamped.engines.map((e) => e.id)).toEqual(['deepseek', 'my-gateway']);
    expect(clamped.engines[0].enabled).toBe(false); // 非布尔
    expect(clamped.engines[0].baseURL).toBe('https://api.deepseek.com'); // 去尾斜杠
    expect(clamped.engines[0].needsKey).toBe(true); // 预设为准（防密钥发给错误端点）
    expect(clamped.engines[1].needsKey).toBe(false); // 自定义引擎按落盘值
    writeFileSync(join(dir, LLM_CONFIG_FILE), '{"engines":[]}', 'utf8');
    expect(loadLlmConfig(dir).engines.map((e) => e.id)).toEqual(['ollama', 'deepseek']);
  });

  test('saveLlmKey/loadLlmKeys 按引擎 id 存取；空串清除；keyExists 口径一致', () => {
    const dir = tempDir();
    expect(loadLlmKeys(dir)).toEqual({});
    saveLlmKey(dir, 'kimi', KEY);
    saveLlmKey(dir, 'zhipu', 'sk-other');
    expect(loadLlmKeys(dir)).toEqual({ kimi: KEY, zhipu: 'sk-other' });
    expect(keyExists(dir, 'kimi')).toBe(true);
    expect(keyExists(dir, 'ollama')).toBe(false);
    saveLlmKey(dir, 'kimi', '  '); // 空白 = 清除
    expect(loadLlmKeys(dir)).toEqual({ zhipu: 'sk-other' });
  });

  test('批次31 旧密钥文件只读兜底；llm-keys.json 有值时以其为准；清除不删用户旧文件', () => {
    const dir = tempDir();
    writeFileSync(join(dir, LEGACY_DEEPSEEK_KEY_FILE), `${KEY}\n`, 'utf8');
    expect(loadLlmKeys(dir).deepseek).toBe(KEY);
    saveLlmKey(dir, 'deepseek', 'sk-newer');
    expect(loadLlmKeys(dir).deepseek).toBe('sk-newer');
    saveLlmKey(dir, 'deepseek', '');
    expect(JSON.parse(readFileSync(join(dir, LLM_KEYS_FILE), 'utf8'))).not.toHaveProperty('deepseek');
    expect(loadLlmKeys(dir).deepseek).toBe(KEY); // 兜底仍在：要彻底清除需用户自行删旧文件（网关不代删）
  });

  test('loadLlmGateway：有可调用引擎才返回实例，否则 null（内核继续只落 L1）', () => {
    const dir = tempDir();
    expect(loadLlmGateway(dir)).toBeNull(); // 无配置文件 → 默认全未启用
    saveLlmConfig(dir, cfg()); // 三引擎已启用，但远端两个还没密钥
    expect(loadLlmGateway(dir)?.isStub).toBe(false); // 本地 Ollama 免密钥即可用
    saveLlmKey(dir, 'deepseek', KEY);
    expect(loadLlmGateway(dir)?.listModels().map((m) => m.model)).toEqual(['ollama-mock', 'deepseek-mock']);
    const off = loadLlmConfig(dir);
    off.engines.forEach((e) => { e.enabled = false; });
    saveLlmConfig(dir, off);
    expect(loadLlmGateway(dir)).toBeNull();
  });
});

// ── 参数页补丁（增删改引擎 + 密钥动作）────────────────────────────────────────

describe('mergeLlmConfig', () => {
  test('改字段只动指定引擎（其余保持）', () => {
    const r = mergeLlmConfig(cfg(), { engines: [{ id: 'ollama', enabled: false, model: 'qwen2.5:7b' }] });
    expect(r.cfg.engines.map((e) => [e.id, e.enabled, e.model])).toEqual([
      ['ollama', false, 'qwen2.5:7b'],
      ['deepseek', true, 'deepseek-mock'],
      ['kimi', true, 'kimi-mock'],
    ]);
    expect(r.keyOp).toBeUndefined();
  });

  test('预设快选可添加且幂等；未识别预设 + 名称/地址 → custom_ 引擎，本地端点自动免密钥', () => {
    const added = mergeLlmConfig(cfg(), { add: { preset: 'kimi' } });
    expect(added.cfg.engines.map((e) => e.id)).toEqual(['ollama', 'deepseek', 'kimi']);
    const dedup = mergeLlmConfig(cfg(), { add: { preset: 'deepseek' } });
    expect(dedup.cfg.engines.filter((e) => e.id === 'deepseek')).toHaveLength(1);

    const presetCfg: LlmGatewayConfig = { engines: [eng('ollama'), eng('deepseek')] };
    const withZhipu = mergeLlmConfig(presetCfg, { add: { preset: 'zhipu' } });
    const zhipu = withZhipu.cfg.engines.find((e) => e.id === 'zhipu')!;
    expect([zhipu.enabled, zhipu.needsKey, zhipu.baseURL, zhipu.model]).toEqual([false, true, 'https://open.bigmodel.cn/api/paas/v4', 'glm-4-plus']);

    const custom = mergeLlmConfig(presetCfg, { add: { name: '本机 vLLM', baseURL: 'http://127.0.0.1:8000/v1', model: 'qwen' } });
    const added2 = custom.cfg.engines[custom.cfg.engines.length - 1];
    expect(added2.id).toMatch(/^custom_/);
    expect([added2.name, added2.enabled, added2.needsKey]).toEqual(['本机 vLLM', false, false]);
    const customRemote = mergeLlmConfig(presetCfg, { add: { name: 'X', baseURL: 'https://api.x.com' } });
    expect(customRemote.cfg.engines[2].needsKey).toBe(true);
    // 缺名称或缺地址 → 不新增（不造半成品引擎）
    expect(mergeLlmConfig(presetCfg, { add: { name: 'X' } }).cfg.engines).toHaveLength(2);
  });

  test('remove 删除引擎；key 动作只回传 id+值（由调用方落盘，值不进配置）', () => {
    const r = mergeLlmConfig(cfg(), { remove: 'deepseek', key: { id: 'kimi', value: KEY } });
    expect(r.cfg.engines.map((e) => e.id)).toEqual(['ollama', 'kimi']);
    expect(r.keyOp).toEqual({ id: 'kimi', value: KEY });
    expect(JSON.stringify(r.cfg)).not.toContain(KEY);
    expect(mergeLlmConfig(cfg(), { key: { id: 'kimi' } }).keyOp).toEqual({ id: 'kimi', value: '' });
  });
});

// ── 拨测（真实 HTTP）与结果写回口径 ───────────────────────────────────────────

describe('testEngine / applyProbeResult', () => {
  test('拨测成功记真实延时；失败按原因如实返回且不含密钥', async () => {
    const c = cfg();
    const ok = await testEngine(c, KEYS, 'kimi');
    expect(ok.ok).toBe(true);
    expect(ok.model).toBe('kimi-mock');
    expect(typeof ok.latencyMs).toBe('number');

    failing.add('kimi');
    const bad = await testEngine(c, KEYS, 'kimi');
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('HTTP 500');
    expect(bad.error).not.toContain(KEY);
  });

  test('未找到引擎 / 未填模型名 / 缺密钥 → 如实失败，不发请求', async () => {
    const c = cfg();
    expect((await testEngine(c, KEYS, 'nope')).error).toBe('未找到引擎 nope');
    c.engines[0].model = '';
    expect((await testEngine(c, KEYS, 'ollama')).error).toContain('未填写模型名');
    expect((await testEngine(c, {}, 'kimi')).error).toContain('未配置 API Key');
    expect(captures).toHaveLength(0);
  });

  // 批次34：用户「配了 Key 点测试连通却全显示连不通」——真因是旧实现在 enabled=false 时 9ms 内直接返回「未启用」，
  // 一条 HTTP 都不发。拨测正是决定要不要启用的手段，因此不再要求先启用（启用仍只影响是否参与精炼排队）。
  test('未勾选启用的引擎照样真拨测：拨测与启用解耦（批次34）', async () => {
    const c = cfg();
    c.engines[0].enabled = false; // ollama 未启用
    const r = await testEngine(c, KEYS, 'ollama');
    expect(r.ok).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
    expect(captures.map((x) => x.engine)).toEqual(['ollama']); // 真实发出了请求
  });

  test('未启用 + 缺条件仍如实失败（解耦不等于放宽其它前提）', async () => {
    const c = cfg();
    c.engines[0].enabled = false;
    c.engines[0].model = '';
    expect((await testEngine(c, KEYS, 'ollama')).error).toContain('未填写模型名');
    c.engines[2].enabled = false;
    expect((await testEngine(c, {}, 'kimi')).error).toContain('未配置 API Key');
    expect(captures).toHaveLength(0);
  });

  test('只有成功拨测参与排序；失败仍记时刻与探针结果，失败延时不顶到队首', () => {
    const c = cfg();
    const ok = applyProbeResult(c, 'kimi', { ok: true, model: 'kimi-mock', latencyMs: 123 });
    expect(ok.engines[2].lastLatencyMs).toBe(123);
    expect(ok.engines[2].lastProbeOk).toBe(true);
    expect(typeof ok.engines[2].lastProbeAt).toBe('number');
    expect(ok.engines[0].lastProbeOk).toBeNull(); // 其它引擎不受影响

    const bad = applyProbeResult(ok, 'deepseek', { ok: false, error: 'HTTP 500', latencyMs: 9000 });
    expect(bad.engines[1].lastLatencyMs).toBeNull();
    expect(bad.engines[1].lastProbeOk).toBe(false);
    // 排序仍认为 kimi 最快（deepseek 失败不被顶到前面）
    const p = new LlmGatewayProvider(bad, KEYS);
    expect(p.listModels().length).toBe(3);
  });
});

// ── IPC 视图（不泄漏密钥本体）─────────────────────────────────────────────────

describe('llmEngineViews', () => {
  test('回传引擎列表 + keySet + 预设；序列化结果不含任何密钥', () => {
    const v = llmEngineViews(cfg(), KEYS);
    expect(v.usable).toBe(true);
    expect(v.engines.map((e) => [e.id, e.keySet])).toEqual([['ollama', false], ['deepseek', true], ['kimi', true]]);
    // 批次33-B：预设快选扩充到 13 家（本机 3 + 云端 10），其余厂商走自定义 OpenAI 兼容地址
    expect(v.presets.map((p) => p.preset)).toEqual([
      'ollama', 'vllm', 'lmstudio', 'deepseek', 'kimi', 'zhipu', 'qwen',
      'siliconflow', 'minimax', 'stepfun', 'spark', 'groq', 'openrouter',
    ]);
    expect(v.presets.filter((p) => !p.needsKey).map((p) => p.preset)).toEqual(['ollama', 'vllm', 'lmstudio']);
    expect(JSON.stringify(v)).not.toContain(KEY);
    expect(llmEngineViews(defaultLlmConfig(), {}).usable).toBe(false);
  });
});

// ── 提示词（层规格单一真源，批次31 口径不变）──────────────────────────────────

describe('buildLayerPrompt', () => {
  const SRC = '上'.repeat(100);

  test('批次40：长度约束按**源文实时算**，不再写死绝对区间', () => {
    // L2 minRatio 0.4 → 100 字源文要求 40–100 字（上限同时被「产物不得长于源」夹住）
    const l2 = buildLayerPrompt('L2', SRC, 'pitfall');
    expect(l2).toContain('长度：40–100 字');
    expect(l2).toContain('由上游 100 字按本层压缩比算出');
    expect(l2).not.toContain('长度：12–300 字'); // 旧的绝对区间文案已废除
    // L6 是索引不是摘要：没有字数区间可写
    expect(buildLayerPrompt('L6', SRC, 'fact')).not.toContain('长度：');
  });

  test('批次40：格式契约写成「第一个词必须是」，L4/L5 各有自己的开头', () => {
    expect(buildLayerPrompt('L4', SRC, 'fact')).toContain('第一个词必须是「适用场景」');
    expect(buildLayerPrompt('L5', SRC, 'fact')).toContain('第一个词必须是「边界条件」');
    expect(buildLayerPrompt('L2', SRC, 'fact')).not.toContain('第一个词必须是');
  });

  test('保留关键词、L6 JSON 与上游原文都照旧进提示词', () => {
    const l6 = buildLayerPrompt('L6', '上游', 'fact');
    expect(l6).toContain('keywords');
    expect(l6).toContain('projections');
    expect(buildLayerPrompt('L2', '上游L1内容XYZ', 'pitfall')).toContain('上游L1内容XYZ');
    expect(buildLayerPrompt('L3', '源文含成功与失败', 'fact')).toContain('成功');
  });
});

// 密钥文件名常量（数据根迁移白名单 + 批次31 兼容依赖这三个文件名）
test('LLM 落盘文件名固定：llm-config.json / llm-keys.json / llm-deepseek-key.txt', () => {
  expect(LLM_CONFIG_FILE).toBe('llm-config.json');
  expect(LLM_KEYS_FILE).toBe('llm-keys.json');
  expect(LEGACY_DEEPSEEK_KEY_FILE).toBe('llm-deepseek-key.txt');
});
