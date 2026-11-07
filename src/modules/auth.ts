// Módulo: Autenticação e primeiro acesso
import { Hono } from 'hono';
import type { AppEnv, AuthUser } from '../types';
import { hashPassword, requireAuth, secretOf, signToken, verifyPassword } from '../auth';

export const authRoutes = new Hono<AppEnv>();

/** Primeiro acesso: cria o proprietário se ainda não houver usuários. */
authRoutes.post('/setup', async (c) => {
  const { n } = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!;
  if (n > 0) return c.json({ error: 'Sistema já configurado' }, 409);
  const b = await c.req.json<{ name?: string; email?: string; password?: string }>();
  if (!b.name || !b.email || !b.password || b.password.length < 6)
    return c.json({ error: 'Informe nome, e-mail e senha (mín. 6 caracteres)' }, 400);
  await c.env.DB.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .bind(b.name, b.email.toLowerCase(), await hashPassword(b.password), 'proprietario').run();
  return c.json({ ok: true }, 201);
});

authRoutes.get('/setup', async (c) => {
  const { n } = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())!;
  return c.json({ needsSetup: n === 0 });
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? AND active = 1')
    .bind((email ?? '').toLowerCase()).first<any>();
  if (!row || !password || !(await verifyPassword(password, row.password_hash)))
    return c.json({ error: 'E-mail ou senha inválidos' }, 401);
  const user: AuthUser = { id: row.id, name: row.name, role: row.role, store_id: row.store_id };
  return c.json({ token: await signToken(user, secretOf(c.env)), user });
});

authRoutes.get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));
