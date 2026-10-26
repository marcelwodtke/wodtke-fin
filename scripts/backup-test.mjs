// Tests the backup migrations (snapshot, manual backup, restore, nightly job, access rules) as the real
// owner, a stranger and the anon role, inside one transaction that is always rolled back.
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
const results = [];
const expect = (name, pass, detail = '') => results.push({ test: name, result: pass ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 90) });
async function as(role, sub) {
  await client.query('reset role');
  await client.query(`set local role ${role}`);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(sub ? { sub, role } : { role })]);
}
async function attempt(sql, params = []) {
  await client.query('savepoint t');
  try { const r = await client.query(sql, params); await client.query('release savepoint t'); return { rows: r.rows }; }
  catch (err) { await client.query('rollback to savepoint t'); return { error: err.message }; }
}
const migrations = ['20261026120000_backups.sql', '20261026120100_backup_schedule.sql'];
const has = (name) => client.query('select 1 from wf_meta.migrations where name = $1', [name]).then(r => r.rowCount > 0).catch(() => false);

try {
  await client.connect();
  await client.query('begin');
  for (const m of migrations) if (!(await has(m))) await client.query(readFileSync(join(root, 'supabase', 'migrations', m), 'utf8'));
  const owner = (await client.query('select user_id from public.wf_settings limit 1')).rows[0]?.user_id;
  if (!owner) throw new Error('no account found');
  const count = async () => +(await client.query('select count(*) from public.wf_entries where user_id = $1', [owner])).rows[0].count;
  const before = await count();

  const job = await attempt(`select schedule from cron.job where jobname = 'wf-daily-backup'`);
  expect('nightly job is scheduled at 06:00 UTC', job.rows?.[0]?.schedule === '0 6 * * *', job.error || job.rows?.[0]?.schedule);

  await as('authenticated', owner);
  let r = await attempt('select public.wf_backup_now() as b');
  const backupId = r.rows?.[0]?.b?.id;
  expect('owner can take a backup', !!backupId, r.error || backupId);
  r = await attempt('select kind, entries from public.wf_backups where id = $1', [backupId]);
  expect('owner sees it, with the entry count', r.rows?.[0]?.entries === before, r.error || JSON.stringify(r.rows?.[0]));

  // change things, then restore
  await client.query('reset role');
  await client.query(`insert into public.wf_entries (user_id, type, amount, description, date) values ($1, 'out', 1, 'backup test', current_date)`, [owner]);
  await client.query(`delete from public.wf_entries where id = (select id from public.wf_entries where user_id = $1 and description <> 'backup test' order by created_at limit 1)`, [owner]);
  await as('authenticated', owner);
  r = await attempt('select public.wf_restore_backup($1) as x', [backupId]);
  expect('owner can restore it', !r.error, r.error || JSON.stringify(r.rows?.[0]?.x));
  await client.query('reset role');
  const after = await count();
  const leftover = +(await client.query(`select count(*) from public.wf_entries where user_id = $1 and description = 'backup test'`, [owner])).rows[0].count;
  expect('restore brings back exactly the saved entries', after === before && leftover === 0, `${before} → ${after}, test row left: ${leftover}`);
  r = await attempt(`select count(*)::int as n from public.wf_backups where user_id = $1 and kind = 'before_restore'`, [owner]);
  expect('restore first saves the current state', r.rows?.[0]?.n >= 1, r.error || r.rows?.[0]?.n);

  // nightly job: one daily per day, repeated runs replace it
  r = await attempt('select public.wf_backup_all() as n');
  await attempt('select public.wf_backup_all()');
  const daily = await attempt(`select count(*)::int as n from public.wf_backups where user_id = $1 and kind = 'daily' and day = (now() at time zone 'America/Sao_Paulo')::date`, [owner]);
  expect('nightly job keeps one daily backup per day', !r.error && daily.rows?.[0]?.n === 1, r.error || daily.rows?.[0]?.n);

  // nobody else gets in
  await as('authenticated', randomUUID());
  r = await attempt('select count(*)::int as n from public.wf_backups');
  expect('stranger sees no backups', !r.error && r.rows[0].n === 0, r.error || r.rows[0].n);
  r = await attempt('select public.wf_restore_backup($1)', [backupId]);
  expect("stranger cannot restore someone's backup", !!r.error, r.error || 'restored');
  await as('anon', null);
  r = await attempt('select public.wf_backup_now()');
  expect('anon cannot take backups', !!r.error, r.error || 'ok');
  r = await attempt('select public.wf_backup_all()');
  expect('anon cannot run the nightly job', !!r.error, r.error || 'ok');
  await as('authenticated', owner);
  r = await attempt('select public.wf_backup_all()');
  expect('signed-in people cannot run the nightly job', !!r.error, r.error || 'ok');
  r = await attempt(`insert into public.wf_backups (data) values ('{}'::jsonb)`);
  expect('backups cannot be written directly', !!r.error, r.error || 'inserted');
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
