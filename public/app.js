// ─── CONFIG ───────────────────────────────────────────────────
let CFG = {
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
const transcriptionHint = document.getElementById('transcription-hint');

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

addMsg('Oi! Me conta seus gastos, receitas ou dívidas. Pode falar ou digitar. Ex: "gastei 45 no mercado" ou "recebi salário de 3000".', 'bot');

// ─── PROCESS TEXT → WORKER ────────────────────────────────────
async function processText(text) {
  if (!CFG.workerUrl) {
    addMsg('Configure a URL do Worker na aba Config primeiro.', 'bot');
    return;
  }

  addMsg(text, 'user');
  hideHint();
  addTyping();

  try {
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

function showHint() { transcriptionHint.style.display = 'flex'; }
function hideHint() { transcriptionHint.style.display = 'none'; }

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

input.addEventListener('input', function () {
  if (!this.value) hideHint();
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 96) + 'px';
});

document.getElementById('send-btn').addEventListener('click', send);

function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  hideHint();
  processText(text);
}

// ─── RECORDING STATE MACHINE ──────────────────────────────────
const recBtn = document.getElementById('rec-btn');
const iconMic  = recBtn.querySelector('.icon-mic');
const iconSpin = recBtn.querySelector('.icon-spin');
const timerEl  = recBtn.querySelector('.rec-timer');

let recTimer = null;
let recSeconds = 0;

function setRecState(state) {
  recBtn.classList.remove('recording', 'transcribing');
  iconMic.style.display  = 'none';
  iconSpin.style.display = 'none';
  timerEl.style.display  = 'none';

  if (state === 'idle') {
    iconMic.style.display = '';
  } else if (state === 'recording') {
    recBtn.classList.add('recording');
    timerEl.style.display = '';
  } else if (state === 'transcribing') {
    recBtn.classList.add('transcribing');
    iconSpin.style.display = '';
  }
}

function startRecTimer() {
  recSeconds = 0;
  timerEl.textContent = '0:00';
  recTimer = setInterval(() => {
    recSeconds++;
    const m = Math.floor(recSeconds / 60);
    const s = String(recSeconds % 60).padStart(2, '0');
    timerEl.textContent = `${m}:${s}`;
  }, 1000);
}

function stopRecTimer() {
  clearInterval(recTimer);
  recTimer = null;
}

setRecState('idle');

// ─── ÁUDIO ────────────────────────────────────────────────────
let isRec = false, recorder = null, chunks = [];

recBtn.addEventListener('click', async () => {
  if (!isRec) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        stopRecTimer();
        setRecState('transcribing');
        await transcribeViaWorker(new Blob(chunks, { type: 'audio/webm' }));
        setRecState('idle');
      };
      recorder.start();
      isRec = true;
      startRecTimer();
      setRecState('recording');
    } catch {
      addMsg('Microfone não disponível. Use o campo de texto.', 'bot');
    }
  } else {
    recorder.stop();
    isRec = false;
  }
});

async function transcribeViaWorker(blob) {
  if (!CFG.workerUrl) {
    addMsg('Configure a URL do Worker.', 'bot');
    return;
  }

  try {
    // Converte blob para base64 usando Promise para poder usar await
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    const res = await fetch(`${CFG.workerUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, mimeType: blob.type }),
    });

    const data = await res.json();

    if (data.error) {
      addMsg('Erro na transcrição: ' + data.error, 'bot');
      return;
    }

    if (data.text) {
      // Coloca o texto no campo para o usuário confirmar/editar antes de enviar
      input.value = data.text;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 96) + 'px';
      input.focus();
      showHint();
    }

  } catch {
    addMsg('Erro ao transcrever áudio.', 'bot');
  }
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

    // Carrega relatório e stats em paralelo
    const [reportRes, statsRes] = await Promise.all([
      fetch(`${CFG.workerUrl}/report?${params}`),
      fetch(`${CFG.workerUrl}/stats?months=6`),
    ]);

    const data = await reportRes.json();
    if (!reportRes.ok) {
      content.innerHTML = `<div class="empty-state">Erro: ${data.error}</div>`;
      return;
    }

    const statsData = statsRes.ok ? await statsRes.json() : null;
    renderReport(data.transactions || [], data.totals, content, statsData?.months || []);

  } catch {
    content.innerHTML = '<div class="empty-state">Erro de conexão.</div>';
  }
}

function renderReport(txList, totals, container, statsMonths = []) {
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

  // Totals grid
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

  // Trend chart — últimos 6 meses
  if (statsMonths.length > 1) {
    const h = document.createElement('div');
    h.className = 'section-heading';
    h.textContent = 'Últimos 6 meses';
    container.appendChild(h);

    const canvas = document.createElement('canvas');
    canvas.className = 'trend-canvas';
    container.appendChild(canvas);
    requestAnimationFrame(() => drawTrend(canvas, statsMonths));
  }

  // Category donut chart
  if (Object.keys(cats).length) {
    const h = document.createElement('div');
    h.className = 'section-heading';
    h.textContent = 'Gastos por categoria';
    container.appendChild(h);

    const chartWrap = document.createElement('div');
    chartWrap.className = 'donut-wrap';
    const canvas = document.createElement('canvas');
    canvas.className = 'donut-canvas';
    const legend = document.createElement('div');
    legend.className = 'donut-legend';
    chartWrap.appendChild(canvas);
    chartWrap.appendChild(legend);
    container.appendChild(chartWrap);

    requestAnimationFrame(() => drawDonut(canvas, legend, cats));
  }

  // Transaction list
  const h2 = document.createElement('div');
  h2.className = 'section-heading';
  h2.textContent = 'Transações';
  container.appendChild(h2);

  const listWrap = document.createElement('div');
  txList.forEach(t => {
    const colorClass = t.tipo === 'receita' ? 'pos' : t.tipo === 'divida' ? 'warn' : 'neg';
    const prefix = t.tipo === 'receita' ? '+' : '−';
    const date = t.created_at ? new Date(t.created_at).toLocaleDateString('pt-BR') : '';

    const row = document.createElement('div');
    row.className = 'tx-row';
    row.innerHTML = `
      <div class="tx-delete-bg">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
        Deletar
      </div>
      <div class="tx-item" data-id="${t.id}" data-tx='${JSON.stringify(t)}'>
        <div>
          <div class="tx-desc">${t.descricao}</div>
          <div class="tx-meta">${date} • ${t.categoria}</div>
        </div>
        <div class="tx-amount ${colorClass}">${prefix} R$ ${Number(t.valor).toFixed(2)}</div>
      </div>
    `;
    listWrap.appendChild(row);
    addSwipeToDelete(row, t.id);
  });
  container.appendChild(listWrap);
}

// ─── CANVAS CHARTS ────────────────────────────────────────────
const DONUT_COLORS = [
  '#f87171','#fb923c','#fbbf24','#34d399','#60a5fa',
  '#a78bfa','#f472b6','#94a3b8','#4ade80','#38bdf8',
];

function drawDonut(canvas, legendEl, cats) {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.parentElement.offsetWidth, 200);
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 8, r = R * 0.58;
  const total = Object.values(cats).reduce((a, v) => a + v, 0);
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);

  let angle = -Math.PI / 2;
  entries.forEach(([, val], i) => {
    const sweep = (val / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = DONUT_COLORS[i % DONUT_COLORS.length];
    ctx.fill();
    angle += sweep;
  });

  // Hole
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0a0a0a';
  ctx.fill();

  // Center text
  ctx.fillStyle = '#f0f0f0';
  ctx.font = `700 ${Math.round(size * 0.11)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('R$ ' + (total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total.toFixed(0)), cx, cy);

  // Legend
  legendEl.innerHTML = '';
  entries.forEach(([cat, val], i) => {
    const pct = ((val / total) * 100).toFixed(0);
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `
      <span class="legend-dot" style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></span>
      <span class="legend-cat">${cat}</span>
      <span class="legend-pct">${pct}%</span>
    `;
    legendEl.appendChild(row);
  });
}

function drawTrend(canvas, months) {
  const dpr = window.devicePixelRatio || 1;
  // getBoundingClientRect respeita o width:100% do CSS — sem overflow
  const W = Math.round(canvas.getBoundingClientRect().width);
  const H = 120;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px'; // width fica com o CSS (100%)

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = { top: 12, right: 12, bottom: 28, left: 42 };
  const w = W - PAD.left - PAD.right;
  const h = H - PAD.top - PAD.bottom;

  const allVals = months.flatMap(m => [m.gastos, m.receitas]);
  const maxVal  = Math.max(...allVals, 1);

  const xOf = i => PAD.left + (i / (months.length - 1)) * w;
  const yOf = v => PAD.top + h - (v / maxVal) * h;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach(t => {
    const y = PAD.top + h * (1 - t);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + w, y); ctx.stroke();
    const label = (maxVal * t / 1000).toFixed(0) + 'k';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = `10px system-ui`;
    ctx.textAlign = 'right';
    ctx.fillText(label, PAD.left - 6, y + 3);
  });

  // Draw line helper
  function drawLine(key, color) {
    ctx.beginPath();
    months.forEach((m, i) => {
      const x = xOf(i), y = yOf(m[key]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Dots
    months.forEach((m, i) => {
      ctx.beginPath();
      ctx.arc(xOf(i), yOf(m[key]), 3, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }

  drawLine('gastos',   '#f87171');
  drawLine('receitas', '#34d399');

  // X-axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  months.forEach((m, i) => {
    const [, mm] = m.month.split('-');
    const label = new Date(m.month + '-01').toLocaleDateString('pt-BR', { month: 'short' });
    ctx.fillText(label, xOf(i), H - 6);
  });

  // Legend
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  [['Gastos','#f87171'], ['Receitas','#34d399']].forEach(([label, color], i) => {
    const x = PAD.left + i * 80;
    ctx.fillStyle = color;
    ctx.fillRect(x, 2, 10, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(label, x + 14, 6);
  });
}

// ─── BOTTOM SHEET — EDITAR TRANSAÇÃO ─────────────────────────
const CATEGORIAS = {
  gasto:   ['alimentação','transporte','moradia','saúde','lazer','educação','assinatura','outros'],
  receita: ['salário','freelance','investimento','outros'],
  divida:  ['cartão','empréstimo','parcela','outros'],
};

const overlay     = document.getElementById('sheet-overlay');
const editSheet   = document.getElementById('edit-sheet');
const sheetValor  = document.getElementById('sheet-valor');
const sheetDesc   = document.getElementById('sheet-descricao');
const sheetCat    = document.getElementById('sheet-categoria');
const sheetMsg    = document.getElementById('sheet-msg');
const sheetSave   = document.getElementById('sheet-save');
const tipoPills   = document.querySelectorAll('.tipo-pill');

let sheetTxId = null;
let sheetTipo = 'gasto';

function openSheet(tx) {
  sheetTxId = tx.id;
  sheetTipo = tx.tipo;
  sheetValor.value = Number(tx.valor).toFixed(2);
  sheetDesc.value  = tx.descricao || '';
  sheetMsg.textContent = '';

  // Activate correct tipo pill
  tipoPills.forEach(p => p.classList.toggle('active', p.dataset.tipo === tx.tipo));
  updateCategoriasSelect(tx.tipo, tx.categoria);

  overlay.classList.add('open');
  setTimeout(() => editSheet.classList.add('open'), 10);
  sheetValor.focus();
}

function closeSheet() {
  editSheet.classList.remove('open');
  overlay.classList.remove('open');
  sheetTxId = null;
}

function updateCategoriasSelect(tipo, selected) {
  sheetCat.innerHTML = '';
  (CATEGORIAS[tipo] || CATEGORIAS.gasto).forEach(c => {
    const opt = new Option(c, c);
    if (c === selected) opt.selected = true;
    sheetCat.appendChild(opt);
  });
}

tipoPills.forEach(pill => {
  pill.addEventListener('click', () => {
    sheetTipo = pill.dataset.tipo;
    tipoPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    updateCategoriasSelect(sheetTipo, sheetCat.value);
  });
});

overlay.addEventListener('click', closeSheet);

// Drag handle: swipe down to close
let sheetDragY = 0;
editSheet.addEventListener('touchstart', e => { sheetDragY = e.touches[0].clientY; }, { passive: true });
editSheet.addEventListener('touchend', e => {
  if (e.changedTouches[0].clientY - sheetDragY > 60) closeSheet();
});

sheetSave.addEventListener('click', async () => {
  const valor = parseFloat(sheetValor.value);
  if (!sheetTxId || isNaN(valor) || valor <= 0) {
    sheetMsg.textContent = 'Verifique o valor.';
    return;
  }

  sheetSave.disabled = true;
  sheetMsg.textContent = '';

  try {
    const res = await fetch(`${CFG.workerUrl}/tx/${sheetTxId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo:      sheetTipo,
        valor,
        categoria: sheetCat.value,
        descricao: sheetDesc.value.trim() || sheetCat.value,
      }),
    });

    if (!res.ok) throw new Error();

    closeSheet();
    loadReport();
  } catch {
    sheetMsg.textContent = 'Erro ao salvar. Tente novamente.';
  } finally {
    sheetSave.disabled = false;
  }
});

// ─── SWIPE TO DELETE ──────────────────────────────────────────
function addSwipeToDelete(row, id) {
  const item = row.querySelector('.tx-item');
  const TRIGGER = 88;
  let startX = 0, startY = 0, dx = 0, tracking = false, decided = false, wasSwiped = false;

  item.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    tracking = true;
    decided = false;
    wasSwiped = false;
  }, { passive: true });

  item.addEventListener('touchmove', e => {
    if (!tracking) return;
    const mx = e.touches[0].clientX - startX;
    const my = e.touches[0].clientY - startY;

    // First move: if vertical dominates, let the page scroll
    if (!decided) {
      if (Math.abs(my) > Math.abs(mx)) { tracking = false; return; }
      decided = true;
    }

    if (mx >= 0) return; // only left swipe
    wasSwiped = true;
    dx = Math.max(mx, -TRIGGER);
    item.style.transition = 'none';
    item.style.transform = `translateX(${dx}px)`;
  }, { passive: true });

  item.addEventListener('touchend', () => {
    if (!tracking) return;
    tracking = false;

    if (dx <= -TRIGGER) {
      item.style.transition = 'transform 0.15s ease';
      item.style.transform = `translateX(-100%)`;
      deleteTx(id, row);
    } else {
      item.style.transition = 'transform 0.25s ease';
      item.style.transform = '';
    }
    dx = 0;
  });

  // Tap (sem swipe) → abre edição
  item.addEventListener('click', () => {
    if (wasSwiped) return;
    try {
      const tx = JSON.parse(item.dataset.tx);
      openSheet(tx);
    } catch {}
  });
}

async function deleteTx(id, row) {
  try {
    const res = await fetch(`${CFG.workerUrl}/tx/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');

    // Collapse height animation
    row.style.height = row.offsetHeight + 'px';
    row.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      row.style.transition = 'height 0.28s ease, opacity 0.28s ease';
      row.style.height = '0';
      row.style.opacity = '0';
    });
    setTimeout(() => row.remove(), 300);
  } catch {
    // Snap back on failure
    const item = row.querySelector('.tx-item');
    item.style.transition = 'transform 0.25s ease';
    item.style.transform = '';
  }
}

// ─── SERVICE WORKER ───────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}
