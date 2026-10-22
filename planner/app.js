// Wodtke Finanças app logic (loaded by index.html).
// ---------- utilities ----------
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = v => brl.format(Math.abs(v) < 0.005 ? 0 : v);
// colour class for a signed balance/result: green when positive, red when negative, plain at zero
const tone = v => (v <= -0.005 ? 'neg' : v >= 0.005 ? 'pos' : '');
const compact = v => {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1).replace('.', ',') + 'k';
  return s + Math.round(a);
};
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const monthDate = (y, m, day) => { const f = new Date(y, m, 1, 12); return new Date(f.getFullYear(), f.getMonth(), Math.min(day, daysIn(f.getFullYear(), f.getMonth())), 12); };
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12); };
const monthName = (y, m) => new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const monthShort = (y, m) => new Date(y, m, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '').replace(' de ', '/');
const weekday = d => d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TYPES = {
  in:    { label: 'Receita',   plural: 'Receitas',   hint: 'salário, extras',      color: 'var(--in)' },
  out:   { label: 'Fixa',      plural: 'Fixas',      hint: 'contas, aluguel',      color: 'var(--out)' },
  daily: { label: 'Dia a dia', plural: 'Dia a dia',  hint: 'compras variáveis',    color: 'var(--daily)' },
  save:  { label: 'Reserva',   plural: 'Reservas',   hint: 'investir, guardar',    color: 'var(--save)' },
  card:  { label: 'Cartão',    plural: 'Cartão',     hint: 'compras no crédito',   color: 'var(--card)' },
};
const FLOW_KEYS = ['in', 'out', 'daily', 'save', 'card'];
const shortNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const REPEATS = { none: 'Não repete', monthly: 'Todo mês', weekly: 'Toda semana', daily: 'Todo dia', installments: 'Parcelado' };

// ---------- state ----------
const KEY = 'wodtke-financas-v1';
function sampleState() {
  const t = today(), y = t.getFullYear(), m = t.getMonth();
  const d = day => iso(monthDate(y, m, day));
  const tags = [
    { id: 't1', name: 'Moradia', color: '#2563eb' }, { id: 't2', name: 'Educação', color: '#7c5cff' },
    { id: 't3', name: 'Transporte', color: '#0ea5e9' }, { id: 't4', name: 'Assinaturas', color: '#14b8a6' },
    { id: 't5', name: 'Saúde', color: '#ef4444' }, { id: 't6', name: 'Lazer', color: '#f59e0b' },
    { id: 't7', name: 'Mercado', color: '#22c55e' }, { id: 't8', name: 'Investimentos', color: '#6366f1' },
  ];
  const cards = [{ id: 'c1', name: 'Cartão Azul', close: 5, due: 12 }, { id: 'c2', name: 'Cartão Viagem', close: 25, due: 3 }];
  const e = (type, amount, desc, date, repeat = 'none', extra = {}) => ({ id: uid(), type, amount, desc, date, repeat, count: 1, tagId: '', cardId: '', ...extra });
  return {
    startBalance: 4200, startDate: d(1), theme: 'system',
    budget: { monthly: 3000, divisor: 'month' },
    tags, cards, exceptions: [],
    entries: [
      e('in', 12000, 'Salário', d(15), 'monthly'),
      e('in', 3500, 'Projeto freelance', d(28), 'monthly'),
      e('in', 6000, '13º salário', iso(monthDate(y, 11, 20))),
      e('out', 2800, 'Aluguel', d(5), 'monthly', { tagId: 't1' }),
      e('out', 420, 'Condomínio', d(10), 'monthly', { tagId: 't1' }),
      e('out', 1340, 'Escola', d(10), 'monthly', { tagId: 't2' }),
      e('out', 730, 'Plano de saúde', d(20), 'monthly', { tagId: 't5' }),
      e('out', 3600, 'Revisão do carro', d(8), 'installments', { count: 6, tagId: 't3' }),
      e('out', 89.9, 'Streaming e música', d(2), 'monthly', { tagId: 't4' }),
      e('daily', 180, 'Feira', d(3), 'none', { tagId: 't7' }),
      e('daily', 64.5, 'Café com cliente', d(6), 'none', { tagId: 't6' }),
      e('save', 800, 'Reserva de emergência', d(16), 'monthly', { tagId: 't8' }),
      e('card', 640, 'Mercado do mês', d(4), 'monthly', { cardId: 'c1', tagId: 't7' }),
      e('card', 2400, 'Passagens', d(9), 'installments', { count: 4, cardId: 'c2', tagId: 't6' }),
      e('card', 159, 'Academia', d(1), 'monthly', { cardId: 'c1', tagId: 't5' }),
    ],
  };
}
// ---------- Supabase data layer ----------
const cfg = window.WF_CONFIG || {};
const sb = cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
let user = null;
const DEFAULT_TAGS = [['Moradia', '#2563eb'], ['Educação', '#7c5cff'], ['Transporte', '#0ea5e9'], ['Assinaturas', '#14b8a6'], ['Saúde', '#ef4444'], ['Lazer', '#f59e0b'], ['Mercado', '#22c55e'], ['Investimentos', '#6366f1']];
// The theme is also kept locally so the login screen opens in the right colors.
const localTheme = () => { try { return localStorage.getItem(KEY + ':theme') || 'system'; } catch (_) { return 'system'; } };
const rememberTheme = t => { try { localStorage.setItem(KEY + ':theme', t); } catch (_) {} };
const emptyState = () => ({ startBalance: 0, startDate: iso(monthDate(today().getFullYear(), today().getMonth(), 1)), theme: localTheme(), budget: { monthly: 0, divisor: 'month' }, tags: [], cards: [], entries: [], exceptions: [] });

const fromEntry = r => ({ id: r.id, type: r.type, amount: +r.amount, desc: r.description || '', date: r.date, endDate: r.end_date || '', repeat: r.repeat, count: r.installments || 1, tagId: r.tag_id || '', cardId: r.card_id || '' });
// od = the date the occurrence originally fell on; amount/date/desc are optional overrides
const fromException = r => ({ id: r.id, entryId: r.entry_id, od: r.occurrence_date, action: r.action, amount: r.amount == null ? null : +r.amount, date: r.date || '', desc: r.description });
const toEntry = e => ({ type: e.type, amount: e.amount, description: e.desc || '', date: e.date, repeat: e.repeat, installments: e.repeat === 'installments' ? e.count : 1, tag_id: e.tagId || null, card_id: e.type === 'card' ? e.cardId : null });
const fromTag = r => ({ id: r.id, name: r.name, color: r.color });
const fromCard = r => ({ id: r.id, name: r.name, close: r.close_day, due: r.due_day });

async function must(query) { const { data, error } = await query; if (error) throw error; return data; }

async function loadAll() {
  let [settings, tags, cards, entries, exceptions] = await Promise.all([
    must(sb.from('wf_settings').select('*').maybeSingle()),
    must(sb.from('wf_tags').select('*').order('name')),
    must(sb.from('wf_cards').select('*').order('name')),
    must(sb.from('wf_entries').select('*').order('date')),
    must(sb.from('wf_entry_exceptions').select('*')),
  ]);
  if (!settings) { // first sign-in: create the settings row and starter categories
    settings = await must(sb.from('wf_settings').insert({ start_date: emptyState().startDate, theme: localTheme() }).select().single());
    if (!tags.length) tags = await must(sb.from('wf_tags').insert(DEFAULT_TAGS.map(([name, color]) => ({ name, color }))).select());
  }
  state = {
    startBalance: +settings.start_balance, startDate: settings.start_date, theme: settings.theme,
    budget: { monthly: +settings.budget_monthly, divisor: settings.budget_divisor },
    tags: tags.map(fromTag), cards: cards.map(fromCard), entries: entries.map(fromEntry), exceptions: exceptions.map(fromException),
  };
  rememberTheme(state.theme);
}

const db = {
  settings: patch => must(sb.from('wf_settings').update(patch).eq('user_id', user.id)),
  addEntry: async e => { const r = await must(sb.from('wf_entries').insert(toEntry(e)).select().single()); state.entries.push(fromEntry(r)); },
  updateEntry: async (id, e) => {
    const r = await must(sb.from('wf_entries').update(toEntry(e)).eq('id', id).select().single());
    state.entries = state.entries.map(x => (x.id === id ? fromEntry(r) : x));
  },
  delEntry: async id => { await must(sb.from('wf_entries').delete().eq('id', id)); state.entries = state.entries.filter(x => x.id !== id); pruneExceptions(); },
  // one changed or skipped occurrence of a recurring entry
  setException: async x => {
    const row = { entry_id: x.entryId, occurrence_date: x.od, action: x.action,
      amount: x.action === 'modify' ? x.amount ?? null : null, date: x.action === 'modify' ? x.date || null : null, description: x.action === 'modify' ? x.desc ?? null : null };
    const r = await must(sb.from('wf_entry_exceptions').upsert(row, { onConflict: 'entry_id,occurrence_date' }).select().single());
    state.exceptions = state.exceptions.filter(e => !(e.entryId === x.entryId && e.od === x.od)).concat(fromException(r));
  },
  clearException: async (entryId, od) => {
    await must(sb.from('wf_entry_exceptions').delete().eq('entry_id', entryId).eq('occurrence_date', od));
    state.exceptions = state.exceptions.filter(e => !(e.entryId === entryId && e.od === od));
  },
  // stop a series after endDate (exceptions past it no longer apply, so drop them)
  endSeries: async (id, endDate) => {
    const r = await must(sb.from('wf_entries').update({ end_date: endDate }).eq('id', id).select().single());
    await must(sb.from('wf_entry_exceptions').delete().eq('entry_id', id).gt('occurrence_date', endDate));
    state.entries = state.entries.map(x => (x.id === id ? fromEntry(r) : x));
    state.exceptions = state.exceptions.filter(e => !(e.entryId === id && e.od > endDate));
  },
  // "this and the following": end the old series the day before `od` and start a new one there
  splitSeries: async (entry, od, next) => {
    if (od <= entry.date) return db.updateEntry(entry.id, next);
    await db.endSeries(entry.id, iso(addDays(parse(od), -1)));
    await db.addEntry(next);
  },
  addTag: async t => { const r = await must(sb.from('wf_tags').insert({ name: t.name, color: t.color }).select().single()); state.tags.push(fromTag(r)); },
  delTag: async id => { await must(sb.from('wf_tags').delete().eq('id', id)); state.tags = state.tags.filter(t => t.id !== id); state.entries.forEach(x => { if (x.tagId === id) x.tagId = ''; }); },
  addCard: async c => { const r = await must(sb.from('wf_cards').insert({ name: c.name, close_day: c.close, due_day: c.due }).select().single()); state.cards.push(fromCard(r)); },
  delCard: async id => { await must(sb.from('wf_cards').delete().eq('id', id)); state.cards = state.cards.filter(c => c.id !== id); state.entries = state.entries.filter(x => x.cardId !== id); pruneExceptions(); },
  wipe: async () => { await must(sb.from('wf_entries').delete().eq('user_id', user.id)); state.entries = []; state.exceptions = []; },
  // replace everything with the sample data set, remapping its local ids to database ids
  seedSample: async () => {
    const s = sampleState();
    await must(sb.from('wf_entries').delete().eq('user_id', user.id));
    await must(sb.from('wf_cards').delete().eq('user_id', user.id));
    await must(sb.from('wf_tags').delete().eq('user_id', user.id));
    const tags = await must(sb.from('wf_tags').insert(s.tags.map(t => ({ name: t.name, color: t.color }))).select());
    const cards = await must(sb.from('wf_cards').insert(s.cards.map(c => ({ name: c.name, close_day: c.close, due_day: c.due }))).select());
    const tagId = Object.fromEntries(s.tags.map(t => [t.id, tags.find(r => r.name === t.name).id]));
    const cardId = Object.fromEntries(s.cards.map(c => [c.id, cards.find(r => r.name === c.name).id]));
    await must(sb.from('wf_entries').insert(s.entries.map(e => toEntry({ ...e, tagId: tagId[e.tagId] || '', cardId: cardId[e.cardId] || '' }))));
    await db.settings({ start_balance: s.startBalance, start_date: s.startDate, budget_monthly: s.budget.monthly, budget_divisor: s.budget.divisor });
    await loadAll();
  },
};

// the database cascades exception deletes; mirror that locally
function pruneExceptions() { const ids = new Set(state.entries.map(e => e.id)); state.exceptions = state.exceptions.filter(x => ids.has(x.entryId)); }

// Runs a database change, reports failures, then re-renders.
async function run(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (err) { console.error(err); toast('Não foi possível salvar: ' + (err.message || 'erro de conexão')); }
  route();
}

let state = emptyState();

let view = { y: today().getFullYear(), m: today().getMonth() }; // first month of the 12-month window
let focus = { y: today().getFullYear(), m: today().getMonth() };   // month used by resumo/categorias

// ---------- projection engine ----------
function occurrences(e, until) {
  const out = [], start = parse(e.date), amt = +e.amount || 0;
  const end = e.endDate && parse(e.endDate) < until ? parse(e.endDate) : until; // a split series stops at its end date
  if (e.repeat === 'daily' || e.repeat === 'weekly') {
    const step = e.repeat === 'daily' ? 1 : 7;
    for (let d = start; d <= end; d = addDays(d, step)) out.push({ d, amt });
  } else if (e.repeat === 'monthly' || e.repeat === 'installments') {
    const n = e.repeat === 'installments' ? Math.max(1, e.count | 0) : Infinity;
    const per = e.repeat === 'installments' ? amt / n : amt;
    for (let i = 0; i < n; i++) {
      const d = monthDate(start.getFullYear(), start.getMonth() + i, start.getDate());
      if (d > end) break;
      out.push({ d, amt: per, i: i + 1, n: e.repeat === 'installments' ? n : null });
    }
  } else out.push({ d: start, amt });
  return out;
}
// A card purchase is charged on the due date of the invoice it falls into.
function invoiceDue(d, card) {
  let m = d.getMonth() + (d.getDate() > card.close ? 1 : 0);
  if (card.due <= card.close) m += 1;
  return monthDate(d.getFullYear(), m, card.due);
}
function dailyBudget(d) {
  const b = state.budget, div = b.divisor === 'month' ? daysIn(d.getFullYear(), d.getMonth()) : +b.divisor;
  return div > 0 ? (+b.monthly || 0) / div : 0;
}
const emptyDay = () => ({ in: 0, out: 0, daily: 0, save: 0, card: 0, items: [], skipped: [] });
function buildLedger(end) {
  const L = new Map(), day = k => (L.has(k) ? L.get(k) : L.set(k, emptyDay()).get(k));
  const ex = new Map((state.exceptions || []).map(x => [x.entryId + '|' + x.od, x]));
  // an occurrence moved earlier can land before `end` even though it originally fell after it
  const ahead = Math.max(0, ...(state.exceptions || []).filter(x => x.date && x.date < x.od).map(x => Math.ceil((parse(x.od) - parse(x.date)) / 864e5)));
  for (const e of state.entries) {
    const card = e.type === 'card' ? state.cards.find(c => c.id === e.cardId) : null;
    for (const o of occurrences(e, addDays(end, ahead))) {
      const od = iso(o.d), x = ex.get(e.id + '|' + od);
      // skipped occurrences are listed on their day (so they can be restored) but not counted
      if (x && x.action === 'skip') { const k = iso(card ? invoiceDue(o.d, card) : o.d); if (parse(k) <= end) day(k).skipped.push({ e, od, amt: o.amt, i: o.i, n: o.n }); continue; }
      const d = x && x.date ? parse(x.date) : o.d, amt = x && x.amount != null ? x.amount : o.amt;
      const when = card ? invoiceDue(d, card) : d;
      if (when > end) continue;
      const b = day(iso(when)); b[e.type] += amt;
      b.items.push({ e, amt, i: o.i, n: o.n, purchase: d, card, od, ex: x || null, desc: (x && x.desc) || e.desc });
    }
  }
  return L;
}
// the default amount of one occurrence (installments split the total), ignoring exceptions
function baseAmount(e, od) { const o = occurrences(e, parse(od)).find(o => iso(o.d) === od); return o ? o.amt : +e.amount; }
// 1-based position of an occurrence inside its series
function occurrenceIndex(e, od) { return occurrences(e, parse(od)).findIndex(o => iso(o.d) === od) + 1; }
function computeRows(end) {
  const L = buildLedger(end), t = today(), rows = [];
  let bal = +state.startBalance || 0;
  for (let d = parse(state.startDate); d <= end; d = addDays(d, 1)) {
    const k = iso(d), b = L.get(k) || emptyDay();
    const budget = d > t ? dailyBudget(d) : 0;
    const daily = b.daily + budget;
    bal += b.in - b.out - daily - b.save - b.card;
    rows.push({ d, k, in: b.in, out: b.out, daily, budget, save: b.save, card: b.card, bal, items: b.items, skipped: b.skipped });
  }
  return rows;
}
const windowEnd = () => monthDate(view.y, view.m + 11, 31);
const monthRows = (rows, y, m) => rows.filter(r => r.d.getFullYear() === y && r.d.getMonth() === m);
const sum = (rs, f) => rs.reduce((a, r) => a + r[f], 0);
function clampView() {
  const s = parse(state.startDate);
  if (view.y * 12 + view.m < s.getFullYear() * 12 + s.getMonth()) { view.y = s.getFullYear(); view.m = s.getMonth(); }
}

// ---------- rendering ----------
const $view = document.getElementById('view');
const cell = v => (Math.abs(v) < 0.005 ? '<td class="num zero">—</td>' : `<td class="num">${money(v)}</td>`);
const dot = t => `<span class="dot" style="background:${TYPES[t].color}"></span>`;

function rangeControl(label) {
  return `<div class="range">
    <button class="icon-btn" data-act="prev" title="Mês anterior">‹</button>
    <div class="label">${label}</div>
    <button class="icon-btn" data-act="next" title="Próximo mês">›</button>
    <button class="btn small" data-act="today">Hoje</button></div>`;
}

function renderFlow() {
  if (isPhone()) return renderFlowPhone();
  clampView();
  const rows = computeRows(windowEnd()), t = today();
  const win = rows.filter(r => r.d >= monthDate(view.y, view.m, 1));
  const lowest = win.reduce((a, r) => (r.bal < a.bal ? r : a), win[0] || { bal: 0, d: t });
  const todayRow = rows.find(r => r.k === iso(t));
  const neg = win.filter(r => r.bal < 0).length;
  const last = win[win.length - 1];
  const label = `${monthShort(view.y, view.m)} – ${monthShort(view.y, view.m + 11)}`;
  let html = `<div class="page-head"><div><h1>Fluxo diário</h1><p>Saldo projetado dia a dia pelos próximos 12 meses.</p></div>${rangeControl(label)}</div>
  <div class="kpis">
    <div class="kpi"><div class="k">Saldo hoje</div><div class="v ${todayRow ? tone(todayRow.bal) : ''}">${todayRow ? money(todayRow.bal) : '—'}</div><div class="s">${t.toLocaleDateString('pt-BR')}</div></div>
    <div class="kpi"><div class="k">Menor saldo</div><div class="v ${tone(lowest.bal)}">${money(lowest.bal)}</div><div class="s">em ${lowest.d.toLocaleDateString('pt-BR')}</div></div>
    <div class="kpi"><div class="k">Dias no vermelho</div><div class="v ${neg ? 'neg' : ''}">${neg}</div><div class="s">de ${win.length} dias projetados</div></div>
    <div class="kpi"><div class="k">Saldo ao fim</div><div class="v ${last ? tone(last.bal) : ''}">${last ? money(last.bal) : '—'}</div><div class="s">${last ? last.d.toLocaleDateString('pt-BR') : ''}</div></div>
  </div>
  <div class="chip-legend">${FLOW_KEYS.map(k => `<span class="chip" style="--c:${TYPES[k].color};font-family:inherit">${TYPES[k].plural}</span>`).join('')}</div>`;
  for (let i = 0; i < 12; i++) {
    const f = monthDate(view.y, view.m + i, 1), y = f.getFullYear(), m = f.getMonth();
    const mr = monthRows(rows, y, m);
    if (!mr.length) continue;
    html += `<section class="month" id="m-${y}-${m}"><div class="month-head"><h2>${monthName(y, m)}</h2><div class="end">saldo final <b class="num ${tone(mr[mr.length - 1].bal)}">${money(mr[mr.length - 1].bal)}</b></div></div>
    <div class="scroll"><table class="flow"><thead><tr><th>Dia</th>${['in', 'out', 'daily', 'save', 'card'].map(k => `<th>${dot(k)}${TYPES[k].plural}</th>`).join('')}<th>Saldo</th></tr></thead><tbody>`;
    for (const r of mr) {
      const wk = [0, 6].includes(r.d.getDay());
      html += `<tr data-day="${r.k}" class="${r.k === iso(t) ? 'today' : ''} ${wk ? 'weekend' : ''}"><td class="day">${r.d.getDate()}<span>${weekday(r.d)}</span></td>
        ${cell(r.in)}${cell(r.out)}${cell(r.daily).replace('<td class="num', `<td class="num${r.budget && !r.items.some(x => x.e.type === 'daily') ? ' forecast' : ''}`)}${cell(r.save)}${cell(r.card)}
        <td class="num bal ${tone(r.bal)}">${money(r.bal)}</td></tr>`;
    }
    html += `</tbody><tfoot><tr><td>Total</td>${['in', 'out', 'daily', 'save', 'card'].map(k => `<td class="num">${money(sum(mr, k))}</td>`).join('')}<td></td></tr></tfoot></table></div>`;
    html += `</section>`;
  }
  $view.innerHTML = html;
  const tr = $view.querySelector('tr.today');
  if (tr && !renderFlow.scrolled) { renderFlow.scrolled = true; tr.scrollIntoView({ block: 'center' }); }
}

// compact day list for one movement type: the day, that type's amount, and the closing balance
function dayListHtml(mr, t, type) {
  return mr.map(r => {
    const wk = [0, 6].includes(r.d.getDay()), v = r[type];
    const fc = type === 'daily' && r.budget && !r.items.some(x => x.e.type === 'daily');
    const has = Math.abs(v) >= 0.005;
    const amount = has ? `<span class="tval${fc ? ' fc' : ''}">${money(v)}</span>` : '<span class="none">—</span>';
    return `<div class="drow ${r.k === iso(t) ? 'today' : ''} ${wk ? 'weekend' : ''}" data-day="${r.k}"><div class="dd"><b>${r.d.getDate()}</b><span>${weekday(r.d)}</span></div>
      <div class="amt${has ? ' has' : ''}" style="--c:${TYPES[type].color}"><span class="tdot"></span>${amount}</div><div class="db num ${tone(r.bal)}">${money(r.bal)}</div></div>`;
  }).join('');
}

// Which movement type the phone list shows; remembered on this device.
let phoneType = (() => { try { const v = localStorage.getItem(KEY + ':phoneType'); return FLOW_KEYS.includes(v) ? v : 'in'; } catch (_) { return 'in'; } })();
function setPhoneType(type) {
  if (!FLOW_KEYS.includes(type) || type === phoneType) return;
  phoneType = type;
  try { localStorage.setItem(KEY + ':phoneType', type); } catch (_) {}
  const y = window.scrollY; renderFlowPhone(); window.scrollTo(0, y); // keep the same days in view
}

// Phones show one month at a time; the arrows in the top bar change month.
const isPhone = () => matchMedia('(max-width: 640px)').matches;
let phoneMonth = { y: today().getFullYear(), m: today().getMonth() };
function shiftPhoneMonth(n) {
  const s = parse(state.startDate), f = monthDate(phoneMonth.y, phoneMonth.m + n, 1);
  if (f.getFullYear() * 12 + f.getMonth() < s.getFullYear() * 12 + s.getMonth()) return toast('Antes da data inicial do planejamento');
  phoneMonth = { y: f.getFullYear(), m: f.getMonth() };
  renderFlow.scrolled = false; route();
}
function clampPhoneMonth() {
  const s = parse(state.startDate);
  if (phoneMonth.y * 12 + phoneMonth.m < s.getFullYear() * 12 + s.getMonth()) phoneMonth = { y: s.getFullYear(), m: s.getMonth() };
}
function renderFlowPhone() {
  clampPhoneMonth();
  const { y, m } = phoneMonth, t = today();
  const mr = monthRows(computeRows(monthDate(y, m, 31)), y, m);
  // the month name and arrows live in the phone top bar (see updatePhoneBar)
  // column header: Dia | type selector | Saldo (a native select keeps the picker accessible)
  const head = `<div class="list-head"><span>Dia</span>
    <label class="type-pick" style="--c:${TYPES[phoneType].color}"><span class="tdot"></span><span class="tname">${TYPES[phoneType].plural}</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      <select data-ptype aria-label="Tipo de lançamento">${FLOW_KEYS.map(k => `<option value="${k}" ${k === phoneType ? 'selected' : ''}>${TYPES[k].plural}</option>`).join('')}</select></label>
    <span>Saldo</span></div>`;
  $view.innerHTML = `${head}<section class="month phone-month"><div class="dlist">${dayListHtml(mr, t, phoneType)}</div></section>`;
  const row = $view.querySelector('.drow.today');
  if (row && !renderFlow.scrolled) { renderFlow.scrolled = true; row.scrollIntoView({ block: 'center' }); }
  else if (!row) window.scrollTo(0, 0);
}

document.addEventListener('change', e => { if (e.target.matches('select[data-ptype]')) setPhoneType(e.target.value); });

// a sideways swipe on the list switches to the next/previous movement type (phones only)
let swipe = null;
document.addEventListener('touchstart', e => { swipe = isPhone() && document.body.dataset.route === 'fluxo' && e.target.closest('.phone-month') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipe) return;
  const dx = e.changedTouches[0].clientX - swipe.x, dy = e.changedTouches[0].clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) setPhoneType(FLOW_KEYS[FLOW_KEYS.indexOf(phoneType) + (dx < 0 ? 1 : -1)]);
}, { passive: true });

function renderHorizon() {
  clampView();
  const rows = computeRows(windowEnd()), t = today();
  const max = Math.max(1, ...rows.map(r => Math.abs(r.bal)));
  const months = [...Array(12)].map((_, i) => { const f = monthDate(view.y, view.m + i, 1); return { y: f.getFullYear(), m: f.getMonth() }; });
  const byKey = new Map(rows.map(r => [r.k, r]));
  let html = `<div class="page-head"><div><h1>Horizonte</h1><p>Um ano inteiro de saldos num mapa de calor — clique num dia para ver os lançamentos.</p></div>
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div class="legend">negativo <span class="bar"></span> positivo</div>${rangeControl(`${monthShort(view.y, view.m)} – ${monthShort(view.y, view.m + 11)}`)}</div></div>
    <div class="horizon-wrap"><table class="horizon"><thead><tr><th></th>${months.map(o => `<th>${monthShort(o.y, o.m)}</th>`).join('')}</tr></thead><tbody>`;
  for (let day = 1; day <= 31; day++) {
    html += `<tr><td class="dnum">${day}</td>`;
    for (const o of months) {
      if (day > daysIn(o.y, o.m)) { html += '<td class="empty"></td>'; continue; }
      const k = `${o.y}-${pad(o.m + 1)}-${pad(day)}`, r = byKey.get(k);
      if (!r) { html += '<td class="empty"></td>'; continue; }
      const a = 0.12 + 0.78 * Math.min(1, Math.abs(r.bal) / max);
      const rgb = r.bal < 0 ? 'var(--neg-rgb)' : 'var(--in-rgb)';
      const fg = a > 0.5 ? '#fff' : 'var(--text)';
      html += `<td class="num ${k === iso(t) ? 'today' : ''}" data-day="${k}" title="${parse(k).toLocaleDateString('pt-BR')}: ${money(r.bal)}" style="background:rgba(${rgb},${a.toFixed(2)});color:${fg}">${compact(r.bal)}</td>`;
    }
    html += '</tr>';
  }
  $view.innerHTML = html + '</tbody></table></div>';
}

function focusControl() {
  return `<div class="range"><button class="icon-btn" data-act="fprev">‹</button><div class="label" style="text-transform:capitalize">${monthName(focus.y, focus.m)}</div><button class="icon-btn" data-act="fnext">›</button></div>`;
}
function focusRows() {
  const end = monthDate(focus.y, focus.m, 31);
  return { rows: computeRows(end), mr: null, end };
}

function renderSummary() {
  const { rows } = focusRows(), mr = monthRows(rows, focus.y, focus.m);
  if (!mr.length) { $view.innerHTML = `<div class="page-head"><div><h1>Resumo do mês</h1></div>${focusControl()}</div><div class="panel empty-state">Sem dados antes da data inicial (${parse(state.startDate).toLocaleDateString('pt-BR')}).</div>`; return; }
  const tot = k => sum(mr, k), inc = tot('in'), outs = tot('out') + tot('daily') + tot('save') + tot('card');
  const result = inc - outs, life = tot('out') + tot('daily') + tot('card');
  const rate = inc ? tot('save') / inc : 0;
  const low = mr.reduce((a, r) => (r.bal < a.bal ? r : a), mr[0]);
  const parts = ['out', 'daily', 'save', 'card'].map(k => ({ k, v: tot(k) })).filter(p => p.v > 0);
  const upcoming = rows.filter(r => r.d > today()).slice(0, 10).flatMap(r => r.items.map(x => ({ ...x, d: r.d }))).slice(0, 8);
  $view.innerHTML = `<div class="page-head"><div><h1>Resumo do mês</h1><p>Inclui lançamentos realizados e previstos.</p></div>${focusControl()}</div>
  <div class="kpis">
    <div class="kpi"><div class="k">Resultado</div><div class="v ${tone(result)}">${money(result)}</div><div class="s">receitas − todas as saídas</div></div>
    <div class="kpi"><div class="k">Taxa de reserva</div><div class="v">${(rate * 100).toFixed(1).replace('.', ',')}%</div><div class="s">${money(tot('save'))} guardados</div></div>
    <div class="kpi"><div class="k">Custo de vida</div><div class="v">${money(life)}</div><div class="s">fixas + dia a dia + cartão</div></div>
    <div class="kpi"><div class="k">Dia a dia médio</div><div class="v">${money(tot('daily') / mr.length)}</div><div class="s">por dia, ${mr.length} dias</div></div>
  </div>
  <div class="grid two">
    <div class="panel"><h3>Para onde vai o dinheiro</h3><p class="hint">Composição das saídas do mês.</p>
      <div class="stack">${parts.map(p => `<span style="width:${(p.v / outs) * 100}%;background:${TYPES[p.k].color}" title="${TYPES[p.k].plural}"></span>`).join('')}</div>
      <div class="rows">
        <div class="row"><span class="sw" style="background:${TYPES.in.color}"></span><div class="grow">Receitas</div><b class="num">${money(inc)}</b></div>
        ${['out', 'daily', 'save', 'card'].map(k => `<div class="row"><span class="sw" style="background:${TYPES[k].color}"></span><div class="grow">${TYPES[k].plural}</div><span class="sub">${outs ? Math.round((tot(k) / outs) * 100) : 0}%</span><b class="num">${money(tot(k))}</b></div>`).join('')}
      </div></div>
    <div class="panel"><h3>Saldo no mês</h3><p class="hint">Pontos de atenção do período.</p>
      <div class="rows">
        <div class="row"><div class="grow">Saldo inicial</div><b class="num ${tone(mr[0].bal - (mr[0].in - mr[0].out - mr[0].daily - mr[0].save - mr[0].card))}">${money(mr[0].bal - (mr[0].in - mr[0].out - mr[0].daily - mr[0].save - mr[0].card))}</b></div>
        <div class="row"><div class="grow">Menor saldo<div class="sub">${low.d.toLocaleDateString('pt-BR')}</div></div><b class="num ${tone(low.bal)}">${money(low.bal)}</b></div>
        <div class="row"><div class="grow">Saldo final</div><b class="num ${tone(mr[mr.length - 1].bal)}">${money(mr[mr.length - 1].bal)}</b></div>
        <div class="row"><div class="grow">Orçamento diário previsto<div class="sub">${money(dailyBudget(mr[0].d))} por dia nos dias futuros</div></div><b class="num">${money(sum(mr, 'budget'))}</b></div>
      </div>
      <h3 style="margin-top:18px">Próximos lançamentos</h3>
      <div class="rows">${upcoming.length ? upcoming.map(x => `<div class="row"><span class="sw" style="background:${TYPES[x.e.type].color}"></span><div class="grow">${esc(x.desc || TYPES[x.e.type].label)}<div class="sub">${x.d.toLocaleDateString('pt-BR')}${x.n ? ` · parcela ${x.i}/${x.n}` : ''}</div></div><b class="num">${money(x.amt)}</b></div>`).join('') : '<div class="empty-state">Nada agendado.</div>'}</div>
    </div>
  </div>`;
}

function renderTags() {
  const end = monthDate(focus.y, focus.m, 31), L = buildLedger(monthDate(focus.y, focus.m + 2, 31));
  const spend = new Map(), counts = new Map();
  for (const b of L.values()) for (const x of b.items) {
    if (x.e.type === 'in') continue;
    const p = x.purchase; if (p.getFullYear() !== focus.y || p.getMonth() !== focus.m) continue;
    const id = x.e.tagId || ''; spend.set(id, (spend.get(id) || 0) + x.amt); counts.set(id, (counts.get(id) || 0) + 1);
  }
  const list = [...state.tags.map(t => ({ ...t, v: spend.get(t.id) || 0, c: counts.get(t.id) || 0 })), ...(spend.get('') ? [{ id: '', name: 'Sem categoria', color: '#94a3b8', v: spend.get(''), c: counts.get('') }] : [])].sort((a, b) => b.v - a.v);
  const total = list.reduce((a, t) => a + t.v, 0), max = Math.max(1, ...list.map(t => t.v));
  $view.innerHTML = `<div class="page-head"><div><h1>Categorias</h1><p>Gastos do mês por categoria (compras no cartão contam na data da compra).</p></div>${focusControl()}</div>
  <div class="grid two">
    <div class="panel"><h3>Total gasto: <span class="num">${money(total)}</span></h3>
      <div class="rows">${list.map(t => `<div class="row"><span class="sw" style="background:${t.color}"></span><div class="grow"><b>${esc(t.name)}</b><div class="sub">${t.c} lançamento${t.c === 1 ? '' : 's'}${total ? ` · ${Math.round((t.v / total) * 100)}%` : ''}</div><div class="meter"><span style="width:${(t.v / max) * 100}%;background:${t.color}"></span></div></div><b class="num">${money(t.v)}</b></div>`).join('')}</div></div>
    <div class="panel"><h3>Nova categoria</h3>
      <div class="inline"><div class="field"><label>Nome</label><input id="tagName" placeholder="ex.: Pets"></div><div class="field" style="flex:0 0 70px"><label>Cor</label><input id="tagColor" type="color" value="#2563eb" style="padding:3px;height:40px"></div></div>
      <button class="btn primary" data-act="addTag">Adicionar categoria</button>
      <p class="hint" style="margin-top:14px">Para remover uma categoria, vá em Ajustes.</p></div>
  </div>`;
}

function renderSettings() {
  const t = state.theme;
  $view.innerHTML = `<div class="page-head"><div><h1>Ajustes</h1><p>Saldo de partida, orçamento diário, cartões e aparência.</p></div></div>
  <div class="grid two">
    <div class="panel"><h3>Ponto de partida</h3><p class="hint">O saldo na conta no início do dia escolhido.</p>
      <div class="inline"><div class="field"><label>Saldo inicial (R$)</label><input type="number" step="0.01" id="sBal" value="${state.startBalance}"></div>
      <div class="field"><label>Data</label><input type="date" id="sDate" value="${state.startDate}"></div></div></div>
    <div class="panel"><h3>Orçamento diário</h3><p class="hint">Quanto você reserva por mês para gastos variáveis. Ele é descontado em cada dia futuro.</p>
      <div class="inline"><div class="field"><label>Por mês (R$)</label><input type="number" step="0.01" id="bMonthly" value="${state.budget.monthly}"></div>
      <div class="field"><label>Dividir por</label><select id="bDiv">${[['month', 'dias do mês'], ['28', '28 dias'], ['30', '30 dias'], ['31', '31 dias']].map(([v, l]) => `<option value="${v}" ${String(state.budget.divisor) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="rows"><div class="row"><div class="grow">Valor por dia (mês atual)</div><b class="num">${money(dailyBudget(today()))}</b></div></div></div>
    <div class="panel"><h3>Cartões de crédito</h3><p class="hint">Compras após o fechamento vão para a fatura seguinte e saem do saldo no vencimento.</p>
      <div class="rows">${state.cards.map(c => `<div class="row"><span class="sw" style="background:var(--card)"></span><div class="grow"><b>${esc(c.name)}</b><div class="sub">fecha dia ${c.close} · vence dia ${c.due}</div></div><button class="btn small danger" data-act="delCard" data-id="${c.id}">Remover</button></div>`).join('') || '<div class="empty-state">Nenhum cartão.</div>'}</div>
      <div class="inline" style="margin-top:12px"><div class="field"><label>Nome</label><input id="cName" placeholder="ex.: Cartão Black"></div><div class="field" style="flex:0 0 80px"><label>Fecha</label><input id="cClose" type="number" min="1" max="31" value="1"></div><div class="field" style="flex:0 0 80px"><label>Vence</label><input id="cDue" type="number" min="1" max="31" value="10"></div></div>
      <button class="btn" data-act="addCard">Adicionar cartão</button></div>
    <div class="panel"><h3>Categorias</h3>
      <div class="rows">${state.tags.map(tg => `<div class="row"><span class="sw" style="background:${tg.color}"></span><div class="grow">${esc(tg.name)}</div><button class="btn small danger" data-act="delTag" data-id="${tg.id}">Remover</button></div>`).join('')}</div></div>
    <div class="panel"><h3>Aparência</h3>
      <div class="seg" style="grid-template-columns:repeat(3,1fr)">${[['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Sistema']].map(([v, l]) => `<button class="${t === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="panel"><h3>Instalar no celular</h3>${installHelp()}</div>
    <div class="panel"><h3>Conta</h3><p class="hint">Conectado como <b>${esc(user?.email || '')}</b>.</p>
      <button class="btn" data-act="logout">Sair da conta</button></div>
    <div class="panel"><h3>Dados</h3><p class="hint">Seus lançamentos ficam salvos na nuvem, visíveis só para a sua conta.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="sample">Restaurar exemplo</button><button class="btn danger" data-act="wipe">Apagar todos os lançamentos</button></div></div>
  </div>`;
  // each handler updates local state and returns the matching settings columns
  const bind = (id, fn) => document.getElementById(id).addEventListener('change', e => { const patch = fn(e.target.value); if (patch) run(() => db.settings(patch), 'Salvo'); });
  bind('sBal', v => { state.startBalance = +v || 0; return { start_balance: state.startBalance }; });
  bind('sDate', v => { if (!v) return null; state.startDate = v; return { start_date: v }; });
  bind('bMonthly', v => { state.budget.monthly = Math.max(0, +v || 0); return { budget_monthly: state.budget.monthly }; });
  bind('bDiv', v => { state.budget.divisor = v; return { budget_divisor: v }; });
}

const routes = { fluxo: renderFlow, horizonte: renderHorizon, resumo: renderSummary, categorias: renderTags, ajustes: renderSettings };
// Phone top bar: calendar (go to today), month switcher on Fluxo (page name elsewhere), Horizonte shortcut.
const PAGE_NAMES = { horizonte: 'Horizonte', resumo: 'Resumo', categorias: 'Categorias', ajustes: 'Ajustes' };
function updatePhoneBar(name) {
  document.querySelector('.mbar-hz').classList.toggle('active', name === 'horizonte');
  document.getElementById('mbarMid').innerHTML = name === 'fluxo'
    ? `<button class="icon-btn" data-act="mprev" title="Mês anterior">‹</button><h2>${monthName(phoneMonth.y, phoneMonth.m)}</h2><button class="icon-btn" data-act="mnext" title="Próximo mês">›</button>`
    : `<h2>${PAGE_NAMES[name] || ''}</h2>`;
}

// sticky month headers sit right under the top bar, whose height varies by device
function setTopBarHeight() {
  const h = document.querySelector('header.top').offsetHeight;
  if (h) document.documentElement.style.setProperty('--top-h', h + 'px');
}
window.addEventListener('resize', setTopBarHeight);
// switch between the phone (one month) and desktop (12 months) layouts when the width crosses the breakpoint
matchMedia('(max-width: 640px)').addEventListener('change', () => { if (user && document.body.dataset.route === 'fluxo') { renderFlow.scrolled = false; route(); } });

function route() {
  const r = (location.hash || '#fluxo').slice(1);
  const fn = routes[r] || renderFlow, name = routes[r] ? r : 'fluxo';
  document.body.dataset.route = name; // lets the CSS style each page differently on phones
  if (name === 'fluxo' && isPhone()) clampPhoneMonth();
  updatePhoneBar(name);
  setTopBarHeight();
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.r === name));
  fn();
}

// ---------- modals ----------
const overlay = document.getElementById('overlay'), modal = document.getElementById('modal');
function openModal(html) { modal.innerHTML = html; overlay.classList.add('open'); }
function closeModal() { overlay.classList.remove('open'); }
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Opens the entry form; pass `existing` to edit an entry (and its whole series) instead of creating one,
// and `opts.from` to change the series only from that occurrence on (the earlier ones keep the old values).
function openEntry(date, existing, opts = {}) {
  let type = existing ? existing.type : 'out';
  const series = existing && existing.repeat !== 'none';
  const from = series && opts.from && opts.from > existing.date ? opts.from : null;
  const fromLabel = from && parse(from).toLocaleDateString('pt-BR');
  const draw = () => {
    const isCard = type === 'card';
    openModal(`<div class="modal-head"><h2>${from ? `Alterar a partir de ${fromLabel}` : existing ? 'Editar lançamento' : 'Novo lançamento'}</h2><button class="icon-btn" data-act="close">✕</button></div>
    <div class="modal-body">
      <div class="seg">${Object.entries(TYPES).map(([k, t]) => `<button class="${k === type ? 'on' : ''}" data-act="type" data-v="${k}"><span class="sw" style="background:${t.color}"></span>${t.label}</button>`).join('')}</div>
      <div class="field"><label>Valor (R$)</label><input id="fAmt" class="amount-input" type="number" step="0.01" min="0" placeholder="0,00" value="${draw.amt ?? ''}"></div>
      <div class="field"><label>Descrição</label><input id="fDesc" placeholder="${TYPES[type].hint}" value="${esc(draw.desc ?? '')}"></div>
      <div class="inline"><div class="field"><label>${isCard ? 'Data da compra' : 'Data'}</label><input id="fDate" type="date" value="${draw.date ?? date ?? iso(today())}"></div>
        <div class="field"><label>Repetição</label><select id="fRep">${Object.entries(REPEATS).map(([k, l]) => `<option value="${k}" ${k === (draw.rep ?? 'none') ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="field" id="fCountWrap" style="display:${(draw.rep ?? 'none') === 'installments' ? 'flex' : 'none'}"><label>Número de parcelas (o valor é dividido)</label><input id="fCount" type="number" min="2" max="120" value="${draw.count ?? 3}"></div>
      <div class="inline">${isCard ? `<div class="field"><label>Cartão</label><select id="fCard">${state.cards.map(c => `<option value="${c.id}" ${c.id === draw.card ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label>Categoria</label><select id="fTag"><option value="">Sem categoria</option>${state.tags.map(t => `<option value="${t.id}" ${t.id === draw.tag ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div></div>
      ${isCard && !state.cards.length ? '<p class="hint neg">Cadastre um cartão em Ajustes primeiro.</p>' : ''}
      ${from ? `<p class="hint" style="margin:4px 0 0">↻ As ocorrências até ${parse(iso(addDays(parse(from), -1))).toLocaleDateString('pt-BR')} ficam como estão. A partir de <b>${fromLabel}</b> vale o que você definir aqui.</p>`
        : series ? `<p class="hint" style="margin:4px 0 0">↻ Este lançamento se repete (${REPEATS[existing.repeat].toLowerCase()}). A alteração vale para <b>todas as ocorrências</b>, inclusive as passadas.</p>` : ''}
    </div>
    <div class="modal-foot">${existing && !from ? `<button class="btn danger" data-act="delEntry" data-id="${existing.id}" style="margin-right:auto">Excluir${series ? ' série' : ''}</button>` : ''}<button class="btn" data-act="close">Cancelar</button><button class="btn primary" data-act="saveEntry">${existing ? 'Salvar alterações' : `Salvar ${TYPES[type].label.toLowerCase()}`}</button></div>`);
    modal.querySelector('#fRep').addEventListener('change', e => { modal.querySelector('#fCountWrap').style.display = e.target.value === 'installments' ? 'flex' : 'none'; });
    setTimeout(() => modal.querySelector('#fAmt').focus(), 30);
  };
  const keep = () => {
    draw.amt = modal.querySelector('#fAmt').value; draw.desc = modal.querySelector('#fDesc').value; draw.date = modal.querySelector('#fDate').value;
    draw.rep = modal.querySelector('#fRep').value; draw.count = modal.querySelector('#fCount').value;
    draw.tag = modal.querySelector('#fTag').value; draw.card = modal.querySelector('#fCard')?.value ?? draw.card;
  };
  // installments store the total, so the form shows the total amount back when editing;
  // from an occurrence on, it shows only what is left of the series
  let prefill = existing && { amt: existing.amount, desc: existing.desc, date: existing.date, rep: existing.repeat, count: existing.count > 1 ? existing.count : 3, tag: existing.tagId, card: existing.cardId };
  if (from && existing.repeat === 'installments') {
    const left = existing.count - occurrenceIndex(existing, from) + 1, per = existing.amount / existing.count;
    prefill = { ...prefill, amt: Math.round(per * left * 100) / 100, count: left, rep: left > 1 ? 'installments' : 'none' };
  }
  if (from) prefill.date = from;
  Object.assign(draw, prefill || { amt: undefined, desc: undefined, date: undefined, rep: undefined, count: undefined, tag: '', card: undefined });
  openEntry.setType = v => { keep(); type = v; draw(); };
  openEntry.submit = () => {
    const amount = parseFloat(modal.querySelector('#fAmt').value), d = modal.querySelector('#fDate').value;
    if (!(amount > 0)) return toast('Informe um valor maior que zero');
    if (!d) return toast('Informe a data');
    const rep = modal.querySelector('#fRep').value;
    const entry = { id: uid(), type, amount, desc: modal.querySelector('#fDesc').value.trim(), date: d, repeat: rep, count: rep === 'installments' ? Math.max(2, parseInt(modal.querySelector('#fCount').value) || 2) : 1, tagId: modal.querySelector('#fTag').value, cardId: type === 'card' ? (modal.querySelector('#fCard')?.value || '') : '' };
    if (type === 'card' && !entry.cardId) return toast('Cadastre um cartão primeiro');
    if (entry.desc.length > 200) return toast('Descrição muito longa (máx. 200)');
    const btn = modal.querySelector('[data-act=saveEntry]'); btn.disabled = true;
    if (from && d < from) return toast(`A nova data não pode ser antes de ${fromLabel}`);
    const save = from ? () => db.splitSeries(existing, from, entry) : existing ? () => db.updateEntry(existing.id, entry) : () => db.addEntry(entry);
    run(async () => { await save(); closeModal(); }, from ? `Alterado a partir de ${fromLabel}` : existing ? 'Alterações salvas' : 'Lançamento salvo').finally(() => { btn.disabled = false; });
  };
  draw();
}

function openDay(k) {
  const rows = computeRows(parse(k)), r = rows.find(x => x.k === k);
  if (!r) return toast('Data anterior ao ponto de partida');
  const tagName = id => state.tags.find(t => t.id === id)?.name;
  const exNote = x => {
    if (!x.ex) return '';
    const parts = [];
    if (x.ex.amount != null) parts.push(`valor ajustado (padrão ${money(baseAmount(x.e, x.od))})`);
    if (x.ex.date) parts.push(`movido de ${parse(x.od).toLocaleDateString('pt-BR')}`);
    if (x.ex.desc != null) parts.push('descrição ajustada');
    return ` · <span style="color:var(--primary);font-weight:700">✎ ${parts.join(', ')}</span>`;
  };
  const items = r.items.map(x => `<div class="row"><span class="sw" style="background:${TYPES[x.e.type].color}"></span><div class="grow"><b>${esc(x.desc || TYPES[x.e.type].label)}</b>
    <div class="sub">${TYPES[x.e.type].label}${x.e.repeat !== 'none' ? ` · ${REPEATS[x.e.repeat].toLowerCase()}` : ''}${x.n ? ` · parcela ${x.i}/${x.n}` : ''}${x.card ? ` · ${esc(x.card.name)}, compra em ${x.purchase.toLocaleDateString('pt-BR')}` : ''}${tagName(x.e.tagId) ? ` · ${esc(tagName(x.e.tagId))}` : ''}${exNote(x)}</div></div>
    <b class="num ${x.e.type === 'in' ? 'pos' : 'neg'}">${x.e.type === 'in' ? '+' : '−'}${money(x.amt)}</b><button class="icon-btn" title="Editar" data-act="editOcc" data-id="${x.e.id}" data-od="${x.od}">✏️</button><button class="icon-btn" title="Excluir" data-act="delOcc" data-id="${x.e.id}" data-od="${x.od}">🗑</button></div>`).join('');
  const skipped = (r.skipped || []).map(x => `<div class="row" style="opacity:.6"><span class="sw" style="background:${TYPES[x.e.type].color}"></span><div class="grow"><b style="text-decoration:line-through">${esc(x.e.desc || TYPES[x.e.type].label)}</b>
    <div class="sub">pulado nesta ocorrência${x.n ? ` · parcela ${x.i}/${x.n}` : ''}</div></div><b class="num" style="text-decoration:line-through">${money(x.amt)}</b><button class="btn small" data-act="restoreOcc" data-id="${x.e.id}" data-od="${x.od}">Restaurar</button></div>`).join('');
  openModal(`<div class="modal-head"><h2 style="text-transform:capitalize">${r.d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2><button class="icon-btn" data-act="close">✕</button></div>
  <div class="modal-body"><div class="rows">${items}${skipped}${r.budget ? `<div class="row"><span class="sw" style="background:var(--daily)"></span><div class="grow"><b>Orçamento diário</b><div class="sub">previsão automática</div></div><b class="num neg forecast">−${money(r.budget)}</b></div>` : ''}${!items && !skipped && !r.budget ? '<div class="empty-state">Nenhum lançamento neste dia.</div>' : ''}</div>
  <div class="rows" style="margin-top:10px;border-top:2px solid var(--border)"><div class="row"><div class="grow"><b>Saldo ao fim do dia</b></div><b class="num ${tone(r.bal)}">${money(r.bal)}</b></div></div></div>
  <div class="modal-foot"><button class="btn primary" data-act="addOn" data-day="${k}">+ Lançar neste dia</button></div>`);
}

// For a recurring entry, ask whether a change applies to one occurrence, the rest of the series, or all of it.
function openSeriesChoice(mode, e, od) {
  const when = parse(od).toLocaleDateString('pt-BR'), first = od <= e.date;
  const opts = mode === 'edit'
    ? [['one', 'Só esta ocorrência', `Muda valor, data ou descrição apenas em ${when}.`],
       ['next', 'Esta e as próximas', first ? 'É a primeira ocorrência, então vale para a série toda.' : `As ocorrências antes de ${when} ficam como estão.`],
       ['all', 'Toda a série', 'Altera todas as ocorrências, inclusive as passadas.']]
    : [['one', 'Pular só esta', `Remove apenas a ocorrência de ${when}. Dá para restaurar depois.`],
       ['next', 'Esta e as próximas', first ? 'É a primeira ocorrência, então exclui a série toda.' : `A série termina antes de ${when}; o histórico anterior fica.`],
       ['all', 'Excluir a série inteira', 'Apaga todas as ocorrências, inclusive as passadas.']];
  openModal(`<div class="modal-head"><h2>${mode === 'edit' ? 'Editar' : 'Excluir'} lançamento que se repete</h2><button class="icon-btn" data-act="close">✕</button></div>
  <div class="modal-body"><p class="hint" style="margin:0 0 12px"><b>${esc(e.desc || TYPES[e.type].label)}</b> · ${REPEATS[e.repeat].toLowerCase()}</p>
    <div class="rows">${opts.map(([v, l, h]) => `<div class="row" data-choice="${v}" style="cursor:pointer"><div class="grow"><b class="${mode === 'delete' && v === 'all' ? 'neg' : ''}">${l}</b><div class="sub">${h}</div></div><span style="color:var(--muted)">›</span></div>`).join('')}</div></div>`);
  modal.querySelectorAll('[data-choice]').forEach(el => el.addEventListener('click', () => {
    const v = el.dataset.choice;
    if (mode === 'edit') {
      if (v === 'one') openOccurrence(e, od);
      else if (v === 'next') openEntry(null, e, { from: od });
      else openEntry(null, e);
    } else if (v === 'one') { closeModal(); run(() => db.setException({ entryId: e.id, od, action: 'skip' }), 'Ocorrência pulada'); }
    else if (v === 'next' && !first) { closeModal(); run(() => db.endSeries(e.id, iso(addDays(parse(od), -1))), 'Série encerrada antes desta data'); }
    else if (confirm(`Excluir "${e.desc || TYPES[e.type].label}" e todas as ocorrências?`)) { closeModal(); run(() => db.delEntry(e.id), 'Série excluída'); }
  }));
}

// Change or skip a single occurrence of a series.
function openOccurrence(e, od) {
  const x = state.exceptions.find(v => v.entryId === e.id && v.od === od && v.action === 'modify');
  const base = baseAmount(e, od), idx = occurrenceIndex(e, od);
  openModal(`<div class="modal-head"><h2>Só esta ocorrência</h2><button class="icon-btn" data-act="close">✕</button></div>
  <div class="modal-body">
    <p class="hint" style="margin:0 0 12px"><b>${esc(e.desc || TYPES[e.type].label)}</b> de ${parse(od).toLocaleDateString('pt-BR')}${e.repeat === 'installments' ? ` · parcela ${idx}/${e.count}` : ''}. O resto da série não muda.</p>
    <div class="field"><label>Valor desta vez (R$) · padrão ${money(base)}</label><input id="oAmt" class="amount-input" type="number" step="0.01" min="0" value="${x && x.amount != null ? x.amount : Math.round(base * 100) / 100}"></div>
    <div class="field"><label>${e.type === 'card' ? 'Data da compra' : 'Data'} desta vez</label><input id="oDate" type="date" value="${(x && x.date) || od}"></div>
    <div class="field"><label>Descrição desta vez</label><input id="oDesc" value="${esc(x && x.desc != null ? x.desc : e.desc)}"></div>
  </div>
  <div class="modal-foot"><button class="btn danger" id="oSkip" style="margin-right:auto">Pular esta vez</button>${x ? '<button class="btn" id="oReset">Voltar ao padrão</button>' : ''}<button class="btn primary" id="oSave">Salvar</button></div>`);
  modal.querySelector('#oSkip').addEventListener('click', () => { closeModal(); run(() => db.setException({ entryId: e.id, od, action: 'skip' }), 'Ocorrência pulada'); });
  modal.querySelector('#oReset')?.addEventListener('click', () => { closeModal(); run(() => db.clearException(e.id, od), 'Ocorrência voltou ao padrão'); });
  modal.querySelector('#oSave').addEventListener('click', () => {
    const amount = parseFloat(modal.querySelector('#oAmt').value), date = modal.querySelector('#oDate').value, desc = modal.querySelector('#oDesc').value.trim();
    if (!(amount > 0)) return toast('Informe um valor maior que zero');
    if (!date) return toast('Informe a data');
    if (desc.length > 200) return toast('Descrição muito longa (máx. 200)');
    // keep only what differs from the series, so later edits to the series still flow through
    const patch = { amount: Math.abs(amount - base) >= 0.005 ? amount : null, date: date !== od ? date : '', desc: desc !== e.desc ? desc : null };
    closeModal();
    if (patch.amount == null && !patch.date && patch.desc == null) return x ? run(() => db.clearException(e.id, od), 'Ocorrência voltou ao padrão') : undefined;
    run(() => db.setException({ entryId: e.id, od, action: 'modify', ...patch }), 'Ocorrência ajustada');
  });
  setTimeout(() => modal.querySelector('#oAmt').focus(), 30);
}

// ---------- events ----------
const toastEl = document.getElementById('toast');
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), 1800); }
function applyTheme() { if (state.theme === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', state.theme); }

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a) { const row = e.target.closest('[data-day]'); if (row && !modal.contains(row)) openDay(row.dataset.day); return; }
  const act = a.dataset.act, shift = n => { const f = monthDate(view.y, view.m + n, 1); view = { y: f.getFullYear(), m: f.getMonth() }; route(); };
  const fshift = n => { const f = monthDate(focus.y, focus.m + n, 1); focus = { y: f.getFullYear(), m: f.getMonth() }; route(); };
  switch (act) {
    case 'prev': shift(-1); break;
    case 'next': shift(1); break;
    case 'today': view = { y: today().getFullYear(), m: today().getMonth() }; renderFlow.scrolled = false; route(); break;
    case 'newEntry': openEntry(); break;
    case 'mprev': shiftPhoneMonth(-1); break;
    case 'mnext': shiftPhoneMonth(1); break;
    case 'mtoday':
      phoneMonth = { y: today().getFullYear(), m: today().getMonth() }; renderFlow.scrolled = false;
      if (document.body.dataset.route !== 'fluxo') location.hash = '#fluxo'; else route();
      break;
    case 'fprev': fshift(-1); break;
    case 'fnext': fshift(1); break;
    case 'close': closeModal(); break;
    case 'type': openEntry.setType(a.dataset.v); break;
    case 'saveEntry': openEntry.submit(); break;
    case 'addOn': openEntry(a.dataset.day); break;
    case 'editEntry': { const en = state.entries.find(x => x.id === a.dataset.id); if (en) openEntry(null, en); break; }
    case 'editOcc': case 'delOcc': {
      const en = state.entries.find(x => x.id === a.dataset.id); if (!en) break;
      if (en.repeat !== 'none') { openSeriesChoice(act === 'editOcc' ? 'edit' : 'delete', en, a.dataset.od); break; }
      if (act === 'editOcc') openEntry(null, en);
      else if (confirm(`Excluir "${en.desc || TYPES[en.type].label}"?`)) { closeModal(); run(() => db.delEntry(en.id), 'Excluído'); }
      break;
    }
    case 'restoreOcc': closeModal(); run(() => db.clearException(a.dataset.id, a.dataset.od), 'Ocorrência restaurada'); break;
    case 'delEntry': {
      const en = state.entries.find(x => x.id === a.dataset.id);
      if (en && confirm(en.repeat !== 'none' ? `Excluir "${en.desc || TYPES[en.type].label}" e todas as repetições?` : `Excluir "${en.desc || TYPES[en.type].label}"?`)) {
        closeModal(); run(() => db.delEntry(en.id), 'Excluído');
      } break;
    }
    case 'addTag': {
      const n = document.getElementById('tagName').value.trim(); if (!n) return toast('Dê um nome à categoria');
      run(() => db.addTag({ name: n.slice(0, 60), color: document.getElementById('tagColor').value }), 'Categoria criada'); break;
    }
    case 'delTag': run(() => db.delTag(a.dataset.id), 'Categoria removida'); break;
    case 'addCard': {
      const n = document.getElementById('cName').value.trim(), c = +document.getElementById('cClose').value, d = +document.getElementById('cDue').value;
      if (!n || !(c >= 1 && c <= 31) || !(d >= 1 && d <= 31)) return toast('Preencha nome, fechamento e vencimento (1–31)');
      run(() => db.addCard({ name: n.slice(0, 60), close: c, due: d }), 'Cartão adicionado'); break;
    }
    case 'delCard':
      if (state.entries.some(x => x.cardId === a.dataset.id) && !confirm('Este cartão tem lançamentos. Removê-lo também exclui essas compras. Continuar?')) break;
      run(() => db.delCard(a.dataset.id), 'Cartão removido'); break;
    case 'theme': state.theme = a.dataset.v; rememberTheme(state.theme); applyTheme(); run(() => db.settings({ theme: state.theme })); break;
    case 'sample': if (confirm('Substituir seus dados pelo exemplo?')) { $view.innerHTML = '<div class="loading">Carregando exemplo…</div>'; run(() => db.seedSample(), 'Exemplo restaurado').then(applyTheme); } break;
    case 'wipe': if (confirm('Apagar todos os lançamentos? Cartões, categorias e ajustes ficam.')) run(() => db.wipe(), 'Lançamentos apagados'); break;
    case 'logout': sb.auth.signOut(); break;
  }
});
document.getElementById('addBtn').addEventListener('click', () => openEntry());

// ---------- install as an app (PWA) ----------
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installHelp() {
  if (isStandalone()) return '<p class="hint" style="margin:0">✓ O app já está instalado e aberto como aplicativo.</p>';
  if (installPrompt) return '<p class="hint">Adicione o Wodtke Finanças à tela inicial e abra como um app, mesmo sem internet.</p><button class="btn primary" data-act="install">⤓ Instalar app</button>';
  if (isIOS()) return '<p class="hint" style="margin:0">No iPhone/iPad, abra no <b>Safari</b>, toque em <b>Compartilhar</b> (□↑) e depois em <b>Adicionar à Tela de Início</b>.</p>';
  if (!window.isSecureContext) return '<p class="hint" style="margin:0">A instalação só aparece quando o app é aberto por um endereço <b>https://</b>. Publique o app num servidor com HTTPS e abra pelo celular.</p>';
  return '<p class="hint" style="margin:0">No Android, abra no <b>Chrome</b> e use o menu <b>⋮ → Instalar app</b> (ou "Adicionar à tela inicial").</p>';
}
function refreshInstallUI() {
  document.querySelectorAll('.install-btn').forEach(b => b.classList.toggle('show', !!installPrompt && !isStandalone()));
  if ((location.hash || '').slice(1) === 'ajustes') renderSettings();
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; refreshInstallUI(); });
window.addEventListener('appinstalled', () => { installPrompt = null; refreshInstallUI(); toast('App instalado'); });
document.addEventListener('click', async e => {
  if (!e.target.closest('[data-act="install"]') || !installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null; refreshInstallUI();
});
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('hashchange', () => { if (user) route(); });

// ---------- login ----------
const AUTH_MODES = {
  login:  { title: 'Entrar', lead: 'Acesse seu planejamento.', submit: 'Entrar', email: true, pass: true, pass2: false },
  signup: { title: 'Criar conta', lead: 'Use um e-mail válido. Vamos enviar um link de confirmação.', submit: 'Criar conta', email: true, pass: true, pass2: true },
  forgot: { title: 'Recuperar senha', lead: 'Enviaremos um link para você criar uma nova senha.', submit: 'Enviar link', email: true, pass: false, pass2: false },
  reset:  { title: 'Nova senha', lead: 'Escolha uma senha nova para sua conta.', submit: 'Salvar nova senha', email: false, pass: true, pass2: true },
};
let authMode = 'login';
const authEl = id => document.getElementById(id);
function authMessage(text, kind = 'err') { const m = authEl('authMsg'); m.textContent = text; m.className = 'auth-msg ' + kind; }
function setAuthMode(mode) {
  authMode = mode; const m = AUTH_MODES[mode];
  authEl('authTitle').textContent = m.title; authEl('authLead').textContent = m.lead; authEl('authSubmit').textContent = m.submit;
  authEl('fEmailWrap').style.display = m.email ? '' : 'none';
  authEl('fPassWrap').style.display = m.pass ? '' : 'none';
  authEl('fPass2Wrap').style.display = m.pass2 ? '' : 'none';
  authEl('aPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  authEl('aPass').value = ''; authEl('aPass2').value = '';
  const link = (to, label) => `<button type="button" data-auth="${to}">${label}</button>`;
  authEl('authLinks').innerHTML = mode === 'login' ? link('signup', 'Criar conta') + link('forgot', 'Esqueci a senha')
    : mode === 'reset' ? '' : link('login', '← Voltar para o login');
  authMessage('', '');
}
const PASS_RULE = 'A senha precisa ter pelo menos 8 caracteres, com letras e números.';
const strongEnough = p => p.length >= 8 && /[a-zA-Z]/.test(p) && /\d/.test(p);
const redirectUrl = () => location.origin + location.pathname;

authEl('authLinks').addEventListener('click', e => { const b = e.target.closest('[data-auth]'); if (b) setAuthMode(b.dataset.auth); });
authEl('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!sb) return authMessage('Backend não configurado: preencha supabaseUrl e supabaseAnonKey em config.js.');
  const email = authEl('aEmail').value.trim(), pass = authEl('aPass').value, pass2 = authEl('aPass2').value, m = AUTH_MODES[authMode];
  if (m.email && !/^\S+@\S+\.\S+$/.test(email)) return authMessage('Informe um e-mail válido.');
  if (m.pass2 && !strongEnough(pass)) return authMessage(PASS_RULE);
  if (m.pass2 && pass !== pass2) return authMessage('As senhas não conferem.');
  if (authMode === 'login' && !pass) return authMessage('Informe a senha.');
  const btn = authEl('authSubmit'); btn.disabled = true; authMessage('Aguarde…', 'ok');
  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw new Error(/confirm/i.test(error.message) ? 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).' : 'E-mail ou senha incorretos.');
    } else if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: redirectUrl() } });
      if (error) throw error;
      if (!data.session) { setAuthMode('login'); authEl('aEmail').value = email; authMessage('Conta criada! Confirme pelo link enviado ao seu e-mail e depois entre.', 'ok'); }
    } else if (authMode === 'forgot') {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
      if (error) throw error;
      authMessage('Se esse e-mail tiver conta, o link de recuperação chegará em instantes.', 'ok');
    } else if (authMode === 'reset') {
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) throw error;
      history.replaceState(null, '', redirectUrl() + '#fluxo');
      await enterApp((await sb.auth.getUser()).data.user);
      toast('Senha atualizada');
    }
  } catch (err) { authMessage(err.message || 'Não foi possível concluir. Tente novamente.'); }
  finally { btn.disabled = false; }
});

async function enterApp(u) {
  if (!u) return;
  user = u;
  document.body.classList.remove('locked');
  $view.innerHTML = '<div class="loading">Carregando seus dados…</div>';
  try { await loadAll(); }
  catch (err) { console.error(err); $view.innerHTML = `<div class="panel empty-state">Não foi possível carregar seus dados (${esc(err.message || 'erro de conexão')}). Verifique a internet e recarregue.</div>`; return; }
  applyTheme(); renderFlow.scrolled = false; route();
}
function leaveApp() {
  user = null; state = emptyState(); closeModal();
  document.body.classList.add('locked'); $view.innerHTML = '';
  setAuthMode('login');
}

applyTheme();
setAuthMode('login');
if (!sb) authMessage('Backend não configurado: preencha supabaseUrl e supabaseAnonKey em config.js.');
else {
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { document.body.classList.add('locked'); setAuthMode('reset'); return; }
    if (event === 'SIGNED_OUT') return leaveApp();
    if (event === 'SIGNED_IN' && session && authMode !== 'reset' && (!user || user.id !== session.user.id)) setTimeout(() => enterApp(session.user), 0);
  });
  sb.auth.getSession().then(({ data }) => { if (data.session && authMode !== 'reset' && !user) enterApp(data.session.user); });
}
