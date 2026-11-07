import type { MiddlewareHandler } from 'hono';
import type { AppEnv, AuthUser, Role } from './types';

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(user: AuthUser, secret: string, ttlSeconds = 60 * 60 * 24 * 30) {
  const header = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u(enc.encode(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${header}.${body}`));
  return `${header}.${body}.${b64u(sig)}`;
}

export async function verifyToken(token: string, secret: string): Promise<AuthUser | null> {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64u(s), enc.encode(`${h}.${b}`));
  if (!ok) return null;
  const p = JSON.parse(new TextDecoder().decode(unb64u(b)));
  if (!p.exp || p.exp < Date.now() / 1000) return null;
  return { id: p.id, name: p.name, role: p.role, store_id: p.store_id ?? null };
}

const ITERATIONS = 100_000;

export async function hashPassword(password: string, salt?: Uint8Array) {
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return `${b64u(salt)}.${b64u(bits)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt] = stored.split('.');
  const again = await hashPassword(password, unb64u(salt));
  // comparação em tempo constante
  if (again.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < again.length; i++) diff |= again.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

export const secretOf = (env: { JWT_SECRET?: string }) => {
  // Sem segredo configurado o sistema não inicia sessões (evita tokens forjáveis em produção).
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET não configurado (mín. 16 caracteres)');
  return env.JWT_SECRET;
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? await verifyToken(token, secretOf(c.env)) : null;
  if (!user) return c.json({ error: 'Não autenticado' }, 401);
  c.set('user', user);
  await next();
};

export const requireRole = (...roles: Role[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!roles.includes(c.get('user').role)) return c.json({ error: 'Sem permissão' }, 403);
  await next();
};
