-- Banco D1 "radar-favcode": inscritos da newsletter, notícias que passaram pelo radar e edições.
-- Aplicar com a API da Cloudflare (POST /accounts/{id}/d1/database/{uuid}/query), um comando por vez.

-- Inscritos. O e-mail (em minúsculas) é a chave. O telefone é opcional e fica só aqui, não vai
-- para o Resend. consent_at/consent_version registram quando e com qual texto a pessoa aceitou.
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'site',
  consent_at TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  synced_at TEXT,
  sync_error TEXT,
  welcomed_at TEXT
);
CREATE INDEX IF NOT EXISTS subscribers_pending ON subscribers(synced_at);

-- Notícias vistas no radar (guardadas por 30 dias), base do rascunho semanal.
-- heat: maior soma de pontos dos termos "Em alta" a que a notícia esteve ligada.
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  column_id TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  heat REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS news_first_seen ON news(first_seen);

-- Edições da newsletter. id = semana ISO (ex.: 2026-W40); data = JSON com assunto, abertura,
-- notícias e comentários; status: draft, scheduled ou sent.
CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  broadcast_id TEXT
);
