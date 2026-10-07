// 护栏：browser.js 依赖真实 DOM，其它单测不会 import 它，语法/加载期错误会漏网。
// 曾真实发生：paint() 里用了 await 却漏写 async → 整个 module 解析失败、页面空白。
// 这里用最小 DOM 桩在进程内 import browser.js，同时覆盖「语法」与「首屏渲染」。
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeEl(id) {
  return {
    id,
    value: '', // backend 输入框：空 → 内存模式（不触发网络）
    innerHTML: '',
    textContent: '',
    dataset: {},
    addEventListener() {},
    querySelectorAll() { return []; },
    closest() { return { dataset: {} }; },
  };
}

test('browser.js 可加载并完成首屏渲染（DOM 桩，内存模式）', async () => {
  const els = {
    backend: makeEl('backend'),
    app: makeEl('app'),
    oneclick: makeEl('oneclick'),
    'boot-status': makeEl('boot-status'),
  };
  globalThis.document = {
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
  };
  // Node 22 的 navigator 是只读 getter，须用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.window = globalThis;

  // 解析 + 执行模块顶层（含末尾的 paint()）；有语法错会在此抛 SyntaxError
  await import('../browser.js');
  await new Promise((r) => setTimeout(r, 0)); // 让 async paint() 完成

  assert.equal(globalThis.__painted, true, '模块应完成首屏渲染（paint 已执行）');
  assert.match(String(els.app.innerHTML), /onboard-page/, 'app 应被塞入渲染结果');
  assert.equal(typeof globalThis.__getSvc, 'function', '应暴露调试入口 __getSvc');
});
