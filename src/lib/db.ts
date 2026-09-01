import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../drizzle/schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const sql = postgres(process.env.DATABASE_URL!, { max: 10 });
    _db = drizzle(sql, { schema });
  }
  return _db;
}

// Convenience re-export — import { db } and use as db.select(), etc.
// This works at runtime via proxy but may lose some types. Prefer getDb() in services.
export const db = new Proxy({} as NonNullable<typeof _db>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export type Database = ReturnType<typeof getDb>;
