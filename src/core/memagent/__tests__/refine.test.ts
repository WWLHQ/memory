// L0→L6 阶梯精炼管道 + L0 加解密契约测试（§2.1 / §2.2 / §4.1 / §16.1）
import { beforeAll, describe, expect, it } from 'vitest';
import { encryptL0, decryptL0, parseL0Envelope, parseL0EnvelopeV2 } from '../crypto.ts';
import { LAYER_SPECS, checkLayerSpec, sanitizeL1, meaningfulLength } from '../layerRules.ts';
import {
  DEDUP_THRESHOLDS, DEDUP_WEIGHTS, DEDUP_WEIGHTS_NO_LLM, L0_POLICY,
} from '../layerRules.ts';
import { coreWrite, coreBrowse } from '../memories.ts';
import { InMemoryStorage } from '../storage.ts';
import { JsVectorBackend } from '../vector.ts';
import type { LlmProvider, L0Port } from '../types.ts';
import type { L0Vault } from '../l0vault.ts';
import { createTestVault, TEST_ADMIN_PW } from './l0Kit.ts';

const ACCOUNT = { user_id: 'u1', team_id: 't1', enterprise_id: 'e1' };

// 共享写密钥（PBKDF2 只跑一次）；查阅会话用例逐条自建 vault 以隔离时间/失败计数。
let sharedVault: L0Vault;
beforeAll(async () => {
  sharedVault = (await createTestVault()).vault;
});

function wctx(storage: InMemoryStorage, now = 1_800_000_000_000, request_id = 'req_w1', l0: L0Port | null = sharedVault) {
  return { storage, vector: new JsVectorBackend(), account: ACCOUNT, request_id, now, l0: l0 ?? undefined };
}

const RAW = '线上事故复盘：支付接口超时，根因是连接池配置 pool_size=5 过小。联系人：张三，电话 13800138000，' +
  '数据库地址 tcp://prod-db:5432/app，api_key: sk-abcdef1234567890abcdef。改成 50 后恢复正常。';

describe('L0 加解密（§4.1 AES-256-GCM + PBKDF2）', () => {
  it('加密后密文不含原文片段，且信封字段齐全', async () => {
    const env = await encryptL0(RAW, 'l0pass');
    expect(env).not.toContain('prod-db');
    expect(env).not.toContain('张三');
    const o = parseL0Envelope(env)!;
    expect(o).not.toBeNull();
    expect(o.alg).toBe('AES-256-GCM');
    expect(o.kdf).toBe('PBKDF2-SHA256');
    expect(o.iter).toBeGreaterThanOrEqual(100_000);
    expect(o.salt.length).toBeGreaterThan(0);
    expect(o.iv.length).toBeGreaterThan(0);
    expect(o.tag.length).toBeGreaterThan(0);
    expect(o.ct.length).toBeGreaterThan(0);
  });

  it('正确密码 → 解密还原原文（逐字节一致）', async () => {
    const env = await encryptL0(RAW, 'l0pass');
    await expect(decryptL0(env, 'l0pass')).resolves.toBe(RAW);
  });

  it('错误密码 → E_AUTH_L0（GCM 认证失败）', async () => {
    const env = await encryptL0(RAW, 'l0pass');
    await expect(decryptL0(env, 'wrong')).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('同一明文两次加密结果不同（随机 salt+iv，防重放推断）', async () => {
    const a = await encryptL0(RAW, 'l0pass');
    const b = await encryptL0(RAW, 'l0pass');
    expect(a).not.toBe(b);
    await expect(decryptL0(b, 'l0pass')).resolves.toBe(RAW);
  });

  it('密文被篡改 → E_AUTH_L0（完整性校验生效）', async () => {
    const env = JSON.parse(await encryptL0(RAW, 'l0pass'));
    env.ct = Buffer.from(env.ct, 'base64').toString('base64').slice(0, -4) + 'AAAA';
    await expect(decryptL0(JSON.stringify(env), 'l0pass')).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('非本系统生成的密文 → E_AUTH_L0', async () => {
    await expect(decryptL0('ENC(旧版标记串)', 'l0pass')).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });

  it('密码 <6 位 → 拒绝加密', async () => {
    await expect(encryptL0(RAW, '123')).rejects.toMatchObject({ code: 'E_AUTH_L0' });
  });
});

describe('L1 清洗脱敏（§2.1）', () => {
  it('姓名/电话/服务地址/密钥全部替换为占位符', () => {
    const out = sanitizeL1(RAW);
    expect(out).not.toContain('13800138000');
    expect(out).not.toContain('tcp://prod-db');
    expect(out).not.toContain('sk-abcdef');
    expect(out).not.toContain('张三');
    expect(out).toContain('[电话]');
    expect(out).toContain('[服务地址]');
    expect(out).toContain('[API_KEY]');
    expect(out).toContain('[姓名]');
  });

  it('保留技术内容（配置项、错误定位等）', () => {
    const out = sanitizeL1(RAW);
    expect(out).toContain('pool_size=5');
    expect(out).toContain('连接池');
  });

  it('批次10：裸 IPv4 / IPv6 / 方括号 IPv6 → [IP]（版本号不误伤）', () => {
    const out = sanitizeL1('数据库 10.0.0.12:5432，监听 ::1 与 2001:db8::1，代理 http://[::1]:8080/');
    expect(out).not.toContain('10.0.0.12');
    expect(out).not.toContain('::1');
    expect(out).not.toContain('2001:db8');
    expect(out).toContain('[IP]');
    expect(out).toContain('[服务地址]');
    // 语义版本号不是 IP（前面有字母边界）
    expect(sanitizeL1('版本 v1.2.3.4 已发布')).toContain('v1.2.3.4');
  });

  it('批次10：18 位 / 15 位证件号 → [证件号]，普通长数字不误伤', () => {
    const out = sanitizeL1('身份证 11010519491231002X，旧证 110105491231002，订单号 202610301234567890');
    expect(out).not.toContain('11010519491231002X');
    expect(out).not.toContain('110105491231002');
    expect(out).toContain('[证件号]');
    // 订单号不符合证件号结构（月份 12 但前面位数不同）→ 不脱敏为证件号
    expect(out).toContain('202610301234567890');
  });

  it('批次10：任意协议 URL 全脱敏（ftp/sftp/ssh/git/ldap…）', () => {
    const out = sanitizeL1('配置 ftp://user:pass@host/dir、ssh://git@host/repo、ldap://dc01:389');
    expect(out).not.toContain('ftp://');
    expect(out).not.toContain('ssh://');
    expect(out).not.toContain('ldap://');
    expect((out.match(/\[服务地址\]/g) ?? []).length).toBe(3);
  });

  it('批次10：Authorization / Cookie 头与 curl -u 基础认证 → [API_KEY]', () => {
    const out = sanitizeL1(
      'Authorization: Basic dXNlcjpwYXNz\nCookie: SESSION=abc123def456\ncurl -u admin:secret123 https://example.com',
    );
    expect(out).not.toContain('dXNlcjpwYXNz');
    expect(out).not.toContain('abc123def456');
    expect(out).not.toContain('secret123');
    expect(out).toContain('[API_KEY]');
    expect(out).toContain('Authorization: [API_KEY]');
    expect(out).toContain('Cookie: [API_KEY]');
  });

  it('批次10：扩充密钥别名（client_secret / x-api-key / session_id）→ [API_KEY]', () => {
    const out = sanitizeL1('client_secret=abcdef123456 x-api-key: zzzzzzzz session_id= sess-abc123');
    expect(out).not.toContain('abcdef123456');
    expect(out).not.toContain('zzzzzzzz');
    expect(out).not.toContain('sess-abc123');
    expect((out.match(/\[API_KEY\]/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('批次10：占位符 [IP] / [证件号] 不计入有效长度', () => {
    expect(meaningfulLength('[IP][证件号]！！！')).toBe(0);
  });
});

describe('每层生成规格（§2.1 / §16.1）', () => {
  it('LAYER_SPECS 覆盖 L1–L6 六层，来源阶梯递进', () => {
    expect(LAYER_SPECS.map((s) => s.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(LAYER_SPECS[1].from).toContain('L1');
    expect(LAYER_SPECS[3].from).toContain('L3');
  });

  it('L2 上限 300 / 下限 50；L3 200/30；L4 120/20；L5 60/10', () => {
    const by = (id: string) => LAYER_SPECS.find((s) => s.id === id)!;
    expect([by('L2').maxChars, by('L2').minChars]).toEqual([300, 50]);
    expect([by('L3').maxChars, by('L3').minChars]).toEqual([200, 30]);
    expect([by('L4').maxChars, by('L4').minChars]).toEqual([120, 20]);
    expect([by('L5').maxChars, by('L5').minChars]).toEqual([60, 10]);
    expect(by('L1').maxChars).toBeNull();  // L1 不限长度
  });

  it('L4 必含"适用场景"，L5 必含"边界条件"；L6 keywords ≤30（§16.1 rule）', () => {
    expect(LAYER_SPECS.find((s) => s.id === 'L4')!.mustInclude).toContain('适用场景');
    expect(LAYER_SPECS.find((s) => s.id === 'L5')!.mustInclude).toContain('边界条件');
    expect(LAYER_SPECS.find((s) => s.id === 'L6')!.maxKeywords).toBe(30);
    const l5 = LAYER_SPECS.find((s) => s.id === 'L5')!;
    expect(checkLayerSpec(l5, '只写了边界但没有写全，长度足够的一段洞察内容').join()).toContain('边界条件');
    const l6 = LAYER_SPECS.find((s) => s.id === 'L6')!;
    const tooMany = JSON.stringify({ keywords: Array.from({ length: 31 }, (_, i) => `k${i}`), projections: [] });
    expect(checkLayerSpec(l6, tooMany).join()).toContain('L6 keywords 超限：31 > 30');
  });

  it('checkLayerSpec 能抓出超长/过短/缺关键词/缺要素', () => {
    const l4 = LAYER_SPECS.find((s) => s.id === 'L4')!;
    expect(checkLayerSpec(l4, '太短')).toContain('L4 过短：2 < 20 字（过度压缩，§16.1）');
    expect(checkLayerSpec(l4, 'x'.repeat(121)).join()).toContain('L4 超长');
    expect(checkLayerSpec(l4, '没有场景说明的一段足够长度的模式归纳文字描述').join()).toContain('适用场景');
    expect(checkLayerSpec(LAYER_SPECS[5], '不是JSON').join()).toContain('合法 JSON');
    expect(checkLayerSpec(l4, '这是一个足够长度且包含适用场景描述的合规模式归纳内容')).toEqual([]);
  });
});

describe('层级规则单一真源（layerRules.ts）', () => {
  it('五维权重合计 1；无 LLM 四维归一化合计 1', () => {
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(DEDUP_WEIGHTS)).toBeCloseTo(1, 10);
    expect(sum(DEDUP_WEIGHTS_NO_LLM)).toBeCloseTo(1, 10);
    expect(DEDUP_WEIGHTS.judge).toBeCloseTo(0.2, 10);
  });

  it('逐层阈值严格递增：L1 0.70 → L6 0.90', () => {
    expect(Object.values(DEDUP_THRESHOLDS)).toEqual([0.70, 0.75, 0.80, 0.85, 0.90, 0.90]);
  });

  it('L0 授权策略：5min 空闲、60s 心跳、5 次错误锁 15min、密码 ≥8', () => {
    expect(L0_POLICY.idleTimeoutMs).toBe(5 * 60_000);
    expect(L0_POLICY.heartbeatIntervalMs).toBe(60_000);
    expect(L0_POLICY.maxFailedAttempts).toBe(5);
    expect(L0_POLICY.lockMs).toBe(15 * 60_000);
    expect(L0_POLICY.adminPasswordMin).toBe(8);
    expect(L0_POLICY.grantPasswordMin).toBe(8);
  });

  it('有效长度排除标点/占位符：只有占位符与感叹号 → 0', () => {
    expect(meaningfulLength('[姓名][电话]！！！')).toBe(0);
    expect(meaningfulLength('pool_size=5 连接池')).toBeGreaterThan(0);
  });

  it('姓名启发式必须带分隔符：不误伤“用户登录失败”', () => {
    expect(sanitizeL1('用户登录失败，错误码 E_AUTH')).toContain('用户登录失败');
    expect(sanitizeL1('用户：张三 反馈登录失败')).toContain('[姓名]');
    expect(sanitizeL1('用户：张三 反馈登录失败')).not.toContain('张三');
  });

  it('密钥支持 = 分隔与 Bearer；数据库地址脱敏', () => {
    const out = sanitizeL1('api_key=abcd1234 token: zzzzzzzz Bearer abcdefgh12345678 postgres://u:p@db:5432/x');
    expect(out).not.toContain('abcd1234');
    expect(out).not.toContain('zzzzzzzz');
    expect(out).not.toContain('abcdefgh12345678');
    expect(out).not.toContain('postgres://');
    expect(out).toContain('[API_KEY]');
  });
});

describe('coreWrite 全链路（L0 加密 + 阶梯落库）', () => {
  it('写密钥已解锁 → L0 真实加密入库（v2 信封），元数据齐全', async () => {
    const s = new InMemoryStorage();
    const r = await coreWrite(
      { content: RAW, category: 'pitfall', project_id: 'P1', source_agent: 'Claude Code' },
      wctx(s),
    );
    expect(r.dedup.action).toBe('new');
    expect(r.spec_violations).toEqual([]);
    const m = (await s.listMemories({}))[0];
    expect(m.content_l0_enc).not.toContain('prod-db');
    expect(parseL0EnvelopeV2(m.content_l0_enc!)).not.toBeNull();
    expect(m.layer_specs?.L1).toBe('v1:清洗脱敏');
    expect(m.content_orig).toBeUndefined(); // v2 只落密文，不再留明文原文副本
    const env = parseL0EnvelopeV2(m.content_l0_enc!);
    expect(env).not.toBeNull();
    expect(env!.v).toBe(2);
    expect(env!.alg).toBe('AES-256-GCM');
  });

  it('未注入 L0Port → E_L0_LOCKED：不落明文、不伪造密文、不写任何记忆', async () => {
    const s = new InMemoryStorage();
    await expect(coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s, 1_800_000_000_000, 'req_nol0', null)))
      .rejects.toMatchObject({ code: 'E_L0_LOCKED' });
    expect(await s.listMemories({})).toEqual([]);
  });

  it('非法 category → 明确报错（不静默落 pitfall）', async () => {
    const s = new InMemoryStorage();
    await expect(
      coreWrite({ content: RAW, category: 'bug' as never, project_id: 'P1' }, wctx(s)),
    ).rejects.toThrow(/非法 category/);
    expect(await s.listMemories({})).toEqual([]);
  });

  it('审计记录 l0_encrypted 与真实层清单（无 LLM → 仅 L1）', async () => {
    const s = new InMemoryStorage();
    await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s));
    const [a] = await s.queryAudit({ action: 'write' });
    expect(a.detail.l0_encrypted).toBe(true);
    expect(a.detail.layers).toEqual(['L1']);
    expect(a.detail.refined_by).toBe('stub');
    const m = (await s.listMemories({}))[0];
    expect(m.refined_by).toBe('stub');
    expect(m.layer).toBe('L1');
  });
});

describe('无真实 LLM 的精炼诚实性（Phase C 验收）', () => {
  it('只落 L1：content_l2..l6 全部不存在，L1 已脱敏', async () => {
    const s = new InMemoryStorage();
    const r = await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s));
    expect(r.refined_by).toBe('stub');
    expect(r.layers?.content_l1).toBeDefined();
    expect(r.layers?.content_l2).toBeUndefined();
    const m = (await s.listMemories({}))[0];
    expect(m.content_l1).not.toContain('13800138000');
    expect([m.content_l2, m.content_l3, m.content_l4, m.content_l5, m.content_l6].every((v) => v === undefined)).toBe(true);
    expect(m.layer_specs).toEqual({ L1: 'v1:清洗脱敏' });
    // 批次24 口径2：一条记忆只记一个「层级生成时间」（本组 L1–L6 的生成时刻），取 ctx.now
    expect(m.layers_generated_at).toBe(1_800_000_000_000);
  });

  it('嫁接路径同样先脱敏（新记忆的 L1 不含原始 PII）', async () => {
    const s = new InMemoryStorage();
    await coreWrite({ content: '连接池配置过小导致超时，改为 50 后恢复', category: 'pitfall', project_id: 'P1' }, wctx(s));
    const r = await coreWrite(
      { content: '连接池配置过小导致超时，改为 50 后恢复；补充联系人：李四，电话 13900002222', category: 'pitfall', project_id: 'P1' },
      wctx(s),
    );
    expect(r.dedup.action).toBe('grafted');
    const created = (await s.getMemory(r.mem_id))!;
    expect(created.content).not.toContain('13900002222');
    expect(created.content).not.toContain('李四');
    expect(created.content).toContain('[电话]');
    expect(created.content_l2).toBeUndefined();
    expect(created.graft_to).toBeTruthy();
  });
});

describe('真实 LLM 精炼落地（refined_by 诚实化）', () => {
  const LAYERS = {
    content_l1: '（Provider 的 L1 不落库，内核以 sanitizeL1 为准）',
    content_l2: '[来源:Agent会话][类型:pitfall] 支付接口超时复盘：根因是连接池配置过小，调整后恢复，关键约束与配置项已保留，供同类问题召回复用。',
    content_l3: '成功点：定位到连接池配置根因；失败点：未提前做压测；经验教训：上线前验证连接池容量。',
    content_l4: '模式归纳：容量类故障优先核对连接池与超时配置。适用场景：支付链路压测与扩容评审。',
    content_l5: '容量假设需随流量演进复核；边界条件：仅适用于同 project_id 的部署环境。',
    content_l6: JSON.stringify({ keywords: ['连接池', '超时', '复盘'], projections: [{ layer: 'L2', relevance: 0.9 }] }),
  };

  function fakeRefine(refineImpl: NonNullable<LlmProvider['refine']>): LlmProvider {
    return { listModels: () => [], call: async () => ({ text: '', tokens: 0 }), isStub: false, refine: refineImpl };
  }

  function lctx(storage: InMemoryStorage, llm?: LlmProvider) {
    return {
      storage, vector: new JsVectorBackend(), account: ACCOUNT, request_id: 'req_llm', now: 1_800_000_000_000,
      llm, llmModel: llm ? 'real-model' : undefined, l0: sharedVault,
    };
  }

  it('全合规：L1–L6 落库、refined_by=llm、layer=L6/content=L6', async () => {
    const s = new InMemoryStorage();
    let calledWith: { model: string; category: string; request_id: string } | undefined;
    const llm = fakeRefine(async (model, _raw, category, ctx) => {
      calledWith = { model, category, request_id: ctx.request_id };
      return LAYERS;
    });
    const r = await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
    expect(calledWith).toEqual({ model: 'real-model', category: 'pitfall', request_id: 'req_llm' });
    expect(r.refined_by).toBe('llm');
    expect(r.spec_violations).toEqual([]);
    expect(r.refine_error).toBeUndefined();
    const m = (await s.listMemories({}))[0];
    expect(m.layer).toBe('L6');
    expect(m.content).toBe(LAYERS.content_l6);
    expect(m.content_l1).not.toContain('13800138000'); // 内核仍以 sanitizeL1 为准
    expect(m.content_l3).toBe(LAYERS.content_l3);
    expect(m.content_l4).toBe(LAYERS.content_l4);
    expect(m.content_l5).toBe(LAYERS.content_l5);
    expect(m.content_l6).toBe(LAYERS.content_l6);
    expect(Object.keys(m.layer_specs ?? {})).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    // 批次24 口径2：真实 LLM 一次产出的整组层级共用一个生成时间
    expect(m.layers_generated_at).toBe(1_800_000_000_000);
    const [a] = await s.queryAudit({ action: 'write' });
    expect(a.detail.refined_by).toBe('llm');
    expect(a.detail.layers).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(a.detail.llm_calls).toBe(1); // 旧 Provider：一次返回多层，按层校验
  });

  it('违规层 → 该层不落 + 停止更深层，layer=最高连续层', async () => {
    const s = new InMemoryStorage();
    const llm = fakeRefine(async () => ({
      ...LAYERS,
      content_l4: '太短', // 违反 L4 minChars / mustInclude
    }));
    const r = await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
    expect(r.refined_by).toBe('llm'); // L2/L3 仍合规
    expect(r.spec_violations?.join()).toContain('L4');
    const m = (await s.listMemories({}))[0];
    expect(m.layer).toBe('L3');
    expect(m.content).toBe(LAYERS.content_l3);
    expect(m.content_l4).toBeUndefined();
    expect(m.content_l5).toBeUndefined();
    expect(m.content_l6).toBeUndefined();
    expect(Object.keys(m.layer_specs ?? {})).toEqual(['L1', 'L2', 'L3']);
  });

  it('refine 抛异常 → 只落 L1、标 stub 并如实返回 refine_error', async () => {
    const s = new InMemoryStorage();
    const llm = fakeRefine(async () => { throw new Error('upstream 502'); });
    const r = await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
    expect(r.refined_by).toBe('stub');
    expect(r.refine_error).toContain('upstream 502');
    expect(r.layers?.content_l2).toBeUndefined();
    const m = (await s.listMemories({}))[0];
    expect(m.layer).toBe('L1');
    expect(m.content_l2).toBeUndefined();
  });

  it('isStub=true 即使实现 refine 也不调用（不上送 stub 流量）', async () => {
    const s = new InMemoryStorage();
    let called = 0;
    const llm: LlmProvider = {
      listModels: () => [], call: async () => ({ text: '', tokens: 0 }), isStub: true,
      refine: async () => { called++; return LAYERS; },
    };
    const r = await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
    expect(called).toBe(0);
    expect(r.refined_by).toBe('stub');
  });
});

describe('coreBrowse L0 授权解密（§4.1 / §4.4.3）', () => {
  it('连续会话 → 返回 L0 明文原文', async () => {
    const s = new InMemoryStorage();
    const { vault } = await createTestVault();
    await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s, 1_800_000_000_000, 'req_b1', vault));
    const unlock = await vault.unlock({ password: TEST_ADMIN_PW, user_id: 'u1' });
    const r = await coreBrowse({ layer: 'L0', project_id: 'P1', l0_auth: { l0_session_id: unlock.l0_session_id } }, {
      storage: s, request_id: 'req_b1', now: 1, l0: vault, user_id: 'u1',
    });
    expect(r.l0_masked).toBe(false);
    expect(r.rows[0].content).toBe(RAW);
  });

  it('错密码 → E_AUTH_L0 + l0_auth_fail 审计（不泄露密文/密码）', async () => {
    const s = new InMemoryStorage();
    const { vault } = await createTestVault({ audit: s });
    await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s, 1_800_000_000_000, 'req_b2', vault));
    await expect(vault.unlock({ password: 'bad-password', user_id: 'u1' }))
      .rejects.toMatchObject({ code: 'E_AUTH_L0' });
    const fails = await s.queryAudit({ action: 'l0_auth_fail' });
    expect(fails).toHaveLength(1);
    expect(fails[0].detail.reason).toBe('bad_password');
    expect(JSON.stringify(fails[0].detail)).not.toContain('bad-password');
  });

  it('未授权（无 l0_session_id）→ 全遮罩 + l0_auth_fail(no_grant)', async () => {
    const s = new InMemoryStorage();
    const { vault } = await createTestVault();
    await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s, 1_800_000_000_000, 'req_b3', vault));
    const r = await coreBrowse({ layer: 'L0', project_id: 'P1' }, {
      storage: s, request_id: 'req_b3', now: 1, l0: vault, user_id: 'u1',
    });
    expect(r.l0_masked).toBe(true);
    expect(r.rows[0].content).toBe('[L0 已加密 · 需授权]');
    const fails = await s.queryAudit({ action: 'l0_auth_fail' });
    expect(fails).toHaveLength(1);
    expect(fails[0].detail.reason).toBe('no_grant');
  });

  it('会话 scope 不含项目 → 遮罩（不返回其他项目 L0 明文）', async () => {
    const s = new InMemoryStorage();
    const { vault } = await createTestVault();
    await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s, 1_800_000_000_000, 'req_b4', vault));
    // 同一账号走 grant 场景：scope 只含 P2 → 查 P1 被遮罩
    await vault.grantAccess({
      grantee_user_id: 'u2', scope_project_ids: ['P2'], password: 'grantpass-1', admin_user_id: 'admin',
    });
    const g = (await vault.listGrants()).find((x) => x.grantee_user_id === 'u2')!;
    const u2 = await vault.unlock({ grant_id: g.grant_id, password: 'grantpass-1', user_id: 'u2' });
    const r = await coreBrowse({ layer: 'L0', project_id: 'P1', l0_auth: { l0_session_id: u2.l0_session_id } }, {
      storage: s, request_id: 'req_b5', now: 1, l0: vault, user_id: 'u2',
    });
    expect(r.l0_masked).toBe(true);
    expect(r.rows[0].content).toBe('[L0 已加密 · 需授权]');
    const fails = await s.queryAudit({ action: 'l0_auth_fail' });
    expect(fails[0].detail.reason).toBe('no_grant');
  });

  it('未精炼记录：仅 L1 可查，L2–L6 空（不伪造层内容）', async () => {
    const s = new InMemoryStorage();
    await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s));
    const get = async (layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6') => {
      const r = await coreBrowse({ layer, project_id: 'P1' }, {
        storage: s, request_id: `req_${layer}`, now: 1,
      });
      return r.rows;
    };
    expect((await get('L1'))[0].content).not.toContain('13800138000');
    for (const ln of ['L2', 'L3', 'L4', 'L5', 'L6'] as const) {
      expect(await get(ln)).toEqual([]);
    }
  });
});
