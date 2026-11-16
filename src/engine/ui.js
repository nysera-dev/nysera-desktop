// Tiny terminal styling helpers — no dependencies.
const on = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open, close) => (s) => (on ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  pink: (s) => (on ? `\x1b[38;2;255;122;194m${s}\x1b[39m` : String(s)),
  purple: (s) => (on ? `\x1b[38;2;197;140;255m${s}\x1b[39m` : String(s)),
  orange: (s) => (on ? `\x1b[38;2;242;166;90m${s}\x1b[39m` : String(s)),
  green: (s) => (on ? `\x1b[38;2;184;216;107m${s}\x1b[39m` : String(s)),
  blue: (s) => (on ? `\x1b[38;2;143;176;255m${s}\x1b[39m` : String(s)),
  yellow: (s) => (on ? `\x1b[38;2;242;193;78m${s}\x1b[39m` : String(s)),
  red: (s) => (on ? `\x1b[38;2;255;107;107m${s}\x1b[39m` : String(s)),
  gray: (s) => (on ? `\x1b[38;2;138;131;153m${s}\x1b[39m` : String(s))
};

export function banner() {
  const g = [c.purple, c.pink, c.pink, c.orange, c.orange, c.green];
  const word = 'NYSERA';
  return word.split('').map((ch, i) => c.bold(g[i](ch))).join(' ');
}

export const STATUS = {
  planned: { label: 'planned', color: c.gray },
  running: { label: 'running', color: c.blue },
  reported: { label: 'reported', color: c.yellow },
  verified: { label: 'verified', color: c.green },
  failed: { label: 'failed', color: c.red },
  skipped: { label: 'skipped', color: c.gray }
};

export function bar(pct, width = 14) {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return '█'.repeat(n) + c.gray('░'.repeat(width - n));
}

export function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length);
}

export const log = {
  info: (m) => console.log(c.pink('›'), m),
  ok: (m) => console.log(c.green('✓'), m),
  warn: (m) => console.log(c.yellow('!'), m),
  err: (m) => console.error(c.red('✗'), m)
};

// Visible width helpers: cut a styled line to the terminal width so it never wraps
// (wrapping breaks the live board redraw on narrow screens like phones / Termux).
export const termCols = () => Math.max(30, process.stdout.columns || 100);
const ANSI = /^\x1b\[[0-9;]*m/;
export function fit(s, cols = termCols()) {
  const str = String(s);
  const max = cols - 1;
  if (str.replace(/\x1b\[[0-9;]*m/g, '').length <= max) return str;
  let out = '', vis = 0, i = 0;
  while (i < str.length && vis < max - 1) {
    const m = str.slice(i).match(ANSI);
    if (m) { out += m[0]; i += m[0].length; continue; }
    out += str[i]; vis++; i++;
  }
  return out + '…' + (on ? '\x1b[0m' : '');
}
