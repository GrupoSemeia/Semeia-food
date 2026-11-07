// Yracema Gestão - PWA (sem build). Telas por perfil + fila offline para pedido e fechamento.
const $app = document.getElementById('app');
const ADMIN = ['administracao', 'diretor', 'proprietario'];
const GLOBAL = ['financeiro', 'administracao', 'diretor', 'proprietario'];
const PAY = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', voucher: 'Voucher', ifood: 'iFood' };
const MOV = { sangria: 'Sangria', despesa: 'Despesa', cancelamento: 'Cancelamento', estorno: 'Estorno' };
const ROLES = { gerente: 'Gerente', financeiro: 'Financeiro', administracao: 'Administração', diretor: 'Diretor', proprietario: 'Proprietário' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iso = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const today = () => iso(new Date());
const plus = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const store = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let session = store.get('session'); // { token, user }

// ---------- API + fila offline ----------
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && session && !path.startsWith('/auth/')) { logout(); throw new Error('Sessão expirada'); }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : r;
  if (!r.ok) throw Object.assign(new Error(data.error || 'Erro ' + r.status), { status: r.status });
  return data;
}

/** GET com reserva offline (catálogos). */
async function cachedGet(path) {
  try { const d = await api(path); store.set('cache:' + path, d); return d; }
  catch (e) { const c = store.get('cache:' + path); if (c && !e.status) return c; throw e; }
}

const queue = () => store.get('queue', []);
/** Envia PUT; se estiver sem rede, guarda na fila (PUTs são idempotentes por loja+data). */
async function saveOrQueue(path, body, label) {
  try { const r = await api(path, { method: 'PUT', body }); return { sent: true, r }; }
  catch (e) {
    if (e.status) throw e; // erro de negócio (validação/trava): não enfileira
    store.set('queue', [...queue().filter((q) => !(q.path === path && q.key === body.production_date + body.closing_date)), { path, body, label, key: body.production_date + body.closing_date }]);
    renderBanner();
    return { sent: false };
  }
}
let syncing = false;
async function sync() {
  if (syncing || !session || !queue().length) return;
  syncing = true;
  try {
    for (const q of queue()) {
      try { await api(q.path, { method: 'PUT', body: q.body }); }
      catch (e) { if (!e.status) break; /* sem rede: tenta depois */ }
      // sucesso ou erro de negócio => sai da fila
      store.set('queue', queue().filter((x) => x !== q && JSON.stringify(x) !== JSON.stringify(q)));
    }
  } finally { syncing = false; renderBanner(); }
}
function renderBanner() {
  let b = document.getElementById('banner');
  const n = queue().length, off = !navigator.onLine;
  if (!n && !off) return b?.remove();
  if (!b) { b = document.createElement('div'); b.id = 'banner'; b.className = 'banner'; document.body.prepend(b); }
  b.textContent = (off ? 'Sem conexão. ' : '') + (n ? `${n} envio(s) pendente(s) — serão enviados automaticamente.` : 'Você pode continuar lançando; envia quando voltar a conexão.');
}
addEventListener('online', () => { sync(); renderBanner(); });
addEventListener('offline', renderBanner);

// ---------- Sessão / roteamento ----------
function logout() { session = null; store.del('session'); location.hash = '#/login'; render(); }
const isGlobal = () => GLOBAL.includes(session.user.role);
const isAdmin = () => ADMIN.includes(session.user.role);

function menu() {
  if (!session) return [];
  if (session.user.role === 'gerente') return [['#/pedido', '📦', 'Pedido'], ['#/fechamento', '💵', 'Caixa'], ['#/relatorios', '📊', 'Relatórios']];
  const m = [['#/painel', '🏠', 'Painel'], ['#/consolidado', '🏭', 'Produção'], ['#/fechamentos', '💵', 'Caixas'], ['#/relatorios', '📊', 'Relatórios']];
  if (isAdmin()) m.push(['#/cadastros', '⚙️', 'Cadastros']);
  return m;
}

const routes = {
  '#/login': viewLogin, '#/pedido': viewPedido, '#/fechamento': viewFechamento, '#/relatorios': viewRelatorios,
  '#/painel': viewPainel, '#/consolidado': viewConsolidado, '#/fechamentos': viewFechamentos, '#/cadastros': viewCadastros,
};

async function render() {
  if (!session) { location.hash = '#/login'; }
  else if (!location.hash || location.hash === '#/login') location.hash = menu()[0][0];
  const route = location.hash || '#/login';
  const view = routes[route] ?? viewLogin;
  const nav = menu();
  $app.innerHTML = session && route !== '#/login'
    ? `<header><div><b>🌭 Yracema</b><small>${esc(session.user.name)} · ${ROLES[session.user.role]}</small></div><button class="small sec" style="color:#fff;border-color:#fff" id="out">Sair</button></header>
       <main id="view"><p class="muted">Carregando…</p></main>
       <nav>${nav.map(([h, i, l]) => `<a href="${h}" class="${h === route ? 'on' : ''}"><span>${i}</span>${l}</a>`).join('')}</nav>`
    : '<main id="view"></main>';
  document.getElementById('out')?.addEventListener('click', logout);
  const el = document.getElementById('view');
  try { await view(el); } catch (e) { el.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  renderBanner();
}
addEventListener('hashchange', () => { history.replaceState(null, '', location.pathname + location.hash); render(); });

const bind = (el, sel, ev, fn) => el.querySelectorAll(sel).forEach((n) => n.addEventListener(ev, fn));
const val = (el, id) => el.querySelector('#' + id).value;
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

// ---------- Login / primeiro acesso ----------
async function viewLogin(el) {
  let setup = false;
  try { setup = (await api('/auth/setup')).needsSetup; } catch {}
  el.innerHTML = `<div class="card" style="margin-top:12vh"><h2>🌭 Yracema Gestão</h2>
    <p class="muted">${setup ? 'Primeiro acesso: crie o usuário proprietário.' : 'Entre com seu e-mail e senha.'}</p>
    ${setup ? '<label>Nome</label><input id="name">' : ''}
    <label>E-mail</label><input id="email" type="email" autocomplete="username">
    <label>Senha</label><input id="pw" type="password" autocomplete="current-password">
    <div class="err" id="err"></div><button id="go">${setup ? 'Criar e entrar' : 'Entrar'}</button></div>`;
  el.querySelector('#go').onclick = async () => {
    try {
      if (setup) await api('/auth/setup', { method: 'POST', body: { name: val(el, 'name'), email: val(el, 'email'), password: val(el, 'pw') } });
      session = await api('/auth/login', { method: 'POST', body: { email: val(el, 'email'), password: val(el, 'pw') } });
      store.set('session', session); location.hash = ''; render(); sync();
    } catch (e) { el.querySelector('#err').textContent = e.message; }
  };
}

// ---------- Gerente: Pedido de produção ----------
async function viewPedido(el) {
  const date = new URLSearchParams(location.search).get('d') || plus(today(), 1);
  const [products, cur] = await Promise.all([cachedGet('/products'), cachedGet('/orders?date=' + date).catch(() => ({ items: [], locked: false }))]);
  const draftKey = 'draft:order:' + date;
  const qty = Object.fromEntries(cur.items.map((i) => [i.product_id, i.quantity]));
  Object.assign(qty, store.get(draftKey, {}));
  const cats = [...new Set(products.map((p) => p.category))];
  el.innerHTML = `<h2>Pedido de produção</h2><div class="card">
    <label>Para produzir em</label><input id="date" type="date" value="${date}">
    ${cur.locked ? '<p class="err">🔒 Pedido travado: a produção desta data já começou.</p>' : ''}</div>
    ${cats.map((c) => `<div class="card"><h3>${esc(c)}</h3>${products.filter((p) => p.category === c).map((p) => `
      <div class="item"><span>${esc(p.name)} <span class="muted">(${esc(p.unit)})</span></span>
      <input type="number" inputmode="decimal" min="0" step="any" data-p="${p.id}" value="${qty[p.id] || ''}" placeholder="0" ${cur.locked ? 'disabled' : ''}></div>`).join('')}</div>`).join('')}
    <div class="card"><label>Observações</label><textarea id="notes" rows="2">${esc(cur.order?.notes ?? '')}</textarea>
    <div class="err" id="err"></div><button id="send" ${cur.locked ? 'disabled' : ''}>Enviar pedido</button></div>`;
  el.querySelector('#date').onchange = (e) => { history.replaceState(null, '', '?d=' + e.target.value); render(); };
  bind(el, 'input[data-p]', 'input', (e) => { qty[e.target.dataset.p] = num(e.target.value); store.set(draftKey, qty); });
  el.querySelector('#send').onclick = async () => {
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ product_id: +id, quantity: q }));
    try {
      const r = await saveOrQueue('/orders', { production_date: date, notes: val(el, 'notes'), items }, `Pedido ${date}`);
      store.del(draftKey);
      el.querySelector('#err').innerHTML = `<span class="pill ${r.sent ? 'ok' : 'warn'}">${r.sent ? `Pedido enviado (${items.length} itens)` : 'Salvo no aparelho — envia quando houver conexão'}</span>`;
    } catch (e) { el.querySelector('#err').textContent = e.message; }
  };
}

// ---------- Gerente: Fechamento de caixa ----------
async function viewFechamento(el) {
  const date = new URLSearchParams(location.search).get('d') || today();
  const { closing } = await cachedGet('/closings?date=' + date).catch(() => ({ closing: null }));
  const draftKey = 'draft:closing:' + date;
  const d = store.get(draftKey) ?? {
    system_total: closing?.system_total ?? '', machine_total: closing?.machine_total ?? '', cash_counted: closing?.cash_counted ?? '',
    notes: closing?.notes ?? '',
    payments: Object.fromEntries((closing?.payments ?? []).map((p) => [p.method, p.amount])),
    movements: closing?.movements ?? [],
  };
  const locked = closing?.status === 'conferido';
  const dis = locked ? 'disabled' : '';
  el.innerHTML = `<h2>Fechamento de caixa</h2>
  <div class="card"><label>Data</label><input id="date" type="date" value="${date}">
  ${closing ? `<p><span class="pill ${locked ? 'ok' : 'warn'}">${locked ? 'Conferido pelo financeiro' : 'Enviado — aguardando conferência'}</span></p>` : ''}</div>
  <div class="card"><h3>Recebimentos</h3>${Object.entries(PAY).map(([k, l]) => `<div class="item"><span>${l}</span><input type="number" inputmode="decimal" step="0.01" min="0" data-pay="${k}" value="${d.payments[k] ?? ''}" ${dis}></div>`).join('')}</div>
  <div class="card"><h3>Relatórios</h3>
    <label>Total do relatório do sistema (Connect Plug)</label><input id="system_total" type="number" inputmode="decimal" step="0.01" value="${d.system_total}" ${dis}>
    <label>Total do relatório da maquininha</label><input id="machine_total" type="number" inputmode="decimal" step="0.01" value="${d.machine_total}" ${dis}>
    <label>Dinheiro contado no caixa</label><input id="cash_counted" type="number" inputmode="decimal" step="0.01" value="${d.cash_counted}" ${dis}></div>
  <div class="card"><h3>Movimentações</h3><div id="movs"></div>
    <div class="row"><select id="mtype">${Object.entries(MOV).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <input id="mamount" type="number" inputmode="decimal" step="0.01" placeholder="Valor"><input id="mdesc" placeholder="Descrição"></div>
    <button class="sec" id="addmov" ${dis}>+ Adicionar</button></div>
  <div class="card"><label>Observações</label><textarea id="notes" rows="2" ${dis}>${esc(d.notes)}</textarea>
  <div id="summary"></div><div class="err" id="err"></div><button id="send" ${dis}>Enviar fechamento</button></div>`;

  const collect = () => {
    const payments = {}; el.querySelectorAll('[data-pay]').forEach((i) => { if (i.value !== '') payments[i.dataset.pay] = num(i.value); });
    return { system_total: num(val(el, 'system_total')), machine_total: num(val(el, 'machine_total')), cash_counted: num(val(el, 'cash_counted')), notes: val(el, 'notes'), payments, movements: d.movements };
  };
  const paint = () => {
    el.querySelector('#movs').innerHTML = d.movements.map((m, i) => `<div class="item"><span>${MOV[m.type]} ${esc(m.description || '')}</span><span>${brl(m.amount)} <button class="small sec" data-del="${i}" ${dis}>✕</button></span></div>`).join('') || '<p class="muted">Nenhuma.</p>';
    bind(el, '[data-del]', 'click', (e) => { d.movements.splice(+e.target.dataset.del, 1); store.set(draftKey, collect()); paint(); });
    // conferência ao vivo (mesmas regras do servidor)
    const c = collect(), p = c.payments, mv = (t) => d.movements.filter((m) => m.type === t).reduce((s, m) => s + m.amount, 0);
    const total = Object.values(p).reduce((s, v) => s + v, 0);
    const diffs = [['Recebimentos × sistema', total - c.system_total], ['Crédito+débito × maquininha', (p.credito || 0) + (p.debito || 0) - c.machine_total],
      ['Caixa contado × esperado', c.cash_counted - ((p.dinheiro || 0) - mv('sangria') - mv('despesa'))]];
    el.querySelector('#summary').innerHTML = `<h3>Conferência</h3><p>Total recebido: <b>${brl(total)}</b></p>` +
      diffs.map(([l, v]) => `<p>${l}: <span class="pill ${Math.abs(v) < 0.01 ? 'ok' : 'bad'}">${Math.abs(v) < 0.01 ? 'OK' : 'Diferença ' + brl(v)}</span></p>`).join('');
  };
  paint();
  el.querySelector('#date').onchange = (e) => { history.replaceState(null, '', '?d=' + e.target.value); render(); };
  el.addEventListener('input', () => { store.set(draftKey, collect()); paint(); });
  el.querySelector('#addmov').onclick = () => {
    const amount = num(val(el, 'mamount')); if (amount <= 0) return;
    d.movements.push({ type: val(el, 'mtype'), amount, description: val(el, 'mdesc') });
    el.querySelector('#mamount').value = ''; el.querySelector('#mdesc').value = ''; store.set(draftKey, collect()); paint();
  };
  el.querySelector('#send').onclick = async () => {
    const c = collect();
    try {
      const r = await saveOrQueue('/closings', { closing_date: date, ...c, payments: Object.entries(c.payments).map(([method, amount]) => ({ method, amount })) }, `Caixa ${date}`);
      store.del(draftKey);
      el.querySelector('#err').innerHTML = `<span class="pill ${r.sent ? 'ok' : 'warn'}">${r.sent ? 'Fechamento enviado' : 'Salvo no aparelho — envia quando houver conexão'}</span>`;
    } catch (e) { el.querySelector('#err').textContent = e.message; }
  };
}

// ---------- Gestão: Painel ----------
async function viewPainel(el) {
  const date = new URLSearchParams(location.search).get('d') || today();
  const d = await api('/dashboard?date=' + date);
  const t = d.totals;
  el.innerHTML = `<h2>Painel do dia</h2><div class="card"><label>Fechamentos de</label><input id="date" type="date" value="${date}">
    <p class="muted">Pedidos para produção em ${d.production_date.split('-').reverse().join('/')}</p></div>
    <div class="kpis"><div class="kpi"><small>Faturamento</small><b>${brl(t.faturamento)}</b></div>
    <div class="kpi"><small>Lojas sem caixa</small><b>${t.lojas_sem_fechamento}</b></div>
    <div class="kpi"><small>Lojas sem pedido</small><b>${t.lojas_sem_pedido}</b></div>
    <div class="kpi"><small>Divergências</small><b>${t.divergencias}</b></div></div>
    <div class="card scroll"><table><tr><th>Loja</th><th>Pedido</th><th>Caixa</th><th>Faturamento</th></tr>
    ${d.stores.map((s) => `<tr><td>${esc(s.store)}</td><td><span class="pill ${s.has_order ? 'ok' : 'bad'}">${s.has_order ? 'Enviado' : 'Falta'}</span></td>
      <td><span class="pill ${!s.has_closing ? 'bad' : s.divergente ? 'warn' : 'ok'}">${!s.has_closing ? 'Falta' : s.divergente ? 'Divergente' : 'OK'}</span></td><td>${brl(s.faturamento)}</td></tr>`).join('')}</table></div>`;
  el.querySelector('#date').onchange = (e) => { history.replaceState(null, '', '?d=' + e.target.value); render(); };
}

// ---------- Gestão: Produção consolidada ----------
async function viewConsolidado(el) {
  const date = new URLSearchParams(location.search).get('d') || plus(today(), 1);
  const c = await api('/orders/consolidated?date=' + date);
  const cats = [...new Set(c.products.map((p) => p.category))];
  el.innerHTML = `<h2>Produção consolidada</h2><div class="card"><label>Produzir em</label><input id="date" type="date" value="${date}">
    ${c.stores_missing.length ? `<p class="err">Sem pedido: ${c.stores_missing.map((s) => esc(s.name)).join(', ')}</p>` : '<p><span class="pill ok">Todas as lojas enviaram</span></p>'}
    <button class="sec" onclick="print()">Imprimir lista</button></div>
    ${cats.map((cat) => `<div class="card scroll"><h3>${esc(cat)}</h3><table>${c.products.filter((p) => p.category === cat).map((p) => `
      <tr><td><b>${esc(p.name)}</b><br><span class="muted">${p.stores.map((s) => esc(s.store) + ': ' + s.quantity).join(' · ')}</span></td><td><b>${p.total}</b> ${esc(p.unit)}</td></tr>`).join('')}</table></div>`).join('') || '<div class="card muted">Nenhum pedido para esta data.</div>'}`;
  el.querySelector('#date').onchange = (e) => { history.replaceState(null, '', '?d=' + e.target.value); render(); };
}

// ---------- Gestão: Conferência de fechamentos ----------
async function viewFechamentos(el) {
  const date = new URLSearchParams(location.search).get('d') || today();
  const { list } = await api('/closings/list?date=' + date);
  el.innerHTML = `<h2>Fechamentos de caixa</h2><div class="card"><label>Data</label><input id="date" type="date" value="${date}"></div>
    ${list.map(({ store, closing: c }) => !c ? `<div class="card"><b>${esc(store)}</b> <span class="pill bad">Sem fechamento</span></div>` : `
    <div class="card"><div class="row"><b>${esc(store)}</b><span class="fix"><span class="pill ${c.status === 'conferido' ? 'ok' : 'warn'}">${c.status === 'conferido' ? 'Conferido' : 'A conferir'}</span></span></div>
    <p>Recebido <b>${brl(c.summary.total_recebido)}</b> · Despesas ${brl(c.summary.despesas)} · Sangrias ${brl(c.summary.sangrias)}</p>
    <p class="muted">${c.payments.map((p) => PAY[p.method] + ' ' + brl(p.amount)).join(' · ')}</p>
    ${[['Sistema', c.summary.diff_sistema], ['Maquininha', c.summary.diff_maquinha], ['Caixa', c.summary.diff_caixa]].map(([l, v]) => `<span class="pill ${Math.abs(v) < 0.01 ? 'ok' : 'bad'}">${l}: ${Math.abs(v) < 0.01 ? 'OK' : brl(v)}</span> `).join('')}
    ${c.notes ? `<p class="muted">Obs: ${esc(c.notes)}</p>` : ''}
    ${c.status === 'enviado' ? `<button data-rev="${c.id}">Marcar como conferido</button>` : ''}
    ${c.status === 'conferido' && isAdmin() ? `<button class="sec" data-reopen="${c.id}">Reabrir</button>` : ''}</div>`).join('')}`;
  el.querySelector('#date').onchange = (e) => { history.replaceState(null, '', '?d=' + e.target.value); render(); };
  bind(el, '[data-rev]', 'click', async (e) => { await api(`/closings/${e.target.dataset.rev}/review`, { method: 'POST' }); render(); });
  bind(el, '[data-reopen]', 'click', async (e) => { await api(`/closings/${e.target.dataset.reopen}/reopen`, { method: 'POST' }); render(); });
}

// ---------- Relatórios ----------
async function viewRelatorios(el) {
  const first = today().slice(0, 8) + '01';
  const st = store.get('reportState', { type: 'daily', from: first, to: today(), store_id: '' });
  const stores = isGlobal() ? await api('/stores') : [];
  el.innerHTML = `<h2>Relatórios</h2><div class="card">
    <label>Tipo</label><select id="type">${[['daily', 'Diário'], ['weekly', 'Semanal'], ['monthly', 'Mensal'], ['store', 'Por loja'], ['product', 'Por produto (pedidos)']].map(([v, l]) => `<option value="${v}" ${st.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <div class="row"><div><label>De</label><input id="from" type="date" value="${st.from}"></div><div><label>Até</label><input id="to" type="date" value="${st.to}"></div></div>
    ${isGlobal() ? `<label>Loja</label><select id="store_id"><option value="">Todas</option>${stores.map((s) => `<option value="${s.id}" ${String(st.store_id) === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
    <button id="run">Gerar</button><button class="sec" id="xlsx">Exportar Excel</button></div><div id="out"></div>`;
  const qs = () => {
    const s = { type: val(el, 'type'), from: val(el, 'from'), to: val(el, 'to'), store_id: isGlobal() ? val(el, 'store_id') : '' };
    store.set('reportState', s); return new URLSearchParams(Object.entries(s).filter(([, v]) => v)).toString();
  };
  const fmt = (v) => typeof v === 'number' && !Number.isInteger(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : v ?? '';
  const run = async () => {
    const r = await api('/reports?' + qs());
    el.querySelector('#out').innerHTML = `<div class="card scroll"><h3>${esc(r.title)}</h3><table><tr>${r.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>
      ${r.rows.map((row) => `<tr>${row.map((v) => `<td>${typeof v === 'string' ? esc(v) : fmt(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${r.columns.length}">Sem dados no período.</td></tr>`}</table></div>`;
  };
  el.querySelector('#run').onclick = () => run().catch((e) => { el.querySelector('#out').innerHTML = `<div class="card err">${esc(e.message)}</div>`; });
  el.querySelector('#xlsx').onclick = async () => {
    try {
      const res = await api('/reports/export.xlsx?' + qs());
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement('a'), { href: url, download: `yracema-${val(el, 'type')}-${val(el, 'from')}_${val(el, 'to')}.xlsx` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { el.querySelector('#out').innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  };
  run().catch(() => {});
}

// ---------- Cadastros (administração) ----------
async function viewCadastros(el) {
  const [stores, products, users] = await Promise.all([api('/stores'), api('/products?all=1'), api('/users')]);
  const toggle = (kind, r) => `<button class="small sec" data-t="${kind}:${r.id}:${r.active ? 0 : 1}">${r.active ? 'Desativar' : 'Ativar'}</button>`;
  el.innerHTML = `<h2>Cadastros</h2>
  <div class="card"><h3>Lojas (${stores.filter((s) => s.active).length} ativas)</h3>
    ${stores.map((s) => `<div class="item"><span>${esc(s.name)} <span class="muted">${esc(s.city || '')}</span> ${s.active ? '' : '<span class="pill bad">inativa</span>'}</span>${toggle('stores', s)}</div>`).join('')}
    <div class="row"><input id="sname" placeholder="Nova loja"><input id="scity" placeholder="Cidade"></div><button id="addstore">Adicionar loja</button></div>
  <div class="card"><h3>Produtos (${products.filter((p) => p.active).length} ativos)</h3>
    ${products.map((p) => `<div class="item"><span>${esc(p.name)} <span class="muted">${esc(p.category)} · ${esc(p.unit)}</span></span>${toggle('products', p)}</div>`).join('')}
    <div class="row"><input id="pname" placeholder="Novo produto"><input id="pcat" placeholder="Categoria (Pães…)"><input id="punit" placeholder="un/kg" style="max-width:80px"></div><button id="addprod">Adicionar produto</button></div>
  <div class="card"><h3>Usuários</h3>
    ${users.map((u) => `<div class="item"><span>${esc(u.name)} <span class="muted">${ROLES[u.role]} · ${esc(u.email)}${u.store_id ? ' · ' + esc(stores.find((s) => s.id === u.store_id)?.name ?? '') : ''}</span></span>${toggle('users', u)}</div>`).join('')}
    <label>Novo usuário</label><input id="uname" placeholder="Nome"><input id="uemail" type="email" placeholder="E-mail"><input id="upw" type="password" placeholder="Senha (mín. 6)">
    <select id="urole">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
    <select id="ustore"><option value="">Loja (só para gerente)</option>${stores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <div class="err" id="err"></div><button id="adduser">Criar usuário</button></div>`;
  const act = (fn) => async () => { try { await fn(); render(); } catch (e) { el.querySelector('#err').textContent = e.message; } };
  bind(el, '[data-t]', 'click', async (e) => { const [k, id, a] = e.target.dataset.t.split(':'); await api(`/${k}/${id}`, { method: 'PATCH', body: { active: a === '1' } }); render(); });
  el.querySelector('#addstore').onclick = act(() => api('/stores', { method: 'POST', body: { name: val(el, 'sname'), city: val(el, 'scity') } }));
  el.querySelector('#addprod').onclick = act(() => api('/products', { method: 'POST', body: { name: val(el, 'pname'), category: val(el, 'pcat') || 'Outros', unit: val(el, 'punit') || 'un' } }));
  el.querySelector('#adduser').onclick = act(() => api('/users', { method: 'POST', body: { name: val(el, 'uname'), email: val(el, 'uemail'), password: val(el, 'upw'), role: val(el, 'urole'), store_id: +val(el, 'ustore') || undefined } }));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
sync();
