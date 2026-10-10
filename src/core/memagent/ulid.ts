// 简易 ULID：48bit 时间戳 + 80bit 随机，单调性满足契约 §3.1
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
  let out = '';
  for (let i = 0; i < n; i++) out += ENC[Math.floor(Math.random() * 32)];
  return out;
}

export function ulid(now = Date.now()): string {
  return `${encodeTime(now)}${randChars(16)}`;
}
