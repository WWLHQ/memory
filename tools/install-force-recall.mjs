#!/usr/bin/env node
// A 方案：把「UserPromptSubmit 强制召回钩子」合并进宿主级 settings.json。
// 默认只预演（dry-run），只有显式 --apply 才写文件；写入前必留 .bak 备份，绝不覆盖其它键。
// 宿主差异：CodeBuddy Code CLI 读 ~/.codebuddy/settings.json，WorkBuddy 桌面端社区实测读
// ~/.workbuddy/settings.json；--host 可指定，未指定时按存在的配置文件探测，多个则要求显式选择。
//
// 用法：
//   node tools/install-force-recall.mjs                       # 预演，打印将写入的内容
//   node tools/install-force-recall.mjs --host=codebuddy --apply
//   node tools/install-force-recall.mjs --host=workbuddy --apply
//   node tools/install-force-recall.mjs --uninstall --apply    # 只摘掉本钩子，其余键原样保留
//
// 改完 settings 后 hooks 不热加载：需重启宿主并在 /hooks 面板审核后才生效。
import { readFile, writeFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOOK_SCRIPT = join(ROOT, '.codebuddy', 'hooks', 'force_recall.mjs');
const HOOK_TAG = 'force_recall.mjs';

const HOSTS = {
  codebuddy: join(homedir(), '.codebuddy', 'settings.json'),
  workbuddy: join(homedir(), '.workbuddy', 'settings.json'),
};

function parseArgs(argv) {
  const o = { host: null, apply: false, uninstall: false };
  for (const a of argv) {
    if (a.startsWith('--host=')) o.host = a.slice(7);
    else if (a === '--apply') o.apply = true;
    else if (a === '--uninstall') o.uninstall = true;
  }
  if (o.host && !HOSTS[o.host]) throw new Error(`未知 --host=${o.host}（可选 codebuddy / workbuddy）`);
  return o;
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

function pickHosts(explicit, apply) {
  if (explicit) return [HOSTS[explicit]];
  const found = Object.keys(HOSTS).filter((k) => existsSync(HOSTS[k]));
  if (found.length === 0) throw new Error('未发现宿主 settings.json，请用 --host=codebuddy|workbuddy 指定');
  // 真正写入时必须明确目标，避免同时改到 CLI 与桌面端两份配置；预演则把所有候选都摊开给用户看。
  if (apply && found.length > 1) {
    throw new Error(`发现多个宿主配置（${found.join(', ')}），--apply 时请用 --host 明确选择，避免装错地方`);
  }
  return found.map((k) => HOSTS[k]);
}

function hookEntry() {
  return {
    hooks: [{
      type: 'command',
      command: `node "${HOOK_SCRIPT.replace(/\\/g, '/')}"`,
      timeout: 5,
    }],
  };
}

function merge(settings, uninstall) {
  const next = { ...settings };
  const hooks = { ...(settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) };
  const ups = Array.isArray(hooks.UserPromptSubmit) ? [...hooks.UserPromptSubmit] : [];
  const kept = ups.filter((entry) => !JSON.stringify(entry).includes(HOOK_TAG));
  if (!uninstall) kept.push(hookEntry());
  if (kept.length) hooks.UserPromptSubmit = kept;
  else delete hooks.UserPromptSubmit;
  if (Object.keys(hooks).length) next.hooks = hooks;
  else delete next.hooks;
  return next;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = pickHosts(args.host, args.apply);

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const nodeMinor = Number(process.versions.node.split('.')[1]);
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 18)) {
    throw new Error(`当前 Node ${process.versions.node} 不支持原生 TS 剥离，钩子会 fail-open 静默不生效；请升级到 22.18+`);
  }
  if (!(await exists(HOOK_SCRIPT))) throw new Error(`钩子脚本不存在：${HOOK_SCRIPT}`);

  for (const target of targets) {
    let current = {};
    if (await exists(target)) {
      try {
        current = JSON.parse(await readFile(target, 'utf8'));
      } catch (e) {
        throw new Error(`宿主配置不是合法 JSON，拒绝改写：${target}（${e.message}）`);
      }
    }
    const output = JSON.stringify(merge(current, args.uninstall), null, 2) + '\n';

    console.log(`目标：${target}`);
    console.log(`动作：${args.uninstall ? '摘除' : '合并'} UserPromptSubmit 强制召回钩子`);
    console.log(`钩子：node ${HOOK_SCRIPT}`);
    console.log('--- 将写入的内容 ---');
    console.log(output);
    if (args.apply) {
      if (await exists(target)) await writeFile(`${target}.bak`, await readFile(target, 'utf8'), 'utf8');
      await writeFile(target, output, 'utf8');
      console.log(`WROTE ${target}（备份 ${target}.bak）`);
    }
  }
  if (!args.apply) {
    console.log('DRY-RUN：未写任何文件。确认无误后加 --apply（多个宿主时须加 --host=codebuddy|workbuddy）。');
  } else {
    console.log('hooks 不热加载：请重启宿主并在 /hooks 面板审核后生效；8204 未启动时钩子会静默放行。');
  }
}

await main();
