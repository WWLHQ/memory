// LLM 精炼网关单测（批次31）：本机 mock 两个 OpenAI 兼容引擎（node:http），
// 覆盖：L2→Ollama / L3–L6→DeepSeek 分层路由、引擎失败互为回退、Bearer 密钥只发给 DeepSeek、
// 双引擎失败错误文本不含密钥、配置/密钥落盘回读、层规格提示词、拨测边界。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import {
  LLM_CONFIG_FILE, LLM_KEY_FILE, TieredLlmProvider, buildLayerPrompt, defaultLlmConfig, loadLlmGateway,
  deepseekKeyExists, loadDeepseekKey, loadLlmConfig, saveDeepseekKey, saveLlmConfig,
  testDeepseek, testOllama, type LlmGatewayConfig,
} from '../llmGateway.ts';

const KEY = 'sk-test-key-abcdef123456';
let temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mam-llmgw-'));
  temps.push(d);
  return d;
}
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });

// ── mock 引擎服务器 ────────────────────────────────────────────────────────────

interface Captured { engine: string; auth: string | null; body: { model?: string; messages?: { content?: string }[] } }
const captures: Captured[] = [];
const failing = new Set<string>(); // 放 engine 名 → 该引擎所有请求 500

function chatServer(engine: string): Server {
  return createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const auth = req.headers.authorization ?? null;
      let body: Captured['body'] = {};
      try { body = JSON.parse(raw); } catch { /* 空体 */ }
      captures.push({ engine, auth, body });
      if (failing.has(engine)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock engine exploded' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: `mock-${engine}-out` } }] }));
    });
  });
}

let ollamaSrv: Server;
let deepseekSrv: Server;
let ollamaBase = '';
let deepseekBase = '';

beforeAll(async () => {
  ollamaSrv = chatServer('ollama');
  deepseekSrv = chatServer('deepseek');
  await new Promise<void>((ok) => ollamaSrv.listen(0, '127.0.0.1', ok));
  await new Promise<void>((ok) => deepseekSrv.listen(0, '127.0.0.1', ok));
  ollamaBase = `http://127.0.0.1:${(ollamaSrv.address() as AddressInfo).port}`;
  deepseekBase = `http://127.0.0.1:${(deepseekSrv.address() as AddressInfo).port}`;
});
afterAll(() => {
  ollamaSrv.close();
  deepseekSrv.close();
});

function cfg(over: Partial<LlmGatewayConfig> = {}): LlmGatewayConfig {
  const def = defaultLlmConfig();
  return {
    ollama: { ...def.ollama, enabled: true, baseURL: ollamaBase, model: 'qwen-mock', ...over.ollama },
    deepseek: { ...def.deepseek, enabled: true, baseURL: deepseekBase, model: 'deepseek-mock', ...over.deepseek },
  };
}

beforeEach(() => { captures.length = 0; failing.clear(); });

// ── 分层路由 ──────────────────────────────────────────────────────────────────

describe('TieredLlmProvider 分层路由（批次31：简单层 Ollama、深层 DeepSeek）', () => {
  test('L2 优先 Ollama；L3–L6 优先 DeepSeek', async () => {
    const p = new TieredLlmProvider(cfg(), KEY);
    await p.refineLayer('', 'L2', '上游 L1 文本', 'fact', { request_id: 'r1', usage: 'write' });
    expect(captures[0].engine).toBe('ollama');
    await p.refineLayer('', 'L3', '上游 L2 文本', 'fact', { request_id: 'r2', usage: 'write' });
    expect(captures[1].engine).toBe('deepseek');
    await p.refineLayer('', 'L6', 'L1–L5 相关内容', 'fact', { request_id: 'r3', usage: 'write' });
    expect(captures[2].engine).toBe('deepseek');
  });

  test('DeepSeek 请求带 Bearer 密钥；Ollama 请求不带 Authorization', async () => {
    const p = new TieredLlmProvider(cfg(), KEY);
    await p.refineLayer('', 'L2', '文本', 'fact', { request_id: 'r', usage: 'write' });
    await p.refineLayer('', 'L4', '文本', 'fact', { request_id: 'r', usage: 'write' });
    const ollama = captures.find((c) => c.engine === 'ollama')!;
    const deepseek = captures.find((c) => c.engine === 'deepseek')!;
    expect(ollama.auth).toBeNull();
    expect(deepseek.auth).toBe(`Bearer ${KEY}`);
    expect(deepseek.body.model).toBe('deepseek-mock');
  });

  test('首选引擎失败 → 回退另一引擎（不加硬上限）', async () => {
    failing.add('deepseek');
    const p = new TieredLlmProvider(cfg(), KEY);
    const out = await p.refineLayer('', 'L3', '文本', 'pitfall', { request_id: 'r', usage: 'write' });
    expect(out).toBe('mock-ollama-out'); // DeepSeek 挂 → L3 回退 Ollama
    failing.clear();
    failing.add('ollama');
    const out2 = await p.refineLayer('', 'L2', '文本', 'fact', { request_id: 'r', usage: 'write' });
    expect(out2).toBe('mock-deepseek-out'); // Ollama 挂 → L2 回退 DeepSeek
  });

  test('双引擎都失败 → 抛错且错误文本绝不含密钥', async () => {
    failing.add('ollama');
    failing.add('deepseek');
    const p = new TieredLlmProvider(cfg(), KEY);
    try {
      await p.refineLayer('', 'L3', '文本', 'fact', { request_id: 'r-err', usage: 'write' });
      expect.unreachable();
    } catch (e) {
      const msg = String((e as Error).message);
      expect(msg).toMatch(/LLM 精炼失败（L3，request_id=r-err）/);
      expect(msg).not.toContain(KEY);
      expect(msg).toContain('mock engine exploded');
    }
  });

  test('未启用/未配置密钥的引擎被跳过；两引擎均未启用 → 显式报错', async () => {
    const onlyOllama = cfg({ deepseek: { enabled: false, baseURL: deepseekBase, model: 'deepseek-mock' } });
    const p = new TieredLlmProvider(onlyOllama, '');
    expect(await p.refineLayer('', 'L5', '文本', 'insight', { request_id: 'r', usage: 'write' })).toBe('mock-ollama-out');
    const none = cfg({ ollama: { enabled: false, baseURL: ollamaBase, model: 'qwen-mock' }, deepseek: { enabled: false, baseURL: deepseekBase, model: 'deepseek-mock' } });
    const p2 = new TieredLlmProvider(none, KEY);
    await expect(p2.refineLayer('', 'L2', '文本', 'fact', { request_id: 'r', usage: 'write' }))
      .rejects.toThrow(/无可用引擎（两引擎均未启用）/);
  });
});

// ── Provider 元数据（内核 routeProxy 19.8）────────────────────────────────────

describe('TieredLlmProvider usable/listModels', () => {
  test('usable 与模型表口径一致；DeepSeek 缺密钥不入表', () => {
    expect(new TieredLlmProvider(defaultLlmConfig(), '').usable()).toBe(false);
    const both = new TieredLlmProvider(cfg(), KEY);
    expect(both.usable()).toBe(true);
    const models = both.listModels();
    expect(models.map((m) => m.model)).toEqual(['qwen-mock', 'deepseek-mock']);
    expect(models[0].tier).toBe('free');
    expect(models[1].tier).toBe('cheap');
    const noKey = new TieredLlmProvider(cfg(), '');
    expect(noKey.listModels().map((m) => m.model)).toEqual(['qwen-mock']);
  });
});

// ── 落盘（配置无密钥 / 密钥 0600 先例）────────────────────────────────────────

describe('配置与密钥落盘', () => {
  test('saveLlmConfig/loadLlmConfig 回读一致；非法字段钳回默认', () => {
    const dir = tempDir();
    saveLlmConfig(dir, cfg());
    const loaded = loadLlmConfig(dir);
    expect(loaded.ollama.enabled).toBe(true);
    expect(loaded.ollama.baseURL).toBe(ollamaBase);
    expect(loaded.deepseek.model).toBe('deepseek-mock');
    const raw = JSON.parse(readFileSync(join(dir, LLM_CONFIG_FILE), 'utf8'));
    expect(JSON.stringify(raw)).not.toContain(KEY); // 配置文件永不含密钥
    writeFileSync(join(dir, LLM_CONFIG_FILE), '{"ollama":{"enabled":"yes","baseURL":"http://x/"},"deepseek":{}}', 'utf8');
    const clamped = loadLlmConfig(dir);
    expect(clamped.ollama.enabled).toBe(false); // 非布尔钳回 false
    expect(clamped.ollama.baseURL).toBe('http://x'); // 去尾斜杠
    expect(clamped.deepseek.model).toBe('deepseek-chat'); // 缺省回默认
  });

  test('saveDeepseekKey/loadDeepseekKey 回读；deepseekKeyExists 口径正确', () => {
    const dir = tempDir();
    expect(deepseekKeyExists(dir)).toBe(false);
    saveDeepseekKey(dir, KEY);
    expect(loadDeepseekKey(dir)).toBe(KEY);
    expect(deepseekKeyExists(dir)).toBe(true);
    saveDeepseekKey(dir, ''); // 空串 = 清除
    expect(deepseekKeyExists(dir)).toBe(false);
  });

  test('loadLlmGateway：可用才返回实例；不可用返回 null', () => {
    const dir = tempDir();
    expect(loadLlmGateway(dir)).toBeNull();
    saveLlmConfig(dir, cfg());
    saveDeepseekKey(dir, KEY);
    expect(loadLlmGateway(dir)?.isStub).toBe(false);
  });
});

// ── 提示词（层规格单一真源）───────────────────────────────────────────────────

describe('buildLayerPrompt', () => {
  test('按 LAYER_SPECS 生成约束：L4 必含「适用场景」、L5 必含「边界条件」、L6 要求 JSON', () => {
    expect(buildLayerPrompt('L4', '上游', 'fact')).toContain('适用场景');
    expect(buildLayerPrompt('L5', '上游', 'fact')).toContain('边界条件');
    const l6 = buildLayerPrompt('L6', '上游', 'fact');
    expect(l6).toContain('keywords');
    expect(l6).toContain('projections');
    expect(buildLayerPrompt('L2', '上游L1内容XYZ', 'pitfall')).toContain('上游L1内容XYZ');
    expect(buildLayerPrompt('L3', '源文含成功与失败', 'fact')).toContain('成功');
  });
});

// ── 连通真拨测 ────────────────────────────────────────────────────────────────

describe('testOllama / testDeepseek（真实 HTTP）', () => {
  test('两引擎各自拨测成功并回模型/延时', async () => {
    const c = cfg();
    const ro = await testOllama(c);
    expect(ro.ok).toBe(true);
    expect(ro.model).toBe('qwen-mock');
    expect(typeof ro.latencyMs).toBe('number');
    const rd = await testDeepseek(c, KEY);
    expect(rd.ok).toBe(true);
    expect(rd.model).toBe('deepseek-mock');
  });

  test('未启用/缺模型/缺密钥 → 如实失败，不伪造成功', async () => {
    const off = defaultLlmConfig();
    expect((await testOllama(off)).ok).toBe(false);
    expect((await testDeepseek(off, KEY)).ok).toBe(false);
    const noModel = cfg({ ollama: { enabled: true, baseURL: ollamaBase, model: '' } });
    expect((await testOllama(noModel)).error).toContain('未填写模型名');
    expect((await testDeepseek(cfg(), '')).error).toContain('未配置 API Key');
  });

  test('引擎故障 → 失败原因如实返回且不含密钥', async () => {
    failing.add('deepseek');
    const r = await testDeepseek(cfg(), KEY);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('HTTP 500');
    expect(r.error).not.toContain(KEY);
  });
});

// 密钥文件路径常量导出稳定性（数据根迁移白名单依赖这两个文件名）
test('LLM 落盘文件名固定：llm-config.json / llm-deepseek-key.txt', () => {
  expect(LLM_CONFIG_FILE).toBe('llm-config.json');
  expect(LLM_KEY_FILE).toBe('llm-deepseek-key.txt');
});
