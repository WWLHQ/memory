// L0 恢复码（批次37-G）：管理密码忘了还能把 L0 原数据库捞回来的唯一通道。
// 原理一句话：同一个 DEK（数据密钥）**包两份**——一份用管理密码派生的 KEK 包（admin_wrap），
// 一份用随机恢复码派生的 KEK 包（recovery_wrap）。恢复码是 256bit 随机数，不是密码的衍生物，
// 所以「设了弱密码」不会连累恢复码；反过来恢复码也推不出密码。
// 一次性口径（用户拍板）：恢复码用过即作废并立刻换新，新码必须重新导出恢复卡才能继续——
// 否则一张被抄走/拍照的纸能无限次开门。作废与换新在同一次改写里完成，不留「旧码还能用」的窗口。
// 诚实边界（必须写进恢复卡与文档）：
//   · 管理密码 + 恢复码**同时**丢失 = 数据不可恢复，本模块不做任何「后门」或万能密钥；
//   · 恢复卡能还原的是 L0 原数据库的解密能力，不是记忆库正文——L1–L6 一直是明文/可重生成；
//   · 恢复码只在生成/轮换那一次返回给调用方，之后任何接口都只回「有没有、什么时候建的」，绝不回显。
import { createHash } from 'node:crypto';
import {
  deriveKek, generateDek, newWrapSalt, randomBytes, unwrapSecret, wrapSecret, type L0Wrap,
} from './crypto.ts';

/** 恢复码熵源字节数：32 字节 = 256bit，与 DEK 同强度 */
export const RECOVERY_CODE_BYTES = 32;
/** 卡面上每段字符数（纯可读性分组，不影响校验） */
const CODE_GROUP = 4;

/** 生成恢复码（base64url，43 字符，无填充）——调用方拿到的是**唯一一次**明文 */
export function generateRecoveryCode(): string {
  return Buffer.from(randomBytes(RECOVERY_CODE_BYTES)).toString('base64url');
}

/** 卡面展示：每 4 字符一段，便于手抄/打印，段间空格 */
export function formatRecoveryCode(code: string): string {
  const raw = normalizeRecoveryCode(code);
  return (raw.match(new RegExp(`.{1,${CODE_GROUP}}`, 'g')) ?? []).join(' ');
}

/**
 * 输入归一：只认「去掉所有空白后的 base64url 串」。
 * 手抄时限格换行、复制时带空格都不该导致恢复失败——但也仅此而已，不做大小写折叠以外的宽容。
 */
export function normalizeRecoveryCode(input: string): string {
  return typeof input === 'string' ? input.replace(/\s+/g, '') : '';
}

/** 用恢复码派生 KEK 并包裹 DEK（与 admin_wrap 完全同构，只是口令来源不同） */
export async function wrapDekWithRecovery(dek: Uint8Array, code: string): Promise<L0Wrap> {
  const secret = normalizeRecoveryCode(code);
  if (secret.length < 32) {
    throw new Error('恢复码长度不足（应由本模块生成，不接受用户自拟）');
  }
  const salt = newWrapSalt();
  return { salt, ...(await wrapSecret(dek, await deriveKek(secret, salt))) };
}

/** 用恢复码解开 DEK；码错 → 抛错（调用方按「口令不符」处理，绝不区分「码格式对但解不开」） */
export async function unwrapDekWithRecovery(wrap: L0Wrap, code: string): Promise<Uint8Array> {
  return unwrapSecret(wrap, await deriveKek(normalizeRecoveryCode(code), wrap.salt));
}

/** 一次性建好「DEK + 管理密码包 + 恢复码包」：首启向导用的就是它 */
export async function createKeyringSecrets(password: string, code: string): Promise<{
  dek: Uint8Array; admin_wrap: L0Wrap; recovery_wrap: L0Wrap; recovery_code: string;
}> {
  const dek = generateDek();
  const salt = newWrapSalt();
  return {
    dek,
    admin_wrap: { salt, ...(await wrapSecret(dek, await deriveKek(password, salt))) },
    recovery_wrap: await wrapDekWithRecovery(dek, code),
    recovery_code: code,
  };
}

/**
 * 卡与库的对应指纹：取两处**公开**材料（admin_wrap.salt / recovery_wrap.salt）做 sha256 前 8 位。
 * 用途只有一个——让用户手上几张恢复卡分得清是哪台机器/哪个库的，不构成任何解密线索。
 * 缺任一侧（还没设密码 / 还没生成恢复码）时返回空串，卡面如实显示「未初始化」。
 */
export function keyringFingerprint(adminWrap?: L0Wrap | null, recoveryWrap?: L0Wrap | null): string {
  if (!adminWrap?.salt || !recoveryWrap?.salt) return '';
  return createHash('sha256').update(`${adminWrap.salt}|${recoveryWrap.salt}`).digest('hex').slice(0, 8);
}

export interface RecoveryCardInput {
  /** 恢复码明文（只在这一次进卡片） */
  code: string;
  fingerprint: string;
  /** 数据根与 L0 原数据库路径：卡上写位置，让用户知道这张卡开的是哪个文件 */
  l0_path: string;
  created_at: number;
  /** 管理密码是否已设置（首启向导里恒为真，恢复流程里用于说明现状） */
  has_admin_password: boolean;
}

/**
 * 恢复卡正文（纯文本：可打印、可抄、存密码管理器，不依赖本应用才能读）。
 * 里面**只有**恢复码与公开指纹，绝不写管理密码、不写 DEK、不写任何派生中间值。
 */
export function buildRecoveryCard(input: RecoveryCardInput): string {
  const when = new Date(input.created_at);
  const groups = formatRecoveryCode(input.code);
  return [
    'MultiAgent Memory — L0 原数据库恢复卡',
    '========================================',
    '',
    '这张卡是什么：L0 原数据库（memories.l0.json）的**一次性**恢复凭据。',
    '什么时候用：忘记 L0 管理密码时，在「账号与安全 → L0 恢复」页输入下面的恢复码。',
    '',
    `恢复码（${RECOVERY_CODE_BYTES * 8} bit，共 ${normalizeRecoveryCode(input.code).length} 字符）：`,
    groups,
    '',
    `库指纹：${input.fingerprint || '（未初始化）'}`,
    `对应文件：${input.l0_path}`,
    `生成时间：${when.toISOString()}（本地 ${when.toLocaleString()}）`,
    `管理密码是否已设置：${input.has_admin_password ? '是' : '否'}`,
    '',
    '必读三条：',
    '1) 用过一次即作废。恢复成功后应用会立刻发一张**新**恢复卡，旧卡当场失效——请重新导出并保存新卡。',
    '2) 管理密码 + 本恢复码**同时**丢失，L0 原文不可恢复。本应用没有任何后门或万能密钥。',
    '3) 请把它存到与电脑分开的地方（打印/密码管理器/U 盘）。和数据根放在同一处的备份，在同一次事故里会一起没了。',
    '',
    '本卡不含管理密码，也不含任何可直接推导密码的信息；L1–L6 记忆正文不在 L0 库里，丢失本卡不影响它们。',
  ].join('\n');
}

/** 恢复码校验的失败文案与成功文案分开，但**不**告诉用户「码对不对」以外的信息 */
export const RECOVERY_BAD_CODE = '恢复码无效（与本机密钥环不匹配）。请核对是否用了最新那张卡——旧卡用过即作废。';
