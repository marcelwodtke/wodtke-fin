// Importar page: Apple Pay purchases waiting for review, and card invoices read from a PDF or CSV.
// The PDF is read on this device (pdf.js, bundled in vendor/); nothing is uploaded. Each line of the
// invoice is compared with the card entries already in the app for that invoice, and the person
// decides, line by line, what to add, adjust or skip. Loaded before app.js; uses its globals at call time.

// ---------- reading the PDF ----------
let pdfLib = null;
function loadPdfReader() {
  if (!pdfLib) pdfLib = new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/pdf.min.js';
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; ok(window.pdfjsLib); };
    sc.onerror = () => { pdfLib = null; sc.remove(); fail(new Error('Não foi possível carregar o leitor de PDF')); };
    document.head.appendChild(sc);
  });
  return pdfLib;
}
// Text of every page as lines: pieces on the same baseline are joined left to right.
async function pdfLines(data, password) {
  const lib = await loadPdfReader();
  // some downloads carry padding before the PDF itself; start at the "%PDF-" marker
  for (let i = 0, end = Math.min(data.length - 5, 2e6); i < end; i++) {
    if (data[i] === 0x25 && data[i + 1] === 0x50 && data[i + 2] === 0x44 && data[i + 3] === 0x46 && data[i + 4] === 0x2d) { if (i) data = data.subarray(i); break; }
  }
  const doc = await lib.getDocument({
    data, password, isEvalSupported: false,
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/', cMapPacked: true,
    standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
  }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push(row = { y, parts: [] });
      // some PDFs space out every letter ("C E S T T O"): join the letters back into words
      let str = it.str;
      const toks = str.trim().split(/ +/);
      if (toks.length >= 2 && toks.filter(t => t.length === 1).length / toks.length >= 0.6) str = str.trim().split(/ {2,}/).map(w => w.replace(/ /g, '')).join(' ');
      row.parts.push({ x, s: str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let s = '', end = -1;
      for (const pt of r.parts) { s += (end >= 0 && pt.x - end > 1.5 ? ' ' : '') + pt.s; end = pt.x + pt.w; }
      lines.push(s.replace(/\s+/g, ' ').trim());
    }
  }
  return lines;
}

// ---------- understanding the lines ----------
const MONTHS_PT = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
const MON = '(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\\.?';
// the date a purchase line starts with (after at most one short token such as a card number):
// 15/09 · 15/09/2026 · 15 SET · 15/set · 03 de nov. 2025
const DATE_START = new RegExp(`^(?:\\S{0,14}\\s)?(?:(\\d{1,2})\\s*\\/\\s*(\\d{1,2})(?:\\s*\\/\\s*(\\d{2,4}))?|(\\d{1,2})\\s*(?:\\/|\\s|\\sde\\s)\\s*${MON}(?:\\s*\\/?\\s*(\\d{4}))?)(?=\\s|$)`, 'i');
const AMOUNT_END = /([-−+])?\s*(?:R\$\s*)?([-−+])?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(-|−|D|C)?$/i;
const MONEY_ANY = /(?:R\$\s*)?[-−+]?\s*\d{1,3}(?:\.\d{3})*,\d{2}/g;
const INSTALLMENT = /\(?\s*(?:parc(?:ela)?\.?\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*\)?\s*$/i;
// invoice bookkeeping rather than purchases: payments and credits, or the bank's own fees
const PAYMENT = /pagamento|pgto|saldo anterior|estorno|cr[eé]dito|desconto|bonifica/i;
const FEE = /encargo|juros|iof|anuidade|multa|tarifa|mora\b|rotativo/i;
const NOT_PURCHASE = new RegExp(`${PAYMENT.source}|${FEE.source}`, 'i');
const brNumber = s => +s.replace(/\./g, '').replace(',', '.');
const year4 = s => +(s.length === 2 ? '20' + s : s);

// the first "dd/mm/yyyy" or "dd MMM yyyy" after a label (same line or the next one)
function dateAfter(text, label) {
  const re = new RegExp(`${label}[^\\d\\n]{0,40}\\n?[^\\d\\n]{0,40}(\\d{1,2})\\s*(?:\\/\\s*(\\d{1,2})\\s*\\/|\\s*${MON})\\s*(\\d{2,4})`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const month = m[2] ? +m[2] - 1 : MONTHS_PT[m[3].slice(0, 3).toLowerCase()];
  return new Date(year4(m[4]), month, +m[1], 12);
}
function amountAfter(text, label) {
  const m = text.match(new RegExp(`${label}[^\\d\\n]{0,30}(\\d{1,3}(?:\\.\\d{3})*,\\d{2})`, 'i'));
  return m ? brNumber(m[1]) : null;
}

function parseInvoice(lines) {
  const text = lines.join('\n');
  const due = dateAfter(text, 'vencimento') || dateAfter(text, 'vence em');
  // the amount due this time; "total a pagar" last, since some banks also use it for the minimum-payment projection
  const total = amountAfter(text, 'fatura atual') ?? amountAfter(text, '(?:^|\\n)total:?\\s*R\\$') ?? amountAfter(text, 'valor total de')
    ?? amountAfter(text, 'total da (?:sua )?fatura(?! de| anterior)') ?? amountAfter(text, 'total a pagar:?');
  // banks that write "+ R$" for payments use "- R$" only as a column separator, not as a sign
  const plusMarksCredit = lines.some(l => /\+\s*R\$\s*\d/.test(l));
  const items = [];
  lines.forEach((line, n) => {
    const d = line.match(DATE_START), a = line.match(AMOUNT_END);
    if (!d || !a || /venc|fechamento|total d[ae] fatura|melhor dia/i.test(line)) return;
    let desc = line.slice(d.index + d[0].length, a.index).replace(MONEY_ANY, ' ').replace(/[\s\-–+]+$/, '').replace(/\s+/g, ' ').trim();
    if (!/[a-zà-ú]{2}/i.test(desc)) return; // a date followed only by numbers (limits, totals) is not a purchase
    const day = +(d[1] || d[4]), month = d[2] ? +d[2] - 1 : MONTHS_PT[d[5].slice(0, 3).toLowerCase()];
    if (day < 1 || day > 31 || month < 0 || month > 11) return;
    const yy = d[3] || d[6], year = yy ? year4(yy) : null;
    let i = null, cnt = null;
    const pm = desc.match(INSTALLMENT);
    if (pm && /parc|\(/i.test(pm[0]) || pm && /\d\s*\/\s*\d/.test(pm[0])) {
      if (+pm[1] >= 1 && +pm[2] >= 2 && +pm[1] <= +pm[2]) { i = +pm[1]; cnt = +pm[2]; desc = desc.slice(0, pm.index).replace(/[\s\-–(]+$/, '').trim(); }
    }
    const sign = [a[1], a[2], a[4]].filter(Boolean).join('');
    const negative = plusMarksCredit ? /\+/.test(sign) : /[-−C]/i.test(sign);
    const kind = negative || PAYMENT.test(desc) ? 'credit' : FEE.test(desc) ? 'fee' : '';
    items.push({ n, raw: line, day, month, year, desc, amount: brNumber(a[3]), i, cnt, credit: !!kind, kind });
  });
  return { due, total, items };
}
// The year of a line with no year: the latest one that keeps it on or before the invoice's due date.
function lineDate(it, due) {
  if (it.year) return new Date(it.year, it.month, it.day, 12);
  const y = due.getFullYear();
  const d = new Date(y, it.month, it.day, 12);
  return d > due ? new Date(y - 1, it.month, it.day, 12) : d;
}

// ---------- category guess ----------
// A purchase's category, from what was used before: a remembered rule for the merchant, else the latest
// entry with the same description, else the most used category among entries whose description looks alike.
const descKey = s => String(s || '').replace(/\s*\((?:parcelas|compra)[^)]*\)\s*$/i, '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
function guessTag(desc) {
  const rule = state.rules.find(x => x.key === merchantKey(desc));
  if (rule && rule.tagId) return rule.tagId;
  const tagged = state.entries.filter(e => e.tagId && state.tags.some(t => t.id === e.tagId));
  const k = descKey(desc);
  if (k) {
    const same = tagged.filter(e => descKey(e.desc) === k).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (same.length) return same[0].tagId;
  }
  // look-alike = same first word (the merchant's name), e.g. "MERCADOLIVRE*SIENO" and "MERCADOLIVRE*CASA"
  const head = s => (String(s || '').toLowerCase().normalize('NFD').match(/[a-z0-9]{4,}/) || [''])[0];
  const h = head(desc), votes = new Map();
  if (h) for (const e of tagged) if (head(e.desc) === h) votes.set(e.tagId, (votes.get(e.tagId) || 0) + 1);
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

// ---------- comparing with the app ----------
// card entries the app charges on this invoice (its due date falls in the invoice month)
function invoiceItems(cardId, y, m) {
  const L = buildLedger(monthDate(y, m, 31)), out = [];
  for (const [k, b] of L) {
    const d = parse(k);
    if (d.getFullYear() !== y || d.getMonth() !== m) continue;
    for (const x of b.items) if (x.card && x.card.id === cardId) out.push({ ...x, charged: d });
  }
  return out;
}
const words = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(w => w.length >= 3);
const sameish = (a, b) => { const wb = words(b); return words(a).some(w => wb.some(v => v.startsWith(w.slice(0, 4)) || w.startsWith(v.slice(0, 4)))); };
const daysApart = (a, b) => Math.abs(a - b) / 864e5;

function reconcile() {
  const card = state.cards.find(c => c.id === imp.cardId);
  const [y, m] = imp.month.split('-').map(Number);
  const appItems = card ? invoiceItems(card.id, y, m - 1) : [];
  const used = new Set();
  const take = test => { const k = appItems.findIndex((x, j) => !used.has(j) && test(x)); if (k >= 0) used.add(k); return k >= 0 ? appItems[k] : null; };
  for (const r of imp.rows) {
    r.match = null; r.status = 'new';
    if (r.credit) { r.status = r.kind === 'fee' ? 'fee' : 'credit'; r.action = r.touched ? r.action : 'skip'; continue; }
    const amt = r.amount, d = parse(r.date);
    // a line dated outside this invoice's cycle is an installment of an older purchase
    r.old = !!card && !r.cnt && (() => { const due = invoiceDue(d, card); return due.getFullYear() !== y || due.getMonth() !== m - 1; })();
    let x = take(a => Math.abs(a.amt - amt) < 0.01 && daysApart(a.purchase, d) <= 3)
      || take(a => Math.abs(a.amt - amt) < 0.01 && daysApart(parse(a.e.date), d) <= 3)
      || (r.old || r.cnt ? take(a => Math.abs(a.amt - amt) < 0.01 && sameish(a.desc, r.desc)) : null)
      || (r.cnt ? take(a => a.n === r.cnt && a.i === r.i && Math.abs(a.amt - amt) < 0.01) : null)
      || take(a => Math.abs(a.amt - amt) < 0.01 && daysApart(a.purchase, d) <= 10 && sameish(a.desc, r.desc));
    if (x) { r.match = x; r.status = 'ok'; }
    else if ((x = take(a => daysApart(a.purchase, d) <= 3 && sameish(a.desc, r.desc)) || (r.cnt ? take(a => a.n === r.cnt && a.i === r.i && sameish(a.desc, r.desc)) : null))) { r.match = x; r.status = 'diff'; }
    if (!r.touched) r.action = r.status === 'new' ? 'add' : r.status === 'diff' ? 'adjust' : 'skip';
  }
  imp.extra = appItems.filter((_, j) => !used.has(j)).map(x => ({ x, skip: false }));
}

// ---------- page ----------
let imp = { cardId: '', month: '', rows: [], extra: [], fileName: '', lines: null, needPassword: false, data: null, total: null, showText: false, csv: null };

function inboxRowsHtml() {
  const items = state.inbox || [];
  const tagName = id => state.tags.find(t => t.id === id)?.name;
  if (!items.length) return '<div class="empty-state">Nenhuma compra do Apple Pay para revisar.</div>';
  return `<div class="rows">${items.map(x => {
    const d = importDefaults(x), card = d.type === 'card' && state.cards.find(c => c.id === d.cardId);
    const guess = [TYPES[d.type].label, card ? card.name : '', tagName(d.tagId) || ''].filter(Boolean).join(' · ');
    return `<div class="row"><span class="sw" style="background:${TYPES[d.type].color}"></span><div class="grow"><b>${esc(x.merchant || 'Compra Apple Pay')}</b>
      <div class="sub">${parse(x.date).toLocaleDateString('pt-BR')}${x.card ? ` · ${esc(x.card)}` : ''}<br>vai como: ${esc(guess)}</div></div>
      <b class="num">${money(x.amount)}</b>
      <div style="display:flex;flex-direction:column;gap:4px"><button class="btn small primary" data-act="inboxUse" data-id="${x.id}">Lançar</button><button class="btn small" data-act="inboxDrop" data-id="${x.id}">Descartar</button></div></div>`;
  }).join('')}</div>`;
}

const STATUS_LABEL = { ok: 'Já lançado', diff: 'Valor diferente', new: 'Novo', credit: 'Pagamento/crédito', fee: 'Tarifa/encargo' };
function invoiceRowsHtml() {
  if (!imp.rows.length) return '';
  const card = state.cards.find(c => c.id === imp.cardId);
  const counts = a => imp.rows.filter(r => r.action === a).length;
  const sumRows = imp.rows.filter(r => !r.credit).reduce((s, r) => s + r.amount, 0);
  return `<div class="inv-sum">
      <span><b>${imp.rows.filter(r => !r.credit).length}</b> compras lidas · ${money(sumRows)}</span>
      ${imp.total != null ? `<span>Total na fatura: <b>${money(imp.total)}</b></span>` : ''}
      <span class="chip-s ok">${imp.rows.filter(r => r.status === 'ok').length} já lançadas</span>
      <span class="chip-s diff">${imp.rows.filter(r => r.status === 'diff').length} com valor diferente</span>
      <span class="chip-s new">${imp.rows.filter(r => r.status === 'new').length} novas</span>
    </div>
    <div class="inv-table"><div class="inv-head"><span>Data</span><span>Descrição</span><span>Parcela</span><span>Valor</span><span>Categoria</span><span>No app</span><span>Fazer</span></div>
    ${imp.rows.map((r, i) => `<div class="inv-row st-${r.status}" data-i="${i}">
      <input type="date" data-f="date" value="${r.date}">
      <input type="text" data-f="desc" value="${esc(r.desc)}">
      <input type="text" class="inv-parc" data-f="parc" value="${r.cnt ? `${r.i}/${r.cnt}` : ''}" placeholder="—" inputmode="numeric" title="Parcela, por exemplo 3/10">
      <input type="text" inputmode="numeric" data-f="amount" class="money-input" value="${maskMoney(r.amount)}">
      <select data-f="tagId" class="inv-tag"><option value="">Sem categoria</option>${state.tags.map(t => `<option value="${t.id}" ${t.id === r.tagId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <span class="inv-st"><i class="chip-s ${r.status}">${STATUS_LABEL[r.status]}</i>${r.match ? `<small>${esc(r.match.desc || '')} · ${money(r.match.amt)}</small>` : r.old && r.status === 'new' ? '<small>compra antiga: entra só nesta fatura</small>' : ''}${r.who ? `<small>${esc(r.who)}</small>` : ''}</span>
      <select data-f="action">
        <option value="add" ${r.action === 'add' ? 'selected' : ''}>Lançar</option>
        ${r.match ? `<option value="adjust" ${r.action === 'adjust' ? 'selected' : ''}>Ajustar valor no app</option>` : ''}
        <option value="skip" ${r.action === 'skip' ? 'selected' : ''}>Ignorar</option>
      </select></div>`).join('')}
    </div>
    ${imp.extra.length ? `<h3 style="margin-top:18px">No app, mas não na fatura</h3><p class="hint">Lançamentos do ${esc(card ? card.name : 'cartão')} que caem nesta fatura e não apareceram no PDF.</p>
      <div class="rows">${imp.extra.map((e, j) => `<label class="row inv-extra"><input type="checkbox" data-extra="${j}" ${e.skip ? 'checked' : ''}><div class="grow"><b>${esc(e.x.desc || TYPES.card.label)}</b><div class="sub">compra ${e.x.purchase.toLocaleDateString('pt-BR')}${e.x.n ? ` · parcela ${e.x.i}/${e.x.n}` : ''} · marcar para pular nesta fatura</div></div><b class="num">${money(e.x.amt)}</b></label>`).join('')}</div>` : ''}
    <div class="inv-apply"><button class="btn primary" data-act="invApply">Aplicar: ${counts('add')} lançar · ${counts('adjust')} ajustar${imp.extra.some(e => e.skip) ? ` · ${imp.extra.filter(e => e.skip).length} pular` : ''}</button>
      <button class="btn" data-act="invAddRow">+ Linha manual</button>
      <button class="btn" data-act="invReset">Limpar alterações</button>
      <button class="btn" data-act="invCancel">Cancelar importação</button>
      <button class="btn" data-act="invText">${imp.showText ? 'Esconder' : 'Ver'} texto lido do arquivo</button></div>
    ${imp.showText && imp.lines ? `<pre class="inv-text">${esc(imp.lines.join('\n'))}</pre>` : ''}`;
}

function renderImport() {
  if (!imp.cardId && state.cards.length) imp.cardId = state.cards[0].id;
  if (!imp.month) { const c = state.cards.find(x => x.id === imp.cardId); const d = c ? invoiceDue(today(), c) : today(); imp.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
  $view.innerHTML = `<div class="page-head"><div><h1>Importar</h1><p>Compras do Apple Pay e faturas do cartão em PDF.</p></div></div>
  <div class="panel"><h3>Apple Pay</h3>${inboxRowsHtml()}</div>
  <div class="panel" style="margin-top:16px"><h3>Fatura do cartão (PDF ou CSV)</h3>
    <p class="hint">O arquivo é lido aqui no aparelho e não é enviado para lugar nenhum. Nada é lançado até você tocar em Aplicar. O CSV serve para a fatura ainda aberta.</p>
    ${state.cards.length ? `<div class="inv-form">
      <div class="field"><label>Cartão</label><select id="invCard">${state.cards.map(c => `<option value="${c.id}" ${c.id === imp.cardId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Fatura que vence em</label><input type="month" id="invMonth" value="${imp.month}"></div>
      <div class="field inv-file"><label>Arquivo</label><label class="btn"><input type="file" id="invFile" accept="application/pdf,.pdf,text/csv,.csv" hidden>⤓ ${imp.fileName ? esc(imp.fileName) : 'Escolher PDF ou CSV da fatura'}</label></div>
    </div>
    ${imp.needPassword ? `<div class="inline inv-pass"><div class="field"><label>Senha do PDF (alguns bancos protegem a fatura, geralmente com parte do CPF)</label><input type="password" id="invPass" autocomplete="off"></div><button class="btn primary" data-act="invUnlock">Abrir</button></div>` : ''}
    ${csvMapHtml()}${invoiceRowsHtml()}` : '<div class="empty-state">Cadastre seus cartões em Ajustes para importar faturas.</div>'}
  </div>`;
  $view.querySelectorAll('.inv-row .money-input').forEach(applyMoneyMask);
}

async function readInvoice(password) {
  try {
    imp.lines = await pdfLines(imp.data.slice(0), password);
    imp.needPassword = false;
  } catch (err) {
    if (err && err.name === 'PasswordException') { imp.needPassword = true; if (password) toast('Senha incorreta'); route(); return; }
    console.error(err); toast('Não foi possível ler este PDF'); return;
  }
  useInvoice(parseInvoice(imp.lines), 'PDF');
}
// Puts what was read on screen: guesses the card from the text, takes the due month if found, compares.
function useInvoice(inv, kind) {
  const text = imp.lines.join(' ').toLowerCase();
  // the card whose name appears as a whole word ("Inter" must not match "internacional")
  const named = state.cards.find(c => new RegExp(`(^|[^a-zà-ú])${c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-zà-ú])`).test(text));
  if (named && !imp.cardTouched) imp.cardId = named.id; // a card the person picked by hand always wins
  if (inv.due) imp.month = `${inv.due.getFullYear()}-${pad(inv.due.getMonth() + 1)}`;
  const [y, m] = imp.month.split('-').map(Number);
  const due = inv.due || monthDate(y, m - 1, 28);
  imp.total = inv.total;
  imp.rows = inv.items.map(it => ({ ...it, date: iso(lineDate(it, due)), action: 'skip', touched: false, tagId: guessTag(it.desc) }));
  reconcile();
  if (!imp.rows.length) { toast(`Nenhuma compra encontrada no ${kind}; veja o texto lido ou adicione linhas`); imp.showText = true; }
  route();
}

// ---------- CSV (some banks send the open invoice as a spreadsheet) ----------
// bytes -> text: UTF-8 when valid, otherwise the Windows Latin-1 that Brazilian banks often use
function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch (_) { return new TextDecoder('windows-1252').decode(bytes); }
}
function csvRows(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(x => x)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some(x => x)) rows.push(row);
  return rows;
}
const CSV_DATE = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$|^(\d{4})-(\d{2})-(\d{2})/;
const CSV_AMOUNT = /^-?\s*(?:R\$\s*)?-?\s*\d[\d.,]*-?$/;
function csvAmount(s) {
  let t = String(s || '').replace(/R\$|\s/g, '');
  const neg = /^-|-$/.test(t); t = t.replace(/-/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, '');
  const v = parseFloat(t); return isNaN(v) ? null : (neg ? -v : v);
}
// which column is which: by the header names, or by what the cells look like
function guessCsvMap(rows) {
  const hi = rows.findIndex(r => r.some(c => /data/i.test(c)) && r.some(c => /valor|r\$/i.test(c)));
  const map = { header: hi, date: -1, desc: -1, amount: -1, parc: -1, who: -1, fin: -1 };
  if (hi >= 0) {
    const h = rows[hi].map(c => c.toLowerCase());
    map.date = h.findIndex(c => /data/.test(c));
    map.desc = h.findIndex(c => /descri|estabelec|hist[oó]rico|lan[cç]amento|loja|nome/.test(c));
    map.amount = h.findIndex(c => /valor|r\$/.test(c) && !/us\$|d[oó]lar|usd|cota/.test(c));
    map.parc = h.findIndex(c => /parc/.test(c));
    map.who = h.findIndex(c => /portador|titular|nome do cart/.test(c));
    map.fin = h.findIndex(c => /final/.test(c));
  }
  const body = rows.slice(hi + 1), cols = Math.max(...rows.map(r => r.length));
  const share = (j, re) => body.filter(r => re.test(r[j] || '')).length / Math.max(1, body.length);
  if (map.date < 0) for (let j = 0; j < cols; j++) if (share(j, CSV_DATE) > 0.6) { map.date = j; break; }
  if (map.amount < 0) for (let j = cols - 1; j >= 0; j--) if (j !== map.date && share(j, CSV_AMOUNT) > 0.6) { map.amount = j; break; }
  if (map.desc < 0) {
    let best = -1, len = 0;
    for (let j = 0; j < cols; j++) if (j !== map.date && j !== map.amount) { const l = body.reduce((a, r) => a + (r[j] || '').length, 0); if (l > len) { len = l; best = j; } }
    map.desc = best;
  }
  return map;
}
function csvInvoice(rows, map) {
  const items = [];
  rows.forEach((r, n) => {
    if (n <= map.header) return;
    const dm = (r[map.date] || '').match(CSV_DATE), v = csvAmount(r[map.amount]);
    if (!dm || v == null || !v) return;
    const isoDate = !!dm[4];
    const day = +(isoDate ? dm[6] : dm[1]), month = +(isoDate ? dm[5] : dm[2]) - 1, yy = isoDate ? dm[4] : dm[3];
    let desc = (r[map.desc] || '').trim(), i = null, cnt = null;
    const fromCol = map.parc >= 0 && r[map.parc];
    const pm = (fromCol ? r[map.parc] : desc).match(fromCol ? /(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i : /(?:parc(?:ela)?\.?\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i);
    if (pm && +pm[1] >= 1 && +pm[2] >= 2 && +pm[1] <= +pm[2]) { i = +pm[1]; cnt = +pm[2]; if (!fromCol) desc = desc.slice(0, pm.index).replace(/[\s\-–]+$/, ''); }
    const who = map.who >= 0 ? [r[map.who], map.fin >= 0 && r[map.fin] ? `final ${r[map.fin]}` : ''].filter(Boolean).join(' · ') : '';
    items.push({ n, raw: r.join(' | '), day, month, year: yy ? +(yy.length === 2 ? '20' + yy : yy) : null, desc: desc || 'Compra', amount: Math.abs(v), neg: v < 0, i, cnt, who });
  });
  // some banks list purchases as negative numbers: then the positive ones are the payments
  const flip = items.filter(x => x.neg).length > items.length / 2;
  for (const x of items) {
    x.kind = (flip ? !x.neg : x.neg) || PAYMENT.test(x.desc) ? 'credit' : FEE.test(x.desc) ? 'fee' : '';
    x.credit = !!x.kind; delete x.neg;
  }
  // summary lines above the table: due date and total
  let due = null, total = null;
  for (const r of rows.slice(0, Math.max(0, map.header))) {
    const k = (r[0] || '').toLowerCase(), v = r.slice(1).find(c => c);
    if (/venc/.test(k) && v) { const dm = v.match(CSV_DATE); if (dm && dm[3]) due = new Date(+(dm[3].length === 2 ? '20' + dm[3] : dm[3]), +dm[2] - 1, +dm[1], 12); }
    if (/total/.test(k) && v) total = csvAmount(v);
  }
  return { due, total, items };
}
function readCsv() {
  const rows = csvRows(decodeText(imp.data));
  imp.csv = { rows, map: imp.csv && imp.csv.keep ? imp.csv.map : guessCsvMap(rows), keep: imp.csv && imp.csv.keep };
  imp.lines = rows.map(r => r.join(' | '));
  useInvoice(csvInvoice(rows, imp.csv.map), 'CSV');
}
// the column picker shown for CSV files, in case the guess got a column wrong
function csvMapHtml() {
  if (!imp.csv) return '';
  const { rows, map } = imp.csv, head = map.header >= 0 ? rows[map.header] : null;
  const cols = Math.max(...rows.map(r => r.length)), sample = rows[map.header + 1] || [];
  const opts = (k, optional) => `<select data-map="${k}">${optional ? `<option value="-1" ${map[k] < 0 ? 'selected' : ''}>(nenhuma)</option>` : ''}${Array.from({ length: cols }, (_, j) => `<option value="${j}" ${map[k] === j ? 'selected' : ''}>${esc((head && head[j]) || `Coluna ${j + 1}`)}${sample[j] ? ` · ${esc(sample[j].slice(0, 18))}` : ''}</option>`).join('')}</select>`;
  return `<div class="inv-map"><span>Colunas do CSV</span>
    <label>Data ${opts('date')}</label><label>Descrição ${opts('desc')}</label><label>Valor ${opts('amount')}</label><label>Parcela ${opts('parc', true)}</label></div>`;
}

// first installment's date for an installment line: if the line's date already falls on this
// invoice, it is the current installment's date, so the purchase was (i-1) months earlier
// the last purchase day that still falls on this invoice (its closing day)
function cycleDate(card) {
  const [y, m] = imp.month.split('-').map(Number);
  for (let d = monthDate(y, m - 1, card.due), k = 0; k < 62; k++, d = addDays(d, -1)) {
    const due = invoiceDue(d, card);
    if (due.getFullYear() === y && due.getMonth() === m - 1) return iso(d);
  }
  return iso(monthDate(y, m - 1, 1));
}
// An installment line (say 5/10) becomes a series of the installments still to come (5 to 10), starting on
// this invoice: earlier ones belong to invoices already paid, and the later ones show up in the months ahead.
function installmentStart(r, card) {
  const d = parse(r.date), [y, m] = imp.month.split('-').map(Number);
  const onThis = x => { const due = invoiceDue(x, card); return due.getFullYear() === y && due.getMonth() === m - 1; };
  if (onThis(d)) return r.date;
  const moved = monthDate(d.getFullYear(), d.getMonth() + (r.i - 1), d.getDate()); // purchase date + (i-1) months
  return onThis(moved) ? iso(moved) : cycleDate(card);
}

async function applyInvoice() {
  const card = state.cards.find(c => c.id === imp.cardId);
  if (!card) return;
  const add = imp.rows.filter(r => r.action === 'add'), adjust = imp.rows.filter(r => r.action === 'adjust' && r.match), skip = imp.extra.filter(e => e.skip);
  if (!add.length && !adjust.length && !skip.length) return toast('Nada marcado para aplicar');
  if (!(await ask(`Aplicar na fatura do ${card.name}?\n\n${add.length} lançar · ${adjust.length} ajustar valor · ${skip.length} pular`, { ok: 'Aplicar' }))) return;
  await run(async () => {
    for (const r of add) {
      // an older purchase with no installment info is entered once, on this invoice, keeping its date in the text
      const bought = parse(r.date).toLocaleDateString('pt-BR');
      const e = r.cnt
        ? { desc: `${r.desc} (parcelas ${r.i} a ${r.cnt} de ${r.cnt}, compra ${bought})`, date: installmentStart(r, card), amount: Math.round(r.amount * (r.cnt - r.i + 1) * 100) / 100,
            repeat: r.cnt > r.i ? 'installments' : 'none', count: r.cnt - r.i + 1 }
        : r.old ? { desc: `${r.desc} (compra ${bought})`, date: cycleDate(card), amount: r.amount, repeat: 'none', count: 1 }
        : { desc: r.desc, date: r.date, amount: r.amount, repeat: 'none', count: 1 };
      Object.assign(e, { type: 'card', cardId: card.id, tagId: r.tagId || '' });
      await db.addEntry(e);
      if (r.tagId) await db.rememberMerchant(r.desc, e); // next time this merchant gets the same category
    }
    for (const r of adjust) {
      const x = r.match;
      await db.setException({ entryId: x.e.id, od: x.od, action: 'modify', amount: r.amount, date: x.ex && x.ex.date ? x.ex.date : '', desc: x.ex ? x.ex.desc : null });
    }
    for (const s of skip) await db.setException({ entryId: s.x.e.id, od: s.x.od, action: 'skip' });
  }, 'Fatura aplicada');
  reconcile(); route();
}

// form events on the Importar page
document.addEventListener('change', async e => {
  if (document.body.dataset.route !== 'importar') return;
  const t = e.target;
  if (t.id === 'invFile' && t.files && t.files[0]) {
    const f = t.files[0];
    imp.fileName = f.name; imp.data = new Uint8Array(await f.arrayBuffer()); imp.rows = []; imp.extra = []; imp.showText = false; imp.csv = null; imp.needPassword = false;
    toast('Lendo a fatura…');
    if (/\.csv$/i.test(f.name) || /csv/.test(f.type)) readCsv(); else readInvoice();
  } else if (t.dataset.map) {
    imp.csv.map[t.dataset.map] = +t.value; imp.csv.keep = true; readCsv();
  } else if (t.id === 'invCard' || t.id === 'invMonth') {
    if (t.id === 'invCard') { imp.cardId = t.value; imp.cardTouched = true; } else imp.month = t.value;
    reconcile(); route();
  } else if (t.dataset.extra != null) {
    imp.extra[+t.dataset.extra].skip = t.checked; route();
  } else if (t.closest('.inv-row')) {
    const r = imp.rows[+t.closest('.inv-row').dataset.i], f = t.dataset.f;
    if (f === 'action') { r.action = t.value; r.touched = true; route(); return; }
    if (f === 'amount') r.amount = Math.abs(unmaskMoney(t.value));
    else if (f === 'parc') { const pm = t.value.match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/); if (pm && +pm[1] >= 1 && +pm[1] <= +pm[2]) { r.i = +pm[1]; r.cnt = +pm[2]; } else { r.i = null; r.cnt = null; } }
    else r[f] = t.value;
    if (f === 'tagId') return;
    if (f !== 'desc') { reconcile(); route(); }
  }
});
document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (!a || document.body.dataset.route !== 'importar') return;
  switch (a.dataset.act) {
    case 'invApply': applyInvoice(); break;
    case 'invUnlock': imp.password = document.getElementById('invPass').value; readInvoice(imp.password); break;
    case 'invText': imp.showText = !imp.showText; route(); break;
    case 'invReset': // read the same file again, dropping every edit
      if (!imp.data) break;
      imp.rows = []; imp.extra = [];
      if (imp.csv) { imp.csv = null; readCsv(); } else readInvoice(imp.password);
      break;
    case 'invCancel':
      (imp.rows.length ? ask('Cancelar esta importação?\n\nNada foi lançado ainda.', { ok: 'Cancelar importação', cancel: 'Continuar' }) : Promise.resolve(true)).then(yes => {
        if (!yes) return;
        imp = { ...imp, rows: [], extra: [], fileName: '', lines: null, needPassword: false, data: null, total: null, showText: false, csv: null, password: undefined, cardTouched: false };
        route();
      });
      break;
    case 'invAddRow': imp.rows.push({ desc: '', amount: 0, date: iso(today()), i: null, cnt: null, credit: false, action: 'add', touched: true, status: 'new', tagId: '' }); route(); break;
  }
});
