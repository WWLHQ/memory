// 自研网页对话导出插件的目录解析（纯函数，便于单测）。
// 开发态读仓库 source；安装态读 extraResources 解压出的 resources/webchat-exporter。
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface WebchatExtensionPathOptions {
  appPath: string;
  resourcesPath: string;
  isPackaged: boolean;
  exists?: (path: string) => boolean;
}

export function resolveWebchatExtensionDir(opts: WebchatExtensionPathOptions): string {
  const exists = opts.exists ?? existsSync;
  const packagedDir = join(opts.resourcesPath, 'webchat-exporter');
  const sourceDir = join(opts.appPath, 'browser-extension', 'webchat-exporter');
  if (opts.isPackaged && exists(packagedDir)) return packagedDir;
  if (exists(sourceDir)) return sourceDir;
  return opts.isPackaged ? packagedDir : sourceDir;
}
