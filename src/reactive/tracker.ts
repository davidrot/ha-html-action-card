/**
 * Dependency tracking.
 *
 * A Computation is a function whose entity reads are recorded while it runs
 * (text node, attribute, show-if, script effect). The Engine keeps an index
 * Map<entityId, Set<Computation>>. On a hass update only indexed entities are compared
 * (reference check: HA replaces a state object when it changes), affected computations
 * re-run and re-record their dependencies. Updates are coalesced per frame.
 */
import { resolveFunction, run } from '../expr';
import type { Fn, Resolver } from '../expr';
import type { HassEntity, HomeAssistant } from '../types';
import { relativeTime } from './helpers';

/** Pseudo entity for time: computations that read now() depend on it, a ticker drives them. */
export const NOW = '$now';

const NO_FUNCTIONS: ReadonlyMap<string, Fn> = new Map();

export interface EngineOptions {
  /** Ticker interval for now()/relative() in ms. Default 1000. */
  refreshInterval?: number;
  /** How to defer a flush. Default: next animation frame, with a timer as fallback. */
  schedule?: (fn: () => void) => void;
  /** Called for errors in expressions and computations (not deduplicated). */
  onError?: (message: string) => void;
}

export class Computation {
  deps = new Set<string>();
  disposed = false;
  private cleanup?: () => void;

  constructor(
    private readonly engine: Engine,
    private readonly fn: () => void | (() => void),
  ) {}

  run(): void {
    if (this.disposed || this.engine.disposed) return;
    this.runCleanup();
    this.engine._unindex(this);
    this.deps = new Set();
    const prev = this.engine.current;
    this.engine.current = this;
    try {
      const result = this.fn();
      if (typeof result === 'function') this.cleanup = result;
    } catch (err) {
      this.engine.report(err instanceof Error ? err.message : String(err));
    } finally {
      this.engine.current = prev;
    }
    if (!this.disposed) this.engine._index(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runCleanup();
    this.engine._remove(this);
  }

  private runCleanup(): void {
    const c = this.cleanup;
    this.cleanup = undefined;
    try {
      c?.();
    } catch (err) {
      this.engine.report(err instanceof Error ? err.message : String(err));
    }
  }
}

export class Engine {
  hass?: HomeAssistant;
  /** The computation currently running; reads are recorded into it. */
  current: Computation | null = null;
  disposed = false;
  /** Functions scripts made available to expressions via card.expose(). */
  readonly exposed = new Map<string, Fn>();
  /** Card inputs (`input.<name>`): what the user picked, else the frontmatter default. */
  inputs: Record<string, unknown> = {};

  private latest?: HomeAssistant;
  private scheduled = false;
  private ticker?: ReturnType<typeof setInterval>;
  private readonly all = new Set<Computation>();
  private readonly index = new Map<string, Set<Computation>>();
  private readonly helpers = new Map<string, Fn>();
  private readonly hassListeners = new Set<(hass: HomeAssistant) => void>();
  private readonly resolver: Resolver;

  constructor(private readonly opts: EngineOptions = {}) {
    this.helpers.set('now', () => this.now());
    this.helpers.set('relative', (value) => {
      this.track(NOW);
      return relativeTime(value, Date.now(), this.locale());
    });
    this.resolver = {
      entity: (id) => this.entity(id),
      input: (name) => this.inputs[name],
      fn: (name) => this.exposed.get(name) ?? this.helpers.get(name) ?? resolveFunction(name, NO_FUNCTIONS),
    };
  }

  // ---- tracked reads (used by expressions and by card.state / card.attr) ----

  track(key: string): void {
    this.current?.deps.add(key);
  }

  /** The state object of an entity (what expressions walk into). */
  entity(id: string): HassEntity | undefined {
    this.track(id);
    return this.hass?.states[id];
  }

  state(id: string): string | undefined {
    this.track(id);
    return this.hass?.states[id]?.state;
  }

  attr(id: string, name: string): unknown {
    this.track(id);
    return this.hass?.states[id]?.attributes?.[name];
  }

  /** Current time in ms; reading it makes the running computation tick (see NOW). */
  now(): number {
    this.track(NOW);
    return Date.now();
  }

  /** Run `fn` without recording dependencies (callbacks that must not subscribe). */
  untracked<T>(fn: () => T): T {
    const prev = this.current;
    this.current = null;
    try {
      return fn();
    } finally {
      this.current = prev;
    }
  }

  /** Re-run every computation, e.g. after a script exposed a new function late. */
  refreshAll(): void {
    if (!this.hass) return;
    for (const c of [...this.all]) c.run();
  }

  /** Called after every processed hass update (card.on('hass')). Returns an unsubscribe. */
  onHass(fn: (hass: HomeAssistant) => void): () => void {
    this.hassListeners.add(fn);
    return () => void this.hassListeners.delete(fn);
  }

  private emitHass(): void {
    for (const fn of [...this.hassListeners]) {
      try {
        this.untracked(() => fn(this.hass!));
      } catch (err) {
        this.report(err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Evaluate an expression source. Errors are reported and yield `undefined`. */
  evaluate(source: string): unknown {
    const r = run(source, this.resolver);
    if (r.error) this.report(`Expression "${source}": ${r.error}`);
    return r.value;
  }

  report(message: string): void {
    this.opts.onError?.(message);
  }

  // ---- computations ----

  /**
   * Run `fn` now (or at the first hass) and again whenever an entity it read changes.
   * `fn` may return a cleanup function that runs before every re-run and on dispose.
   */
  computation(fn: () => void | (() => void)): Computation {
    const c = new Computation(this, fn);
    this.all.add(c);
    if (this.hass) c.run();
    return c;
  }

  // ---- hass updates ----

  setHass(hass: HomeAssistant): void {
    if (this.disposed) return;
    this.latest = hass;
    if (!this.hass) {
      // First hass: evaluate everything once, synchronously.
      this.hass = hass;
      for (const c of [...this.all]) c.run();
      this.emitHass();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const go = () => {
      if (!this.scheduled) return;
      this.scheduled = false;
      this.flush();
    };
    (this.opts.schedule ?? defaultSchedule)(go);
  }

  /** Compare against the last processed hass (not every intermediate one), run affected. */
  private flush(): void {
    const next = this.latest;
    const prev = this.hass;
    if (this.disposed || !next || !prev || next === prev) return;
    this.hass = next;
    const dirty = new Set<Computation>();
    for (const [id, set] of this.index) {
      if (id === NOW) continue;
      if (prev.states[id] !== next.states[id]) for (const c of set) dirty.add(c);
    }
    for (const c of dirty) c.run();
    this.emitHass();
  }

  dispose(): void {
    this.disposed = true;
    for (const c of [...this.all]) c.dispose();
    this.all.clear();
    this.index.clear();
    this.hassListeners.clear();
    this.syncTicker();
  }

  // ---- internals used by Computation ----

  _index(c: Computation): void {
    for (const dep of c.deps) {
      let set = this.index.get(dep);
      if (!set) this.index.set(dep, (set = new Set()));
      set.add(c);
    }
    this.syncTicker();
  }

  _unindex(c: Computation): void {
    for (const dep of c.deps) {
      const set = this.index.get(dep);
      if (!set) continue;
      set.delete(c);
      if (set.size === 0) this.index.delete(dep);
    }
  }

  _remove(c: Computation): void {
    this._unindex(c);
    this.all.delete(c);
    this.syncTicker();
  }

  // ---- time ----

  private locale(): string | undefined {
    const h = this.hass as unknown as { locale?: { language?: string }; language?: string } | undefined;
    return h?.locale?.language ?? h?.language;
  }

  private syncTicker(): void {
    const needed = !this.disposed && (this.index.get(NOW)?.size ?? 0) > 0;
    if (needed && !this.ticker) {
      this.ticker = setInterval(() => this.tick(), this.opts.refreshInterval ?? 1000);
    } else if (!needed && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  private tick(): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    for (const c of [...(this.index.get(NOW) ?? [])]) c.run();
  }
}

function defaultSchedule(fn: () => void): void {
  // Frame batching, but also a timer so background tabs (no frames) still update.
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn());
  setTimeout(fn, 250);
}
