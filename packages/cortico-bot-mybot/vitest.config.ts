// Runs with the pinned Cortico checkout's vitest (package.json `test`); `cortico/*` maps to its src/.
import { fileURLToPath } from 'node:url';

export default {
  resolve: {
    alias: [{ find: /^cortico\/(.*)$/, replacement: fileURLToPath(new URL('../../vendor/cortico/src/$1', import.meta.url)) }],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    env: { CORTICO_LANGUAGE: 'zh' },
    pool: 'forks',
  },
};
