// A4：本机后端地址单一真源（src/web/backend.ts）
// 1) 解析规则：?backend= / ?agentBackend=（空值 = 显式关闭）
// 2) 静态断言：src/web 下除 backend.ts 外不得再出现 8200/8201 字面量
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { HOME_BASE, ONBOARD_BASE, backendParam, agentBackendParam, homeBaseUrl, onboardBaseUrl, discoverTrustedDevBackend, rememberHomeBase } from '../backend.ts';

function goto(search: string): void {
  window.history.replaceState({}, '', `/index.html${search}`);
}

describe('A4 backend.ts 解析规则', () => {
  beforeEach(() => { goto(''); sessionStorage.clear(); });

  it('默认值：HOME_BASE / ONBOARD_BASE 各自独立', () => {
    expect(HOME_BASE).toBe('http://localhost:8201');
    expect(ONBOARD_BASE).toBe('http://localhost:8200');
    expect(homeBaseUrl()).toBe(HOME_BASE);
    expect(onboardBaseUrl()).toBe(ONBOARD_BASE);
  });

  it('?backend= 覆盖 home；agentOnboard 未给 agentBackend 时回落 backend', () => {
    goto('?backend=http://127.0.0.1:9999');
    expect(backendParam()).toBe('http://127.0.0.1:9999');
    expect(homeBaseUrl()).toBe('http://127.0.0.1:9999');
    expect(onboardBaseUrl()).toBe('http://127.0.0.1:9999');
  });

  it('?agentBackend= 优先于 ?backend=，两者互不串台', () => {
    goto('?backend=http://localhost:9001&agentBackend=http://127.0.0.1:9002');
    expect(homeBaseUrl()).toBe('http://localhost:9001');
    expect(onboardBaseUrl()).toBe('http://127.0.0.1:9002');
  });

  it('显式空值 = 关闭后端（返回空串，调用方跳过网络）', () => {
    goto('?backend=&agentBackend=');
    expect(backendParam()).toBe('');
    expect(agentBackendParam()).toBe('');
    expect(homeBaseUrl()).toBe('');
    expect(onboardBaseUrl()).toBe('');
  });
});

describe('批次26-B P1-1：?backend= 回环白名单（防凭据外送）', () => {
  beforeEach(() => { goto(''); sessionStorage.clear(); });

  it('白名单内（http + localhost/127.0.0.1/[::1] + 显式端口）放行并归一化 origin', () => {
    goto('?backend=http://localhost:8211');
    expect(homeBaseUrl()).toBe('http://localhost:8211');
    goto('?backend=http://127.0.0.1:8215');
    expect(homeBaseUrl()).toBe('http://127.0.0.1:8215');
    goto('?agentBackend=http://[::1]:9300');
    expect(onboardBaseUrl()).toBe('http://[::1]:9300');
  });

  it('外部主机 / https / 无端口 / 带路径 / 带凭据 → 拒绝并回落默认值', () => {
    // 外部主机（诱导打开带参 URL 把登录密码 POST 过去的主场景）
    goto('?backend=http://evil.example:8080');
    expect(homeBaseUrl()).toBe(HOME_BASE);
    // https（非本机 http 服务）
    goto('?backend=https://127.0.0.1:8201');
    expect(homeBaseUrl()).toBe(HOME_BASE);
    // 无端口
    goto('?backend=http://localhost');
    expect(homeBaseUrl()).toBe(HOME_BASE);
    // 带路径/查询
    goto('?backend=http://127.0.0.1:8201/api');
    expect(homeBaseUrl()).toBe(HOME_BASE);
    // 带用户凭据
    goto('?backend=http://u:p@127.0.0.1:8201');
    expect(homeBaseUrl()).toBe(HOME_BASE);
  });

  it('agentBackend 非法时逐级回落：?backend= 合法则用它，否则 ONBOARD_BASE', () => {
    goto('?agentBackend=http://evil.example&backend=http://127.0.0.1:8300');
    expect(onboardBaseUrl()).toBe('http://127.0.0.1:8300');
    goto('?agentBackend=http://evil.example');
    expect(onboardBaseUrl()).toBe(ONBOARD_BASE);
  });

  it('拒绝时写 ui:backend_param_rejected（只记 host，不记完整 URL）', async () => {
    const actionLog = await import('../shared/actionLog.ts');
    const spy = vi.spyOn(actionLog, 'uiLog');
    goto('?backend=http://evil.example:8080');
    homeBaseUrl();
    expect(spy).toHaveBeenCalledWith('ui', 'backend_param_rejected',
      expect.objectContaining({ param: 'backend', host: 'evil.example:8080' }),
      expect.objectContaining({ level: 'error' }));
    spy.mockRestore();
  });
});

describe('批次27：?backend= 会话记忆（同标签页跳转不丢备用端口）', () => {
  beforeEach(() => { goto(''); sessionStorage.clear(); });

  it('带参校验通过后，无参打开同标签页其它页面仍用该地址（dev 备用端口场景）', () => {
    goto('?backend=http://127.0.0.1:8211&agentBackend=http://127.0.0.1:8211');
    expect(homeBaseUrl()).toBe('http://127.0.0.1:8211');
    goto('');
    expect(homeBaseUrl()).toBe('http://127.0.0.1:8211');
    expect(onboardBaseUrl()).toBe('http://127.0.0.1:8211');
  });

  it('home 与 agent 会话值各自记忆，无参不串台', () => {
    goto('?backend=http://localhost:9001&agentBackend=http://127.0.0.1:9002');
    homeBaseUrl();
    onboardBaseUrl();
    goto('');
    expect(homeBaseUrl()).toBe('http://localhost:9001');
    expect(onboardBaseUrl()).toBe('http://127.0.0.1:9002');
  });

  it('显式 ?backend= 空值 = 关闭，并清掉会话记忆（后续无参回落默认）', () => {
    goto('?backend=http://127.0.0.1:8211');
    homeBaseUrl();
    goto('?backend=');
    expect(homeBaseUrl()).toBe('');
    goto('');
    expect(homeBaseUrl()).toBe(HOME_BASE);
  });

  it('白名单外参数仍拒绝：回落本标签页已记忆的合法值（若有），否则默认值', () => {
    goto('?backend=http://127.0.0.1:8211');
    homeBaseUrl();
    goto('?backend=http://evil.example:8080');
    expect(homeBaseUrl()).toBe('http://127.0.0.1:8211');
  });
});

describe('批次27：dev 备用端口自动发现（免手动重跑 npm run dev）', () => {
  beforeEach(() => { goto(''); sessionStorage.clear(); });
  afterEach(() => vi.unstubAllGlobals());

  it('discoverTrustedDevBackend：只认放行当前来源且 service=home 的 /api/health', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('CORS blocked')) // 8211：服务在但不放行本来源 → fetch reject
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, service: 'home' }) }) // 8212：受信 dev 后端
      .mockResolvedValue(new TypeError('unused'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await discoverTrustedDevBackend()).toBe('http://127.0.0.1:8212');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('http://127.0.0.1:8211/api/health');
  });

  it('discoverTrustedDevBackend：全未命中返回 null，不猜地址', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    expect(await discoverTrustedDevBackend()).toBeNull();
  });

  it('rememberHomeBase：合法值入会话，随后无参 homeBaseUrl 用它；非法值拒绝', () => {
    expect(rememberHomeBase('http://127.0.0.1:8211')).toBe('http://127.0.0.1:8211');
    expect(homeBaseUrl()).toBe('http://127.0.0.1:8211');
    expect(rememberHomeBase('http://evil.example:8080')).toBeNull();
    expect(homeBaseUrl()).toBe('http://127.0.0.1:8211');
    goto('?backend=');
    expect(homeBaseUrl()).toBe('');
  });
});

describe('A4 src/web 端口字面量扫描', () => {
  const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__') continue;
        walk(p, out);
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        out.push(p);
      }
    }
    return out;
  }

  it('除 backend.ts 外，src/web 不再硬编码 8200/8201', () => {
    const offenders = walk(WEB_ROOT)
      .filter((p) => relative(WEB_ROOT, p).replace(/\\/g, '/') !== 'backend.ts')
      .filter((p) => /\b820[01]\b/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(WEB_ROOT, p).replace(/\\/g, '/'));
    expect(offenders).toEqual([]);
  });
});
