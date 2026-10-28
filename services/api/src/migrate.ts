import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required; refusing to run a migration without an explicit database target.');
}

const pool = new Pool({ connectionString, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('kicks-schema-migrations'))");
  const table = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.consent_events')::text AS table_name"
  );
  if (!table.rows[0]?.table_name) {
    throw new Error('Base schema is missing. Apply services/api/db/schema.sql to the intended database before running this migration.');
  }
  for (const migrationName of [
    '20261025_consent_purpose.sql',
    '20261025_metadata_consent_binding.sql'
  ]) {
    const sql = await readFile(new URL(`../db/migrations/${migrationName}`, import.meta.url), 'utf8');
    await client.query(sql);
  }
  await client.query('COMMIT');
  process.stdout.write('KICK API migrations applied successfully.\n');
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
