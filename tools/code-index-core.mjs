/**
 * 代码索引的 EOL 无关纯函数核（CODE-INDEX-EOL-FIX）。
 * 无 IO、无 git 依赖：指纹计算与索引比较都先归一化换行为 LF，
 * 从而让 core.autocrlf=true 下「git blob 存 LF / checkout 转 CRLF」
 * 不再产生假过期。内容真变更仍会改变指纹，不被静默放过。
 */
import { createHash } from 'node:crypto';

/** 把 CRLF / 单独的 CR 统一成 LF；指纹与比较都以规范化文本为准 */
export const canonical = (text) => String(text).replace(/\r\n?/g, '\n');

/** 12 位 sha256 前缀；输入先 canonical，故 LF/CRLF 同一内容指纹相同 */
export const fingerprintOf = (text) =>
  createHash('sha256').update(canonical(text)).digest('hex').slice(0, 12);

/** 索引是否最新：两侧都先 canonical，CRLF checkout 的索引与 LF 基准等价 */
export const isIndexCurrent = (written, generated) =>
  canonical(written) === canonical(generated);
