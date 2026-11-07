import { Hono } from 'hono';
import type { AppEnv } from './types';
import { authRoutes } from './modules/auth';
import { adminRoutes } from './modules/admin';
import { orderRoutes } from './modules/orders';
import { closingRoutes } from './modules/closings';
import { dashboardRoutes, reportRoutes } from './modules/reports';

const app = new Hono<AppEnv>();

app.get('/api/health', (c) => c.json({ ok: true, app: 'yracema' }));
app.route('/api/auth', authRoutes);
app.route('/api', adminRoutes);          // /stores /products /users
app.route('/api/orders', orderRoutes);
app.route('/api/closings', closingRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/dashboard', dashboardRoutes);

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Não encontrado' }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError((e, c) => {
  console.error(e);
  return c.json({ error: 'Erro interno' }, 500);
});

export default app;
