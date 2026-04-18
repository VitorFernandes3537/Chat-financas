// ─── CONFIG ────────────────────────────────────────────────────
let CFG = {
  openaiKey: localStorage.getItem('openai_key') || '',
  workerUrl: localStorage.getItem('worker_url') || '',
};

// ─── TABS ──────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + target).classList.add('active');
    if (target === 'report') initReport();
  });
});

// ─── SETTINGS ──────────────────────────────────────────────────
document.getElementById('cfg-openai').value = CFG.openaiKey;
document.getElementById('cfg-worker').value = CFG.workerUrl;

document.getElementById('btn-save-settings').addEventListener('click', () => {
  CFG.openaiKey = document.getElementById('cfg-openai').value.trim();
  CFG.workerUrl = document.getElementById('cfg-worker').value.trim().replace(/\/$/, '');
  localStorage.setItem('openai_key', CFG.openaiKey);
  localStorage.setItem('worker_url', CFG.workerUrl);
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Salvo!';
  setTimeout(() => msg.textContent = '', 2000);
});

// ─── CHAT ──────────────────────────────────────────────────────
const messagesEl = document.getElementById('messages');

function addMsg(text, role, tx) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  if (tx) {
    const tag = document.createElement('span');
    tag.className = 'msg-tag tag-' + tx.tipo;
    const labels = { gasto: 'Gasto', receita: 'Receita', divida: 'Dívida' };
    tag.textContent = `${labels[tx.tipo]} • ${tx.categoria} • R$ ${Number(tx.valor).toFixed(2)}`;
    div.appendChild(document.createElement('br'));
    div.appendChild(tag);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function addTyping() {
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.id = 'typing';
  div.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function removeTyping() { document.getElementById('typing')?.remove(); }

addMsg('Oi! Me conta seus gastos, receitas ou dívidas. Ex: "gastei 45 reais no mercado" ou "recebi salário de 3000".', 'bot');

async function processText(text) {
  if (!CFG.openaiKey) {
    addMsg('Configure sua chave OpenAI na aba Config primeiro.', 'bot');
    return;
  }

  addMsg(text, 'user');
  addTyping();

  const prompt = `Você é um assistente financeiro pessoal brasileiro. Analise esta mensagem e extraia informações financeiras.

Mensagem: "${text}"

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto fora do JSON):
{
  "entendeu": true,
  "tipo": "gasto",
  "valor": 45.00,
  "categoria": "alimentação",
  "descricao": "mercado",
  "resposta": "Registrado! Gasto de R$ 45,00 no mercado."
}

Tipos: "gasto", "receita", "divida"
Categorias para gasto: alimentação, transporte, moradia, saúde, lazer, educação, assinatura, outros
Categorias para receita: salário, freelance, investimento, outros  
Categorias para dívida: cartão, empréstimo, parcela, outros

Se não conseguir extrair, responda: {"entendeu": false, "resposta": "Não entendi. Tente: 'gastei 50 no uber'"}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.openaiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await res.json();
    removeTyping();

    if (data.error) { addMsg('Erro OpenAI: ' + data.error.message, 'bot'); return; }

    const raw = data.choices[0].message.content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(raw);

    if (!parsed.entendeu) { addMsg(parsed.resposta, 'bot'); return; }

    // Save to Worker / Supabase
    const tx = { tipo: parsed.tipo, valor: parsed.valor, categoria: parsed.categoria, descricao: parsed.descricao };

    if (CFG.workerUrl) {
      try {
        await fetch(`${CFG.workerUrl}/tx`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tx)
        });
      } catch (_) {
        // Worker offline — salva localmente
        saveLocal(tx);
      }
    } else {
      saveLocal(tx);
    }

    addMsg(parsed.resposta, 'bot', tx);

  } catch (err) {
    removeTyping();
    addMsg('Erro ao processar. Verifique sua conexão e chave.', 'bot');
    console.error(err);
  }
}

// ─── LOCAL FALLBACK ────────────────────────────────────────────
function saveLocal(tx) {
  const list = JSON.parse(localStorage.getItem('tx_local') || '[]');
  list.push({ ...tx, created_at: new Date().toISOString() });
  localStorage.setItem('tx_local', JSON.stringify(list));
}
function getLocal() {
  return JSON.parse(localStorage.getItem('tx_local') || '[]');
}

// ─── SEND / INPUT ─────────────────────────────────────────────
const input = document.getElementById('user-input');
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
document.getElementById('send-btn').addEventListener('click', send);

function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  processText(text);
}

// ─── AUDIO ────────────────────────────────────────────────────
let isRec = false, recorder = null, chunks = [];
const recBtn = document.getElementById('rec-btn');

recBtn.addEventListener('click', async () => {
  if (!isRec) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        await transcribe(new Blob(chunks, { type: 'audio/webm' }));
      };
      recorder.start();
      isRec = true;
      recBtn.classList.add('recording');
      recBtn.title = 'Parar';
    } catch {
      addMsg('Microfone não disponível. Use o campo de texto.', 'bot');
    }
  } else {
    recorder.stop();
    isRec = false;
    recBtn.classList.remove('recording');
    recBtn.title = 'Gravar';
  }
});

async function transcribe(blob) {
  if (!CFG.openaiKey) { addMsg('Configure a chave OpenAI primeiro.', 'bot'); return; }
  addTyping();
  try {
    const fd = new FormData();
    fd.append('file', blob, 'audio.webm');
    fd.append('model', 'whisper-1');
    fd.append('language', 'pt');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.openaiKey}` },
      body: fd
    });
    const data = await res.json();
    removeTyping();
    if (data.text) processText(data.text);
    else addMsg('Não consegui transcrever. Tente novamente.', 'bot');
  } catch {
    removeTyping();
    addMsg('Erro na transcrição.', 'bot');
  }
}

// ─── REPORT ───────────────────────────────────────────────────
function initReport() {
  const sel = document.getElementById('filter-month');
  if (sel.options.length === 0) {
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      const opt = new Option(label, val);
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  loadReport();
}

document.getElementById('btn-load-report').addEventListener('click', loadReport);

async function loadReport() {
  const month = document.getElementById('filter-month').value;
  const tipo = document.getElementById('filter-tipo').value;
  const content = document.getElementById('report-content');
  content.innerHTML = '<div class="empty-state">Carregando...</div>';

  let txList = [];

  if (CFG.workerUrl) {
    try {
      const params = new URLSearchParams({ month });
      if (tipo) params.set('tipo', tipo);
      const res = await fetch(`${CFG.workerUrl}/report?${params}`);
      const data = await res.json();
      txList = data.transactions || [];
    } catch {
      txList = getLocal();
    }
  } else {
    txList = getLocal();
  }

  // filter by month if local
  if (!CFG.workerUrl) {
    txList = txList.filter(t => t.created_at?.startsWith(month));
    if (tipo) txList = txList.filter(t => t.tipo === tipo);
  }

  renderReport(txList, content);
}

function renderReport(txList, container) {
  if (!txList.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma transação neste período.</div>';
    return;
  }

  const receitas = txList.filter(t => t.tipo === 'receita').reduce((a, t) => a + Number(t.valor), 0);
  const gastos = txList.filter(t => t.tipo === 'gasto').reduce((a, t) => a + Number(t.valor), 0);
  const dividas = txList.filter(t => t.tipo === 'divida').reduce((a, t) => a + Number(t.valor), 0);
  const saldo = receitas - gastos;

  // Categorias
  const cats = {};
  txList.filter(t => t.tipo === 'gasto').forEach(t => {
    cats[t.categoria] = (cats[t.categoria] || 0) + Number(t.valor);
  });
  const maxCat = Math.max(...Object.values(cats), 1);

  container.innerHTML = '';

  // Summary cards
  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  grid.innerHTML = `
    <div class="stat-card"><div class="stat-label">Receitas</div><div class="stat-value pos">R$ ${receitas.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">Gastos</div><div class="stat-value neg">R$ ${gastos.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">Saldo</div><div class="stat-value ${saldo >= 0 ? 'pos' : 'neg'}">R$ ${saldo.toFixed(2)}</div></div>
  `;
  container.appendChild(grid);

  if (dividas > 0) {
    const dc = document.createElement('div');
    dc.className = 'stat-card';
    dc.innerHTML = `<div class="stat-label">Total em dívidas</div><div class="stat-value warn">R$ ${dividas.toFixed(2)}</div>`;
    container.appendChild(dc);
  }

  // Categories
  if (Object.keys(cats).length) {
    const h = document.createElement('div');
    h.className = 'section-heading';
    h.textContent = 'Gastos por categoria';
    container.appendChild(h);

    const catWrap = document.createElement('div');
    catWrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, val]) => {
      const item = document.createElement('div');
      item.className = 'cat-bar-item';
      item.innerHTML = `
        <div class="cat-bar-header"><span>${cat}</span><span style="color:var(--red)">R$ ${val.toFixed(2)}</span></div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(val / maxCat * 100).toFixed(1)}%"></div></div>
      `;
      catWrap.appendChild(item);
    });
    container.appendChild(catWrap);
  }

  // Transaction list
  const h2 = document.createElement('div');
  h2.className = 'section-heading';
  h2.textContent = 'Todas as transações';
  container.appendChild(h2);

  const listWrap = document.createElement('div');
  [...txList].reverse().forEach(t => {
    const colorClass = t.tipo === 'receita' ? 'pos' : t.tipo === 'divida' ? 'warn' : 'neg';
    const prefix = t.tipo === 'receita' ? '+' : '-';
    const date = t.created_at ? new Date(t.created_at).toLocaleDateString('pt-BR') : '';
    const item = document.createElement('div');
    item.className = 'tx-item';
    item.innerHTML = `
      <div><div class="tx-desc">${t.descricao}</div><div class="tx-meta">${date} • ${t.categoria}</div></div>
      <div class="tx-amount ${colorClass}">${prefix} R$ ${Number(t.valor).toFixed(2)}</div>
    `;
    listWrap.appendChild(item);
  });
  container.appendChild(listWrap);
}

// ─── SERVICE WORKER REGISTRATION ──────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}
