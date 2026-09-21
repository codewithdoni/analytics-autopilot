// Dependency-free helpers for reading Dart source with regexes — just enough
// structure awareness (comments, strings, balanced brackets) to be trustworthy.
// This is NOT a Dart parser. Known limits are listed in references/router-patterns.md.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const GENERATED = /\.(g|freezed|gr|config|mocks|gen|pb|pbenum|pbjson)\.dart$/;
const SKIP_DIRS = new Set(['.dart_tool', 'build', '.git', 'node_modules', 'ios', 'android', 'macos', 'windows', 'linux', 'web', 'test', 'integration_test']);

/** All hand-written Dart files under <root>/lib, as paths relative to root. */
export function walkDart(root, sub = 'lib') {
  const out = [];
  const start = path.join(root, sub);
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) visit(full);
      } else if (name.endsWith('.dart') && !GENERATED.test(name)) out.push(path.relative(root, full));
    }
  };
  visit(start);
  return out.sort();
}

/**
 * Returns two same-length views of the source:
 *  - code:   comments blanked out, strings intact (use to read values)
 *  - mask:   comments AND string contents blanked out, quotes kept (use to match structure)
 * Offsets and line numbers are identical across src / code / mask.
 */
export function views(src) {
  const code = src.split('');
  const mask = src.split('');
  const n = src.length;
  let i = 0;
  const blank = (arr, from, to) => {
    for (let k = from; k < to && k < n; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(code, i, j);
      blank(mask, i, j);
      i = j;
      continue;
    }
    if (c === '/' && c2 === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j === -1 ? n : j + 2;
      blank(code, i, j);
      blank(mask, i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const raw = i > 0 && src[i - 1] === 'r';
      const triple = src.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      let j = i + quote.length;
      while (j < n) {
        if (!raw && src[j] === '\\') {
          j += 2;
          continue;
        }
        // `${ ... }` may contain quotes of its own; skip the whole interpolation.
        if (!raw && src[j] === '$' && src[j + 1] === '{') {
          let depth = 0;
          let k = j + 1;
          for (; k < n; k++) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}' && --depth === 0) break;
          }
          j = k + 1;
          continue;
        }
        if (src.startsWith(quote, j)) break;
        if (!triple && src[j] === '\n') break;
        j++;
      }
      blank(mask, i + quote.length, j);
      i = Math.min(j + quote.length, n);
      continue;
    }
    i++;
  }
  return { code: code.join(''), mask: mask.join('') };
}

export function readDart(root, rel) {
  const src = readFileSync(path.join(root, rel), 'utf8');
  return { rel, src, ...views(src) };
}

const PAIRS = { '(': ')', '{': '}', '[': ']', '<': '>' };

/** Index of the bracket matching mask[open]; -1 if unbalanced. Pass the MASK view. */
export function matchBracket(mask, open) {
  const o = mask[open];
  const c = PAIRS[o];
  if (!c) return -1;
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === o) depth++;
    else if (mask[i] === c) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 1-based line number of an offset. */
export function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** End offset (exclusive) of the expression starting at `from`: stops at a top-level `,` `)` `]` `}` or `;`. */
export function expressionEnd(mask, from) {
  let depth = 0;
  for (let i = from; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) return i;
  }
  return mask.length;
}

/** The call that encloses `index`: { name, open, close } where mask[open] === '('. */
export function enclosingCall(mask, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = mask[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const before = mask.slice(Math.max(0, i - 80), i);
        const m = /([A-Za-z_][\w.]*)\s*(?:<[^<>()]*>)?\s*$/.exec(before);
        return { name: m ? m[1] : null, open: i, close: matchBracket(mask, i) };
      }
      depth--;
    }
  }
  return null;
}

/** Class declarations with their body range: [{ name, extends, mixins, start, bodyOpen, bodyClose }]. */
export function classes(mask) {
  const out = [];
  const re = /\b(?:abstract\s+|final\s+|sealed\s+|base\s+)*class\s+(\w+)(?:<[^{]*?>)?\s*(?:extends\s+([\w.]+(?:<[^{]*?>)?))?([^{;]*)\{/g;
  let m;
  while ((m = re.exec(mask))) {
    const bodyOpen = m.index + m[0].length - 1;
    const bodyClose = matchBracket(mask, bodyOpen);
    if (bodyClose === -1) continue;
    out.push({ name: m[1], extends: (m[2] ?? '').trim(), rest: (m[3] ?? '').trim(), start: m.index, bodyOpen, bodyClose });
  }
  return out;
}

export function classAt(classList, index) {
  let best = null;
  for (const c of classList) if (index > c.bodyOpen && index < c.bodyClose && (!best || c.bodyOpen > best.bodyOpen)) best = c;
  return best;
}

/**
 * Body of a function/method named `name` inside [from, to): returns { start, end } of the
 * braces block or `=>` expression, or null. Matches declarations, not calls.
 */
export function findFunctionBody(mask, name, from = 0, to = mask.length) {
  const re = new RegExp(`(?<![\\w.])${name.replace(/[$]/g, '\\$')}\\s*(?:<[^<>()]*>)?\\s*\\(`, 'g');
  re.lastIndex = from;
  let m;
  while ((m = re.exec(mask)) && m.index < to) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(mask, open);
    if (close === -1) continue;
    let k = close + 1;
    while (k < mask.length && /\s/.test(mask[k])) k++;
    if (mask.startsWith('async', k)) {
      k += 5;
      if (mask[k] === '*') k++;
      while (k < mask.length && /\s/.test(mask[k])) k++;
    }
    if (mask[k] === '{') {
      const end = matchBracket(mask, k);
      if (end !== -1) return { start: k, end: end + 1 };
    } else if (mask.startsWith('=>', k)) return { start: k, end: expressionEnd(mask, k + 2) };
  }
  return null;
}

export const snake = (s) =>
  String(s ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

export const camel = (s) => snake(s).replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase());

/** Parse `--flag value` / `--flag` CLI arguments. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
