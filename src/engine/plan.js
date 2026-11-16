import fs from 'node:fs';
import path from 'node:path';
import { ask, extractJson } from './models.js';

const PLANNER_SYSTEM = `NYSERA_PLANNER
You are the planner of Nysera, a crew of AI agents. Split the user's task into a small graph of lanes that can run in parallel where possible.

Rules:
- 2 to 7 lanes. Each lane is one focused piece of work one agent can finish alone.
- category must be one of: CATEGORIES.
- depends_on lists lane ids whose output this lane needs. Lanes with no dependencies run first, in parallel.
- prompt is a complete instruction for that lane's agent (it will not see the other lanes' prompts).
- If the task needs code, prefer one lane per file or per clear unit, plus a "test" lane that writes tests.

Reply with JSON only, no prose:
{"summary":"one sentence","lanes":[{"id":"L1","title":"short","category":"code","depends_on":[],"prompt":"..."}]}`;

export function listProject(dir, max = 60) {
  const out = [];
  const skip = new Set(['node_modules', '.git', '.nysera', 'dist', 'build', '.venv', '__pycache__']);
  (function walk(d, depth) {
    if (depth > 2 || out.length >= max) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max || skip.has(e.name) || e.name.startsWith('.')) continue;
      const rel = path.relative(dir, path.join(d, e.name));
      out.push(e.isDirectory() ? rel + '/' : rel);
      if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
    }
  })(dir, 0);
  return out;
}

export function validatePlan(raw, categories) {
  if (!raw || !Array.isArray(raw.lanes) || raw.lanes.length === 0) throw new Error('plan has no lanes');
  const lanes = raw.lanes.slice(0, 7).map((l, i) => ({
    id: String(l.id || `L${i + 1}`),
    title: String(l.title || `Lane ${i + 1}`).slice(0, 60),
    category: categories.includes(l.category) ? l.category : 'code',
    depends_on: Array.isArray(l.depends_on) ? l.depends_on.map(String) : [],
    prompt: String(l.prompt || l.title || '')
  }));
  const ids = new Set(lanes.map((l) => l.id));
  if (ids.size !== lanes.length) throw new Error('duplicate lane ids');
  for (const l of lanes) l.depends_on = l.depends_on.filter((d) => ids.has(d) && d !== l.id);

  // Layering (Kahn). Cycles → error.
  const layerOf = {};
  const remaining = new Set(lanes.map((l) => l.id));
  let layer = 0;
  while (remaining.size) {
    const ready = lanes.filter((l) => remaining.has(l.id) && l.depends_on.every((d) => !remaining.has(d)));
    if (!ready.length) throw new Error('plan has a dependency cycle');
    for (const l of ready) { layerOf[l.id] = layer; remaining.delete(l.id); }
    layer++;
  }
  for (const l of lanes) l.layer = layerOf[l.id];
  return { summary: String(raw.summary || ''), lanes, layers: layer };
}

export async function makePlan({ apiKey, chains, task, cwd, onFallback, signal }) {
  const categories = Object.keys(chains).filter((k) => k !== 'plan' && k !== 'review');
  const files = listProject(cwd);
  const messages = [
    { role: 'system', content: PLANNER_SYSTEM.replace('CATEGORIES', categories.join(', ')) },
    { role: 'user', content: `Task:\n${task}\n\nProject files (top levels):\n${files.length ? files.join('\n') : '(empty folder)'}` }
  ];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await ask({ apiKey, chain: chains.plan.chain, effort: chains.plan.effort, messages, onFallback, signal });
    try {
      return { ...validatePlan(extractJson(res.content), categories), model: res.model };
    } catch (e) {
      lastErr = e;
      messages.push({ role: 'assistant', content: res.content }, { role: 'user', content: `That was not valid (${e.message}). Reply with the JSON object only.` });
    }
  }
  throw new Error(`planner did not return a valid plan: ${lastErr.message}`);
}
