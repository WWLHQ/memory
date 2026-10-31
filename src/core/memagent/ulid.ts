// 简易 ULID：48bit 时间戳 + 80bit 随机（crypto 级），同毫秒内单调递增（契约 §3.1）
const ENC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ts: number): string {
  let t = ts, out = '';
  for (let i = 0; i < 10; i++) {
    out = ENC[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function randChars(n: number): string {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += ENC[bytes[i] % 32];
  return out;
}

/** 同毫秒内递增：从末尾向前逢 32 进位 */
function increment(s: string): string {
  const chars = s.split('');
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ENC.indexOf(chars[i]);
    if (idx < 31) {
      chars[i] = ENC[idx + 1];
      return chars.join('');
    }
    chars[i] = ENC[0];
  }
  return randChars(s.length);
}

let lastTime = 0;
let lastRand = '';

export function ulid(now = Date.now()): string {
  if (now <= lastTime) {
    lastRand = increment(lastRand);
    return `${encodeTime(lastTime)}${lastRand}`;
  }
  lastTime = now;
  lastRand = randChars(16);
  return `${encodeTime(now)}${lastRand}`;
}
