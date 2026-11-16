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

export function loadChains() {
  const saved = readJson(CHAINS_PATH, null);
  return saved ? { ...DEFAULT_CHAINS, ...saved } : { ...DEFAULT_CHAINS };
}
export function saveChains(chains) { writeJson(CHAINS_PATH, chains); }

export function isMock() { return process.env.NYSERA_MOCK === '1'; }
