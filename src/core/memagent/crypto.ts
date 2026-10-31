// L0 加密层（§4.1）：AES-256-GCM + PBKDF2 派生密钥。
// 密钥不落地：每次加密随机 salt + iv，密钥只从 L0 授权密码现场派生，绝不存储。
//
// 运行环境覆盖（同一份代码，零分支）：
//   · Node 主进程 / 单测 → node:crypto（createCipheriv，GCM tag 分离存储）
//   · Electron 渲染进程 / 浏览器 → WebCrypto（crypto.subtle，tag 附在密文尾部）
//   · jsdom（vitest）→ 无 crypto.subtle，自动降级到 node:crypto
//
// 密文格式（JSON 序列化后存入 Memory.content_l0_enc）：
//   { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter, salt, iv, tag, ct }
//   salt/iv/tag/ct 均为 base64。tag 独立存放（GCM 认证标签），两种后端产出一致。
import { MemAgentError } from './errors.ts';

export interface L0Envelope {
  v: 1;
  alg: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iter: number;      // PBKDF2 迭代次数
  salt: string;      // base64
  iv: string;        // base64（12 字节，GCM 推荐）
  tag: string;       // base64（16 字节认证标签）
  ct: string;        // base64 密文
}

/** v2 信封（§4.4）：DEK 直加密，无逐条 salt/KDF；密钥只在主进程内存 */
export interface L0EnvelopeV2 {
  v: 2;
  alg: 'AES-256-GCM';
  iv: string;
  tag: string;
  ct: string;
}

/** wrapped DEK：密码派生 KEK 包裹（salt 随记录存，iv/tag/ct 为包裹结果） */
export interface L0Wrap {
  salt: string;
  iv: string;
  tag: string;
  ct: string;
}

export const L0_KEK_ITER = 100_000;
export const L0_DEK_BYTES = 32;
const L0_WRAP_SALT_BYTES = 16;

const ITER = 100_000;          // PBKDF2 迭代（§4.1）
const KEY_BYTES = 32;          // AES-256
const IV_BYTES = 12;
const SALT_BYTES = 16;
const TAG_BYTES = 16;

// ─── base64（Node Buffer / 浏览器 btoa 双兼容） ────────────────────────────────

function b64(buf: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function rand(n: number): Uint8Array {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint8Array(n));
  // 兜底：Node 无 global crypto 时（极老版本）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  return new Uint8Array(nodeCrypto.randomBytes(n));
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** PBKDF2-SHA256 派生 AES-256 原始密钥（node:crypto 路径，不落地，每次现算） */
async function deriveKeyNode(password: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  // 批次26-B P1-11：改用异步 pbkdf2（libuv 线程池），100k 轮不再阻塞主进程事件循环（IPC 全停数百 ms）
  return new Promise((resolve, reject) => {
    nodeCrypto.pbkdf2(password, Buffer.from(salt), iter, KEY_BYTES, 'sha256', (err, dk) => {
      if (err) reject(err);
      else resolve(new Uint8Array(dk));
    });
  });
}

/** 是否有可用 WebCrypto */
function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.importKey === 'function';
}

/** WebCrypto 路径：deriveKey 出 CryptoKey */
async function deriveKeyWeb(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function deriveKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey | Uint8Array> {
  if (hasWebCrypto()) return deriveKeyWeb(password, salt, iter);
  return deriveKeyNode(password, salt, iter);
}

/**
 * 加密 L0 原文（§4.1）。
 * 返回 JSON 信封字符串，可直接存入 Memory.content_l0_enc。
 */
export async function encryptL0(plain: string, password: string): Promise<string> {
  if (!password || password.length < 6) {
    throw new MemAgentError('E_AUTH_L0', 'L0 加密密码须 ≥6 位');
  }
  const salt = rand(SALT_BYTES);
  const iv = rand(IV_BYTES);
  const key = await deriveKey(password, salt, ITER);

  let ct: Uint8Array;
  let tag: Uint8Array;

  if (key instanceof Uint8Array) {
    // node:crypto：GCM tag 由 getAuthTag() 单独取
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
    ct = new Uint8Array(Buffer.concat([cipher.update(enc(plain), 'utf8'), cipher.final()]));
    tag = new Uint8Array(cipher.getAuthTag());
  } else {
    // WebCrypto：tag 附在密文尾部 16 字节
    const out = new Uint8Array(await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      enc(plain),
    ));
    ct = out.slice(0, out.length - TAG_BYTES);
    tag = out.slice(out.length - TAG_BYTES);
  }

  const env: L0Envelope = {
    v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: ITER,
    salt: b64(salt), iv: b64(iv), tag: b64(tag), ct: b64(ct),
  };
  return JSON.stringify(env);
}

/** 解析信封；非法格式返回 null（调用方按 E_AUTH_L0 处理） */
export function parseL0Envelope(raw: string): L0Envelope | null {
  try {
    const o = JSON.parse(raw) as Partial<L0Envelope>;
    if (o?.alg !== 'AES-256-GCM' || !o.salt || !o.iv || !o.ct || !o.tag || !o.iter) return null;
    return o as L0Envelope;
  } catch {
    return null;
  }
}

/**
 * 解密 L0 原文。密码错 → GCM 认证失败抛 E_AUTH_L0（与 §4.1 口径一致）。
 */
export async function decryptL0(envelope: string, password: string): Promise<string> {
  const env = parseL0Envelope(envelope);
  if (!env) throw new MemAgentError('E_AUTH_L0', 'L0 密文格式非法（非本系统生成）');
  const salt = unb64(env.salt);
  const iv = unb64(env.iv);
  const tag = unb64(env.tag);
  const ct = unb64(env.ct);
  const key = await deriveKey(password, salt, env.iter);

  if (key instanceof Uint8Array) {
    // node:crypto：setAuthTag 后 final() 校验 GCM tag，失败即抛
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
    d.setAuthTag(Buffer.from(tag));
    try {
      return dec(new Uint8Array(Buffer.concat([d.update(Buffer.from(ct)), d.final()])));
    } catch {
      throw new MemAgentError('E_AUTH_L0', 'L0 密码错误或密文被篡改');
    }
  }

  // WebCrypto：把 ct||tag 拼回再解
  const body = new Uint8Array(ct.length + tag.length);
  body.set(ct, 0);
  body.set(tag, ct.length);
  try {
    const out = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      body as unknown as BufferSource,
    );
    return dec(new Uint8Array(out));
  } catch {
    throw new MemAgentError('E_AUTH_L0', 'L0 密码错误或密文被篡改');
  }
}

// ─── v2：DEK 直加密 + KEK 包裹（§4.4；仅主进程使用，密码/DEK 不落盘） ──────────

/** 随机字节（salt/DEK 生成用；测试可注入替代随机源） */
export function randomBytes(n: number): Uint8Array {
  return rand(n);
}

/** 生成 32 字节 DEK（只在主进程内存持有） */
export function generateDek(): Uint8Array {
  return rand(L0_DEK_BYTES);
}

/** 随机包裹 salt（base64，随 keyring 记录持久化） */
export function newWrapSalt(): string {
  return b64(rand(L0_WRAP_SALT_BYTES));
}

/** PBKDF2-SHA256 派生 32 字节 KEK（仅主进程：Node crypto；浏览器不派生任何 L0 密钥） */
export async function deriveKek(password: string, saltB64: string, iter = L0_KEK_ITER): Promise<Uint8Array> {
  return deriveKeyNode(password, unb64(saltB64), iter);
}

async function encryptRaw(data: Uint8Array, key: Uint8Array): Promise<{ iv: string; tag: string; ct: string }> {
  const iv = rand(IV_BYTES);
  if (hasWebCrypto()) {
    const k = await globalThis.crypto.subtle.importKey(
      'raw', key as unknown as BufferSource, 'AES-GCM', false, ['encrypt'],
    );
    const out = new Uint8Array(await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource }, k, data as unknown as BufferSource,
    ));
    return { iv: b64(iv), tag: b64(out.slice(out.length - TAG_BYTES)), ct: b64(out.slice(0, out.length - TAG_BYTES)) };
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
  const ct = new Uint8Array(Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]));
  return { iv: b64(iv), tag: b64(new Uint8Array(cipher.getAuthTag())), ct: b64(ct) };
}

async function decryptRaw(
  ivB64: string, tagB64: string, ctB64: string, key: Uint8Array,
): Promise<Uint8Array> {
  const iv = unb64(ivB64);
  const tag = unb64(tagB64);
  const ct = unb64(ctB64);
  if (hasWebCrypto()) {
    const k = await globalThis.crypto.subtle.importKey(
      'raw', key as unknown as BufferSource, 'AES-GCM', false, ['decrypt'],
    );
    const body = new Uint8Array(ct.length + tag.length);
    body.set(ct, 0);
    body.set(tag, ct.length);
    try {
      return new Uint8Array(await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource }, k, body as unknown as BufferSource,
      ));
    } catch {
      throw new MemAgentError('E_AUTH_L0', 'L0 密钥不匹配或密文被篡改');
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
  const d = nodeCrypto.createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(iv));
  d.setAuthTag(Buffer.from(tag));
  try {
    return new Uint8Array(Buffer.concat([d.update(Buffer.from(ct)), d.final()]));
  } catch {
    throw new MemAgentError('E_AUTH_L0', 'L0 密钥不匹配或密文被篡改');
  }
}

/** 用 KEK 包裹秘密（DEK）；salt 由调用方生成并随记录存 */
export async function wrapSecret(secret: Uint8Array, kek: Uint8Array): Promise<Omit<L0Wrap, 'salt'>> {
  return encryptRaw(secret, kek);
}

/** 解开包裹；密码错 → GCM 认证失败（E_AUTH_L0） */
export async function unwrapSecret(wrap: Omit<L0Wrap, 'salt'>, kek: Uint8Array): Promise<Uint8Array> {
  return decryptRaw(wrap.iv, wrap.tag, wrap.ct, kek);
}

/** v2 信封：DEK 直加密 L0 原文 */
export async function encryptL0WithKey(plain: string, dek: Uint8Array): Promise<string> {
  const body = await encryptRaw(enc(plain), dek);
  const env: L0EnvelopeV2 = { v: 2, alg: 'AES-256-GCM', ...body };
  return JSON.stringify(env);
}

/** 解析 v2 信封；非法/旧版本返回 null（旧 v1 走 decryptL0 迁移） */
export function parseL0EnvelopeV2(raw: string): L0EnvelopeV2 | null {
  try {
    const o = JSON.parse(raw) as Partial<L0EnvelopeV2>;
    if (o?.v !== 2 || o?.alg !== 'AES-256-GCM' || !o.iv || !o.tag || !o.ct) return null;
    return o as L0EnvelopeV2;
  } catch {
    return null;
  }
}

/** 解密 v2 信封；DEK 错/密文篡改 → E_AUTH_L0 */
export async function decryptL0WithKey(envelope: string, dek: Uint8Array): Promise<string> {
  const env = parseL0EnvelopeV2(envelope);
  if (!env) throw new MemAgentError('E_AUTH_L0', 'L0 密文格式非法（非 v2 信封）');
  return dec(await decryptRaw(env.iv, env.tag, env.ct, dek));
}

/** 脱敏占位符（§2.1 L1 定义；批次10 补 [IP] / [证件号]） */
export const MASK = {
  name: '[姓名]',
  phone: '[电话]',
  email: '[邮箱]',
  idcard: '[证件号]',
  ip: '[IP]',
  key: '[API_KEY]',
  addr: '[服务地址]',
  secret: '[密钥]',
} as const;

/** 派生密钥字节数（测试/其它模块复用） */
export const L0_KEY_BYTES = KEY_BYTES;
