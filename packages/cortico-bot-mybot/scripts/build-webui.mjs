// Builds the Persona page bundle: webui/client.ts → dist/webui.js and dist/webui.css (package.json `cortico.webUiClient`).
// Uses the esbuild of the pinned Cortico checkout with the options of its own WebUI build (scripts/build-web.ts).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rmSync } from 'node:fs';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cortico = resolve(pkg, '../../vendor/cortico');
const esbuild = createRequire(resolve(cortico, 'package.json'))('esbuild');

rmSync(resolve(pkg, 'dist'), { recursive: true, force: true });
await esbuild.build({
  entryPoints: [resolve(pkg, 'webui/client.ts')],
  outfile: resolve(pkg, 'dist/webui.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
});
