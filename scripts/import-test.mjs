// Tests the Apple Wallet import path (wf_rotate_import_token + wf_import) as the real owner,
// the anon role and a stranger, inside one transaction that is always rolled back.
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
  try { const r = await client.query(sql, params); await client.query('release savepoint t'); return { rows: r.rows, rowCount: r.rowCount }; }
  catch (err) { await client.query('rollback to savepoint t'); return { error: err.message }; }
}
const imp = (token, amount, merchant = 'PADARIA TESTE', card = 'Cartão Teste', date = null) =>
  attempt(`select public.wf_import($1, $2, $3, $4, $5) as r`, [token, amount, merchant, card, date]);

try {
  await client.connect();
  await client.query('begin');
  const owner = (await client.query(`select user_id from public.wf_settings limit 1`)).rows[0]?.user_id;
  if (!owner) throw new Error('no account found');

  // the owner creates an import code
  await as('authenticated', owner);
  let r = await attempt(`select public.wf_rotate_import_token() as t`);
  const token = r.rows?.[0]?.t;
  expect('owner can create an import code', !!token && token.startsWith('wfi_'), r.error || `${token?.slice(0, 8)}…`);
  r = await attempt(`select token_hash from public.wf_import_tokens`);
  expect('only a hash of the code is stored', r.rows?.length === 1 && r.rows[0].token_hash !== token && r.rows[0].token_hash.length === 64, r.error || 'sha256 hex');

  // the shortcut calls in as anon with that code
  await as('anon', null);
  const cases = [['R$ 1.234,56', 1234.56], ['45,9', 45.9], ['1234.56', 1234.56], ['R$45,90', 45.9], ['1.234', 1234], ['-89,90', 89.9]];
  for (const [input, want] of cases) {
    r = await imp(token, input);
    expect(`reads amount "${input}"`, !r.error && Number(r.rows[0].r.amount) === want, r.error || `got ${r.rows[0].r.amount}`);
  }
  r = await imp(token, 'R$ 10,00', 'MERCADO', 'Inter', '2026-11-03');
  expect('keeps the purchase date sent', !r.error && r.rows[0].r.date === '2026-11-03', r.error || r.rows[0].r.date);
  r = await imp(token, 'abc');
  expect('rejects an unreadable amount', !!r.error, r.error || 'accepted');
  r = await imp(token, '0,00');
  expect('rejects a zero amount', !!r.error, r.error || 'accepted');
  r = await imp('wfi_' + 'f'.repeat(48), '10,00');
  expect('rejects a wrong code', !!r.error, r.error || 'accepted');
  r = await imp(null, '10,00');
  expect('rejects a missing code', !!r.error, r.error || 'accepted');
  r = await attempt(`select count(*) from public.wf_inbox`);
  expect('anon cannot read the inbox', !!r.error, r.error || 'read succeeded');
  r = await attempt(`select public.wf_rotate_import_token()`);
  expect('anon cannot create codes', !!r.error, r.error || 'created');

  // the owner sees the imported items; a stranger does not
  await as('authenticated', owner);
  r = await attempt(`select count(*)::int as n, bool_and(status = 'pending') as pending, bool_and(user_id = $1) as mine from public.wf_inbox where created_at > now() - interval '1 minute'`, [owner]);
  expect('owner sees the imported purchases as pending', !r.error && r.rows[0].n === cases.length + 1 && r.rows[0].pending && r.rows[0].mine, r.error || `${r.rows[0].n} items`);
  await as('authenticated', randomUUID());
  r = await attempt(`select count(*)::int as n from public.wf_inbox`);
  expect('stranger cannot see the inbox', !r.error && r.rows[0].n === 0, r.error || `${r.rows[0].n} items`);
  r = await attempt(`select count(*)::int as n from public.wf_import_tokens`);
  expect('stranger cannot see import codes', !r.error && r.rows[0].n === 0, r.error || `${r.rows[0].n} codes`);

  // a new code replaces the old one
  await as('authenticated', owner);
  const token2 = (await attempt(`select public.wf_rotate_import_token() as t`)).rows?.[0]?.t;
  await as('anon', null);
  r = await imp(token, '10,00');
  expect('old code stops working after a new one is made', !!r.error, r.error || 'accepted');
  r = await imp(token2, '10,00');
  expect('new code works', !r.error, r.error || 'ok');

  // rate limit: at most 60 items per hour
  let blocked = null;
  for (let i = 0; i < 70 && !blocked; i++) { const x = await imp(token2, '1,00'); if (x.error) blocked = { at: i, msg: x.error }; }
  expect('rate limit kicks in', !!blocked && /too many/.test(blocked.msg), blocked ? `blocked after ${blocked.at} more` : 'never blocked');
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
