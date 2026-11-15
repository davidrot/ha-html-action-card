import { Expr, ExprRuntimeError } from './ast';

/**
 * What the evaluator needs from the outside. The caller wraps these to record
 * dependencies: every state()/attr() call is a tracked read.
 */
export interface Resolver {
  /**
   * The Home Assistant state object of an entity ({ state, attributes, last_changed, ... }),
   * `undefined` if it does not exist. Expressions name the property themselves, exactly as
   * in Home Assistant: `light.kitchen.state`, `light.kitchen.attributes.brightness`.
   */
  entity(entityId: string): unknown;
  /** Value of a card input (`input.<name>`), from the frontmatter and the card config. */
  input?(name: string): unknown;
  /** Resolve a callable by (dotted) name. Order is the caller's business. */
  fn(name: string): ((...args: unknown[]) => unknown) | undefined;
}

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;

/** Number or numeric string -> number. Anything else (incl. "unavailable") -> undefined. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    return NUMERIC.test(s) ? Number(s) : undefined;
  }
  return undefined;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' || typeof b === 'number') {
    const x = toNumber(a);
    const y = toNumber(b);
    return x !== undefined && y !== undefined && x === y;
  }
  return a === b;
}

function finite(n: number): number | undefined {
  return Number.isFinite(n) ? n : undefined;
}

export function evaluate(e: Expr, r: Resolver): unknown {
  switch (e.t) {
    case 'num':
    case 'str':
    case 'lit':
    case 'word':
      return e.v;

    case 'ref': {
      let v: unknown;
      if (e.entity.startsWith('input.') && r.input) {
        // `input.timer` is the picked value (an entity id); `input.timer.state` reads that entity.
        v = r.input(e.entity.slice(6));
        if (e.path.length === 0) return v;
        if (typeof v === 'string' && ENTITY_ID.test(v)) v = r.entity(v);
      } else {
        v = r.entity(e.entity);
        // No default: a bare `light.kitchen` names no property and renders empty.
        if (e.path.length === 0) return undefined;
      }
      for (const key of e.path) {
        if (v == null || typeof v !== 'object' || BLOCKED.has(key)) return undefined;
        v = (v as Record<string, unknown>)[key];
      }
      return v;
    }

    case 'call': {
      const fn = r.fn(e.name);
      if (!fn) throw new ExprRuntimeError(`Unknown function "${e.name}"`);
      const args = e.args.map((a) => evaluate(a, r));
      try {
        return fn(...args);
      } catch (err) {
        throw new ExprRuntimeError(`Function "${e.name}" threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    case 'unary': {
      const v = evaluate(e.arg, r);
      if (e.op === '!') return !v;
      const n = toNumber(v);
      if (n === undefined) return undefined;
      return e.op === '-' ? -n : n;
    }

    case 'cond':
      return evaluate(e.test, r) ? evaluate(e.a, r) : evaluate(e.b, r);

    case 'bin': {
      // Short-circuit first: only read what is needed, so dependencies stay minimal.
      if (e.op === '&&') {
        const l = evaluate(e.l, r);
        return l ? evaluate(e.r, r) : l;
      }
      if (e.op === '||') {
        const l = evaluate(e.l, r);
        return l ? l : evaluate(e.r, r);
      }
      const a = evaluate(e.l, r);
      const b = evaluate(e.r, r);
      switch (e.op) {
        case '==':
          return looseEquals(a, b);
        case '!=':
          return !looseEquals(a, b);
        case '<':
        case '>':
        case '<=':
        case '>=': {
          const x = toNumber(a);
          const y = toNumber(b);
          if (x === undefined || y === undefined) return false; // e.g. "unavailable" > 5
          return e.op === '<' ? x < y : e.op === '>' ? x > y : e.op === '<=' ? x <= y : x >= y;
        }
        case '+': {
          if (a == null || b == null) return undefined;
          const x = toNumber(a);
          const y = toNumber(b);
          if (x !== undefined && y !== undefined) return finite(x + y);
          return String(a) + String(b); // string concatenation
        }
        default: {
          const x = toNumber(a);
          const y = toNumber(b);
          if (x === undefined || y === undefined) return undefined;
          return e.op === '-' ? finite(x - y) : e.op === '*' ? finite(x * y) : e.op === '/' ? finite(x / y) : finite(x % y);
        }
      }
    }
  }
}

/** Static scan: every entity id an expression can possibly read (for the pre-check). */
export function collectEntities(e: Expr, out: Set<string> = new Set()): Set<string> {
  switch (e.t) {
    case 'ref':
      out.add(e.entity);
      break;
    case 'call':
      e.args.forEach((a) => collectEntities(a, out));
      break;
    case 'unary':
      collectEntities(e.arg, out);
      break;
    case 'bin':
      collectEntities(e.l, out);
      collectEntities(e.r, out);
      break;
    case 'cond':
      collectEntities(e.test, out);
      collectEntities(e.a, out);
      collectEntities(e.b, out);
      break;
  }
  return out;
}
