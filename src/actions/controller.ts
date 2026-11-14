/**
 * Event delegation for `data-event` (when) + `data-action` (what).
 * One set of listeners on the content root, no per-element listeners.
 *
 * tap      click (also keyboard activation)
 * dbltap   dblclick
 * hold     pointer held for `data-delay` ms (default 500), cancelled by moving away/release
 * press    fires on pointer down; with `data-repeat="ms"` repeats until release/leave
 * release  fires on pointer up inside the element
 */
import { runAction } from './run';
import type { ActionContext, ActionParams } from './run';

const EVENTS = new Set(['tap', 'hold', 'dbltap', 'press', 'release']);
const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;
const MIN_REPEAT = 20;
const ERROR_MS = 3000;

export interface ControllerContext extends ActionContext {
  /** Technical problems (bad config). Deduplicated by the caller. */
  report(message: string): void;
  /** User-visible message (toast). */
  notify(message: string): void;
}

interface Session {
  el: Element;
  ev: string;
  x: number;
  y: number;
  hold?: ReturnType<typeof setTimeout>;
  repeat?: ReturnType<typeof setInterval>;
}

export class ActionController {
  private readonly sessions = new Map<number, Session>();
  private readonly pending = new WeakSet<Element>();
  private readonly listeners: Array<[string, EventListener]> = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly ctx: ControllerContext,
  ) {}

  start(): void {
    this.on('click', (e) => this.onClick(e as MouseEvent));
    this.on('dblclick', (e) => {
      const el = this.find(e);
      if (el && this.eventOf(el) === 'dbltap') this.fire(el);
    });
    this.on('pointerdown', (e) => this.onDown(e as PointerEvent));
    this.on('pointermove', (e) => this.onMove(e as PointerEvent));
    this.on('pointerup', (e) => this.onUp(e as PointerEvent, true));
    this.on('pointercancel', (e) => this.onUp(e as PointerEvent, false));
    this.on('contextmenu', (e) => {
      const ev = this.eventOf(this.find(e));
      if (ev === 'hold' || ev === 'press') e.preventDefault(); // no long-press menu
    });
  }

  stop(): void {
    for (const [type, fn] of this.listeners) this.root.removeEventListener(type, fn);
    this.listeners.length = 0;
    for (const id of [...this.sessions.keys()]) this.end(id);
  }

  // ---- DOM events ----

  private onClick(e: MouseEvent): void {
    const el = this.find(e);
    if (!el) return;
    const ev = this.eventOf(el);
    if (ev === 'tap') return this.fire(el);
    // Keyboard activation (Enter/Space on a button) has detail 0: press/hold/release/dbltap
    // would otherwise be unreachable without a pointer. Fire once.
    if (ev && ev !== 'dbltap' && e.detail === 0) this.fire(el);
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = this.find(e);
    const ev = this.eventOf(el);
    if (!el || (ev !== 'press' && ev !== 'hold' && ev !== 'release')) return;

    this.end(e.pointerId);
    const s: Session = { el, ev, x: e.clientX, y: e.clientY };
    this.sessions.set(e.pointerId, s);
    try {
      (el as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable, fine */
    }

    if (ev === 'press') {
      this.fire(el);
      const every = parseInt(el.getAttribute('data-repeat') ?? '', 10);
      if (every > 0) s.repeat = setInterval(() => this.fire(el, false), Math.max(every, MIN_REPEAT));
    } else if (ev === 'hold') {
      const delay = parseInt(el.getAttribute('data-delay') ?? '', 10);
      s.hold = setTimeout(() => {
        s.hold = undefined;
        this.fire(el);
      }, delay > 0 ? delay : HOLD_MS);
    }
  }

  private onMove(e: PointerEvent): void {
    const s = this.sessions.get(e.pointerId);
    if (!s) return;
    if (s.ev === 'hold') {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) this.end(e.pointerId);
    } else if (!inside(s.el, e.clientX, e.clientY)) {
      this.end(e.pointerId); // pointer left the element: stop repeating / no release
    }
  }

  private onUp(e: PointerEvent, up: boolean): void {
    const s = this.sessions.get(e.pointerId);
    if (!s) return;
    this.end(e.pointerId);
    if (up && s.ev === 'release' && inside(s.el, e.clientX, e.clientY)) this.fire(s.el);
  }

  private end(pointerId: number): void {
    const s = this.sessions.get(pointerId);
    if (!s) return;
    if (s.hold) clearTimeout(s.hold);
    if (s.repeat) clearInterval(s.repeat);
    this.sessions.delete(pointerId);
  }

  // ---- firing ----

  /** `confirm` is false for repeat ticks: ask once, not every 100 ms. */
  private fire(el: Element, confirm = true): void {
    if (this.pending.has(el)) return; // double-click / slow call protection

    let action: string;
    let params: ActionParams;
    try {
      ({ action, params } = read(el));
    } catch (err) {
      return this.fail(el, err);
    }
    if (!action) return;

    const hass = this.ctx.hass();
    if (params.entity && hass?.states[params.entity]?.state === 'unavailable') return;
    if (hass && hass.connected === false) {
      this.ctx.notify('Not connected to Home Assistant');
      return;
    }
    const question = el.getAttribute('data-confirm');
    if (confirm && question && !window.confirm(question)) return;

    el.classList.remove('is-error');
    el.classList.add('is-pending');
    this.pending.add(el);
    runAction(this.ctx, action, params)
      .catch((err) => this.fail(el, err))
      .finally(() => {
        this.pending.delete(el);
        el.classList.remove('is-pending');
      });
  }

  private fail(el: Element, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.ctx.report(message);
    this.ctx.notify(message);
    el.classList.add('is-error');
    setTimeout(() => el.classList.remove('is-error'), ERROR_MS);
  }

  // ---- helpers ----

  private on(type: string, fn: EventListener): void {
    this.root.addEventListener(type, fn);
    this.listeners.push([type, fn]);
  }

  /** Innermost element with data-action inside the content root. */
  private find(e: Event): Element | null {
    const target = e.target;
    if (!(target instanceof Element)) return null;
    const el = target.closest('[data-action]');
    return el && this.root.contains(el) ? el : null;
  }

  private eventOf(el: Element | null): string | undefined {
    if (!el) return undefined;
    const ev = (el.getAttribute('data-event') || 'tap').trim().toLowerCase();
    if (EVENTS.has(ev)) return ev;
    this.ctx.report(`Unknown data-event "${ev}" (use tap, hold, dbltap, press or release)`);
    return undefined;
  }
}

function read(el: Element): { action: string; params: ActionParams } {
  const attr = (name: string) => el.getAttribute(name)?.trim() || undefined;
  const params: ActionParams = {
    entity: attr('data-entity'),
    path: attr('data-path'),
    url: attr('data-url'),
    target: attr('data-target'),
  };
  const raw = attr('data-data');
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`data-data is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('data-data must be a JSON object');
    }
    params.data = parsed as Record<string, unknown>;
  }
  return { action: attr('data-action') ?? '', params };
}

function inside(el: Element, x: number, y: number): boolean {
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return true; // no layout (tests): do not guess
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
