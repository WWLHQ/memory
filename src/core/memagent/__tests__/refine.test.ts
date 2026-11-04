// L0→L6 阶梯精炼管道 + L0 加解密契约测试（§2.1 / §2.2 / §4.1 / §16.1）
import { beforeAll, describe, expect, it } from 'vitest';
import { encryptL0, decryptL0, parseL0Envelope, parseL0EnvelopeV2 } from '../crypto.ts';
import { LAYER_SPECS, checkLayerSpec, sanitizeL1, meaningfulLength } from '../layerRules.ts';
import {
  DEDUP_THRESHOLDS, DEDUP_WEIGHTS, DEDUP_WEIGHTS_NO_LLM, L0_POLICY,
  depthCapFor, layerBand,
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

  // 批次27 P2-5：对抗样本固化——sanitizeL1 是逐行正则集合，不是语义识别。
  // 以下形态部分可命中、部分明确不命中；这里如实记录边界，防止后续误以为「已全覆盖」。
  describe('对抗样本（P2-5：正则脱敏的已知边界，非语义识别）', () => {
    it('跨行拼接：键值在同一行内仍命中；值被换行截断后剩余片段不追脱', () => {
      const out = sanitizeL1('api_key = abc123def\nsecond 456');
      expect(out).toContain('[API_KEY]');
      expect(out).not.toContain('abc123def');
      // 换行后的「second 456」与上一行无键名关联，不做跨行语义关联
      expect(out).toContain('second 456');
    });

    it('全角分隔符：全角冒号「：」命中；全角等号「＝」不在分隔符类 → 不命中（已知边界）', () => {
      const outColon = sanitizeL1('password：AbcDef12345');
      expect(outColon).toContain('[API_KEY]');
      expect(outColon).not.toContain('AbcDef12345');
      const outEq = sanitizeL1('password＝AbcDef12345');
      expect(outEq).toContain('AbcDef12345');
    });

    it('裸 Base64（无键名/无认证头上下文）不命中——Base64 也用于正常技术内容，防止误伤', () => {
      const out = sanitizeL1('payload YWRtaW46c2VjcmV0MTIz decode ok');
      expect(out).toContain('YWRtaW46c2VjcmV0MTIz');
    });

    it('拆词（C o o k i e）不命中——逐词正则不做模糊匹配；正常拼写 Cookie: 仍命中', () => {
      const split = sanitizeL1('C o o k i e : abcdefgh');
      expect(split).toContain('abcdefgh');
      const normal = sanitizeL1('Cookie: abcdefgh');
      expect(normal).not.toContain('abcdefgh');
      expect(normal).toContain('[API_KEY]');
    });
  });
});

describe('每层生成规格（§2.1 / §16.1）', () => {
  it('LAYER_SPECS 覆盖 L1–L6 六层，来源阶梯递进', () => {
    expect(LAYER_SPECS.map((s) => s.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
    expect(LAYER_SPECS[1].from).toContain('L1');
    expect(LAYER_SPECS[3].from).toContain('L3');
  });

  it('批次40：绝对下限改为「相对下限的地板」——maxChars 不变，minChars 只做兜底', () => {
    const by = (id: string) => LAYER_SPECS.find((s) => s.id === id)!;
    expect([by('L2').maxChars, by('L2').minChars, by('L2').minRatio]).toEqual([300, 12, 0.4]);
    expect([by('L3').maxChars, by('L3').minChars, by('L3').minRatio]).toEqual([200, 12, 0.35]);
    expect([by('L4').maxChars, by('L4').minChars, by('L4').minRatio]).toEqual([120, 12, 0.3]);
    expect([by('L5').maxChars, by('L5').minChars, by('L5').minRatio]).toEqual([60, 10, 0.25]);
    expect(by('L1').maxChars).toBeNull();  // L1 不限长度
  });

  it('批次40：产物长度区间随源文算——短源不再被要求扩写，产物不得长于源', () => {
    const l2 = LAYER_SPECS.find((s) => s.id === 'L2')!;
    // 无源文 → 退回地板
    expect(layerBand(l2)).toEqual({ min: 12, max: 300 });
    expect(layerBand(l2, '')).toEqual({ min: 12, max: 300 });
    // 批次39 实测的结构性不可能样例：18 字源要求 ≥50 字摘要
    expect(layerBand(l2, 'x'.repeat(18))).toEqual({ min: 12, max: 18 });
    // 200 字源 → 下限按 40% 算，上限不许超过源文（压缩不是扩写）
    expect(layerBand(l2, 'x'.repeat(200))).toEqual({ min: 80, max: 200 });
    // 超长源 → 相对下限被本层上限的 80% 钳住，避免 min > max
    expect(layerBand(l2, 'x'.repeat(5000))).toEqual({ min: 240, max: 300 });
  });

  it('批次40：深度上限按 L1 有效字数分档（料不够就不硬凑深层）', () => {
    expect(depthCapFor(meaningfulLength('x'.repeat(30)))).toBe('L2');
    expect(depthCapFor(meaningfulLength('x'.repeat(59)))).toBe('L2');
    expect(depthCapFor(meaningfulLength('x'.repeat(60)))).toBe('L3');
    expect(depthCapFor(meaningfulLength('x'.repeat(119)))).toBe('L3');
    expect(depthCapFor(meaningfulLength('x'.repeat(120)))).toBe('L4');
    expect(depthCapFor(meaningfulLength('x'.repeat(240)))).toBe('L5');
    // 连入库门槛（30）都不够 → 这行就停在 L1
    expect(depthCapFor(29)).toBeNull();
    expect(depthCapFor(0)).toBeNull();
  });

  it('L4 必须以「适用场景」开头，L5 必须以「边界条件」开头；L6 keywords ≤30（§16.1 rule）', () => {
    expect(LAYER_SPECS.find((s) => s.id === 'L4')!.mustStartWith).toBe('适用场景');
    expect(LAYER_SPECS.find((s) => s.id === 'L5')!.mustStartWith).toBe('边界条件');
    expect(LAYER_SPECS.find((s) => s.id === 'L6')!.maxKeywords).toBe(30);
    const l5 = LAYER_SPECS.find((s) => s.id === 'L5')!;
    expect(checkLayerSpec(l5, '只写了边界但没有写全，长度足够的一段洞察内容').join()).toContain('边界条件');
    const l6 = LAYER_SPECS.find((s) => s.id === 'L6')!;
    const tooMany = JSON.stringify({ keywords: Array.from({ length: 31 }, (_, i) => `k${i}`), projections: [] });
    expect(checkLayerSpec(l6, tooMany).join()).toContain('L6 keywords 超限：31 > 30');
  });

  it('checkLayerSpec 能抓出超长/过短/缺关键词/未按格式契约开头', () => {
    const l4 = LAYER_SPECS.find((s) => s.id === 'L4')!;
    expect(checkLayerSpec(l4, '太短')).toContain('L4 过短：2 < 12 字（过度压缩，§16.1）');
    expect(checkLayerSpec(l4, 'x'.repeat(121)).join()).toContain('L4 超长');
    expect(checkLayerSpec(l4, '没有场景说明的一段足够长度的模式归纳文字描述').join()).toContain('适用场景');
    expect(checkLayerSpec(LAYER_SPECS[5], '不是JSON').join()).toContain('合法 JSON');
    expect(checkLayerSpec(l4, '适用场景：支付链路压测与扩容评审时核对连接池配置')).toEqual([]);
  });

  it('批次40：超短源文不会被判成「min > max」的死区间（地板不得盖过上限）', () => {
    const l5 = LAYER_SPECS.find((s) => s.id === 'L5')!;
    const band = layerBand(l5, 'x'.repeat(4));
    expect(band.min).toBeLessThanOrEqual(band.max!);
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
  // 批次40：深度上限按 L1 有效字数给（≥240 才允许炼到 L5），所以全链用例用长原文；
  // 逐层产物必须**一层比一层短**（压缩不是扩写），下列样本已按 layerBand 实测区间校验。
  const RAW_LONG = '线上事故复盘（2026-10-12 支付链路）：支付接口大面积超时，值班排查后确认根因是连接池配置项 pool_size=5 过小，' +
    '高峰期活跃连接被打满后请求排队，网关侧 504 状态码激增。临时把 pool_size 调到 50 并同步调大 connect_timeout=800ms 后恢复，' +
    '错误码 SQLSTATE 40001 也随之消失。联系人：张三，电话 13800138000，数据库地址 tcp://prod-db:5432/app，api_key: sk-abcdef1234567890abcdef。' +
    '复盘结论：容量类参数必须压测验证后再上线，压测环境要复现生产并发量，不能只按单机配置推算；' +
    '同类隐患在订单查询链路也出现过一次，当时的处置同样是先扩连接池再查慢查询，没有留下压测记录，这次要补齐。';

  const LAYERS = {
    content_l1: '（Provider 的 L1 不落库，内核以 sanitizeL1 为准）',
    content_l2: '支付链路超时复盘：根因是连接池配置项过小（pool_size=5），高峰连接打满后请求排队，网关 504 状态码激增；' +
      '调到 pool_size=50、connect_timeout=800ms 后恢复，错误码随之下清。结论是容量类参数须压测验证后再上线。',
    content_l3: '成功点：值班快速定位到连接池配置项根因并恢复；失败点：上线前没做并发压测，容量参数只按单机推算；经验教训：容量类参数必须压测验证。',
    content_l4: '适用场景：支付链路与网关容量评审。连接池、超时这类配置项要与生产并发量一起核对，不能只按单机默认值上线。',
    content_l5: '边界条件：仅适用于同 project_id 且网关前置的部署环境，非支付链路仍需另做压测。',
    content_l6: JSON.stringify({ keywords: ['连接池', '超时', '504', 'SQLSTATE 40001', '压测'], projections: [{ layer: 'L2', relevance: 0.9 }] }),
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
    const r = await coreWrite({ content: RAW_LONG, category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
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
      content_l4: '太短', // 违反 L4 相对下限 + 格式契约前缀（批次40）
    }));
    const r = await coreWrite({ content: RAW_LONG, category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
    expect(r.refined_by).toBe('llm_partial'); // 批次27 P2-4：LLM 产出中断（L4 违规停梯），L2/L3 仍合规
    expect(r.spec_violations?.join()).toContain('L4');
    const m = (await s.listMemories({}))[0];
    expect(m.layer).toBe('L3');
    expect(m.content).toBe(LAYERS.content_l3);
    expect(m.content_l4).toBeUndefined();
    expect(m.content_l5).toBeUndefined();
    // 批次40-C：L6 是独立通道——L4 判废不影响索引照产出，但行上 layer 仍按连续叙事层记，绝不用 L6 冒充深度
    expect(m.content_l6).toBe(LAYERS.content_l6);
    expect(Object.keys(m.layer_specs ?? {})).toEqual(['L1', 'L2', 'L3', 'L6']);
  });

  it('批次40 深度上限：短 L1 只炼到 L2+L6，L3–L5 一次都不调', async () => {
    const s = new InMemoryStorage();
    const asked: string[] = [];
    // 压缩率按源文给：RAW 脱敏后 90 字 → L2 允许 36–90 字（LAYERS.content_l2 是给长原文的，这里换短的）
    const L2_SHORT = '支付接口超时复盘：根因是连接池 pool_size=5 过小，调到 50 后恢复；容量类参数上线前必须压测。';
    const llm = fakeRefine(async (_m, _raw, _c, ctx) => {
      asked.push(ctx.request_id);
      return { ...LAYERS, content_l2: L2_SHORT };
    });
    // RAW 脱敏后有效字 50 → depthCapFor=L2：料不够就不硬凑深层（硬凑只能编造）
    const r = await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
    expect(r.refined_by).toBe('llm');
    expect(r.spec_violations).toEqual([]);
    const m = (await s.listMemories({}))[0];
    expect(m.content_l2).toBe(L2_SHORT);
    expect(m.content_l3).toBeUndefined();
    expect(m.content_l4).toBeUndefined();
    expect(m.content_l5).toBeUndefined();
    expect(m.content_l6).toBe(LAYERS.content_l6);
    expect(Object.keys(m.layer_specs ?? {})).toEqual(['L1', 'L2', 'L6']);
    expect(asked).toHaveLength(1); // 旧 Provider 一次返回多层：本行只该被调用一次
  });

  it('批次40 深度上限：有料但太短（有效字 <30）→ 整行停在 L1，一次引擎都不调', async () => {
    const s = new InMemoryStorage();
    let called = 0;
    const llm = fakeRefine(async () => { called++; return LAYERS; });
    // 带硬事实所以过了质量门（错误码 + 40001），但有效字只有 24 → depthCapFor = null
    const r = await coreWrite({ content: '错误码 SQLSTATE 40001 在压测环境复现了。', category: 'pitfall', project_id: 'P1' }, lctx(s, llm));
    expect(called).toBe(0);
    expect(r.dedup.action).not.toBe('filtered');
    expect(r.refined_by).toBe('stub');
    const m = (await s.listMemories({}))[0];
    expect(m.layer).toBe('L1');
    expect(m.content_l2).toBeUndefined();
    expect(m.refined_by).toBe('stub');
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

  it('批次27 P2-2：非法 layer → E_BAD_LAYER，且不写 log_view 成功审计', async () => {
    const s = new InMemoryStorage();
    await coreWrite({ content: RAW, category: 'pitfall', project_id: 'P1' }, wctx(s));
    await expect(coreBrowse({ layer: 'L9' as 'L1', project_id: 'P1' } as never, {
      storage: s, request_id: 'req_bad_layer', now: 1,
    })).rejects.toThrow('E_BAD_LAYER');
    const views = await s.queryAudit({ action: 'log_view' });
    expect(views).toEqual([]);
  });
});
