import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

const { Pool } = pg;

// Parse BIGINT (OID 20) as JavaScript number for timestamps and counts
pg.types.setTypeParser(20, (val: string) => Number(val));

declare global {
  var _postgresPool: pg.Pool | undefined;
}

export function resolveDatabaseConnectionConfig(): pg.PoolConfig {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (connectionString) {
    const isLocal =
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1') ||
      connectionString.includes('/cloudsql/');

    const needsSsl =
      !isLocal &&
      (connectionString.includes('neon.tech') ||
        connectionString.includes('sslmode=require') ||
        process.env.NODE_ENV === 'production');

    return {
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }

  if (process.env.SQL_HOST && process.env.SQL_DB_NAME && process.env.SQL_USER) {
    return {
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD || '',
      database: process.env.SQL_DB_NAME,
      port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }

  throw new Error(
    '[Database Error] متغير البيئة DATABASE_URL غير مضبوط! يرجى ضبط DATABASE_URL لاتصال Neon PostgreSQL قبل تشغيل الخادم.'
  );
}

export const createPool = (): pg.Pool => {
  if (!global._postgresPool) {
    const config = resolveDatabaseConnectionConfig();
    global._postgresPool = new Pool(config);

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export const getPool = (): pg.Pool => createPool();

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

// إنشاء drizzle عند أول استخدام فقط، حتى لا ينهار الخادم عند الاستيراد إذا كان DATABASE_URL غير مضبوط
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    if (!_db) _db = drizzle(createPool(), { schema });
    const value = (_db as any)[prop];
    return typeof value === 'function' ? value.bind(_db) : value;
  }
});
