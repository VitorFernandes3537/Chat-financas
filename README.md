# Finanças Pessoais — PWA + Cloudflare Worker + Supabase

App de controle financeiro pessoal com chat de voz/texto, IA para extração de dados
e relatórios mensais. Roda como PWA instalável no Android (sem Play Store).

## Estrutura

```
financa-pwa/
├── public/                  ← Frontend estático (deploy no Cloudflare Pages)
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── manifest.json        ← Configura o PWA
│   ├── sw.js                ← Service Worker (offline)
│   └── icons/               ← Crie ícones 192x192 e 512x512 (PNG)
├── worker/                  ← API backend (deploy no Cloudflare Workers)
│   ├── index.js
│   └── wrangler.toml
└── supabase_migration.sql   ← Execute no Supabase SQL Editor
```

---

## Passo 1 — Supabase (banco de dados)

1. Acesse https://supabase.com e crie um projeto grátis
2. Vá em **SQL Editor** e cole o conteúdo de `supabase_migration.sql`
3. Execute (botão Run)
4. Anote:
   - `SUPABASE_URL`: em Settings > API > Project URL
   - `SUPABASE_KEY`: em Settings > API > service_role (secret)

---

## Passo 2 — Cloudflare Worker (API)

Pré-requisito: Node.js instalado

```bash
# Instale o Wrangler (CLI do Cloudflare)
npm install -g wrangler

# Faça login
wrangler login

# Entre na pasta do worker
cd worker

# Edite wrangler.toml: coloque seu SUPABASE_URL e ALLOWED_ORIGIN

# Salve a chave do Supabase como segredo (NÃO vai pro git)
wrangler secret put SUPABASE_KEY
# Cole a service_role key quando pedir

# Deploy
wrangler deploy
```

Você vai receber a URL do worker: `https://financa-worker.SEU-USUARIO.workers.dev`

---

## Passo 3 — Cloudflare Pages (frontend PWA)

### Opção A — Via Git (recomendado)
1. Suba a pasta `public/` para um repositório GitHub
2. Acesse https://dash.cloudflare.com > Pages > Create a project
3. Conecte o repositório
4. Build settings: deixe em branco (site estático)
5. Output directory: `/` (ou `public` se subiu a raiz)
6. Deploy

### Opção B — Deploy direto via CLI
```bash
npx wrangler pages deploy public --project-name financa-pwa
```

Você vai receber a URL: `https://financa-pwa.pages.dev`

---

## Passo 4 — Ícones do PWA

Crie dois ícones PNG simples (pode usar https://favicon.io ou Canva):
- `public/icons/icon-192.png` — 192x192px
- `public/icons/icon-512.png` — 512x512px

Sem ícones, o PWA ainda funciona mas não aparece bonitinho na tela inicial.

---

## Passo 5 — Configurar o app

1. Abra o PWA no Chrome do Android
2. Vá na aba **Config**
3. Coloque:
   - Chave OpenAI (`sk-...`) — para transcrição de voz e extração de dados
   - URL do Worker — a URL que você recebeu no Passo 2
4. Salvar

---

## Instalar no Android como app

1. Abra o PWA no **Chrome** (não Samsung Internet, não Firefox)
2. Toque no menu (⋮) > **Adicionar à tela inicial**
3. Confirme
4. Pronto — vira um ícone na home, abre sem barra do navegador

---

## Custos estimados

| Serviço | Plano | Custo |
|---------|-------|-------|
| Supabase | Free | R$ 0 |
| Cloudflare Workers | Free (100k req/dia) | R$ 0 |
| Cloudflare Pages | Free | R$ 0 |
| OpenAI GPT-4o-mini | ~$0.00015/req | < R$ 1/mês |
| OpenAI Whisper | ~$0.006/min áudio | < R$ 2/mês |

**Total: praticamente R$ 0**

---

## Offline

O Service Worker faz cache dos arquivos estáticos.
Se você registrar sem internet, salva no `localStorage` do celular.
Quando a conexão voltar, os próximos registros vão direto pro Supabase.

> Para sincronizar os itens offline automaticamente, é uma melhoria futura simples:
> ao detectar conexão, fazer POST de cada item do localStorage e limpar.
