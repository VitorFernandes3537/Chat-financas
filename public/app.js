// ─── CONFIG ──────────────────────────────────────────────────
// Só o workerUrl fica salvo — nenhuma chave de API no frontend
let CFG = {
  workerUrl: localStorage.getItem('worker_url') || '',
};

// ─── TABS ─────────────────────────────────────────────────────
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

// ─── SETTINGS ─────────────────────────────────────────────────
document.getElementById('cfg-worker').value = CFG.workerUrl;

document.getElementById('btn-save-settings').addEventListener('click', () => {
  CFG.workerUrl = document.getElementById('cfg-worker').value.trim().replace(/\/$/, '');
  localStorage.setItem('worker_url', CFG.workerUrl);
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Salvo!';
  setTimeout(() => msg.textContent = '', 2000);
});

// ─── CHAT ─────────────────────────────────────────────────────
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

// ─── PROCESS TEXT → WORKER ────────────────────────────────────
async function processText(text) {
  if (!CFG.workerUrl) {
    addMsg('Configure a URL do Worker na aba Config primeiro.', 'bot');
    return;
  }

  addMsg(text, 'user');
  addTyping();

  try {
    // Toda a lógica de IA e banco fica no Worker
    const res = await fetch(`${CFG.workerUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    const parsed = await res.json();
    removeTyping();

    if (!res.ok) {
      addMsg('Erro: ' + (parsed.error || 'Tente novamente.'), 'bot');
      return;
    }

    if (!parsed.entendeu) {
      addMsg(parsed.resposta, 'bot');
      return;
    }

    addMsg(parsed.resposta, 'bot', {
      tipo: parsed.tipo,
      valor: parsed.valor,
      categoria: parsed.categoria,
    });

  } catch (err) {
    removeTyping();
    addMsg('Erro de conexão com o Worker. Verifique a URL nas configurações.', 'bot');
    console.error(err);
  }
}

// ─── INPUT ────────────────────────────────────────────────────
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

// ─── ÁUDIO ────────────────────────────────────────────────────
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
        await transcribeViaWorker(new Blob(chunks, { type: 'audio/webm' }));
      };
      recorder.start();
      isRec = true;
      recBtn.classList.add('recording');
    } catch {
      addMsg('Microfone não disponível. Use o campo de texto.', 'bot');
    }
  } else {
    recorder.stop();
    isRec = false;
    recBtn.classList.remove('recording');
  }
});

async function transcribeViaWorker(blob) {
  if (!CFG.workerUrl) { addMsg('Configure a URL do Worker.', 'bot'); return; }

  addTyping();

  // Converte blob para base64 para enviar ao Worker
  const reader = new FileReader();
  reader.onload = async () => {
    const base64 = reader.result.split(',')[1];

    try {
      const res = await fetch(`${CFG.workerUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mimeType: blob.type }),
      });

      const data = await res.json();
      removeTyping();

      if (data.error) { addMsg('Erro na transcrição: ' + data.error, 'bot'); return; }
      if (data.text) processText(data.text);

    } catch {
      removeTyping();
      addMsg('Erro ao transcrever áudio.', 'bot');
    }
  };
  reader.readAsDataURL(blob);
}

// ─── RELATÓRIO ────────────────────────────────────────────────
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

  if (!CFG.workerUrl) {
    content.innerHTML = '<div class="empty-state">Configure a URL do Worker nas configurações.</div>';
    return;
  }

  content.innerHTML = '<div class="empty-state">Carregando...</div>';

  try {
    const params = new URLSearchParams({ month });
    if (tipo) params.set('tipo', tipo);

    const res = await fetch(`${CFG.workerUrl}/report?${params}`);
    const data = await res.json();

    if (!res.ok) {
      content.innerHTML = `<div class="empty-state">Erro: ${data.error}</div>`;
      return;
    }

    renderReport(data.transactions || [], data.totals, content);

  } catch {
    content.innerHTML = '<div class="empty-state">Erro de conexão.</div>';
  }
}

function renderReport(txList, totals, container) {
  if (!txList.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma transação neste período.</div>';
    return;
  }

  const { receitas = 0, gastos = 0, dividas = 0, saldo = 0 } = totals || {};

  const cats = {};
  txList.filter(t => t.tipo === 'gasto').forEach(t => {
    cats[t.categoria] = (cats[t.categoria] || 0) + Number(t.valor);
  });
  const maxCat = Math.max(...Object.values(cats), 1);

  container.innerHTML = '';

  // Cards de totais
  const grid = document.createElement('div');
  grid.className = 'summary-grid';
  grid.innerHTML = `
    <div class="stat-card"><div class="stat-label">Receitas</div><div class="stat-value pos">R$ ${Number(receitas).toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">Gastos</div><div class="stat-value neg">R$ ${Number(gastos).toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">Saldo</div><div class="stat-value ${saldo >= 0 ? 'pos' : 'neg'}">R$ ${Number(saldo).toFixed(2)}</div></div>
  `;
  container.appendChild(grid);

  if (dividas > 0) {
    const dc = document.createElement('div');
    dc.className = 'stat-card';
    dc.innerHTML = `<div class="stat-label">Dívidas</div><div class="stat-value warn">R$ ${Number(dividas).toFixed(2)}</div>`;
    container.appendChild(dc);
  }

  // Barras por categoria
  if (Object.keys(cats).length) {
    const h = document.createElement('div');
    h.className = 'section-heading';
    h.textContent = 'Gastos por categoria';
    container.appendChild(h);

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([cat, val]) => {
      const item = document.createElement('div');
      item.className = 'cat-bar-item';
      item.innerHTML = `
        <div class="cat-bar-header"><span>${cat}</span><span style="color:var(--red)">R$ ${val.toFixed(2)}</span></div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(val / maxCat * 100).toFixed(1)}%"></div></div>
      `;
      wrap.appendChild(item);
    });
    container.appendChild(wrap);
  }

  // Lista de transações
  const h2 = document.createElement('div');
  h2.className = 'section-heading';
  h2.textContent = 'Transações';
  container.appendChild(h2);

  const listWrap = document.createElement('div');
  [...txList].forEach(t => {
    const colorClass = t.tipo === 'receita' ? 'pos' : t.tipo === 'divida' ? 'warn' : 'neg';
    const prefix = t.tipo === 'receita' ? '+' : '-';
    const date = t.created_at ? new Date(t.created_at).toLocaleDateString('pt-BR') : '';
    const item = document.createElement('div');
    item.className = 'tx-item';
    item.innerHTML = `
      <div>
        <div class="tx-desc">${t.descricao}</div>
        <div class="tx-meta">${date} • ${t.categoria}</div>
      </div>
      <div class="tx-amount ${colorClass}">${prefix} R$ ${Number(t.valor).toFixed(2)}</div>
    `;
    listWrap.appendChild(item);
  });
  container.appendChild(listWrap);
}

// ─── SERVICE WORKER ───────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}
