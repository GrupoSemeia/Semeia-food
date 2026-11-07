// Módulo: Cadastros (lojas, produtos, usuários)
import { Hono } from 'hono';
import type { AppEnv, Role } from '../types';
import { ADMIN_ROLES } from '../types';
import { hashPassword, requireAuth, requireRole } from '../auth';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireAuth);

const ROLES: Role[] = ['gerente', 'financeiro', 'administracao', 'diretor', 'proprietario'];

// ---- Lojas (novas unidades entram só com um cadastro) ----
adminRoutes.get('/stores', async (c) => {
  const u = c.get('user');
  const q = u.role === 'gerente'
    ? c.env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(u.store_id)
    : c.env.DB.prepare('SELECT * FROM stores ORDER BY active DESC, name');
  return c.json((await q.all()).results);
});

adminRoutes.post('/stores', requireRole(...ADMIN_ROLES), async (c) => {
  const b = await c.req.json<{ name?: string; city?: string }>();
  if (!b.name) return c.json({ error: 'Nome obrigatório' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO stores (name, city) VALUES (?,?)').bind(b.name, b.city ?? null).run();
  return c.json({ id: r.meta.last_row_id }, 201);
});

adminRoutes.patch('/stores/:id', requireRole(...ADMIN_ROLES), async (c) => {
  const b = await c.req.json<{ name?: string; city?: string; active?: boolean }>();
  await c.env.DB.prepare('UPDATE stores SET name=COALESCE(?,name), city=COALESCE(?,city), active=COALESCE(?,active) WHERE id=?')
    .bind(b.name ?? null, b.city ?? null, b.active === undefined ? null : +b.active, c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- Produtos (catálogo de ~85 itens) ----
adminRoutes.get('/products', async (c) => {
  const all = c.req.query('all') === '1';
  const r = await c.env.DB.prepare(
    `SELECT * FROM products ${all ? '' : 'WHERE active = 1'} ORDER BY category, sort_order, name`).all();
  return c.json(r.results);
});

adminRoutes.post('/products', requireRole(...ADMIN_ROLES), async (c) => {
  const b = await c.req.json<{ name?: string; category?: string; unit?: string; sort_order?: number }>();
  if (!b.name) return c.json({ error: 'Nome obrigatório' }, 400);
  const r = await c.env.DB.prepare('INSERT INTO products (name,category,unit,sort_order) VALUES (?,?,?,?)')
    .bind(b.name, b.category ?? 'Outros', b.unit ?? 'un', b.sort_order ?? 0).run();
  return c.json({ id: r.meta.last_row_id }, 201);
});

adminRoutes.patch('/products/:id', requireRole(...ADMIN_ROLES), async (c) => {
  const b = await c.req.json<{ name?: string; category?: string; unit?: string; sort_order?: number; active?: boolean }>();
  await c.env.DB.prepare(
    `UPDATE products SET name=COALESCE(?,name), category=COALESCE(?,category), unit=COALESCE(?,unit),
     sort_order=COALESCE(?,sort_order), active=COALESCE(?,active) WHERE id=?`)
    .bind(b.name ?? null, b.category ?? null, b.unit ?? null, b.sort_order ?? null,
      b.active === undefined ? null : +b.active, c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- Usuários ----
adminRoutes.get('/users', requireRole(...ADMIN_ROLES), async (c) => {
  const r = await c.env.DB.prepare(
    'SELECT id,name,email,role,store_id,active FROM users ORDER BY active DESC, name').all();
  return c.json(r.results);
});

adminRoutes.post('/users', requireRole(...ADMIN_ROLES), async (c) => {
  const b = await c.req.json<{ name?: string; email?: string; password?: string; role?: Role; store_id?: number }>();
  if (!b.name || !b.email || !b.password || b.password.length < 6 || !b.role || !ROLES.includes(b.role))
    return c.json({ error: 'Dados inválidos' }, 400);
  if (b.role === 'gerente' && !b.store_id) return c.json({ error: 'Gerente precisa de uma loja' }, 400);
  if (b.role === 'proprietario' && c.get('user').role !== 'proprietario')
    return c.json({ error: 'Só o proprietário cria outro proprietário' }, 403);
  try {
    const r = await c.env.DB.prepare('INSERT INTO users (name,email,password_hash,role,store_id) VALUES (?,?,?,?,?)')
      .bind(b.name, b.email.toLowerCase(), await hashPassword(b.password), b.role, b.role === 'gerente' ? b.store_id : null).run();
    return c.json({ id: r.meta.last_row_id }, 201);
  } catch {
    return c.json({ error: 'E-mail já cadastrado' }, 409);
  }
});

adminRoutes.patch('/users/:id', requireRole(...ADMIN_ROLES), async (c) => {
  const b = await c.req.json<{ active?: boolean; password?: string; store_id?: number }>();
  if (b.password) {
    if (b.password.length < 6) return c.json({ error: 'Senha muito curta' }, 400);
    await c.env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(b.password), c.req.param('id')).run();
  }
  if (b.active !== undefined)
    await c.env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(+b.active, c.req.param('id')).run();
  if (b.store_id !== undefined)
    await c.env.DB.prepare("UPDATE users SET store_id=? WHERE id=? AND role='gerente'").bind(b.store_id, c.req.param('id')).run();
  return c.json({ ok: true });
});
