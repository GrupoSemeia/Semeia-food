// Módulo: Pedido de Produção (lojas -> cozinha central)
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { GLOBAL_ROLES } from '../types';
import { requireAuth, requireRole } from '../auth';
import { isDate, nowTimeBR, resolveStore, todayBR } from '../util';

export const orderRoutes = new Hono<AppEnv>();
orderRoutes.use('*', requireAuth);

/** Pedido da data D trava para o gerente quando a produção de D começa. */
export function orderLocked(date: string, cutoff: string): boolean {
  const today = todayBR();
  return today > date || (today === date && nowTimeBR() >= cutoff);
}

// Pedido de uma loja numa data (com itens)
orderRoutes.get('/', async (c) => {
  const u = c.get('user');
  const date = c.req.query('date');
  if (!isDate(date)) return c.json({ error: 'date inválida' }, 400);
  const storeId = resolveStore(u, Number(c.req.query('store_id')) || null);
  if (!storeId) return c.json({ error: 'Informe store_id' }, 400);
  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE store_id=? AND production_date=?')
    .bind(storeId, date).first<any>();
  const items = order
    ? (await c.env.DB.prepare('SELECT product_id, quantity FROM order_items WHERE order_id=?').bind(order.id).all()).results
    : [];
  return c.json({ order, items, locked: orderLocked(date, c.env.ORDER_CUTOFF) });
});

// Lança/atualiza o pedido (idempotente: reenviar a mesma data substitui os itens)
orderRoutes.put('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ store_id?: number; production_date?: string; notes?: string; items?: { product_id: number; quantity: number }[] }>();
  if (!isDate(b.production_date) || !Array.isArray(b.items)) return c.json({ error: 'Dados inválidos' }, 400);
  const storeId = resolveStore(u, b.store_id);
  if (!storeId) return c.json({ error: 'Loja não definida' }, 400);
  if (u.role === 'gerente' && orderLocked(b.production_date, c.env.ORDER_CUTOFF))
    return c.json({ error: 'Pedido travado: a produção desta data já começou' }, 423);
  const items = b.items.filter((i) => Number(i.quantity) > 0 && Number.isInteger(i.product_id));

  const db = c.env.DB;
  await db.prepare(
    `INSERT INTO orders (store_id, production_date, notes, created_by) VALUES (?,?,?,?)
     ON CONFLICT(store_id, production_date) DO UPDATE SET notes=excluded.notes, updated_at=datetime('now')`)
    .bind(storeId, b.production_date, b.notes ?? null, u.id).run();
  const { id } = (await db.prepare('SELECT id FROM orders WHERE store_id=? AND production_date=?')
    .bind(storeId, b.production_date).first<{ id: number }>())!;
  await db.batch([
    db.prepare('DELETE FROM order_items WHERE order_id=?').bind(id),
    ...items.map((i) => db.prepare('INSERT INTO order_items (order_id, product_id, quantity) VALUES (?,?,?)').bind(id, i.product_id, Number(i.quantity))),
  ]);
  return c.json({ ok: true, order_id: id, items: items.length });
});

// Consolidação automática de todas as lojas (substitui a planilha manual)
orderRoutes.get('/consolidated', requireRole(...GLOBAL_ROLES), async (c) => {
  const date = c.req.query('date');
  if (!isDate(date)) return c.json({ error: 'date inválida' }, 400);
  const db = c.env.DB;
  const rows = (await db.prepare(
    `SELECT p.id AS product_id, p.name, p.category, p.unit, s.id AS store_id, s.name AS store, oi.quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id AND o.production_date = ?
       JOIN products p ON p.id = oi.product_id
       JOIN stores s ON s.id = o.store_id
      ORDER BY p.category, p.sort_order, p.name, s.name`).bind(date).all<any>()).results;
  const map = new Map<number, any>();
  for (const r of rows) {
    const e = map.get(r.product_id) ?? { product_id: r.product_id, name: r.name, category: r.category, unit: r.unit, total: 0, stores: [] };
    e.total += r.quantity;
    e.stores.push({ store_id: r.store_id, store: r.store, quantity: r.quantity });
    map.set(r.product_id, e);
  }
  const missing = (await db.prepare(
    `SELECT id, name FROM stores WHERE active=1 AND id NOT IN (SELECT store_id FROM orders WHERE production_date=?)`)
    .bind(date).all()).results;
  return c.json({ date, products: [...map.values()], stores_missing: missing });
});
