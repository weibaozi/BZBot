import { resolve } from 'node:path';

/**
 * 按部署登记的图像资料，供别的 World（生图）按条目 id 取名字和外貌说明，不用直接 import 本包。
 * 图片本身走记忆句柄 `mem:visual/<id>/<文件名>`，由宿主读取。
 * 键是部署目录；表挂在 globalThis 的固定 Symbol 上，同一进程里两份包副本也取到同一张表。
 * 图像资料 World 启动时登记、停止时注销，没启用就查不到。
 */
export interface VisualProvider { describe(id: string): { name: string; description: string } | null }

const KEY = Symbol.for('mybot.visual-library');
function table(): Map<string, VisualProvider> {
  const g = globalThis as { [KEY]?: Map<string, VisualProvider> };
  return g[KEY] ??= new Map();
}
function scope(botDir: string): string {
  const path = resolve(botDir);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

export function registerVisual(botDir: string, provider: VisualProvider): () => void {
  const key = scope(botDir);
  if (table().has(key)) throw new Error('Visual library already registered for this deployment');
  table().set(key, provider);
  return () => { if (table().get(key) === provider) table().delete(key); };
}

export function lookupVisual(botDir: string): VisualProvider | null {
  return table().get(scope(botDir)) ?? null;
}
