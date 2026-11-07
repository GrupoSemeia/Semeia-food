// Teste de fumaça: precisa de `npm run dev` (banco local migrado) rodando.
// BASE=http://localhost:8787 npm test
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
let owner, mgr, s1, s2, p1, p2;

const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
};

test('setup + login do proprietário', async () => {
  const st = await api('/api/auth/setup');
  if (st.data.needsSetup) await api('/api/auth/setup', { method: 'POST', body: { name: 'Dono', email: 'dono@y.com', password: 'secret1' } });
  const l = await api('/api/auth/login', { method: 'POST', body: { email: 'dono@y.com', password: 'secret1' } });
  assert.equal(l.status, 200, 'rode com banco limpo ou use dono@y.com/secret1');
  owner = l.data.token;
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'dono@y.com', password: 'x' } })).status, 401);
  assert.equal((await api('/api/stores')).status, 401);
});

test('cadastros: lojas, produtos, gerente', async () => {
  s1 = (await api('/api/stores', { method: 'POST', token: owner, body: { name: 'Loja Teste 1 ' + Date.now(), city: 'Curitiba' } })).data.id;
  s2 = (await api('/api/stores', { method: 'POST', token: owner, body: { name: 'Loja Teste 2 ' + Date.now(), city: 'Araucária' } })).data.id;
  p1 = (await api('/api/products', { method: 'POST', token: owner, body: { name: 'Pão ' + Date.now(), category: 'Pães' } })).data.id;
  p2 = (await api('/api/products', { method: 'POST', token: owner, body: { name: 'Salsicha ' + Date.now(), category: 'Salsichas', unit: 'kg' } })).data.id;
  const email = `g${Date.now()}@y.com`;
  assert.equal((await api('/api/users', { method: 'POST', token: owner, body: { name: 'Gerente', email, password: 'abc123', role: 'gerente', store_id: s1 } })).status, 201);
  mgr = (await api('/api/auth/login', { method: 'POST', body: { email, password: 'abc123' } })).data.token;
  // gerente não administra cadastros nem vê relatórios globais
  assert.equal((await api('/api/stores', { method: 'POST', token: mgr, body: { name: 'x' } })).status, 403);
  assert.equal((await api('/api/dashboard', { token: mgr })).status, 403);
  assert.equal((await api('/api/stores', { token: mgr })).data.length, 1);
});

test('pedido de produção + consolidação', async () => {
  const put = (token, store_id, q1, q2) => api('/api/orders', { method: 'PUT', token, body: { store_id, production_date: tomorrow, items: [{ product_id: p1, quantity: q1 }, { product_id: p2, quantity: q2 }] } });
  assert.equal((await put(mgr, s2 /* ignorado: gerente usa a própria loja */, 100, 5)).status, 200);
  assert.equal((await put(mgr, s1, 120, 6)).status, 200); // reenvio = idempotente
  assert.equal((await put(owner, s2, 50, 2.5)).status, 200);
  const g = await api(`/api/orders?date=${tomorrow}`, { token: mgr });
  assert.equal(g.data.items.length, 2);
  const cons = (await api(`/api/orders/consolidated?date=${tomorrow}`, { token: owner })).data;
  const pao = cons.products.find((p) => p.product_id === p1);
  assert.equal(pao.total, 170);
  assert.equal(pao.stores.length, 2);
  // pedido de data passada é travado para gerente
  assert.equal((await api('/api/orders', { method: 'PUT', token: mgr, body: { production_date: '2020-01-01', items: [] } })).status, 423);
});

test('fechamento de caixa + divergência + conferência', async () => {
  const body = {
    closing_date: today, system_total: 1000, machine_total: 600, cash_counted: 350,
    payments: [{ method: 'dinheiro', amount: 400 }, { method: 'pix', amount: 100 }, { method: 'credito', amount: 300 }, { method: 'debito', amount: 200 }],
    movements: [{ type: 'sangria', amount: 50, description: 'cofre' }, { type: 'cancelamento', amount: 20 }],
  };
  const r = await api('/api/closings', { method: 'PUT', token: mgr, body });
  assert.equal(r.status, 200);
  const s = r.data.closing.summary;
  assert.equal(s.total_recebido, 1000);
  assert.equal(s.diff_sistema, 0);
  assert.equal(s.diff_maquinha, -100); // 300+200-600
  assert.equal(s.diff_caixa, 0);       // 350 - (400-50)
  assert.equal(s.divergente, true);
  const id = r.data.closing.id;
  assert.equal((await api(`/api/closings/${id}/review`, { method: 'POST', token: mgr })).status, 403);
  assert.equal((await api(`/api/closings/${id}/review`, { method: 'POST', token: owner })).status, 200);
  assert.equal((await api('/api/closings', { method: 'PUT', token: mgr, body })).status, 423); // conferido: travado
});

test('dashboard, relatórios e export Excel', async () => {
  const d = (await api(`/api/dashboard?date=${today}`, { token: owner })).data;
  assert.ok(d.totals.faturamento >= 1000);
  const mine = d.stores.find((s) => s.store_id === s1);
  assert.equal(mine.has_closing, true);
  assert.equal(mine.divergente, true);
  for (const type of ['daily', 'weekly', 'monthly', 'store', 'product']) {
    const r = await api(`/api/reports?type=${type}&from=${today.slice(0, 8)}01&to=${tomorrow}`, { token: owner });
    assert.equal(r.status, 200, type);
    assert.ok(r.data.rows.length > 0, type);
  }
  const x = await api(`/api/reports/export.xlsx?type=store&from=${today}&to=${today}`, { token: owner });
  assert.equal(x.status, 200);
  assert.equal(x.data[0], 0x50); assert.equal(x.data[1], 0x4b); // assinatura ZIP "PK"
  assert.equal((await api('/api/reports?type=nope', { token: owner })).status, 400);
});
