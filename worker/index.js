/**
 * Cloudflare Worker — Finanças Pessoais API
 *
 * Variáveis de ambiente (configure no painel Cloudflare ou wrangler.toml):
 *   SUPABASE_URL   — ex: https://xxxx.supabase.co
 *   SUPABASE_KEY   — service_role key (Settings > API)
 *   ALLOWED_ORIGIN — URL do seu PWA, ex: https://financa.pages.dev
 */

const CORS = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';
    const headers = { 'Content-Type': 'application/json', ...CORS(origin) };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // ── POST /tx ── Salva uma transação
    if (url.pathname === '/tx' && request.method === 'POST') {
      const body = await request.json();
      const { tipo, valor, categoria, descricao } = body;

      if (!tipo || !valor || !categoria) {
        return new Response(JSON.stringify({ error: 'Campos obrigatórios: tipo, valor, categoria' }), { status: 400, headers });
      }

      const res = await supabase(env, 'POST', '/rest/v1/transactions', {
        tipo, valor: Number(valor), categoria, descricao: descricao || categoria
      });

      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: err }), { status: 500, headers });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 201, headers });
    }

    // ── GET /report ── Busca transações com filtros
    if (url.pathname === '/report' && request.method === 'GET') {
      const month = url.searchParams.get('month'); // ex: 2025-06
      const tipo = url.searchParams.get('tipo');   // opcional

      let query = '/rest/v1/transactions?select=*&order=created_at.desc';

      if (month) {
        const [year, m] = month.split('-');
        const from = `${year}-${m}-01T00:00:00`;
        const lastDay = new Date(Number(year), Number(m), 0).getDate();
        const to = `${year}-${m}-${String(lastDay).padStart(2, '0')}T23:59:59`;
        query += `&created_at=gte.${from}&created_at=lte.${to}`;
      }

      if (tipo) {
        query += `&tipo=eq.${tipo}`;
      }

      const res = await supabase(env, 'GET', query);

      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: err }), { status: 500, headers });
      }

      const transactions = await res.json();

      // Agrega por categoria
      const byCategory = {};
      transactions.forEach(t => {
        if (t.tipo === 'gasto') {
          byCategory[t.categoria] = (byCategory[t.categoria] || 0) + Number(t.valor);
        }
      });

      const totals = {
        receitas: transactions.filter(t => t.tipo === 'receita').reduce((a, t) => a + Number(t.valor), 0),
        gastos: transactions.filter(t => t.tipo === 'gasto').reduce((a, t) => a + Number(t.valor), 0),
        dividas: transactions.filter(t => t.tipo === 'divida').reduce((a, t) => a + Number(t.valor), 0),
      };
      totals.saldo = totals.receitas - totals.gastos;

      return new Response(JSON.stringify({ transactions, totals, byCategory }), { headers });
    }

    // ── DELETE /tx/:id ── Remove uma transação
    if (url.pathname.startsWith('/tx/') && request.method === 'DELETE') {
      const id = url.pathname.split('/')[2];
      const res = await supabase(env, 'DELETE', `/rest/v1/transactions?id=eq.${id}`);

      if (!res.ok) {
        return new Response(JSON.stringify({ error: 'Não foi possível deletar' }), { status: 500, headers });
      }

      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Rota não encontrada' }), { status: 404, headers });
  }
};

// ── Helper Supabase ──────────────────────────────────────────
function supabase(env, method, path, body) {
  const url = env.SUPABASE_URL + path;
  const opts = {
    method,
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=minimal' : '',
    }
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}
