// 跨 iframe 登录态共享（localStorage）—— REQ-005 T11 补充
// Overview 通览页用 iframe 嵌套三个子页面，三者同源同域，可共享 localStorage。
// 机制：
//   - login 成功后用 sessionId 写入 localStorage 一条键 `session:realpage`；
//   - 本 hook 每次挂载读该键作为"权威 session"，与 useLoginMirror 的本地 session 合并优先使用。
//   - logout 时同时清除两处的 session。
// 注意：使用 localStorage 而非 sessionStorage，确保同域下所有 iframe 都能读写同一份数据。
import { useEffect, useRef } from 'react';

const KEY = 'session:realpage';

export function getStoredSessionId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(KEY) ?? null;
}
export function storeSessionId(sid: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, sid);
}
export function clearStoredSessionId(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}

/** 判断当前跨 iframe 是否已有活跃 session。测试时可调用 setTestOverride(true) 强制返回 true */
let _testOverride = false;
export function setTestOverride(on: boolean): void {
  _testOverride = on;
}
export function hasActiveSession(): boolean {
  if (_testOverride) return true;
  if (typeof localStorage === 'undefined') return false;
  const sid = localStorage.getItem(KEY);
  return !!sid && sid.length > 0;
}

/**
 * 返回一个"权威 session_id"（跨 iframe 共享）或 null。
 * 调用方可将该值注入 useLoginMirror 的 login 回调查询（通过 X-Auth-Session 头）。
 * 当前后端 /api/me 暂不支持该头识别，只作占位；后续接入后端认证后可启用。
 */
export function useCrossTabAuth() {
  const sidRef = useRef<string | null>(null);
  useEffect(() => {
    sidRef.current = getStoredSessionId();
    const onStore = () => { sidRef.current = getStoredSessionId(); };
    window.addEventListener('storage', onStore);
    return () => window.removeEventListener('storage', onStore);
  }, []);
  return sidRef.current;
}
