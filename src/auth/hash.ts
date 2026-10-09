// REQ-005 T2：密码哈希与校验（规格 §4.1 安全）
// 要求：哈希存储、传输加密、界面不回显；校验用常量时间比较防时序。
// 零依赖：使用 Node 内置 crypto.scrypt + timingSafeEqual（满足 4.1，无需引入 bcrypt/argon2）。
// ⚠ 本模块只允许在 Node 侧（单测 / 后端）使用。前端**绝不可静态 import**本模块：
//   任何顶层 node 内置 import 都会让 Vite dev 抛 "externalized for browser compatibility"
//   中断整个模块图 → 页面白屏。前端登录一律走后端（useLoginMirror）。
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';

const KEYLEN = 64;
const SALT_BYTES = 16;

/**
 * 对明文密码做加盐哈希。
 * 返回 `salt:derived`（hex），每次 salt 随机 → 同明文两次结果不同；不回显明文。
 */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = scryptSync(plain, salt, KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * 校验明文与存储哈希是否匹配。
 * 任意阶段异常（格式错/缺字段）一律返回 false，不抛出；比较用 timingSafeEqual 防时序。
 */
export function verifyPassword(plain: string, hash: string): boolean {
  const sep = hash.indexOf(':');
  if (sep < 0) return false;
  const salt = hash.slice(0, sep);
  const derivedHex = hash.slice(sep + 1);
  if (!salt || !derivedHex) return false;
  let derived: Buffer;
  try {
    derived = Buffer.from(derivedHex, 'hex');
  } catch {
    return false;
  }
  const attempt = scryptSync(plain, salt, KEYLEN);
  if (attempt.length !== derived.length) return false;
  return timingSafeEqual(attempt, derived);
}
