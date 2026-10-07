// 护栏：browser.js 依赖真实 DOM，其它单测不会 import 它，语法/加载期错误会漏网。
// 曾真实发生：paint() 里用了 await 却漏写 async → 整个 module 解析失败、页面空白。
// 这里用最小 DOM 桩在进程内 import browser.js，同时覆盖「语法」与「首屏渲染」。
// 渲染层严格对齐原型：首屏应产出 .card（宿主 Agent 卡）/ .gain（效果证据）/ .found（发现列表）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeEl(id) {
  return {
    id,
    value: '', // backend 隐藏输入框：空 → 内存模式（不触发网络）
    innerHTML: '',
    textContent: '',
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    closest() { return { dataset: {} }; },
  };
}

test('browser.js 可加载并完成首屏渲染（DOM 桩，原型结构）', async () => {
  const els = {
    backend: makeEl('backend'),
    cards: makeEl('cards'),
    gains: makeEl('gains'),
    found: makeEl('found'),
    toast: makeEl('toast'),
    btnDiscover: makeEl('btnDiscover'),
    formBadge: makeEl('formBadge'),
    scanState: makeEl('scanState'),
    'boot-status': makeEl('boot-status'),
  };
  globalThis.document = {
    getElementById: (id) => els[id] || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  // Node 22 的 navigator 是只读 getter，须用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  globalThis.window = globalThis;

  // 解析 + 执行模块顶层（含末尾的 boot()）；有语法错会在此抛 SyntaxError
  await import('../browser.js');
  await new Promise((r) => setTimeout(r, 0)); // 让同步 boot 收尾

  assert.equal(globalThis.__painted, true, '模块应完成首屏渲染（boot 已执行）');
  assert.match(String(els.cards.innerHTML), /class="card"/, '宿主 Agent 卡片区应被塞入 .card（对齐原型）');
  assert.match(String(els.gains.innerHTML), /class="gain"/, '效果证据区应被塞入 .gain（对齐原型）');
  assert.match(String(els.found.innerHTML), /class="found/, '一键接入发现区应被塞入 .found（对齐原型）');
  assert.equal(typeof globalThis.__getSvc, 'function', '应暴露调试入口 __getSvc');
});
