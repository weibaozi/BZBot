import { migrateQqextras } from '../server/migration.ts';

const [profile, flag] = process.argv.slice(2);
if (!profile || (flag && flag !== '--apply')) throw new Error('Usage: node scripts/migrate-qqextras.mjs <profile directory> [--apply]');
console.log(JSON.stringify(await migrateQqextras(profile, flag === '--apply')));
