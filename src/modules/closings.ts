// Módulo: Fechamento de Caixa
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { GLOBAL_ROLES, MOVEMENT_TYPES, PAYMENT_METHODS } from '../types';
import { requireAuth, requireRole } from '../auth';
import { isDate, resolveStore, round2 } from '../util';

export const closingRoutes = new Hono<AppEnv>();
closingRoutes.use('*', requireAuth);

interface Payment { method: string; amount: number }
interface Movement { type: string; amount: number; description?: string }

/**
 * Conferência (regras do MVP):
 *  - diff_sistema  = soma dos recebimentos - total do relatório do sistema
 *  - diff_maquinha = (crédito + débito) - total do relatório da maquininha
 *  - diff_caixa    = dinheiro contado - (dinheiro recebido - sangrias - despesas)
 * Cancelamentos e estornos são informativos (o sistema já os desconta das vendas).
 */
export function computeSummary(c: { system_total: number; machine_total: number; cash_counted: number }, payments: Payment[], movements: Movement[]) {
  const pay = (m: string) => payments.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0);
  const mov = (t: string) => movements.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0);
  const total_recebido = payments.reduce((s, p) => s + p.amount, 0);
  const diff_sistema = round2(total_recebido - c.system_total);
  const diff_maquinha = round2(pay('credito') + pay('debito') - c.machine_total);
  const diff_caixa = round2(c.cash_counted - (pay('dinheiro') - mov('sangria') - mov('despesa')));
  return {
    total_recebido: round2(total_recebido),
    sangrias: round2(mov('sangria')), despesas: round2(mov('despesa')),
    cancelamentos: round2(mov('cancelamento')), estornos: round2(mov('estorno')),
    diff_sistema, diff_maquinha, diff_caixa,
    divergente: [diff_sistema, diff_maquinha, diff_caixa].some((d) => Math.abs(d) >= 0.01),
  };
}

async function load(db: D1Database, storeId: number, date: string) {
  const closing = await db.prepare('SELECT * FROM closings WHERE store_id=? AND closing_date=?').bind(storeId, date).first<any>();
  if (!closing) return null;
  const payments = (await db.prepare('SELECT method, amount FROM closing_payments WHERE closing_id=?').bind(closing.id).all<Payment>()).results;
  const movements = (await db.prepare('SELECT id, type, amount, description FROM closing_movements WHERE closing_id=?').bind(closing.id).all<Movement>()).results;
  return { ...closing, payments, movements, summary: computeSummary(closing, payments, movements) };
}

closingRoutes.get('/', async (c) => {
  const u = c.get('user');
  const date = c.req.query('date');
  if (!isDate(date)) return c.json({ error: 'date inválida' }, 400);
  const storeId = resolveStore(u, Number(c.req.query('store_id')) || null);
  if (!storeId) return c.json({ error: 'Informe store_id' }, 400);
  return c.json({ closing: await load(c.env.DB, storeId, date) });
});

// Cria/atualiza (idempotente por loja+data, seguro para reenvio da fila offline)
closingRoutes.put('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{
    store_id?: number; closing_date?: string; system_total?: number; machine_total?: number; cash_counted?: number;
    notes?: string; payments?: Payment[]; movements?: Movement[];
  }>();
  if (!isDate(b.closing_date)) return c.json({ error: 'closing_date inválida' }, 400);
  const storeId = resolveStore(u, b.store_id);
  if (!storeId) return c.json({ error: 'Loja não definida' }, 400);
  const payments = (b.payments ?? []).filter((p) => (PAYMENT_METHODS as readonly string[]).includes(p.method) && Number(p.amount) >= 0)
    .map((p) => ({ method: p.method, amount: Number(p.amount) }));
  const movements = (b.movements ?? []).filter((m) => (MOVEMENT_TYPES as readonly string[]).includes(m.type) && Number(m.amount) >= 0)
    .map((m) => ({ type: m.type, amount: Number(m.amount), description: m.description ?? '' }));

  const db = c.env.DB;
  const existing = await db.prepare('SELECT id, status FROM closings WHERE store_id=? AND closing_date=?').bind(storeId, b.closing_date).first<any>();
  if (existing?.status === 'conferido') return c.json({ error: 'Fechamento já conferido; não pode ser alterado' }, 423);

  await db.prepare(
    `INSERT INTO closings (store_id, closing_date, system_total, machine_total, cash_counted, notes, created_by)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(store_id, closing_date) DO UPDATE SET system_total=excluded.system_total,
       machine_total=excluded.machine_total, cash_counted=excluded.cash_counted, notes=excluded.notes, updated_at=datetime('now')`)
    .bind(storeId, b.closing_date, Number(b.system_total ?? 0), Number(b.machine_total ?? 0), Number(b.cash_counted ?? 0), b.notes ?? null, u.id).run();
  const { id } = (await db.prepare('SELECT id FROM closings WHERE store_id=? AND closing_date=?').bind(storeId, b.closing_date).first<{ id: number }>())!;
  await db.batch([
    db.prepare('DELETE FROM closing_payments WHERE closing_id=?').bind(id),
    db.prepare('DELETE FROM closing_movements WHERE closing_id=?').bind(id),
    ...payments.map((p) => db.prepare('INSERT INTO closing_payments (closing_id, method, amount) VALUES (?,?,?)').bind(id, p.method, p.amount)),
    ...movements.map((m) => db.prepare('INSERT INTO closing_movements (closing_id, type, amount, description) VALUES (?,?,?,?)').bind(id, m.type, m.amount, m.description)),
  ]);
  return c.json({ ok: true, closing: await load(db, storeId, b.closing_date) });
});

// Conferência pelo financeiro/gestão
closingRoutes.post('/:id/review', requireRole(...GLOBAL_ROLES), async (c) => {
  const r = await c.env.DB.prepare(
    `UPDATE closings SET status='conferido', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?`)
    .bind(c.get('user').id, c.req.param('id')).run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Não encontrado' }, 404);
});

// Reabrir (apenas administração/diretoria/proprietário)
closingRoutes.post('/:id/reopen', requireRole('administracao', 'diretor', 'proprietario'), async (c) => {
  await c.env.DB.prepare(`UPDATE closings SET status='enviado', reviewed_by=NULL, reviewed_at=NULL WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// Fechamentos do dia de todas as lojas (tela de conferência)
closingRoutes.get('/list', requireRole(...GLOBAL_ROLES), async (c) => {
  const date = c.req.query('date');
  if (!isDate(date)) return c.json({ error: 'date inválida' }, 400);
  const stores = (await c.env.DB.prepare('SELECT id, name FROM stores WHERE active=1 ORDER BY name').all<any>()).results;
  const list = await Promise.all(stores.map(async (s) => ({ store_id: s.id, store: s.name, closing: await load(c.env.DB, s.id, date) })));
  return c.json({ date, list });
});
