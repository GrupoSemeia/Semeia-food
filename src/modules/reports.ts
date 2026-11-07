// Módulos: Relatórios (diário/semanal/mensal/por loja/por produto, export Excel) e Dashboard
import { Hono } from 'hono';
import type { AppEnv, AuthUser } from '../types';
import { GLOBAL_ROLES, MOVEMENT_TYPES, PAYMENT_METHODS } from '../types';
import { requireAuth, requireRole } from '../auth';
import { addDays, isDate, resolveStore, round2, todayBR } from '../util';
import { computeSummary } from './closings';
import { buildXlsx, type Cell } from '../xlsx';

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use('*', requireAuth);

type ReportType = 'daily' | 'weekly' | 'monthly' | 'store' | 'product';
const TYPES: ReportType[] = ['daily', 'weekly', 'monthly', 'store', 'product'];

const mondayOf = (d: string) => {
  const dt = new Date(d + 'T12:00:00Z');
  return addDays(d, -((dt.getUTCDay() + 6) % 7));
};

interface Report { title: string; columns: string[]; rows: Cell[][] }

function storeFilter(user: AuthUser, requested: number | null): number | null {
  // gerente: sempre a própria loja; demais: opcional
  return user.role === 'gerente' ? user.store_id : requested;
}

async function closingsInRange(db: D1Database, from: string, to: string, storeId: number | null) {
  const pay = PAYMENT_METHODS.map((m) => `(SELECT COALESCE(SUM(amount),0) FROM closing_payments WHERE closing_id=c.id AND method='${m}') AS p_${m}`);
  const mov = MOVEMENT_TYPES.map((m) => `(SELECT COALESCE(SUM(amount),0) FROM closing_movements WHERE closing_id=c.id AND type='${m}') AS m_${m}`);
  const rows = (await db.prepare(
    `SELECT c.id, c.store_id, s.name AS store, c.closing_date, c.system_total, c.machine_total, c.cash_counted, ${[...pay, ...mov].join(',')}
       FROM closings c JOIN stores s ON s.id = c.store_id
      WHERE c.closing_date BETWEEN ? AND ? ${storeId ? 'AND c.store_id = ?' : ''}
      ORDER BY c.closing_date, s.name`).bind(...(storeId ? [from, to, storeId] : [from, to])).all<any>()).results;
  return rows.map((r) => {
    const payments = PAYMENT_METHODS.map((m) => ({ method: m as string, amount: r['p_' + m] as number }));
    const movements = MOVEMENT_TYPES.map((m) => ({ type: m as string, amount: r['m_' + m] as number }));
    return { ...r, payments, movements, summary: computeSummary(r, payments, movements) };
  });
}

const LABEL: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', voucher: 'Voucher', ifood: 'iFood' };

export async function buildReport(db: D1Database, type: ReportType, from: string, to: string, storeId: number | null): Promise<Report> {
  if (type === 'product') {
    const rows = (await db.prepare(
      `SELECT p.name, p.category, p.unit, SUM(oi.quantity) AS total, COUNT(DISTINCT o.production_date) AS dias, COUNT(DISTINCT o.store_id) AS lojas
         FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id
        WHERE o.production_date BETWEEN ? AND ? ${storeId ? 'AND o.store_id = ?' : ''}
        GROUP BY p.id ORDER BY p.category, p.name`).bind(...(storeId ? [from, to, storeId] : [from, to])).all<any>()).results;
    return {
      title: `Pedidos por produto (${from} a ${to})`,
      columns: ['Produto', 'Categoria', 'Unidade', 'Quantidade total', 'Dias com pedido', 'Lojas'],
      rows: rows.map((r) => [r.name, r.category, r.unit, r.total, r.dias, r.lojas]),
    };
  }

  const closings = await closingsInRange(db, from, to, storeId);
  const keyOf = (c: any) => type === 'daily' ? c.closing_date : type === 'weekly' ? mondayOf(c.closing_date) : type === 'monthly' ? c.closing_date.slice(0, 7) : c.store;
  const groups = new Map<string, any[]>();
  for (const c of closings) groups.set(keyOf(c), [...(groups.get(keyOf(c)) ?? []), c]);
  const first = { daily: 'Data', weekly: 'Semana (início segunda)', monthly: 'Mês', store: 'Loja' }[type];
  const sum = (list: any[], f: (c: any) => number) => round2(list.reduce((s, c) => s + f(c), 0));

  const rows: Cell[][] = [...groups.entries()].map(([k, list]) => [
    k,
    sum(list, (c) => c.summary.total_recebido),
    ...PAYMENT_METHODS.map((m) => sum(list, (c) => c['p_' + m])),
    sum(list, (c) => c.summary.despesas),
    sum(list, (c) => c.summary.sangrias),
    sum(list, (c) => c.summary.cancelamentos),
    sum(list, (c) => c.summary.estornos),
    list.length,
    list.filter((c) => c.summary.divergente).length,
  ]);
  if (rows.length) {
    const n = (i: number) => rows.reduce((s, r) => s + (r[i] as number), 0);
    const cols = rows[0].length - 1; // última coluna (divergências) é contagem; demais são valores
    rows.push(['TOTAL', ...Array.from({ length: cols }, (_, i) => (i < cols - 2 ? round2(n(i + 1)) : n(i + 1)))]);
  }
  return {
    title: `Relatório ${{ daily: 'diário', weekly: 'semanal', monthly: 'mensal', store: 'por loja' }[type]} (${from} a ${to})`,
    columns: [first!, 'Faturamento', ...PAYMENT_METHODS.map((m) => LABEL[m]), 'Despesas', 'Sangrias', 'Cancelamentos', 'Estornos', 'Fechamentos', 'Com divergência'],
    rows,
  };
}

function parseParams(c: any) {
  const type = c.req.query('type') as ReportType;
  const today = todayBR();
  const from = c.req.query('from') ?? today.slice(0, 8) + '01';
  const to = c.req.query('to') ?? today;
  if (!TYPES.includes(type) || !isDate(from) || !isDate(to) || from > to || addDays(from, 400) < to) return null;
  return { type, from, to, storeId: storeFilter(c.get('user'), Number(c.req.query('store_id')) || null) };
}

reportRoutes.get('/', async (c) => {
  const p = parseParams(c);
  if (!p) return c.json({ error: 'Parâmetros inválidos (type, from, to; máx. ~13 meses)' }, 400);
  return c.json(await buildReport(c.env.DB, p.type, p.from, p.to, p.storeId));
});

reportRoutes.get('/export.xlsx', async (c) => {
  const p = parseParams(c);
  if (!p) return c.json({ error: 'Parâmetros inválidos' }, 400);
  const r = await buildReport(c.env.DB, p.type, p.from, p.to, p.storeId);
  const file = buildXlsx(r.title.replace(/[\\/?*[\]:]/g, '-'), r.columns, r.rows);
  return new Response(file, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="yracema-${p.type}-${p.from}_${p.to}.xlsx"`,
    },
  });
});

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use('*', requireAuth, requireRole(...GLOBAL_ROLES));

// Painel do dia: quem já lançou pedido / fechou caixa, faturamento e divergências
dashboardRoutes.get('/', async (c) => {
  const today = todayBR();
  const closingDate = c.req.query('date') ?? today;
  const productionDate = c.req.query('production_date') ?? addDays(closingDate, 1);
  if (!isDate(closingDate) || !isDate(productionDate)) return c.json({ error: 'Datas inválidas' }, 400);
  const db = c.env.DB;
  const stores = (await db.prepare('SELECT id, name FROM stores WHERE active=1 ORDER BY name').all<any>()).results;
  const orders = new Set((await db.prepare('SELECT store_id FROM orders WHERE production_date=?').bind(productionDate).all<any>()).results.map((r) => r.store_id));
  const closings = new Map((await closingsInRange(db, closingDate, closingDate, null)).map((r) => [r.store_id, r]));
  const rows = stores.map((s) => {
    const cl = closings.get(s.id);
    return {
      store_id: s.id, store: s.name,
      has_order: orders.has(s.id),
      has_closing: !!cl,
      faturamento: cl?.summary.total_recebido ?? 0,
      divergente: cl?.summary.divergente ?? false,
    };
  });
  return c.json({
    closing_date: closingDate, production_date: productionDate, stores: rows,
    totals: {
      faturamento: round2(rows.reduce((s, r) => s + r.faturamento, 0)),
      lojas_sem_pedido: rows.filter((r) => !r.has_order).length,
      lojas_sem_fechamento: rows.filter((r) => !r.has_closing).length,
      divergencias: rows.filter((r) => r.divergente).length,
    },
  });
});
