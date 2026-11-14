/** Text with `{{ expression }}` placeholders, split into literal and expression parts. */
export type Part = string | { expr: string };

export function parseTemplate(text: string): Part[] {
  const parts: Part[] = [];
  let literal = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      const end = findClose(text, i + 2);
      if (end !== -1) {
        if (literal) parts.push(literal);
        literal = '';
        parts.push({ expr: text.slice(i + 2, end).trim() });
        i = end + 2;
        continue;
      }
    }
    literal += text[i++];
  }
  if (literal) parts.push(literal);
  return parts;
}

/** The expression, if the template is nothing but one `{{ }}` (surrounding whitespace allowed). */
export function singleExpression(parts: Part[]): string | undefined {
  const rest = parts.filter((p) => typeof p !== 'string' || p.trim() !== '');
  const only = rest[0];
  return rest.length === 1 && typeof only !== 'string' ? only.expr : undefined;
}

export function hasExpressions(parts: Part[]): boolean {
  return parts.some((p) => typeof p !== 'string');
}

const RAW_BLOCKS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;

/**
 * The browser parses the HTML before we ever see a `{{ }}`: in `{{ a<b }}` it would read
 * `<b` as a tag and destroy the expression. Escape `<` inside `{{ }}` so the expression
 * arrives intact (the parser turns `&lt;` back into `<`). Script, style and comment blocks
 * are left untouched. This is the only change made to the user's markup.
 */
export function protectExpressions(html: string): string {
  let out = '';
  let last = 0;
  for (const m of html.matchAll(RAW_BLOCKS)) {
    out += escapeInExpressions(html.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + escapeInExpressions(html.slice(last));
}

function escapeInExpressions(text: string): string {
  if (!text.includes('{{')) return text;
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      const end = findClose(text, i + 2);
      if (end !== -1) {
        out += text.slice(i, end + 2).replace(/</g, '&lt;');
        i = end + 2;
        continue;
      }
    }
    out += text[i++];
  }
  return out;
}

/** `}}` inside a quoted string does not end the expression. */
export function findClose(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (text.startsWith('}}', i)) return i;
  }
  return -1;
}

/** How a value is shown as text: missing -> empty, booleans as true/false, objects as JSON. */
export function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }
  return String(v);
}

export function renderParts(parts: Part[], evaluate: (expr: string) => unknown): string {
  let out = '';
  for (const p of parts) out += typeof p === 'string' ? p : formatValue(evaluate(p.expr));
  return out;
}
