import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.NYSERA_HOME || path.join(os.homedir(), '.nysera');
export const CONFIG_PATH = path.join(HOME, 'config.json');
export const CHAINS_PATH = path.join(HOME, 'routing', 'model-chains.json');

// Work categories. Each lane gets one; the category picks the model chain + effort.
// Model IDs are OpenRouter IDs. They change over time — run `nysera doctor` to check
// they still exist, and `nysera model set <category> <id,id,...>` to edit.
export const DEFAULT_CHAINS = {
  plan: { chain: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.5-pro'], effort: 'high', about: 'Break a task into lanes' },
  deep: { chain: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'openai/gpt-4o'], effort: 'high', about: 'Hard reasoning, architecture, tricky bugs' },
  code: { chain: ['anthropic/claude-sonnet-4', 'deepseek/deepseek-chat', 'qwen/qwen-2.5-coder-32b-instruct'], effort: 'medium', about: 'Writing and changing code' },
  quick: { chain: ['google/gemini-2.5-flash', 'deepseek/deepseek-chat', 'openai/gpt-4o-mini'], effort: 'low', about: 'Small, simple edits' },
  research: { chain: ['google/gemini-2.5-pro', 'anthropic/claude-sonnet-4', 'moonshotai/kimi-k2'], effort: 'high', about: 'Reading, comparing, summarising' },
  docs: { chain: ['openai/gpt-4o', 'google/gemini-2.5-flash', 'mistralai/mistral-small'], effort: 'low', about: 'READMEs, comments, guides' },
  test: { chain: ['anthropic/claude-sonnet-4', 'deepseek/deepseek-chat', 'openai/gpt-4o'], effort: 'medium', about: 'Writing tests' },
  review: { chain: ['openai/gpt-4o', 'google/gemini-2.5-pro', 'anthropic/claude-sonnet-4'], effort: 'high', about: 'Checking another lane\'s work' }
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
