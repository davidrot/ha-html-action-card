export type Fn = (...args: unknown[]) => unknown;

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

/** Globals that are always callable from expressions. */
const ROOTS: Record<string, unknown> = {
  Math,
  Number,
  String,
  Date,
  parseFloat,
  parseInt,
  isNaN,
  isFinite,
};

function walk(root: unknown, parts: string[]): Fn | undefined {
  let parent: unknown = undefined;
  let cur: unknown = root;
  for (let i = 1; i < parts.length; i++) {
    if (cur == null || (typeof cur !== 'object' && typeof cur !== 'function')) return undefined;
    if (BLOCKED.has(parts[i])) return undefined;
    parent = cur;
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  return typeof cur === 'function' ? (cur as Fn).bind(parent) : undefined;
}

export function lookupBuiltin(name: string): Fn | undefined {
  const parts = name.split('.');
  if (!Object.prototype.hasOwnProperty.call(ROOTS, parts[0])) return undefined;
  return walk(ROOTS[parts[0]], parts);
}

export function lookupWindow(name: string): Fn | undefined {
  const parts = name.split('.');
  if (BLOCKED.has(parts[0])) return undefined;
  const root = (globalThis as Record<string, unknown>)[parts[0]];
  return root === undefined ? undefined : walk(root, parts);
}

/**
 * Function resolution order:
 * 1. functions exposed by scripts via card.expose(), 2. built-in globals, 3. window.
 */
export function resolveFunction(name: string, exposed: ReadonlyMap<string, Fn>): Fn | undefined {
  return exposed.get(name) ?? lookupBuiltin(name) ?? lookupWindow(name);
}
