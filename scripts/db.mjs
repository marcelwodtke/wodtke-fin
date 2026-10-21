// Applies supabase/migrations/*.sql to the database in SUPABASE_DB_URL (read from .env),
// recording each applied file so it never runs twice. `check` reports tables, RLS and policies.
// The connection string is never printed.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const url = process.env.SUPABASE_DB_URL;
if (!url || url.includes('[YOUR-PASSWORD]') || url.includes('xxxxxxxx')) {
  console.error('SUPABASE_DB_URL is missing or still the example value. Fill in .env first.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const mode = process.argv[2] || 'check';

try {
  await client.connect();
  if (mode === 'migrate') await migrate();
  await check();
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

async function migrate() {
  await client.query(`create schema if not exists wf_meta;
    create table if not exists wf_meta.migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set((await client.query('select name from wf_meta.migrations')).rows.map(r => r.name));
  for (const f of files) {
    if (done.has(f)) { console.log(`skip    ${f} (already applied)`); continue; }
    await client.query('begin');
    try {
      await client.query(readFileSync(join(dir, f), 'utf8'));
      await client.query('insert into wf_meta.migrations (name) values ($1)', [f]);
      await client.query('commit');
      console.log(`applied ${f}`);
    } catch (err) {
      await client.query('rollback');
      throw new Error(`${f}: ${err.message}`);
    }
  }
}

async function check() {
  const tables = await client.query(`
    select c.relname as table, c.relrowsecurity as rls,
           (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
           has_table_privilege('anon', c.oid, 'select') as anon_can_select
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'wf\\_%'
    order by c.relname`);
  if (!tables.rows.length) { console.log('No wf_ tables found yet.'); return; }
  console.table(tables.rows);
  const bad = tables.rows.filter(r => !r.rls || Number(r.policies) === 0 || r.anon_can_select);
  console.log(bad.length ? `WARNING: check ${bad.map(r => r.table).join(', ')}` : 'OK: every wf_ table has RLS on, an owner policy, and no anon access.');
}
