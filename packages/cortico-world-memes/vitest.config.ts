import { fileURLToPath } from 'node:url';
export default {
  resolve: { alias: [{ find: /^cortico\/(.*)$/, replacement: fileURLToPath(new URL('../../vendor/cortico/src/$1', import.meta.url)) },
    { find: 'vitest', replacement: fileURLToPath(new URL('../../vendor/cortico/node_modules/vitest', import.meta.url)) }] },
  test: { include: ['tests/**/*.test.ts'], pool: 'forks', maxWorkers: 1, minWorkers: 1 },
};
