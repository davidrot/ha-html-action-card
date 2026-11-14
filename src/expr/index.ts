/**
 * Expression language shared by {{ }} and data-show-if.
 * Own parser, no eval. Literals, entity refs (domain.object.state, .attributes.x), comparisons,
 * && || !, arithmetic, ? :, parentheses, function calls.
 */
import { Expr, ExprRuntimeError, ExprSyntaxError } from './ast';
import { evaluate, Resolver } from './evaluate';
import { parse } from './parser';

export { parse } from './parser';
export { evaluate, collectEntities, toNumber } from './evaluate';
export type { Resolver } from './evaluate';
export { resolveFunction, lookupBuiltin, lookupWindow } from './builtins';
export type { Fn } from './builtins';
export { ExprSyntaxError, ExprRuntimeError } from './ast';
export type { Expr } from './ast';

const cache = new Map<string, Expr | ExprSyntaxError>();

/** Parse with a small cache (the same source is re-evaluated on every update). */
export function compile(source: string): Expr {
  let hit = cache.get(source);
  if (hit === undefined) {
    if (cache.size > 1000) cache.clear();
    try {
      hit = parse(source);
    } catch (err) {
      hit = err as ExprSyntaxError;
    }
    cache.set(source, hit);
  }
  if (hit instanceof Error) throw hit;
  return hit;
}

export interface RunResult {
  value: unknown;
  /** Set when parsing or evaluation failed. `value` is then `undefined`. */
  error?: string;
}

/** Never throws: errors become `{ value: undefined, error }`. */
export function run(source: string, resolver: Resolver): RunResult {
  try {
    return { value: evaluate(compile(source), resolver) };
  } catch (err) {
    if (err instanceof ExprSyntaxError || err instanceof ExprRuntimeError) {
      return { value: undefined, error: err.message };
    }
    return { value: undefined, error: err instanceof Error ? err.message : String(err) };
  }
}
