// 自研插件目录解析：安装态优先 extraResources，开发态回仓库源码；两边都不存在时诚实回预期位置。
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { resolveWebchatExtensionDir } from '../webchatExtensionPath.ts';

describe('resolveWebchatExtensionDir', () => {
  const appPath = 'D:\\dev\\memory';
  const resourcesPath = 'D:\\installed\\resources';

  it('安装态优先用解压到 resources 的插件目录', () => {
    const dir = resolveWebchatExtensionDir({
      appPath,
      resourcesPath,
      isPackaged: true,
      exists: (p) => p === join(resourcesPath, 'webchat-exporter'),
    });
    expect(dir).toBe(join(resourcesPath, 'webchat-exporter'));
  });

  it('开发态回仓库 browser-extension/webchat-exporter', () => {
    const dir = resolveWebchatExtensionDir({
      appPath,
      resourcesPath,
      isPackaged: false,
      exists: (p) => p === join(appPath, 'browser-extension', 'webchat-exporter'),
    });
    expect(dir).toBe(join(appPath, 'browser-extension', 'webchat-exporter'));
  });

  it('目标都不存在时回当前形态的预期路径，不伪造任意目录', () => {
    expect(resolveWebchatExtensionDir({ appPath, resourcesPath, isPackaged: true, exists: () => false }))
      .toBe(join(resourcesPath, 'webchat-exporter'));
    expect(resolveWebchatExtensionDir({ appPath, resourcesPath, isPackaged: false, exists: () => false }))
      .toBe(join(appPath, 'browser-extension', 'webchat-exporter'));
  });
});
