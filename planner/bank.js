// Importar page: the checking-account statement (OFX). Each movement is compared with what the app already
// has in that period (not card purchases, which live on the invoices) and the person decides, line by line,
// what to add, adjust or skip. Like the invoice reader, the file is read on this device and nothing is
// saved until "Aplicar". Loaded before app.js; uses its globals (state, db, money…) at call time.

let stm = { fileName: '', org: '', start: '', end: '', bal: null, rows: [], extra: [], applying: false };

// ---------- reading the OFX ----------
// OFX 1.x is SGML: tags often have no closing tag, so values run to the end of the line.
function parseOfx(text) {
  const tag = (blk, name) => { const m = blk.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i')); return m ? m[1].trim() : ''; };
  const day = s => (s && s.length >= 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
  const blocks = text.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>/i)[0]);
  const items = blocks.map(b => {
    const amt = parseFloat(tag(b, 'TRNAMT').replace(',', '.'));
    return { id: tag(b, 'FITID'), date: day(tag(b, 'DTPOSTED')), amount: Math.abs(amt), dir: amt < 0 ? 'out' : 'in', memo: tag(b, 'MEMO') || tag(b, 'NAME') };
  }).filter(x => x.date && x.amount > 0);
  const bal = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i);
  return { org: tag(text, 'ORG'), start: day(tag(text, 'DTSTART')), end: day(tag(text, 'DTEND')), bal: bal ? parseFloat(bal[1]) : null, items };
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s/-])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Ltda|Sa|Me|Eireli|Cpf|Cnpj)\b/g, w => w.toUpperCase());
// "DEBITO TRANSFERENCIA PIX ( DOC.: DEB PIX / LET S ENTRETENIMENTO LTDA )" → "Pix para Let S Entretenimento LTDA"
function statementDesc(memo, dir) {
  const m = memo.match(/^(.*?)\s*\(\s*DOC\.?:\s*(.*?)\s*\)\s*$/i);
  const head = (m ? m[1] : memo).replace(/\s+-\s*IB$/i, '').replace(/\s+/g, ' ').trim(), doc = m ? m[2] : ''; // "- IB": internet banking
  if (/pix/i.test(head) && doc.includes('/')) {
    const who = doc.split('/').pop().replace(/^\s*\d{5,}\s*/, '').replace(/\s+\d{8,}\s*$/, '').trim();
    return `Pix ${dir === 'in' ? 'de' : 'para'} ${titleCase(who)}`;
  }
  const company = (doc.match(/-\s*([^-/]*[a-zà-ú]{3}[^-/]*)$/i) || [])[1];
  return titleCase(head) + (company ? ` · ${titleCase(company.trim())}` : '');
}
// payment of a credit-card invoice: its purchases are already in the app, so it is skipped by default
const CARD_BILL = /cobran[cç]a propria|fatura|cart[aã]o de cr[eé]dito/i;
// debits that are usually fixed bills rather than day-to-day spending
const FIXED_BILL = /parcela|mensalid|financiamento|empr[eé]stimo|seguro|t[ií]tulo|conv[eê]nio|energia|aluguel|condom|juros|iof|tarifa|cesta/i;

function readStatement(bytes) {
  const ofx = parseOfx(decodeText(bytes));
  if (!ofx.items.length) { toast('Nenhuma movimentação encontrada neste arquivo'); return; }
  Object.assign(stm, { org: ofx.org, start: ofx.start, end: ofx.end, bal: ofx.bal, extra: [] });
  stm.rows = ofx.items.map(x => {
    const card = x.dir === 'out' && CARD_BILL.test(x.memo);
    const desc = card ? `Pagamento de fatura${(x.memo.match(/-\s*([^-/)]*[a-zà-ú]{3}[^-/)]*)\)?\s*$/i) || [])[1] ? ` · ${titleCase(x.memo.match(/-\s*([^-/)]*[a-zà-ú]{3}[^-/)]*)\)?\s*$/i)[1].trim())}` : ''}` : statementDesc(x.memo, x.dir);
    return { ...x, desc, card, type: x.dir === 'in' ? 'in' : FIXED_BILL.test(x.memo) ? 'out' : 'daily', tagId: guessTag(desc), action: 'skip', touched: false };
  });
  stmReconcile();
}

// ---------- comparing with the app ----------
// everything the app has on these days except card purchases (those are compared with the invoices)
function statementItems(from, to) {
  const L = buildLedger(parse(to)), out = [];
  for (const [k, b] of L) if (k >= from && k <= to) for (const x of b.items) if (x.e.type !== 'card') out.push({ ...x, on: parse(k) });
  return out;
}
function stmReconcile() {
  if (!stm.rows.length) return;
  const from = iso(addDays(parse(stm.start || stm.rows[0].date), -3)), to = iso(addDays(parse(stm.end || stm.rows[stm.rows.length - 1].date), 3));
  const appItems = statementItems(from, to), used = new Set();
  const take = test => { const k = appItems.findIndex((x, j) => !used.has(j) && test(x)); if (k >= 0) used.add(k); return k >= 0 ? appItems[k] : null; };
  for (const r of stm.rows) {
    r.match = null; r.status = 'new';
    if (r.card) { r.status = 'cardbill'; if (!r.touched) r.action = 'skip'; continue; }
    const d = parse(r.date), same = a => (a.e.type === 'in') === (r.dir === 'in');
    let x = take(a => same(a) && Math.abs(a.amt - r.amount) < 0.01 && daysApart(a.on, d) <= 3);
    if (x) { r.match = x; r.status = 'ok'; }
    // same direction and close in time, with the same name (up to 3 days) or almost the same value (up to 1 day, 3%):
    // probably the same movement with another value, like a salary that came in a little lower
    else if ((x = take(a => same(a) && ((daysApart(a.on, d) <= 3 && sameish(a.desc, r.desc)) || (daysApart(a.on, d) <= 1 && Math.abs(a.amt - r.amount) <= r.amount * 0.03))))) { r.match = x; r.status = 'diff'; }
    if (!r.touched) r.action = r.status === 'new' ? 'add' : r.status === 'diff' ? 'adjust' : 'skip';
  }
  const last = stm.end || to, t = iso(today());
  stm.extra = appItems.filter((a, j) => !used.has(j) && iso(a.on) >= (stm.start || from) && iso(a.on) <= last && iso(a.on) <= t).map(x => ({ x, skip: false }));
}

// ---------- page section ----------
const STM_LABEL = { ok: 'Já lançado', diff: 'Valor diferente', new: 'Novo', cardbill: 'Pagamento de fatura' };
const STM_TYPES = ['in', 'out', 'daily', 'save'];
function statementHtml() {
  const head = `<div class="inv-form stm-form"><div class="field inv-file"><label>Arquivo do extrato (OFX)</label><label class="btn"><input type="file" id="stmFile" accept=".ofx,.qfx,application/x-ofx" hidden>⤓ ${stm.fileName ? esc(stm.fileName) : 'Escolher extrato OFX'}</label></div></div>`;
  if (!stm.rows.length) return head;
  const appBal = stm.end ? (computeRows(parse(stm.end)).find(r => r.k === stm.end) || {}).bal : null;
  const ins = stm.rows.filter(r => r.dir === 'in').reduce((a, r) => a + r.amount, 0), outs = stm.rows.filter(r => r.dir === 'out').reduce((a, r) => a + r.amount, 0);
  const count = a => stm.rows.filter(r => r.action === a).length;
  const fmt = k => (k ? parse(k).toLocaleDateString('pt-BR') : '');
  return head + `<div class="inv-sum">
      <span>${esc(stm.org || 'Banco')} · ${fmt(stm.start)} a ${fmt(stm.end)} · <b>${stm.rows.length}</b> movimentações</span>
      <span>Entradas <b class="pos">${money(ins)}</b> · Saídas <b class="neg">${money(outs)}</b></span>
      <span class="chip-s ok">${stm.rows.filter(r => r.status === 'ok').length} já lançadas</span>
      <span class="chip-s diff">${stm.rows.filter(r => r.status === 'diff').length} com valor diferente</span>
      <span class="chip-s new">${stm.rows.filter(r => r.status === 'new').length} novas</span>
    </div>
    ${stm.bal != null && appBal != null ? `<p class="hint stm-bal">Saldo no banco em ${fmt(stm.end)}: <b class="${tone(stm.bal)}">${money(stm.bal)}</b> · no app: <b class="${tone(appBal)}">${money(appBal)}</b>${Math.abs(stm.bal - appBal) >= 0.01 ? ` · diferença de <b>${money(stm.bal - appBal)}</b>` : ' · iguais ✓'}</p>` : ''}
    <div class="inv-table"><div class="inv-head stm-head"><span>Data</span><span>Descrição</span><span>Tipo</span><span>Valor</span><span>Categoria</span><span>No app</span><span>Fazer</span></div>
    ${stm.rows.map((r, i) => `<div class="inv-row stm-row st-${r.status === 'cardbill' ? 'credit' : r.status}" data-i="${i}">
      <input type="date" data-f="date" value="${r.date}">
      <input type="text" data-f="desc" value="${esc(r.desc)}" title="${esc(r.memo)}">
      <select data-f="type">${STM_TYPES.map(k => `<option value="${k}" ${k === r.type ? 'selected' : ''}>${TYPES[k].label}</option>`).join('')}</select>
      <input type="text" inputmode="numeric" data-f="amount" class="money-input stm-amt ${r.dir === 'in' ? 'pos' : 'neg'}" value="${maskMoney(r.amount)}">
      <select data-f="tagId" class="inv-tag"><option value="">Sem categoria</option>${state.tags.map(t => `<option value="${t.id}" ${t.id === r.tagId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <span class="inv-st"><i class="chip-s ${r.status === 'cardbill' ? 'credit' : r.status}">${STM_LABEL[r.status]}</i>${r.match ? `<small>${esc(r.match.desc || TYPES[r.match.e.type].label)} · ${money(r.match.amt)} · ${r.match.on.toLocaleDateString('pt-BR')}</small>` : r.card ? '<small>as compras já estão no cartão</small>' : ''}</span>
      <select data-f="action">
        <option value="add" ${r.action === 'add' ? 'selected' : ''}>Lançar</option>
        ${r.match ? `<option value="adjust" ${r.action === 'adjust' ? 'selected' : ''}>Ajustar no app</option>` : ''}
        <option value="skip" ${r.action === 'skip' ? 'selected' : ''}>Ignorar</option>
      </select></div>`).join('')}
    </div>
    ${stm.extra.length ? `<h3 style="margin-top:18px">No app, mas não no extrato</h3><p class="hint">Lançamentos do período que não apareceram no banco. Marque os que não aconteceram para pular só esta ocorrência.</p>
      <div class="rows">${stm.extra.map((e, j) => `<label class="row inv-extra"><input type="checkbox" data-stm-extra="${j}" ${e.skip ? 'checked' : ''}><span class="sw" style="background:${TYPES[e.x.e.type].color}"></span><div class="grow"><b>${esc(e.x.desc || TYPES[e.x.e.type].label)}</b><div class="sub">${TYPES[e.x.e.type].label} · ${e.x.on.toLocaleDateString('pt-BR')}</div></div><b class="num">${money(e.x.amt)}</b></label>`).join('')}</div>` : ''}
    <div class="inv-apply"><button class="btn primary" data-act="stmApply">Aplicar: ${count('add')} lançar · ${count('adjust')} ajustar${stm.extra.some(e => e.skip) ? ` · ${stm.extra.filter(e => e.skip).length} pular` : ''}</button>
      <button class="btn" data-act="stmReset">Limpar alterações</button>
      <button class="btn" data-act="stmCancel">Cancelar importação</button></div>`;
}

async function applyStatement() {
  if (stm.applying) return;
  const add = stm.rows.filter(r => r.action === 'add'), adjust = stm.rows.filter(r => r.action === 'adjust' && r.match), skip = stm.extra.filter(e => e.skip);
  if (!add.length && !adjust.length && !skip.length) return toast('Nada marcado para aplicar');
  if (!(await ask(`Aplicar o extrato?\n\n${add.length} lançar · ${adjust.length} ajustar · ${skip.length} pular`, { ok: 'Aplicar' }))) return;
  const entries = add.map(r => ({ type: r.type, amount: r.amount, desc: r.desc, date: r.date, repeat: 'none', count: 1, tagId: r.tagId || '', cardId: '' }));
  const total = entries.length + adjust.length + skip.length;
  let done = 0, saved = false;
  const b = busy('Aplicando o extrato…'), step = (label, n = 1) => { done += n; b.say(`${label} ${Math.min(done, total)} de ${total}…`, done / total); };
  stm.applying = true;
  try {
    await run(async () => {
      for (let k = 0; k < entries.length; k += 40) { const chunk = entries.slice(k, k + 40); await db.addEntries(chunk); step('Lançado', chunk.length); }
      await db.rememberMerchants(add.map((r, k) => [r.desc, entries[k]]).filter(([, e]) => e.tagId));
      // the app's occurrence takes the bank's value, and its date when the bank shows another day
      for (const r of adjust) {
        const x = r.match;
        await db.setException({ entryId: x.e.id, od: x.od, action: 'modify', amount: r.amount, date: r.date !== iso(x.on) ? r.date : (x.ex && x.ex.date) || '', desc: x.ex ? x.ex.desc : null });
        step('Ajustando');
      }
      for (const sk of skip) { await db.setException({ entryId: sk.x.e.id, od: sk.x.od, action: 'skip' }); step('Pulando'); }
      saved = true;
    }, `Extrato aplicado: ${entries.length} lançadas`);
  } finally { stm.applying = false; b.done(); }
  if (saved) clearStatement(); else stmReconcile();
  route();
}
function clearStatement() { stm = { fileName: '', org: '', start: '', end: '', bal: null, rows: [], extra: [], applying: false, data: null }; }

document.addEventListener('change', async e => {
  if (document.body.dataset.route !== 'importar') return;
  const t = e.target;
  if (t.id === 'stmFile' && t.files && t.files[0]) {
    const f = t.files[0];
    stm.fileName = f.name; stm.data = new Uint8Array(await f.arrayBuffer());
    const b = busy('Lendo o extrato…');
    try { readStatement(stm.data); } finally { b.done(); }
    route();
  } else if (t.dataset.stmExtra != null) {
    stm.extra[+t.dataset.stmExtra].skip = t.checked; route();
  } else if (t.closest('.stm-row')) {
    const r = stm.rows[+t.closest('.stm-row').dataset.i], f = t.dataset.f;
    if (f === 'action') { r.action = t.value; r.touched = true; route(); return; }
    if (f === 'amount') r.amount = Math.abs(unmaskMoney(t.value));
    else r[f] = t.value;
    if (f === 'date' || f === 'amount') { stmReconcile(); route(); }
  }
});
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a || document.body.dataset.route !== 'importar') return;
  switch (a.dataset.act) {
    case 'stmApply': applyStatement(); break;
    case 'stmReset': if (stm.data) { readStatement(stm.data); route(); } break;
    case 'stmCancel':
      (stm.rows.length ? ask('Cancelar esta importação?\n\nNada foi lançado ainda.', { ok: 'Cancelar importação', cancel: 'Continuar' }) : Promise.resolve(true))
        .then(yes => { if (yes) { clearStatement(); route(); } });
      break;
  }
});
