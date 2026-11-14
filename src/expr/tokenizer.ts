import { ExprSyntaxError } from './ast';

export type Token =
  | { k: 'num'; v: number; pos: number }
  | { k: 'str'; v: string; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'end'; pos: number };

// Longest first.
const OPS = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '(', ')', ','];

const NUMBER = /\d+(?:\.\d+)?/y;
// First segment starts with a letter/underscore; later segments may start with a digit (HA object ids, list indexes).
const IDENT = /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*/y;

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r' };

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      NUMBER.lastIndex = i;
      const m = NUMBER.exec(src)!;
      tokens.push({ k: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      let out = '';
      i++;
      let closed = false;
      while (i < src.length) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          out += ESCAPES[next] ?? next;
          i += 2;
          continue;
        }
        if (ch === c) {
          closed = true;
          i++;
          break;
        }
        out += ch;
        i++;
      }
      if (!closed) throw new ExprSyntaxError('Unterminated string', start);
      tokens.push({ k: 'str', v: out, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = i;
      const m = IDENT.exec(src)!;
      tokens.push({ k: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ k: 'op', v: op, pos: i });
      i += op.length;
      continue;
    }
    throw new ExprSyntaxError(`Unexpected character "${c}"`, i);
  }
  tokens.push({ k: 'end', pos: src.length });
  return tokens;
}
