-- Yracema MVP - schema inicial (Cloudflare D1 / SQLite)

CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  city TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- gerente | financeiro | administracao | diretor | proprietario
  role TEXT NOT NULL CHECK (role IN ('gerente','financeiro','administracao','diretor','proprietario')),
  store_id INTEGER REFERENCES stores(id),   -- obrigatório para gerente
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'Outros', -- Pães, Salsichas, Molhos, Embalagens, Batata, Carnes, Outros
  unit TEXT NOT NULL DEFAULT 'un',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Pedido de produção: 1 por loja por data de produção
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  production_date TEXT NOT NULL,            -- YYYY-MM-DD (dia em que será produzido/entregue)
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, production_date)
);

CREATE TABLE order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (order_id, product_id)
);

-- Fechamento de caixa: 1 por loja por data
CREATE TABLE closings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  closing_date TEXT NOT NULL,
  system_total REAL NOT NULL DEFAULT 0,     -- total do relatório do sistema (Connect Plug)
  machine_total REAL NOT NULL DEFAULT 0,    -- total do relatório da maquininha
  cash_counted REAL NOT NULL DEFAULT 0,     -- dinheiro contado em caixa
  notes TEXT,
  -- aberto: gerente ainda edita | enviado: aguardando conferência | conferido: financeiro conferiu
  status TEXT NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','conferido')),
  created_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (store_id, closing_date)
);

-- Recebimentos por forma de pagamento
CREATE TABLE closing_payments (
  closing_id INTEGER NOT NULL REFERENCES closings(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('dinheiro','pix','credito','debito','voucher','ifood')),
  amount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (closing_id, method)
);

-- Movimentações: sangria, despesa, cancelamento, estorno
CREATE TABLE closing_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  closing_id INTEGER NOT NULL REFERENCES closings(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sangria','despesa','cancelamento','estorno')),
  amount REAL NOT NULL,
  description TEXT
);

CREATE INDEX idx_orders_date ON orders(production_date);
CREATE INDEX idx_closings_date ON closings(closing_date);
CREATE INDEX idx_movements_closing ON closing_movements(closing_id);
