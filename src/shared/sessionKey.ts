/**
 * 渲染层登录态在 localStorage 的键名（单一真源）。
 * 消费方：web 页面（crossTabAuth）、Electron preload（数据面 IPC 会话自动附带，批次26-B P1-2）。
 */
export const SESSION_STORAGE_KEY = 'session:realpage';
