// Model calls through OpenRouter, with ordered fallback chains.
// "No silent downgrade": if a model fails, we move to the next one in the chain
// and record which model actually answered.
import { EFFORT_TOKENS, isMock } from './config.js';
import { mockComplete } from './mock.js';

const API = 'https://openrouter.ai/api/v1';

export class ModelError extends Error {
  constructor(message, attempts) { super(message); this.attempts = attempts; }
}

async function callOnce(apiKey, model, messages, maxTokens, signal) {
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/nysera',
      'X-Title': 'Nysera CLI'
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || text.slice(0, 200) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('empty response');
  return { content, usage: data.usage || null };
}

/**
 * Ask a category's chain. Tries each model in order until one answers.
 * onFallback(model, error) is called each time a model is skipped.
 */
export async function ask({ apiKey, chain, effort = 'medium', messages, onFallback, signal, timeoutMs = 180000 }) {
  const maxTokens = EFFORT_TOKENS[effort] || EFFORT_TOKENS.medium;
  const attempts = [];
  for (const model of chain) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
      const out = isMock()
        ? await mockComplete(model, messages)
        : await callOnce(apiKey, model, messages, maxTokens, ctrl.signal);
      clearTimeout(t);
      attempts.push({ model, ok: true });
      return { ...out, model, attempts };
    } catch (e) {
      clearTimeout(t);
      if (signal && signal.aborted) throw new ModelError('stopped by user', attempts);
      const reason = e.name === 'AbortError' ? 'timeout' : e.message;
      attempts.push({ model, ok: false, reason });
      if (onFallback) onFallback(model, reason);
      if (e.status === 401) throw new ModelError('OpenRouter rejected the API key (401). Run `nysera setup`.', attempts);
    }
  }
  throw new ModelError(`every model in the chain failed: ${attempts.map((a) => `${a.model} (${a.reason})`).join('; ')}`, attempts);
}

export async function listModels(apiKey) {
  if (isMock()) return null;
  const res = await fetch(`${API}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return new Set((data.data || []).map((m) => m.id));
}

export async function checkKey(apiKey) {
  if (isMock()) return { ok: true, label: 'mock' };
  const res = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return { ok: false, status: res.status };
  const data = await res.json().catch(() => ({}));
  return { ok: true, info: data.data || {} };
}

/** Pull the first JSON object/array out of a model reply. */
export function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in reply');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in reply');
}
