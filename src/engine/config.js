import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.NYSERA_HOME || path.join(os.homedir(), '.nysera');
export const CONFIG_PATH = path.join(HOME, 'config.json');
export const CHAINS_PATH = path.join(HOME, 'routing', 'model-chains.json');

// Work categories. Each lane gets one; the category picks the model chain + effort.
// Model IDs are OpenRouter IDs. IDs starting with `~` are OpenRouter's "latest" aliases:
// they always point at the newest model of that family, so they don't go stale.
// Pinned IDs can be retired — run `nysera doctor` to check they still exist, and `nysera model set <category> <id,id,...>` to edit.
export const DEFAULT_CHAINS = {
  plan: { chain: ['~anthropic/claude-sonnet-latest', '~openai/gpt-latest', '~google/gemini-pro-latest', 'deepseek/deepseek-chat'], effort: 'high', about: 'Break a task into lanes' },
  deep: { chain: ['~anthropic/claude-sonnet-latest', '~google/gemini-pro-latest', '~openai/gpt-latest'], effort: 'high', about: 'Hard reasoning, architecture, tricky bugs' },
  code: { chain: ['~anthropic/claude-sonnet-latest', 'deepseek/deepseek-chat', '~openai/gpt-latest'], effort: 'medium', about: 'Writing and changing code' },
  quick: { chain: ['~google/gemini-flash-latest', 'deepseek/deepseek-chat', '~openai/gpt-mini-latest'], effort: 'low', about: 'Small, simple edits' },
  research: { chain: ['~google/gemini-pro-latest', '~anthropic/claude-sonnet-latest', '~moonshotai/kimi-latest'], effort: 'high', about: 'Reading, comparing, summarising' },
  docs: { chain: ['~openai/gpt-mini-latest', '~google/gemini-flash-latest', 'deepseek/deepseek-chat'], effort: 'low', about: 'READMEs, comments, guides' },
  test: { chain: ['~anthropic/claude-sonnet-latest', 'deepseek/deepseek-chat', '~openai/gpt-latest'], effort: 'medium', about: 'Writing tests' },
  review: { chain: ['~openai/gpt-latest', '~google/gemini-pro-latest', '~anthropic/claude-sonnet-latest'], effort: 'high', about: 'Checking another lane\'s work' }
};

export const EFFORT_TOKENS = { low: 1500, medium: 3000, high: 6000 };

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

export function loadConfig() {
  const cfg = readJson(CONFIG_PATH, {});
  if (process.env.OPENROUTER_API_KEY) cfg.apiKey = process.env.OPENROUTER_API_KEY;
  return cfg;
}
export function saveConfig(cfg) { writeJson(CONFIG_PATH, cfg); }

// Model IDs Nysera used to ship as defaults. Some have since been retired on
// OpenRouter, so saved chains that still contain them are moved to the
// matching "latest" alias the next time they are loaded.
const RETIRED = {
  'anthropic/claude-sonnet-4': '~anthropic/claude-sonnet-latest',
  'openai/gpt-4o': '~openai/gpt-latest',
  'openai/gpt-4o-mini': '~openai/gpt-mini-latest',
  'google/gemini-2.5-pro': '~google/gemini-pro-latest',
  'google/gemini-2.5-flash': '~google/gemini-flash-latest',
  'moonshotai/kimi-k2': '~moonshotai/kimi-latest',
  'qwen/qwen-2.5-coder-32b-instruct': 'deepseek/deepseek-chat',
  'mistralai/mistral-small': 'deepseek/deepseek-chat'
};

export function loadChains() {
  const saved = readJson(CHAINS_PATH, null);
  if (!saved) return { ...DEFAULT_CHAINS };
  let changed = false;
  for (const v of Object.values(saved)) {
    if (!v || !Array.isArray(v.chain)) continue;
    const next = [...new Set(v.chain.map((m) => RETIRED[m] || m))];
    if (next.join() !== v.chain.join()) { v.chain = next; changed = true; }
  }
  if (changed) { try { writeJson(CHAINS_PATH, saved); } catch { /* read-only home: use in memory */ } }
  return { ...DEFAULT_CHAINS, ...saved };
}
export function saveChains(chains) { writeJson(CHAINS_PATH, chains); }

export function isMock() { return process.env.NYSERA_MOCK === '1'; }
