/**
 * The `card` object handed to user scripts: comfort functions only.
 * Everything here is optional sugar; scripts are plain JavaScript and may do anything.
 */
import { runAction } from '../actions';
import type { ActionParams, ControllerContext } from '../actions';
import type { Fn } from '../expr';
import type { Engine } from '../reactive/tracker';
import type { HassEntity, HomeAssistant } from '../types';

export interface CardApi {
  /** Current Home Assistant object (always fresh). */
  readonly hass: HomeAssistant | undefined;
  /** The card's shadow root. */
  readonly root: ShadowRoot;
  $(selector: string): Element | null;
  $$(selector: string): Element[];

  state(entityId: string): string | undefined;
  attr(entityId: string, name: string): unknown;
  /** Current time in ms; inside card.effect() it makes the effect tick. */
  now(): number;

  call(domain: string, service: string, data?: Record<string, unknown>): Promise<void>;
  /** Same grammar as data-action: "light.toggle", "toggle", "more-info", "navigate", "url". */
  action(name: string, params?: ActionParams): Promise<void>;
  navigate(path: string): Promise<void>;
  moreInfo(entityId: string): Promise<void>;
  toggle(entityId: string): Promise<void>;

  /** Runs now (or at the first hass) and again whenever an entity read inside changes. */
  effect(fn: () => void | (() => void)): () => void;
  /** Called with (new, old) state objects when the entity changes (not initially). */
  onEntity(entityId: string, fn: (next: HassEntity | undefined, prev: HassEntity | undefined) => void): () => void;
  /** Coarse escape hatch: after every processed hass update. */
  on(event: 'hass', fn: (hass: HomeAssistant) => void): () => void;
  /** Make functions callable from {{ }} and data-show-if. */
  expose(fns: Record<string, unknown>): void;
  /** Run `fn` when the card is torn down. */
  cleanup(fn: () => void): void;
}

export interface ApiDeps {
  engine: Engine;
  shadow: ShadowRoot;
  ctx: ControllerContext;
  cleanup: (fn: () => void) => void;
}

export function createCardApi({ engine, shadow, ctx, cleanup }: ApiDeps): CardApi {
  /** Failures are reported (toast + console) and still reject for scripts that await. */
  const guard = (promise: Promise<void>): Promise<void> => {
    promise.catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      ctx.report(message);
      ctx.notify(message);
    });
    return promise;
  };

  const api: CardApi = {
    get hass() {
      return engine.hass;
    },
    root: shadow,
    $: (selector) => shadow.querySelector(selector),
    $$: (selector) => Array.from(shadow.querySelectorAll(selector)),

    state: (id) => engine.state(id),
    attr: (id, name) => engine.attr(id, name),
    now: () => engine.now(),

    call: (domain, service, data) => guard(runAction(ctx, `${domain}.${service}`, { data })),
    action: (name, params) => guard(runAction(ctx, name, params)),
    navigate: (path) => api.action('navigate', { path }),
    moreInfo: (entity) => api.action('more-info', { entity }),
    toggle: (entity) => api.action('toggle', { entity }),

    effect(fn) {
      const c = engine.computation(fn);
      return () => c.dispose();
    },

    onEntity(id, fn) {
      let started = false;
      let prev: HassEntity | undefined;
      const c = engine.computation(() => {
        engine.track(id);
        const next = engine.hass?.states[id];
        const before = prev;
        prev = next;
        if (!started) {
          started = true;
          return;
        }
        engine.untracked(() => fn(next, before));
      });
      return () => c.dispose();
    },

    on(event, fn) {
      if (event !== 'hass') throw new Error(`card.on: unknown event "${event}" (only "hass")`);
      return engine.onHass(fn);
    },

    expose(fns) {
      for (const [name, fn] of Object.entries(fns)) {
        if (typeof fn === 'function') engine.exposed.set(name, fn as Fn);
      }
      engine.refreshAll(); // no-op before the first evaluation
    },

    cleanup(fn) {
      cleanup(fn);
    },
  };
  return api;
}
