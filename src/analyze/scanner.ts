/**
 * A small HTML scanner for the security rating. It keeps source offsets (for line numbers),
 * which DOMParser does not, and needs no DOM. It is deliberately forgiving: it only has to
 * find tags, attributes, script/style blocks and `{{ }}` expressions.
 */
import { findClose } from '../render/template';

export interface Attr {
  name: string;
  value: string;
  offset: number;
}

export type Token =
  | { kind: 'tag'; name: string; attrs: Attr[]; offset: number }
  /** <script> / <style> with their raw content. */
  | { kind: 'raw'; name: 'script' | 'style'; attrs: Attr[]; content: string; offset: number; contentOffset: number }
  /** `{{ expression }}` in text. */
  | { kind: 'expr'; source: string; offset: number };

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const decode = (s: string) => s.replace(/&(lt|gt|amp|quot|#39|apos);/g, (m) => ENTITIES[m]);
const isNameStart = (c: string | undefined) => !!c && /[A-Za-z]/.test(c);

export function scan(html: string): Token[] {
  const tokens: Token[] = [];
  const n = html.length;
  let i = 0;

  while (i < n) {
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('{{', i)) {
      const end = findClose(html, i + 2);
      if (end !== -1) {
        tokens.push({ kind: 'expr', source: decode(html.slice(i + 2, end).trim()), offset: i });
        i = end + 2;
        continue;
      }
      i += 2;
      continue;
    }
    if (html[i] === '<' && isNameStart(html[i + 1])) {
      const offset = i;
      let j = i + 1;
      while (j < n && /[\w:-]/.test(html[j])) j++;
      const name = html.slice(i + 1, j).toLowerCase();
      const attrs: Attr[] = [];

      // attributes up to the closing '>'
      for (;;) {
        while (j < n && /[\s/]/.test(html[j])) j++;
        if (j >= n || html[j] === '>') break;
        const start = j;
        while (j < n && !/[\s=>/]/.test(html[j])) j++;
        if (j === start) {
          j++; // stray character
          continue;
        }
        const attrName = html.slice(start, j).toLowerCase();
        let value = '';
        let k = j;
        while (k < n && /\s/.test(html[k])) k++;
        if (html[k] === '=') {
          k++;
          while (k < n && /\s/.test(html[k])) k++;
          const quote = html[k];
          if (quote === '"' || quote === "'") {
            const close = html.indexOf(quote, k + 1);
            const stop = close === -1 ? n : close;
            value = html.slice(k + 1, stop);
            j = Math.min(stop + 1, n);
          } else {
            let v = k;
            while (v < n && !/[\s>]/.test(html[v])) v++;
            value = html.slice(k, v);
            j = v;
          }
        }
        attrs.push({ name: attrName, value: decode(value), offset: start });
      }
      i = Math.min(j + 1, n); // past '>'

      if (name === 'script' || name === 'style') {
        const close = html.toLowerCase().indexOf(`</${name}`, i);
        const stop = close === -1 ? n : close;
        tokens.push({ kind: 'raw', name, attrs, content: html.slice(i, stop), offset, contentOffset: i });
        const gt = html.indexOf('>', stop);
        i = close === -1 || gt === -1 ? n : gt + 1;
      } else {
        tokens.push({ kind: 'tag', name, attrs, offset });
      }
      continue;
    }
    i++;
  }
  return tokens;
}

/** offset -> 1-based line number. */
export function lineCounter(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
