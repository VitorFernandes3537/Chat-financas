-- Execute no Supabase SQL Editor
-- Dashboard > SQL Editor > New query


CREATE TABLE IF NOT EXISTS transactions (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo        text NOT NULL CHECK (tipo IN ('gasto', 'receita', 'divida')),
  valor       numeric(10, 2) NOT NULL CHECK (valor > 0),
  categoria   text NOT NULL,
  descricao   text,
  created_at  timestamptz DEFAULT now()
);

-- Índices para as queries do relatório
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_tipo        ON transactions (tipo);

-- Row Level Security (RLS) — desative se for uso pessoal via service_role key
-- ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- Comentário: a service_role key bypassa RLS automaticamente.
-- Se quiser autenticação no futuro, habilite RLS e adicione policies.
