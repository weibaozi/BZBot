import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const esbuild = createRequire(new URL('../../../vendor/cortico/package.json', import.meta.url))('esbuild');
await esbuild.build({ entryPoints: [fileURLToPath(new URL('../webui/client.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../dist/webui.js', import.meta.url)), loader: { '.css': 'text' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
