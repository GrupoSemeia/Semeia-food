export type Role = 'gerente' | 'financeiro' | 'administracao' | 'diretor' | 'proprietario';

export interface Env {
  DB: D1Database;
  JWT_SECRET?: string;
  ORDER_CUTOFF: string;
}

export interface AuthUser {
  id: number;
  name: string;
  role: Role;
  store_id: number | null;
}

export type AppEnv = { Bindings: Env; Variables: { user: AuthUser } };

export const PAYMENT_METHODS = ['dinheiro', 'pix', 'credito', 'debito', 'voucher', 'ifood'] as const;
export const MOVEMENT_TYPES = ['sangria', 'despesa', 'cancelamento', 'estorno'] as const;

/** Perfis com visão de todas as lojas. */
export const GLOBAL_ROLES: Role[] = ['financeiro', 'administracao', 'diretor', 'proprietario'];
/** Perfis que administram cadastros (lojas, produtos, usuários). */
export const ADMIN_ROLES: Role[] = ['administracao', 'diretor', 'proprietario'];
