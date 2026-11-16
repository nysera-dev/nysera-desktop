// Nysera Desktop — Electron main process.
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig as loadCliConfig, loadChains } from './engine/config.js';
import { checkKey } from './engine/models.js';
import { run as runLanes } from './engine/run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPENROUTER = 'https://openrouter.ai/api/v1';
let win = null;

// ---------- settings (key encrypted with the OS keychain when available) ----------
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const chatsPath = () => path.join(app.getPath('userData'), 'chats.json');

function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2), { mode: 0o600 }); }

function loadSettings() {
  const s = readJson(settingsPath(), {});
  let apiKey = '';
  if (s.keyEnc && safeStorage.isEncryptionAvailable()) {
    try { apiKey = safeStorage.decryptString(Buffer.from(s.keyEnc, 'base64')); } catch { apiKey = ''; }
  } else if (s.keyPlain) apiKey = s.keyPlain;
  if (!apiKey) apiKey = loadCliConfig().apiKey || ''; // reuse `nysera setup` key if present
  return { apiKey, chatModel: (s.chatModel && !/gemini-2\.5|claude-sonnet-4$|gpt-4o|qwen-2\.5|mistral-small|kimi-k2$/.test(s.chatModel) ? s.chatModel : '~google/gemini-flash-latest'), demo: !!s.demo, lastDir: s.lastDir || '' };
}
function saveSettings(patch) {
  const cur = readJson(settingsPath(), {});
  const next = { ...cur };
  if ('apiKey' in patch) {
    delete next.keyEnc; delete next.keyPlain;
    if (patch.apiKey) {
      if (safeStorage.isEncryptionAvailable()) next.keyEnc = safeStorage.encryptString(patch.apiKey).toString('base64');
      else next.keyPlain = patch.apiKey;
    }
  }
  for (const k of ['chatModel', 'demo', 'lastDir']) if (k in patch) next[k] = patch[k];
  writeJson(settingsPath(), next);
  applyDemo();
}
function applyDemo() { if (loadSettings().demo) process.env.NYSERA_MOCK = '1'; else delete process.env.NYSERA_MOCK; }
const publicSettings = () => { const s = loadSettings(); return { hasKey: !!s.apiKey, keyHint: s.apiKey ? s.apiKey.slice(0, 8) + '…' + s.apiKey.slice(-4) : '', chatModel: s.chatModel, demo: s.demo, lastDir: s.lastDir, platform: process.platform, version: app.getVersion() }; };

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#0c0a12',
    title: 'Nysera',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: path.join(here, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(here, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}

app.whenReady().then(() => { applyDemo(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// ---------- settings IPC ----------
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, patch) => { saveSettings(patch || {}); return publicSettings(); });
ipcMain.handle('settings:testKey', async (_e, key) => {
  const k = key || loadSettings().apiKey;
  if (!k) return { ok: false, message: 'No key yet.' };
  try {
    const r = await checkKey(k);
    return r.ok ? { ok: true, message: 'Key works.' } : { ok: false, message: `OpenRouter rejected the key (${r.status}).` };
  } catch (e) { return { ok: false, message: 'Could not reach OpenRouter: ' + e.message }; }
});
ipcMain.handle('chats:load', () => readJson(chatsPath(), {}));
ipcMain.handle('chats:save', (_e, data) => { writeJson(chatsPath(), data || {}); return true; });
ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('open:path', (_e, p) => { if (p && fs.existsSync(p)) shell.openPath(p); });

// ---------- chat (streams deltas) ----------
const chats = new Map();
ipcMain.handle('chat:send', async (_e, { id, messages, model }) => {
  const { apiKey, demo } = loadSettings();
  const ctrl = new AbortController();
  chats.set(id, ctrl);
  try {
    if (demo || !apiKey) {
      const text = demo
        ? 'Demo mode: this reply is canned. Add your OpenRouter key in Settings and turn demo mode off for real answers.'
        : 'Add your OpenRouter API key in Settings first (openrouter.ai → Keys).';
      for (const w of text.split(' ')) { if (ctrl.signal.aborted) break; send('chat:delta', { id, delta: w + ' ' }); await new Promise((r) => setTimeout(r, 25)); }
      return { ok: true, model: 'demo' };
    }
    const res = await fetch(`${OPENROUTER}/chat/completions`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://nysera.app', 'X-Title': 'Nysera Desktop' },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.5 })
    });
    if (!res.ok || !res.body) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch {}
      if (res.status === 401) msg = 'OpenRouter rejected your key. Check it in Settings.';
      if (res.status === 402) msg = 'Your OpenRouter credit has run out.';
      return { ok: false, error: msg };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return { ok: true, model };
        try { const j = JSON.parse(data); const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (d) send('chat:delta', { id, delta: d }); } catch {}
      }
    }
    return { ok: true, model };
  } catch (e) {
    if (ctrl.signal.aborted) return { ok: true, stopped: true };
    return { ok: false, error: 'Could not reach OpenRouter: ' + e.message };
  } finally { chats.delete(id); }
});
ipcMain.handle('chat:stop', (_e, id) => { const c = chats.get(id); if (c) c.abort(); });

// ---------- run (nysera engine) ----------
let current = null;
ipcMain.handle('dir:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Choose a project folder' });
  if (r.canceled || !r.filePaths[0]) return null;
  saveSettings({ lastDir: r.filePaths[0] });
  return r.filePaths[0];
});
ipcMain.handle('run:start', async (_e, opts) => {
  if (current) return { ok: false, error: 'A run is already in progress.' };
  const { apiKey, demo } = loadSettings();
  if (!apiKey && !demo) return { ok: false, error: 'Add your OpenRouter key in Settings, or turn on demo mode.' };
  if (!opts || !opts.task || !opts.dir) return { ok: false, error: 'Pick a folder and describe the task.' };
  if (!fs.existsSync(opts.dir)) return { ok: false, error: 'That folder does not exist.' };
  const ctrl = new AbortController();
  current = ctrl;
  try {
    const result = await runLanes({
      apiKey, chains: loadChains(), task: opts.task, cwd: opts.dir,
      write: !!opts.write, testCmd: opts.test ? String(opts.test) : null, review: opts.review !== false,
      concurrency: 4, tui: false, signal: ctrl.signal,
      hooks: { event: (ev) => send('run:event', ev), lanes: (lanes) => send('run:lanes', lanes) }
    });
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { current = null; }
});
ipcMain.handle('run:stop', () => { if (current) current.abort(); });
ipcMain.handle('run:chains', () => loadChains());
