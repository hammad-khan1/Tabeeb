/**
 * Applies pending migrations.
 *
 * Plain `.mjs` so `node` runs it directly. The previous `.mts` version needed `tsx`,
 * which is a devDependency and therefore absent from the production image — the deploy
 * script would have had to download it over the network mid-deploy to migrate the
 * database. Nothing here is TypeScript beyond the import syntax, so the dependency
 * bought nothing.
 *
 *   npm run db:migrate                 # local, reads .env.local
 *   node drizzle/migrate.mjs           # container, reads the process environment
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Local runs read .env.local; the container is given its environment directly, and
// dotenv is not installed there. Missing is fine, so the failure is ignored.
if (!process.env.DATABASE_URL) {
  try {
    const { config } = await import('dotenv');
    config({ path: '.env.local' });
  } catch {
    // No dotenv available — the environment is expected to be set already.
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

// Resolved from this file rather than the working directory, so it works whether run
// from the repository root or from inside the container.
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// max: 1 — drizzle's migrator must run every statement on one connection.
const sql = postgres(url, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder });
  console.log('Migrations applied.');
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
