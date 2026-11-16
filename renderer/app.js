/* Nysera Desktop — renderer. Talks to the main process only through window.nysera. */
(() => {
  const api = window.nysera;
  const $ = (id) => document.getElementById(id);

  const BOTS = [
    { id: 'nysera', name: 'Nysera', role: 'Lead coding agent', grad: 'linear-gradient(135deg,#c58cff,#ff7ac2)',
      system: 'You are Nysera, the lead coding agent in the Nysera Desktop app. You plan work, review and write code, and explain clearly. Be concrete and concise, like a sharp senior engineer in a chat app. Use fenced code blocks for code. Answer in the language the user writes in.',
      hello: 'Hi, I\'m Nysera. Ask me to plan, write or review code — or use Run lanes to let the whole crew work on a folder.',
      sugs: ['Plan a REST API for a todo app', 'Review this function for bugs', 'Explain async/await simply'] },
    { id: 'aria', name: 'Aria', role: 'Research', grad: 'linear-gradient(135deg,#8fb0ff,#c58cff)',
      system: 'You are Aria, the research agent in the Nysera Desktop app. You compare options, summarise documentation and explain trade-offs. Structure answers clearly, note uncertainty, and say what should be double-checked. Keep it chat-length. Answer in the language the user writes in.',
      hello: 'Aria here. I compare tools, read docs and weigh trade-offs so the crew builds on facts.',
      sugs: ['Compare Vite vs Next.js for a landing page', 'What is OpenRouter?', 'Pros and cons of SQLite in production'] },
    { id: 'juno', name: 'Juno', role: 'Ops & deploys', grad: 'linear-gradient(135deg,#f2a65a,#ff7ac2)',
      system: 'You are Juno, the ops agent in the Nysera Desktop app. You help with builds, deploys, CI, hosting, Docker, DNS and incidents. Give practical step-by-step answers and exact commands. You cannot run anything yourself; you guide the user. Answer in the language the user writes in.',
      hello: 'Juno, ops. Deploys, CI, DNS, Docker — tell me what you are shipping and where.',
      sugs: ['Deploy a static site to Vercel', 'Write a GitHub Actions CI for Node', 'Point my domain to Vercel'] }
  ];
  const MODELS = [
    ['~google/gemini-flash-latest', 'Gemini Flash (latest) · fast'],
    ['~anthropic/claude-sonnet-latest', 'Claude Sonnet (latest)'],
    ['~openai/gpt-latest', 'GPT (latest)'],
    ['~openai/gpt-mini-latest', 'GPT mini (latest) · cheap'],
    ['~google/gemini-pro-latest', 'Gemini Pro (latest)'],
    ['deepseek/deepseek-chat', 'DeepSeek Chat'],
    ['~moonshotai/kimi-latest', 'Kimi (latest)']
  ];

  let settings = {};
  let chats = {};      // botId -> [{who, text, err}]
  let models = {};     // botId -> model id
  let view = 'chat';
  let bot = 'nysera';
  let streaming = null; // {id, botId}
  let runDir = '';
  let running = false;
  let lastRun = null;

  // ---------- helpers ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  // Text with ``` fences → text nodes + <pre>; never uses innerHTML.
  function renderText(node, text) {
    node.textContent = '';
    const parts = String(text).split(/```[a-zA-Z0-9_+-]*\n?/);
    parts.forEach((p, i) => { if (!p) return; node.append(i % 2 ? el('pre', null, p.replace(/\n$/, '')) : document.createTextNode(p)); });
  }
  const saveChats = () => api.chats.save({ chats, models });

  // ---------- navigation ----------
  function show(v, botId) {
    view = v; if (botId) bot = botId;
    $('view-chat').hidden = v !== 'chat';
    $('view-run').hidden = v !== 'run';
    $('view-settings').hidden = v !== 'settings';
    document.querySelectorAll('.item').forEach((b) => b.classList.toggle('active', (v === 'chat' && b.dataset.bot === bot) || (v !== 'chat' && b.dataset.view === v)));
    if (v === 'chat') renderChat(); else renderBots();
    if (v === 'settings') renderSettings();
  }
  function renderBots() {
    const nav = $('bots'); nav.textContent = '';
    for (const b of BOTS) {
      const list = chats[b.id] || [];
      const last = list.length ? list[list.length - 1].text.replace(/\s+/g, ' ').slice(0, 40) : b.role;
      const busy = streaming && streaming.botId === b.id;
      nav.append(el('button', { class: 'item' + (view === 'chat' && bot === b.id ? ' active' : ''), 'data-bot': b.id, onclick: () => show('chat', b.id) },
        el('span', { class: 'ico', style: `background:${b.grad}` }),
        el('span', { class: 'meta' }, el('span', { class: 'name' }, b.name), el('span', { class: 'sub' }, busy ? 'typing…' : last))));
    }
  }

  // ---------- chat ----------
  function renderChat() {
    const b = BOTS.find((x) => x.id === bot);
    $('chat-avatar').style.background = b.grad;
    $('chat-name').textContent = b.name;
    $('chat-role').textContent = b.role;
    $('input').placeholder = `Message ${b.name}…`;
    const sel = $('chat-model'); sel.textContent = '';
    const cur = models[bot] || settings.chatModel;
    const opts = MODELS.some(([id]) => id === cur) ? MODELS : [[cur, cur], ...MODELS];
    for (const [id, label] of opts) sel.append(el('option', { value: id, selected: id === cur ? 'selected' : null }, label));
    $('key-banner').hidden = settings.hasKey;
    const box = $('msgs'); box.textContent = '';
    const list = chats[bot] || [];
    if (!list.length) {
      box.append(el('div', { class: 'empty' },
        el('img', { src: 'assets/nysera-mascot.png', alt: '' }),
        el('div', { class: 't' }, b.name), el('div', null, b.hello),
        el('div', { class: 'sugs' }, b.sugs.map((s) => el('button', { onclick: () => sendMsg(s) }, s)))));
    } else {
      for (const m of list) {
        const n = el('div', { class: `msg ${m.who}${m.err ? ' err' : ''}` });
        renderText(n, m.text || (m.who === 'bot' ? '…' : ''));
        box.append(n);
      }
      box.scrollTop = box.scrollHeight;
    }
    updateSend();
    renderBots();
  }
  function updateSend() {
    const busy = streaming && streaming.botId === bot;
    const s = $('send');
    s.textContent = busy ? '■' : '↑';
    s.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    s.classList.toggle('on', !!busy || !!$('input').value.trim());
  }
  async function sendMsg(text) {
    const q = (text || '').trim();
    if (!q || streaming) return;
    const b = BOTS.find((x) => x.id === bot);
    const botId = bot;
    const list = (chats[botId] = chats[botId] || []);
    const history = list.filter((m) => !m.err).slice(-16).map((m) => ({ role: m.who === 'you' ? 'user' : 'assistant', content: m.text }));
    list.push({ who: 'you', text: q }, { who: 'bot', text: '' });
    $('input').value = '';
    const id = Math.random().toString(36).slice(2);
    streaming = { id, botId };
    renderChat();
    const res = await api.chat.send({ id, model: models[botId] || settings.chatModel, messages: [{ role: 'system', content: b.system }, ...history, { role: 'user', content: q }] });
    const lastMsg = list[list.length - 1];
    if (!res.ok) { lastMsg.text = res.error || 'Something went wrong.'; lastMsg.err = true; }
    else if (!lastMsg.text) lastMsg.text = res.stopped ? 'Stopped.' : '…';
    streaming = null;
    if (list.length > 100) list.splice(0, list.length - 100);
    saveChats();
    if (view === 'chat') renderChat(); else renderBots();
  }
  api.chat.onDelta(({ id, delta }) => {
    if (!streaming || streaming.id !== id) return;
    const list = chats[streaming.botId];
    list[list.length - 1].text += delta;
    if (view === 'chat' && bot === streaming.botId) {
      const box = $('msgs');
      const last = box.lastElementChild;
      if (last) { renderText(last, list[list.length - 1].text); box.scrollTop = box.scrollHeight; }
    }
  });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); if (streaming && streaming.botId === bot) api.chat.stop(streaming.id); else sendMsg($('input').value); });
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); } });
  $('input').addEventListener('input', () => { const t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(200, t.scrollHeight) + 'px'; updateSend(); });
  $('chat-model').addEventListener('change', (e) => { models[bot] = e.target.value; saveChats(); });
  $('chat-clear').addEventListener('click', () => { if (streaming && streaming.botId === bot) api.chat.stop(streaming.id); chats[bot] = []; saveChats(); renderChat(); });
  $('banner-settings').addEventListener('click', () => show('settings'));

  // ---------- run ----------
  function setDir(d) { runDir = d || ''; $('dir').textContent = runDir || 'No folder chosen'; $('dir').title = runDir; }
  $('pick').addEventListener('click', async () => { const d = await api.run.pickDir(); if (d) setDir(d); });
  function renderLanes(lanes) {
    $('board').hidden = false;
    const box = $('lanes'); box.textContent = '';
    const v = lanes.filter((l) => l.status === 'verified').length;
    $('board-count').textContent = `${v}/${lanes.length} verified`;
    for (const l of lanes) {
      box.append(el('div', { class: 'lane' },
        el('span', { style: 'color:#6f6880' }, l.id),
        el('span', { class: 't', title: l.title }, l.title),
        el('span', { class: 'cat', style: 'color:#a59fb5' }, l.category),
        el('span', { class: 'm', title: l.model || '' }, l.model || '—'),
        el('span', { class: `st ${l.status}` }, l.status === 'running' ? el('span', { class: 'running-dot' }) : null, l.status),
        l.evidence ? el('span', { class: 'ev' }, l.evidence) : null));
    }
  }
  api.run.onLanes((lanes) => renderLanes(lanes));
  api.run.onEvent((ev) => {
    $('log-card').hidden = false;
    const log = $('log');
    log.append(el('div', null, el('span', { class: 'time' }, ev.time), ev.text));
    log.scrollTop = log.scrollHeight;
    $('run-sub').textContent = ev.text.slice(0, 40);
  });
  function setRunning(on) {
    running = on;
    const b = $('run-btn');
    b.textContent = on ? 'Stop' : 'Start run';
    b.classList.toggle('stop', on);
    $('run-hint').textContent = on ? 'Running… you can switch to a chat meanwhile.' : '';
    if (!on) $('run-sub').textContent = lastRun ? lastRun : 'plan → lanes → verify';
  }
  $('run-btn').addEventListener('click', async () => {
    if (running) { api.run.stop(); $('run-hint').textContent = 'Stopping…'; return; }
    const task = $('task').value.trim();
    if (!runDir) { $('run-hint').textContent = 'Choose a project folder first.'; return; }
    if (!task) { $('run-hint').textContent = 'Describe the task first.'; return; }
    $('log').textContent = ''; $('lanes').textContent = ''; $('summary').hidden = true; $('board').hidden = true;
    setRunning(true);
    const res = await api.run.start({ task, dir: runDir, write: $('opt-write').checked, review: $('opt-review').checked, test: $('opt-test').value.trim() || null });
    const sum = $('summary'); sum.textContent = ''; sum.hidden = false;
    if (!res.ok) {
      lastRun = 'last run: ' + res.error.slice(0, 30);
      sum.append(el('div', { class: 'hint bad' }, res.error));
    } else {
      const r = res.result;
      renderLanes(r.lanes);
      const v = r.lanes.filter((l) => l.status === 'verified').length;
      lastRun = `last run: ${v}/${r.lanes.length} verified`;
      sum.append(el('div', { class: 'sum' },
        el('strong', null, `${v}/${r.lanes.length} lanes verified`),
        el('span', { class: 'hint' }, r.files.length ? `${r.files.length} file(s) ${$('opt-write').checked ? 'written to the project' : 'saved in the run folder'}` : 'no files'),
        r.test ? el('span', { class: r.test.code === 0 ? 'hint ok' : 'hint bad' }, `test exit ${r.test.code}`) : null,
        el('div', { class: 'grow' }),
        el('button', { class: 'pill', onclick: () => api.open.path(r.runDir) }, 'Open run folder')));
    }
    setRunning(false);
  });

  // ---------- settings ----------
  async function renderSettings() {
    $('key-status').textContent = settings.hasKey ? `Saved: ${settings.keyHint}` : 'No key saved.';
    $('key-status').className = 'hint';
    const sel = $('default-model'); sel.textContent = '';
    for (const [id, label] of MODELS) sel.append(el('option', { value: id, selected: id === settings.chatModel ? 'selected' : null }, label));
    const chains = await api.run.chains();
    const box = $('chains'); box.textContent = '';
    for (const [k, v] of Object.entries(chains)) box.append(el('div', { class: 'c' }, el('span', { class: 'k' }, k), el('span', { class: 'e' }, v.effort), el('span', null, v.chain.join(' → '))));
  }
  function refreshSide() {
    $('key-sub').textContent = settings.hasKey ? 'OpenRouter connected' : 'add your API key';
    $('ver').textContent = `v${settings.version || ''}`;
  }
  $('key-save').addEventListener('click', async () => {
    const k = $('key').value.trim();
    if (!k) { $('key-status').textContent = 'Paste a key first.'; return; }
    $('key-status').textContent = 'Checking…';
    const t = await api.settings.testKey(k);
    if (!t.ok) { $('key-status').textContent = t.message; $('key-status').className = 'hint bad'; return; }
    settings = await api.settings.set({ apiKey: k });
    $('key').value = '';
    refreshSide(); renderSettings();
    $('key-status').textContent = `Saved and working: ${settings.keyHint}`; $('key-status').className = 'hint ok';
  });
  $('key-test').addEventListener('click', async () => {
    $('key-status').textContent = 'Checking…';
    const t = await api.settings.testKey($('key').value.trim() || null);
    $('key-status').textContent = t.message; $('key-status').className = t.ok ? 'hint ok' : 'hint bad';
  });
  $('default-model').addEventListener('change', async (e) => { settings = await api.settings.set({ chatModel: e.target.value }); });

  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

  // ---------- boot ----------
  (async () => {
    settings = await api.settings.get();
    const saved = await api.chats.load();
    chats = saved.chats || {}; models = saved.models || {};
    setDir(settings.lastDir);
    refreshSide();
    show(settings.hasKey ? 'chat' : 'settings', 'nysera');
  })();
})();
