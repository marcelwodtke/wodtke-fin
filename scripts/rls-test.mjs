// Row-level security test. Impersonates a stranger, the real owner and the anon role inside
// one transaction that is always rolled back, so nothing in the database changes.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const TABLES = ['wf_settings', 'wf_tags', 'wf_cards', 'wf_entries'];
const results = [];
const expect = (name, pass, detail = '') => results.push({ test: name, result: pass ? 'PASS' : 'FAIL', detail });

async function as(role, sub) {
  await client.query(`set local role ${role}`);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
}
async function attempt(sql, params = []) {
  await client.query('savepoint t');
  try { const r = await client.query(sql, params); await client.query('release savepoint t'); return { rowCount: r.rowCount, rows: r.rows }; }
  catch (err) { await client.query('rollback to savepoint t'); return { error: err.message }; }
}

try {
  await client.connect();
  await client.query('begin');

  const owners = (await client.query(`select user_id, count(*)::int as n from public.wf_entries group by user_id order by n desc`)).rows;
  const ownerCounts = {};
  for (const t of TABLES) ownerCounts[t] = (await client.query(`select user_id, count(*)::int as n from public.${t} group by user_id`)).rows;
  if (!owners.length) throw new Error('No entries yet: add some in the app (or Ajustes -> Restaurar exemplo) and run again.');
  const owner = owners[0].user_id;
  const mine = Object.fromEntries(TABLES.map(t => [t, ownerCounts[t].find(r => r.user_id === owner)?.n || 0]));
  console.log(`Owner ${owner.slice(0, 8)}…  rows: ${TABLES.map(t => `${t}=${mine[t]}`).join(', ')}  (accounts with entries: ${owners.length})`);

  // 1. a different signed-in user
  const stranger = randomUUID();
  await as('authenticated', stranger);
  for (const t of TABLES) {
    const r = await attempt(`select count(*)::int as n from public.${t}`);
    expect(`stranger cannot read ${t}`, !r.error && r.rows[0].n === 0, r.error || `sees ${r.rows[0].n} rows`);
  }
  let r = await attempt(`update public.wf_entries set amount = 1 where user_id = $1`, [owner]);
  expect('stranger cannot update owner entries', !r.error && r.rowCount === 0, r.error || `${r.rowCount} rows changed`);
  r = await attempt(`delete from public.wf_entries where user_id = $1`, [owner]);
  expect('stranger cannot delete owner entries', !r.error && r.rowCount === 0, r.error || `${r.rowCount} rows deleted`);
  r = await attempt(`insert into public.wf_entries (user_id, type, amount, date) values ($1, 'out', 10, current_date)`, [owner]);
  expect('stranger cannot insert rows as the owner', !!r.error, r.error || 'insert succeeded');
  r = await attempt(`update public.wf_settings set start_balance = 999999 where user_id = $1`, [owner]);
  expect('stranger cannot change owner settings', !r.error && r.rowCount === 0, r.error || `${r.rowCount} rows changed`);
  await client.query('reset role');

  // 2. the owner sees exactly their own data, and cannot point an entry at someone else's card
  await as('authenticated', owner);
  for (const t of TABLES) {
    const q = await attempt(`select count(*)::int as n from public.${t}`);
    expect(`owner reads own ${t}`, !q.error && q.rows[0].n === mine[t], q.error || `${q.rows[0].n} of ${mine[t]}`);
  }
  r = await attempt(`insert into public.wf_entries (type, amount, date, card_id) values ('card', 10, current_date, $1)`, [randomUUID()]);
  expect('owner cannot reference a card that is not theirs', !!r.error, r.error ? r.error.split('\n')[0] : 'insert succeeded');
  r = await attempt(`insert into public.wf_entries (type, amount, date) values ('out', -5, current_date)`);
  expect('database rejects invalid amounts', !!r.error, r.error ? r.error.split('\n')[0] : 'insert succeeded');
  await client.query('reset role');

  // 3. not signed in at all
  await as('anon', null);
  for (const t of TABLES) {
    const q = await attempt(`select count(*) from public.${t}`);
    expect(`anon blocked from ${t}`, !!q.error, q.error || 'read succeeded');
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.query('rollback').catch(() => {});
  await client.end().catch(() => {});
}
if (results.length) {
  console.table(results);
  const failed = results.filter(x => x.result === 'FAIL').length;
  console.log(failed ? `${failed} test(s) FAILED` : `All ${results.length} tests passed. Transaction rolled back; nothing was changed.`);
  if (failed) process.exitCode = 1;
}
