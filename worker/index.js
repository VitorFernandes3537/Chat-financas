/**
 * Cloudflare Worker — Finanças Pessoais API v2
 *
 * Secrets (Settings > Variables > Add secret):
 *   SUPABASE_URL   — ex: https://xxxx.supabase.co
 *   SUPABASE_KEY   — service_role key
 *   OPENAI_KEY     — sk-...
 *
 * Variável normal:
 *   ALLOWED_ORIGIN — ex: https://financa-pwa.pages.dev
 */

const cors = (env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = { 'Content-Type': 'application/json', ...cors(env) };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    // ── POST /process ─────────────────────────────────────────
    // Recebe texto → OpenAI extrai dados → salva no Supabase
    if (url.pathname === '/process' && request.method === 'POST') {
      const { text } = await request.json();
      if (!text) return new Response(JSON.stringify({ error: 'Campo text obrigatório' }), { status: 400, headers });

      const prompt = `Você é um assistente financeiro pessoal brasileiro. Analise esta mensagem e extraia informações financeiras.

Mensagem: "${text}"

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{"entendeu":true,"tipo":"gasto","valor":45.00,"categoria":"alimentação","descricao":"mercado","resposta":"Registrado! Gasto de R$ 45,00 no mercado."}

Tipos: "gasto", "receita", "divida"
Categorias gasto: alimentação, transporte, moradia, saúde, lazer, educação, assinatura, outros
Categorias receita: salário, freelance, investimento, outros
Categorias dívida: cartão, empréstimo, parcela, outros

Se não entender: {"entendeu":false,"resposta":"Não entendi. Tente: 'gastei 50 no uber'"}`;

      let parsed;
      try {
        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.OPENAI_KEY}` },
          body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 300, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
        });
        const aiData = await aiRes.json();
        if (aiData.error) return new Response(JSON.stringify({ error: 'OpenAI: ' + aiData.error.message }), { status: 502, headers });
        parsed = JSON.parse(aiData.choices[0].message.content.replace(/```json|```/g, '').trim());
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Erro ao processar com IA' }), { status: 500, headers });
      }

      if (parsed.entendeu) {
        const sbRes = await supabase(env, 'POST', '/rest/v1/transactions_app_financa', {
          tipo: parsed.tipo, valor: Number(parsed.valor),
          categoria: parsed.categoria, descricao: parsed.descricao || parsed.categoria,
        });
        if (!sbRes.ok) return new Response(JSON.stringify({ error: 'Supabase: ' + await sbRes.text() }), { status: 500, headers });
      }

      return new Response(JSON.stringify(parsed), { headers });
    }

    // ── POST /transcribe ──────────────────────────────────────
    // Recebe áudio base64 → Whisper → retorna texto
    if (url.pathname === '/transcribe' && request.method === 'POST') {
      const { audio, mimeType } = await request.json();
      if (!audio) return new Response(JSON.stringify({ error: 'Campo audio obrigatório' }), { status: 400, headers });

      const binary = atob(audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const fd = new FormData();
      fd.append('file', new Blob([bytes], { type: mimeType || 'audio/webm' }), 'audio.webm');
      fd.append('model', 'whisper-1');
      fd.append('language', 'pt');

      const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_KEY}` },
        body: fd,
      });
      const wData = await wRes.json();
      if (wData.error) return new Response(JSON.stringify({ error: 'Whisper: ' + wData.error.message }), { status: 502, headers });

      return new Response(JSON.stringify({ text: wData.text }), { headers });
    }

    // ── GET /report ───────────────────────────────────────────
    if (url.pathname === '/report' && request.method === 'GET') {
      const month = url.searchParams.get('month');
      const tipo = url.searchParams.get('tipo');

      let query = '/rest/v1/transactions_app_financa?select=*&order=created_at.desc';

      if (month) {
        const [year, m] = month.split('-');
        const lastDay = new Date(Number(year), Number(m), 0).getDate();
        query += `&created_at=gte.${year}-${m}-01T00:00:00&created_at=lte.${year}-${m}-${String(lastDay).padStart(2,'0')}T23:59:59`;
      }
      if (tipo) query += `&tipo=eq.${tipo}`;

      const res = await supabase(env, 'GET', query);
      if (!res.ok) return new Response(JSON.stringify({ error: await res.text() }), { status: 500, headers });

      const transactions = await res.json();
      const byCategory = {};
      transactions.forEach(t => {
        if (t.tipo === 'gasto') byCategory[t.categoria] = (byCategory[t.categoria] || 0) + Number(t.valor);
      });
      const totals = {
        receitas: transactions.filter(t => t.tipo === 'receita').reduce((a, t) => a + Number(t.valor), 0),
        gastos:   transactions.filter(t => t.tipo === 'gasto').reduce((a, t) => a + Number(t.valor), 0),
        dividas:  transactions.filter(t => t.tipo === 'divida').reduce((a, t) => a + Number(t.valor), 0),
      };
      totals.saldo = totals.receitas - totals.gastos;

      return new Response(JSON.stringify({ transactions, totals, byCategory }), { headers });
    }

    // ── GET /stats ────────────────────────────────────────────
    // Retorna totais mensais dos últimos N meses para o gráfico de tendência
    if (url.pathname === '/stats' && request.method === 'GET') {
      const months = Math.min(parseInt(url.searchParams.get('months') || '6'), 12);
      const now = new Date();
      const results = [];

      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const year = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();
        const from = `${year}-${m}-01T00:00:00`;
        const to   = `${year}-${m}-${String(lastDay).padStart(2,'0')}T23:59:59`;

        const res = await supabase(env, 'GET',
          `/rest/v1/transactions_app_financa?select=tipo,valor&created_at=gte.${from}&created_at=lte.${to}`
        );
        if (!res.ok) continue;

        const rows = await res.json();
        const gastos   = rows.filter(r => r.tipo === 'gasto').reduce((a, r) => a + Number(r.valor), 0);
        const receitas = rows.filter(r => r.tipo === 'receita').reduce((a, r) => a + Number(r.valor), 0);
        results.push({ month: `${year}-${m}`, gastos, receitas });
      }

      return new Response(JSON.stringify({ months: results }), { headers });
    }

    // ── PATCH /tx/:id ─────────────────────────────────────────
    // Editar tipo, valor, categoria e descrição de uma transação
    if (url.pathname.startsWith('/tx/') && request.method === 'PATCH') {
      const id = url.pathname.split('/')[2];
      const body = await request.json();
      const allowed = ['tipo', 'valor', 'categoria', 'descricao'];
      const patch = {};
      allowed.forEach(k => { if (body[k] !== undefined) patch[k] = body[k]; });
      if (patch.valor !== undefined) patch.valor = Number(patch.valor);
      if (!Object.keys(patch).length) {
        return new Response(JSON.stringify({ error: 'Nenhum campo para atualizar' }), { status: 400, headers });
      }
      const res = await supabase(env, 'PATCH', `/rest/v1/transactions_app_financa?id=eq.${id}`, patch);
      if (!res.ok) return new Response(JSON.stringify({ error: 'Erro ao atualizar' }), { status: 500, headers });
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    // ── DELETE /tx/:id ────────────────────────────────────────
    if (url.pathname.startsWith('/tx/') && request.method === 'DELETE') {
      const id = url.pathname.split('/')[2];
      const res = await supabase(env, 'DELETE', `/rest/v1/transactions_app_financa?id=eq.${id}`);
      if (!res.ok) return new Response(JSON.stringify({ error: 'Erro ao deletar' }), { status: 500, headers });
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Rota não encontrada' }), { status: 404, headers });
  },
};

function supabase(env, method, path, body) {
  const opts = {
    method,
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': (method === 'POST' || method === 'PATCH') ? 'return=minimal' : '',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(env.SUPABASE_URL + path, opts);
}
