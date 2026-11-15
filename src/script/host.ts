/**
 * Finds the <script> tags in the card content and runs them verbatim.
 * (innerHTML never executes scripts, so we extract and run them ourselves.)
 *
 * Classic inline scripts run synchronously in a function whose scope provides `card`,
 * `document` and `window` (shims), `hass` (live) and card-scoped timers/listeners/observers.
 * `<script src>` loads a real script tag into the page (globals like Chart.js).
 * `type="module"` scripts get the same names as constants.
 * Each script block is isolated: share things via card.expose() or window.
 *
 * Scripts re-run on every render and re-attach. Nothing may survive a teardown: see Resources.
 */
import type { ControllerContext } from '../actions';
import type { Engine } from '../reactive/tracker';
import { createCardApi } from './api';
import type { CardApi } from './api';
import { createDocumentShim, createWindowShim } from './document';
import { Resources } from './resources';

export interface ScriptHostOptions {
  engine: Engine;
  shadow: ShadowRoot;
  content: HTMLElement;
  ctx: ControllerContext;
  /** Namespace for card.store: the card's name from the frontmatter. */
  storeName?: string;
}

const externalScripts = new Map<string, Promise<void>>();
let moduleCounter = 0;

export class ScriptHost {
  readonly api: CardApi;
  private readonly resources: Resources;
  private readonly scope: Record<string, unknown>;
  private disposed = false;

  constructor(private readonly o: ScriptHostOptions) {
    this.resources = new Resources((message) => o.ctx.report(message));
    this.api = createCardApi({
      engine: o.engine,
      shadow: o.shadow,
      ctx: o.ctx,
      cleanup: (fn) => this.resources.add(fn),
      storeName: o.storeName,
    });
    this.scope = this.createScope();
  }

  /**
   * Runs all scripts in document order. Returns a promise only when something asynchronous
   * (external or module script) is involved; otherwise everything has already run.
   * Never rejects: problems are reported and the next script still runs.
   */
  run(): Promise<void> | undefined {
    let chain: Promise<void> | undefined;
    for (const script of Array.from(this.o.content.querySelectorAll('script'))) {
      const step = (): void | Promise<void> => {
        if (this.disposed) return;
        try {
          const r = this.exec(script);
          return r ? r.catch((err) => this.fail(script, err)) : undefined;
        } catch (err) {
          this.fail(script, err);
        }
      };
      if (chain) chain = chain.then(step);
      else chain = step() || undefined;
    }
    return chain;
  }

  dispose(): void {
    this.disposed = true;
    this.resources.dispose();
  }

  // ---- execution ----

  private exec(script: HTMLScriptElement): void | Promise<void> {
    const type = (script.getAttribute('type') ?? '').trim().toLowerCase();
    const isModule = type === 'module';
    const classic = type === '' || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
    if (!isModule && !classic) return; // data blocks (application/json, text/template ...)

    const src = script.getAttribute('src');
    const code = script.textContent ?? '';
    if (src) {
      if (isModule) return import(/* @vite-ignore */ src).then(() => undefined);
      return loadExternal(src, script);
    }
    if (!code.trim()) return;
    if (isModule) return this.runModule(code);
    this.runClassic(code);
  }

  private runClassic(code: string): void {
    // `with` + a null-prototype scope makes the names visible without parameters and keeps
    // `hass` live. (new Function bodies are sloppy mode, so `with` is legal.)
    const fn = new Function('__scope', `with (__scope) {\n${code}\n}`);
    fn(this.scope);
  }

  private async runModule(code: string): Promise<void> {
    const key = `__hac_${++moduleCounter}`;
    const g = globalThis as Record<string, unknown>;
    g[key] = this.scope;
    // Modules are strict (no `with`): hand the same names over as constants.
    // `hass` is a snapshot here; card.hass is the live object.
    const names = Object.keys(this.scope).filter((n) => n !== 'globalThis');
    const source = `const __s = globalThis[${JSON.stringify(key)}];\nconst { ${names.join(', ')} } = __s;\n${code}`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
      delete g[key];
    }
  }

  private createScope(): Record<string, unknown> {
    const res = this.resources;
    const scope: Record<string, unknown> = Object.create(null);
    scope.card = this.api;
    scope.document = createDocumentShim(this.o.shadow, this.o.content, res);
    Object.defineProperty(scope, 'hass', { get: () => this.o.engine.hass, enumerable: true });

    // Card-scoped versions: nothing keeps running or listening after the card is gone.
    scope.setTimeout = res.setTimeout;
    scope.setInterval = res.setInterval;
    scope.clearTimeout = res.clearTimeout;
    scope.clearInterval = res.clearInterval;
    scope.requestAnimationFrame = res.requestAnimationFrame;
    scope.cancelAnimationFrame = res.cancelAnimationFrame;
    scope.addEventListener = (type: string, l: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) =>
      res.listen(window, type, l, o);
    scope.removeEventListener = (type: string, l: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) =>
      res.unlisten(window, type, l, o);

    // Observers disconnect themselves on teardown.
    for (const name of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver']) {
      const Base = (globalThis as Record<string, unknown>)[name] as
        | (new (...args: unknown[]) => { disconnect(): void; observe(...args: unknown[]): void })
        | undefined;
      if (typeof Base !== 'function') continue;
      scope[name] = class extends Base {
        constructor(...args: unknown[]) {
          super(...args);
          res.add(() => this.disconnect());
        }
        observe(...args: unknown[]): void {
          if (res.isDisposed) return; // created by async code after the card was torn down
          super.observe(...args);
        }
      };
    }

    const win = createWindowShim(scope);
    scope.window = win;
    scope.self = win;
    scope.globalThis = win;
    return scope;
  }

  private fail(script: Element, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const where = script.getAttribute('src') ? ` (${script.getAttribute('src')})` : '';
    this.o.ctx.report(`Script error${where}: ${message}`);
    console.error('[html-action-card] script error', err);
  }
}

/** Classic <script src>: a real script tag in the page, loaded once per URL (CDN libraries). */
function loadExternal(src: string, original: Element): Promise<void> {
  const cached = externalScripts.get(src);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    for (const name of ['crossorigin', 'integrity', 'referrerpolicy', 'nonce']) {
      const value = original.getAttribute(name);
      if (value !== null) el.setAttribute(name, value);
    }
    el.onload = () => resolve();
    el.onerror = () => {
      externalScripts.delete(src); // allow a retry after a failure
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.append(el);
  });
  externalScripts.set(src, promise);
  return promise;
}
