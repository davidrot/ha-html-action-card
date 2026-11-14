import { BinOp, Expr, ExprSyntaxError } from './ast';
import { Token, tokenize } from './tokenizer';

// Lowest to highest precedence (same order as JavaScript).
const LEVELS: string[][] = [
  ['||'],
  ['&&'],
  ['==', '!=', '===', '!=='],
  ['<', '>', '<=', '>='],
  ['+', '-'],
  ['*', '/', '%'],
];

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    if (this.peek().k === 'end') throw new ExprSyntaxError('Empty expression', 0);
    const e = this.ternary();
    const t = this.peek();
    if (t.k !== 'end') throw new ExprSyntaxError(`Unexpected token "${describe(t)}"`, t.pos);
    return e;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }

  private next(): Token {
    return this.tokens[this.i++];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }

  private expectOp(v: string): void {
    const t = this.next();
    if (t.k !== 'op' || t.v !== v) throw new ExprSyntaxError(`Expected "${v}" but found "${describe(t)}"`, t.pos);
  }

  private ternary(): Expr {
    const test = this.level(0);
    if (this.isOp('?')) {
      this.next();
      const a = this.ternary();
      this.expectOp(':');
      const b = this.ternary();
      return { t: 'cond', test, a, b };
    }
    return test;
  }

  private level(n: number): Expr {
    if (n === LEVELS.length) return this.unary();
    let left = this.level(n + 1);
    for (;;) {
      const t = this.peek();
      if (t.k !== 'op' || !LEVELS[n].includes(t.v)) return left;
      this.next();
      const right = this.level(n + 1);
      left = { t: 'bin', op: normalize(t.v), l: left, r: right };
    }
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.k === 'op' && (t.v === '!' || t.v === '-' || t.v === '+')) {
      this.next();
      return { t: 'unary', op: t.v, arg: this.unary() };
    }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.next();
    switch (t.k) {
      case 'num':
        return { t: 'num', v: t.v };
      case 'str':
        return { t: 'str', v: t.v };
      case 'op':
        if (t.v === '(') {
          const e = this.ternary();
          this.expectOp(')');
          return e;
        }
        throw new ExprSyntaxError(`Unexpected token "${t.v}"`, t.pos);
      case 'id':
        return this.identifier(t.v);
      default:
        throw new ExprSyntaxError('Unexpected end of expression', t.pos);
    }
  }

  private identifier(name: string): Expr {
    if (this.isOp('(')) {
      this.next();
      const args: Expr[] = [];
      if (!this.isOp(')')) {
        for (;;) {
          args.push(this.ternary());
          if (this.isOp(',')) {
            this.next();
            continue;
          }
          break;
        }
      }
      this.expectOp(')');
      return { t: 'call', name, args };
    }
    if (name === 'true') return { t: 'lit', v: true };
    if (name === 'false') return { t: 'lit', v: false };
    if (name === 'null') return { t: 'lit', v: null };
    let segs = name.split('.');
    if (segs.length === 1) return { t: 'word', v: name };
    // Jinja habit: `states.light.kitchen.state` is the same as `light.kitchen.state`.
    if (segs[0] === 'states' && segs.length >= 3) segs = segs.slice(1);
    return { t: 'ref', entity: `${segs[0]}.${segs[1]}`, path: segs.slice(2) };
  }
}

function normalize(op: string): BinOp {
  if (op === '===') return '==';
  if (op === '!==') return '!=';
  return op as BinOp;
}

function describe(t: Token): string {
  return t.k === 'end' ? 'end of expression' : String(t.v);
}

export function parse(source: string): Expr {
  return new Parser(tokenize(source)).parse();
}
