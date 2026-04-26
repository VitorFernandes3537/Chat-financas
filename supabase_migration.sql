-- Execute no Supabase SQL Editor
-- Dashboard > SQL Editor > New query
-- ATENÇÃO: a tabela já foi criada com este nome via SQL Editor manual


CREATE TABLE IF NOT EXISTS transactions_app_financa (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo        text NOT NULL CHECK (tipo IN ('gasto', 'receita', 'divida')),
  valor       numeric(10, 2) NOT NULL CHECK (valor > 0),
  categoria   text NOT NULL,
  descricao   text,
  created_at  timestamptz DEFAULT now()
);

-- Índices para as queries do relatório
CREATE INDEX IF NOT EXISTS idx_taf_created_at ON transactions_app_financa (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_taf_tipo        ON transactions_app_financa (tipo);

-- Row Level Security (RLS) — a service_role key bypassa RLS automaticamente.
-- Se quiser autenticação por usuário no futuro, habilite RLS e adicione policies.
-- ALTER TABLE transactions_app_financa DISABLE ROW LEVEL SECURITY;
