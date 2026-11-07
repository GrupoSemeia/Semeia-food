import type { AuthUser } from './types';
import { GLOBAL_ROLES } from './types';

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Data de hoje no fuso de Curitiba (America/Sao_Paulo). */
export function todayBR(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export function nowTimeBR(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(now);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Loja efetiva: gerente só enxerga a própria; perfis globais podem escolher. */
export function resolveStore(user: AuthUser, requested?: number | null): number | null {
  if (user.role === 'gerente') return user.store_id;
  return GLOBAL_ROLES.includes(user.role) ? requested ?? null : null;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
