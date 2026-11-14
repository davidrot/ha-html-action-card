// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../main';
import type { HtmlActionCard } from '../card';
import { hassOf } from '../testutil';

/**
 * Scripts re-run on every render and re-attach. These tests make sure nothing a script
 * registered outside the card survives a teardown or piles up.
 */
const g = globalThis as unknown as Record<string, unknown>;
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
let el: HtmlActionCard;

function mount(content: string) {
  el = document.createElement('html-action-card') as HtmlActionCard;
  document.body.append(el);
  el.hass = hassOf({ 'light.a': 'on' });
  el.setConfig({ type: 'custom:html-action-card', content });
}
const fire = (target: EventTarget, type: string) => target.dispatchEvent(new Event(type));

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  g.__n = 0;
});
afterEach(() => {
  el?.remove();
  vi.restoreAllMocks();
});

describe('listeners outside the card', () => {
  it.each([
    ['window.addEventListener', 'window.addEventListener("hac-test", () => globalThis.__n++)', () => window],
    ['bare addEventListener', 'addEventListener("hac-test", () => globalThis.__n++)', () => window],
    ['document.addEventListener', 'document.addEventListener("hac-test", () => globalThis.__n++)', () => document],
  ])('%s is removed with the card', (_name, code, target) => {
    mount(`<script>${code}</script>`);
    fire(target(), 'hac-test');
    expect(g.__n).toBe(1);
    el.remove();
    fire(target(), 'hac-test');
    expect(g.__n).toBe(1);
  });

  it('re-attaching several times never stacks handlers', () => {
    mount('<script>window.addEventListener("hac-test", () => globalThis.__n++)</script>');
    for (let i = 0; i < 5; i++) {
      el.remove();
      document.body.append(el);
    }
    fire(window, 'hac-test');
    expect(g.__n).toBe(1);
  });

  it('a new config replaces the old handlers', () => {
    mount('<script>window.addEventListener("hac-test", () => globalThis.__n++)</script>');
    el.setConfig({ type: 'custom:html-action-card', content: '<script>window.addEventListener("hac-test", () => globalThis.__n += 10)</script>' });
    fire(window, 'hac-test');
    expect(g.__n).toBe(10);
  });

  it('removeEventListener from the script still works', () => {
    mount(`<script>
      const h = () => globalThis.__n++;
      window.addEventListener("hac-test", h);
      window.removeEventListener("hac-test", h);
      document.addEventListener("hac-test", h);
      document.removeEventListener("hac-test", h);
    </script>`);
    fire(window, 'hac-test');
    fire(document, 'hac-test');
    expect(g.__n).toBe(0);
  });
});

describe('async script code that outlives the card', () => {
  it('cannot register anything after teardown', async () => {
    mount(`<script>
      Promise.resolve().then(() => {
        window.addEventListener("hac-test", () => globalThis.__n++);
        document.addEventListener("hac-test", () => globalThis.__n++);
        setInterval(() => globalThis.__n++, 5);
        new MutationObserver(() => globalThis.__n++).observe(document.documentElement, { attributes: true });
        card.cleanup(() => { globalThis.__late = true; });
      });
    </script>`);
    el.remove(); // torn down before the promise callback runs
    await wait();
    fire(window, 'hac-test');
    fire(document, 'hac-test');
    document.documentElement.setAttribute('data-y', '1');
    await wait(30);
    document.documentElement.removeAttribute('data-y');
    expect(g.__n).toBe(0);
    expect(g.__late).toBe(true); // a late cleanup runs immediately instead of being lost
    delete g.__late;
  });
});

describe('timers, frames, observers', () => {
  it('window.setInterval and requestAnimationFrame stop with the card', async () => {
    mount(`<script>
      window.setInterval(() => globalThis.__n++, 5);
      const loop = () => { globalThis.__n++; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    </script>`);
    await wait(40);
    expect(g.__n as number).toBeGreaterThan(0);
    el.remove();
    const n = g.__n;
    await wait(60);
    expect(g.__n).toBe(n);
  });

  it('a MutationObserver created by a script is disconnected', async () => {
    mount(`<script>
      new MutationObserver(() => globalThis.__n++).observe(document.documentElement, { attributes: true });
    </script>`);
    document.documentElement.setAttribute('data-x', '1');
    await wait();
    expect(g.__n).toBe(1);
    el.remove();
    document.documentElement.setAttribute('data-x', '2');
    await wait();
    expect(g.__n).toBe(1);
    document.documentElement.removeAttribute('data-x');
  });
});

describe('window shim stays a normal window', () => {
  it('globals, identity and constructors behave', () => {
    mount(`<script>
      window.__fromScript = 7;
      globalThis.__checks = [
        window === window.self, window === window.top, window === globalThis,
        typeof window.Promise.resolve, window.document === document,
        typeof window.getComputedStyle(document.body).display,
        new window.Date(0).getTime(),
      ];
    </script>`);
    expect(g.__fromScript).toBe(7); // writes reach the real window
    expect(g.__checks).toEqual([true, true, true, 'function', true, 'string', 0]);
    delete g.__fromScript;
  });
});
