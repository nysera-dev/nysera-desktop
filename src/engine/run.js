import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ask, extractJson } from './models.js';
import { makePlan, listProject } from './plan.js';
import { c, STATUS, bar, pad, banner, log, fit, termCols } from './ui.js';

const WORKER_SYSTEM = `You are one agent in Nysera's crew, working on a single lane of a bigger task.
Do only your lane. Be concrete and complete.
When you create or change a file, output it in full in exactly this form:

### FILE: relative/path.ext
\`\`\`lang
...entire file content...
\`\`\`

Paths are relative to the project root. Never use absolute paths or "..".
After the files, add 1-3 short lines on what you did.`;

const REVIEW_SYSTEM = `NYSERA_REVIEWER
You check another agent's lane output. Decide if it fully and correctly does what the lane asked.
Be strict: missing pieces, obvious bugs, or placeholders mean fail.
Reply with JSON only: {"pass": true|false, "notes": "one or two sentences"}`;

const now = () => new Date().toISOString().slice(11, 19);

// Pull "### FILE: path" + fenced block pairs out of a model reply.
// Models format this a little differently (bold, backticks round the path, a
// blank line before the fence, ~~~ fences…), so the parser is forgiving.
export function extractFiles(text) {
  const files = [];
  const seen = new Set();
  const add = (p, content) => {
    p = String(p).trim().replace(/^[`'"*]+|[`'"*:]+$/g, '').trim();
    if (!p || /\s/.test(p) || seen.has(p)) return;
    seen.add(p); files.push({ path: p, content: content.endsWith('\n') ? content : content + '\n' });
  };
  const re = /^[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?[ \t]*FILE[ \t]*:?[ \t]*(?:\*\*)?[ \t]*([^\n]+?)[ \t]*(?:\*\*)?[ \t]*\n(?:[ \t]*\n)*[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?[ \t]*\2[ \t]*(?:\n|$)/gim;
  let m;
  while ((m = re.exec(text))) add(m[1], m[3]);
  if (files.length) return files;
  // Fallback: a fence whose info string names a file — ```python hello.py / ```hello.py / ```py title="hello.py"
  const re2 = /^[ \t]*(`{3,}|~{3,})[ \t]*(?:[\w+-]+[ \t]+)?(?:title=|file=|path=)?["']?([\w./-]+\.[\w]+)["']?[ \t]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*(?:\n|$)/gim;
  while ((m = re2.exec(text))) add(m[2], m[3]);
  return files;
}

// Categories whose lanes are expected to hand back at least one file.
const FILE_CATEGORIES = new Set(['code', 'test', 'docs', 'quick']);

// Current contents of the project's small text files, so lanes can edit them.
function projectContext(cwd, laneText) {
  const list = listProject(cwd, 80).filter((f) => !f.endsWith('/'));
  if (!list.length) return '';
  const mentioned = list.filter((f) => laneText.includes(path.basename(f)));
  const order = [...mentioned, ...list.filter((f) => !mentioned.includes(f))];
  let budget = 40000;
  const parts = [];
  for (const rel of order) {
    let st; try { st = fs.statSync(path.join(cwd, rel)); } catch { continue; }
    if (st.size > 20000 || st.size > budget) continue;
    let body; try { body = fs.readFileSync(path.join(cwd, rel), 'utf8'); } catch { continue; }
    if (body.includes('\u0000')) continue;
    parts.push(`### ${rel}\n\`\`\`\n${body}\n\`\`\``);
    budget -= body.length;
  }
  return `Project files: ${list.join(', ')}` + (parts.length ? `\n\nCurrent contents (when you change a file, output the whole new file):\n${parts.join('\n\n')}` : '');
}

function safeJoin(root, rel) {
  if (path.isAbsolute(rel)) return null;
  const full = path.resolve(root, rel);
  return full.startsWith(path.resolve(root) + path.sep) ? full : null;
}

function runCommand(cmd, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.on('error', (e) => resolve({ code: 1, out: String(e) }));
  });
}

const plain = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');

class Board {
  constructor(tui, hooks) { this.tui = tui; this.hooks = hooks || {}; this.lines = 0; this.events = []; this.lanes = []; this.header = ''; }
  event(msg) {
    this.events.push(`${c.gray(now())} ${msg}`);
    if (this.events.length > 6) this.events.shift();
    if (this.hooks.event) this.hooks.event({ time: now(), text: plain(msg) });
    else if (!this.tui) console.log(`${c.gray(now())} ${msg}`);
    this.draw();
  }
  snapshot() {
    return this.lanes.map((l) => ({ id: l.id, title: l.title, category: l.category, status: l.status, model: l.model, evidence: l.evidence, layer: l.layer, files: (l.files || []).map((f) => f.path) }));
  }
  draw() {
    if (this.hooks.lanes) this.hooks.lanes(this.snapshot());
    if (!this.tui) return;
    const cols = termCols();
    const rows = [this.header, ''];
    for (const l of this.lanes) {
      const st = STATUS[l.status];
      const pct = l.status === 'planned' ? 0 : l.status === 'running' ? Math.min(90, l.tick * 7) : 100;
      if (cols >= 110) {
        rows.push(`  ${c.gray(pad(l.id, 4))}${pad(l.title, 30)} ${c.gray(pad(l.category, 9))}${bar(pct)}  ${st.color(pad(st.label, 9))}${c.gray(pad(l.model || '', 30))}`);
      } else {
        // narrow terminal (phone): id · title · short bar · status — model goes in the events
        const bw = cols >= 70 ? 10 : 6;
        const tw = Math.max(8, cols - (2 + 4 + 1 + bw + 2 + 9) - 1);
        rows.push(`  ${c.gray(pad(l.id, 4))}${pad(l.title, tw)} ${bar(pct, bw)}  ${st.color(st.label)}`);
      }
    }
    rows.push('', c.gray('  events'), ...this.events.map((e) => '  ' + e));
    if (this.lines) process.stdout.write(`\x1b[${this.lines}A\x1b[0J`);
    process.stdout.write(rows.map((r) => fit(r, cols)).join('\n') + '\n');
    this.lines = rows.length;
  }
}

export async function run({ apiKey, chains, task, cwd, write, testCmd, review, concurrency, tui, hooks, signal }) {
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(cwd, '.nysera', 'runs', id);
  fs.mkdirSync(path.join(runDir, 'lanes'), { recursive: true });
  const board = new Board(tui, hooks);
  const stopped = () => signal && signal.aborted;
  board.header = `${banner()}  ${c.gray('· dag-crew ·')} ${c.bold(task.length > 60 ? task.slice(0, 59) + '…' : task)}`;
  console.log('');

  // 1. Plan
  board.event(`${c.purple('plan')} asking ${chains.plan.chain[0]}…`);
  const plan = await makePlan({ apiKey, chains, task, cwd, signal, onFallback: (m, r) => board.event(`${c.orange('fallback')} ${m} → next (${r})`) });
  board.event(`${c.purple('plan')} ${plan.lanes.length} lanes · ${plan.layers} layers · by ${plan.model}`);
  const lanes = plan.lanes.map((l) => ({ ...l, status: 'planned', tick: 0, output: '', files: [], model: '', evidence: '' }));
  board.lanes = lanes;
  const byId = Object.fromEntries(lanes.map((l) => [l.id, l]));
  const spin = tui ? setInterval(() => { for (const l of lanes) if (l.status === 'running') l.tick++; board.draw(); }, 400) : null;

  // 2. Execute layer by layer, lanes inside a layer in parallel (capped).
  try {
    for (let layer = 0; layer < plan.layers; layer++) {
      const queue = lanes.filter((l) => l.layer === layer);
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
          const lane = queue.shift();
          if (stopped()) { lane.status = 'skipped'; lane.evidence = 'stopped by user'; board.draw(); continue; }
          if (lane.depends_on.some((d) => byId[d].status === 'failed' || byId[d].status === 'skipped')) {
            lane.status = 'skipped';
            board.event(`${lane.id} ${c.gray('skipped')} (a dependency failed)`);
            continue;
          }
          lane.status = 'running';
          board.event(`${lane.id} ${c.blue('running')} · ${lane.category}`);
          const deps = lane.depends_on.map((d) => `--- Output of ${d} (${byId[d].title}) ---\n${byId[d].output.slice(0, 12000)}`).join('\n\n');
          const cfg = chains[lane.category] || chains.code;
          try {
            const ctx = write ? projectContext(cwd, `${lane.title} ${lane.prompt}`) : '';
            const messages = [
              { role: 'system', content: WORKER_SYSTEM },
              { role: 'user', content: `Overall task: ${task}\nPlan: ${plan.summary}\n\nYour lane (${lane.id} · ${lane.title}):\n${lane.prompt}${deps ? `\n\nInputs from earlier lanes:\n${deps}` : ''}${ctx ? `\n\n${ctx}` : ''}` }
            ];
            const onFallback = (m, r) => board.event(`${lane.id} ${c.orange('fallback')} ${m} → next (${r})`);
            let res = await ask({ apiKey, chain: cfg.chain, effort: cfg.effort, signal, messages, onFallback });
            let files = extractFiles(res.content);
            const wantsFiles = FILE_CATEGORIES.has(lane.category);
            if (wantsFiles && !files.length && !stopped()) {
              // One nudge: same lane, ask for the files in the required format.
              board.event(`${lane.id} ${c.orange('retry')} no file in the reply — asking again`);
              const again = await ask({ apiKey, chain: [res.model, ...cfg.chain.filter((m) => m !== res.model)], effort: cfg.effort, signal, onFallback,
                messages: [...messages, { role: 'assistant', content: res.content }, { role: 'user', content: 'You did not output any file. Output every file this lane creates or changes now, in full, each as a line "### FILE: relative/path.ext" followed by a fenced code block. No other text.' }] });
              const f2 = extractFiles(again.content);
              if (f2.length) { res = { ...again, content: `${res.content}\n\n${again.content}` }; files = f2; }
            }
            lane.output = res.content;
            lane.model = res.model;
            lane.files = files;
            fs.writeFileSync(path.join(runDir, 'lanes', `${lane.id}.md`), `# ${lane.id} · ${lane.title}\n\nmodel: ${res.model}\n\n${res.content}\n`);
            if (wantsFiles && !files.length) {
              lane.status = 'failed';
              lane.evidence = 'no file in the model output';
              board.event(`${lane.id} ${c.red('failed')} · no file in the output (see .nysera/runs/${id}/lanes/${lane.id}.md)`);
              continue;
            }
            lane.status = 'reported';
            board.event(`${lane.id} ${c.yellow('reported done')} · ${lane.files.length} file(s) · ${res.model}`);
          } catch (e) {
            lane.status = stopped() ? 'skipped' : 'failed';
            lane.evidence = stopped() ? 'stopped by user' : e.message;
            board.event(`${lane.id} ${c.red('failed')} · ${e.message}`);
          }
        }
      });
      await Promise.all(workers);
    }

    // 3. Collect files.
    const allFiles = [];
    for (const l of lanes) for (const f of l.files) allFiles.push({ ...f, lane: l.id });
    const outRoot = path.join(runDir, 'files');
    for (const f of allFiles) {
      const dest = safeJoin(outRoot, f.path);
      if (!dest) { board.event(`${c.red('blocked')} unsafe path ${f.path}`); continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.content);
    }
    if (write && allFiles.length) {
      const backup = path.join(runDir, 'backup');
      for (const f of allFiles) {
        const dest = safeJoin(cwd, f.path);
        if (!dest) continue;
        if (fs.existsSync(dest)) {
          const b = path.join(backup, f.path);
          fs.mkdirSync(path.dirname(b), { recursive: true });
          fs.copyFileSync(dest, b);
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content);
      }
      board.event(`${c.purple('write')} ${allFiles.length} file(s) into the project (originals backed up)`);
    }

    if (stopped()) throw new Error('stopped by user');
    // 4. Verify. Only a passed check turns "reported" into "verified".
    const reported = lanes.filter((l) => l.status === 'reported');
    let test = null;
    if (testCmd) {
      const where = write ? cwd : outRoot;
      board.event(`${c.purple('test')} running \`${testCmd}\` in ${write ? 'project' : 'run files'}…`);
      test = await runCommand(testCmd, where);
      fs.writeFileSync(path.join(runDir, 'test-output.txt'), test.out);
      if (test.code === 0) {
        for (const l of reported) { l.status = 'verified'; l.evidence = `test passed: ${testCmd}`; }
        board.event(`${c.green('test passed')} → ${reported.length} lane(s) verified`);
      } else {
        board.event(`${c.red('test failed')} (exit ${test.code}) → lanes stay "reported"`);
      }
    }
    if (test && test.code !== 0) {
      for (const l of reported) l.evidence = `test failed: ${testCmd} (exit ${test.code})`;
    }
    // A failed test outranks any review: only review when no test was given.
    if (review && !testCmd) {
      const pending = lanes.filter((l) => l.status === 'reported');
      await Promise.all(pending.map(async (l) => {
        try {
          const res = await ask({
            apiKey, chain: chains.review.chain, effort: chains.review.effort,
            messages: [
              { role: 'system', content: REVIEW_SYSTEM },
              { role: 'user', content: `Lane goal (${l.id} · ${l.title}):\n${l.prompt}\n\nLane output:\n${l.output.slice(0, 20000)}` }
            ]
          });
          const verdict = extractJson(res.content);
          if (verdict.pass === true) { l.status = 'verified'; l.evidence = `review passed (${res.model}): ${verdict.notes || ''}`; board.event(`${l.id} ${c.green('verified')} by review · ${res.model}`); }
          else { l.evidence = `review failed (${res.model}): ${verdict.notes || ''}`; board.event(`${l.id} ${c.yellow('review flagged')} · ${verdict.notes || ''}`); }
        } catch (e) {
          l.evidence = `review error: ${e.message}`;
          board.event(`${l.id} ${c.gray('review unavailable')} · stays reported`);
        }
      }));
    }

    // 5. Report.
    if (spin) clearInterval(spin);
    board.draw();
    const counts = {};
    for (const l of lanes) counts[l.status] = (counts[l.status] || 0) + 1;
    const summary = [
      `# Nysera run ${id}`, '', `**Task:** ${task}`, '', `**Plan:** ${plan.summary} (by ${plan.model})`, '',
      '| Lane | Title | Category | Model | Status | Evidence |', '|---|---|---|---|---|---|',
      ...lanes.map((l) => `| ${l.id} | ${l.title} | ${l.category} | ${l.model || '-'} | ${l.status} | ${(l.evidence || '-').replace(/\|/g, '/')} |`),
      '', `Files: ${allFiles.map((f) => f.path).join(', ') || 'none'}`,
      test ? `\nTest \`${testCmd}\`: exit ${test.code}` : ''
    ].join('\n');
    fs.writeFileSync(path.join(runDir, 'summary.md'), summary + '\n');
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ id, task, plan: { summary: plan.summary, model: plan.model }, lanes: lanes.map(({ output, tick, ...rest }) => ({ ...rest, files: rest.files.map((f) => f.path) })), test: test && { cmd: testCmd, code: test.code } }, null, 2));

    console.log('');
    const parts = Object.entries(counts).map(([k, v]) => STATUS[k].color(`${v} ${k}`));
    log.ok(`done · ${parts.join(c.gray(' · '))}`);
    if (allFiles.length) log.info(`${allFiles.length} file(s) ${write ? 'written to the project' : `saved in ${path.relative(cwd, outRoot)}  ${c.gray('(use --write to apply)')}`}`);
    log.info(`full log: ${path.relative(cwd, runDir)}/summary.md`);
    if (test && test.code !== 0) log.warn(`test output: ${path.relative(cwd, runDir)}/test-output.txt`);
    if (!testCmd && !review) log.warn('nothing was checked, so no lane is "verified". Add --test "<cmd>" or drop --no-review.');
    return { id, lanes: board.snapshot(), runDir, counts, files: allFiles.map((f) => f.path), test: test && { cmd: testCmd, code: test.code } };
  } finally {
    if (spin) clearInterval(spin);
  }
}
