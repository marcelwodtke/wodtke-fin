// Read-only look at the database: columns of the planner tables and whether pg_cron can be used.
// Prints no data rows and never the connection string.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const cols = await client.query(`select table_name, string_agg(column_name || ':' || data_type, ', ' order by ordinal_position) as cols
    from information_schema.columns where table_schema = 'public' and table_name like 'wf\\_%' group by table_name order by table_name`);
  for (const r of cols.rows) console.log(r.table_name, '→', r.cols);
  const ext = await client.query(`select name, installed_version, default_version from pg_available_extensions where name in ('pg_cron')`);
  console.log('pg_cron:', ext.rows);
  const sizes = await client.query(`select 'entries' as t, count(*)::int from public.wf_entries union all select 'users', count(*)::int from public.wf_settings`);
  console.log('counts:', sizes.rows);
} catch (err) { console.error('Failed:', err.message); process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
