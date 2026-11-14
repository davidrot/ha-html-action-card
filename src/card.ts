import { ActionController } from './actions';
import type { ControllerContext } from './actions';
import { Binder } from './render/binder';
import { protectExpressions } from './render/template';
import { Engine } from './reactive/tracker';
import { ScriptHost } from './script';
import type { CardConfig, HomeAssistant } from './types';

/**
 * The card element. Renders user HTML/CSS verbatim into a Shadow DOM, keeps `{{ }}` and
 * `data-show-if` bound to Home Assistant states, handles data-event/data-action and runs the
 * user's scripts.
 *
 * Start-up order: render DOM -> bind -> scripts -> first evaluation (needs scripts first, so
 * exposed functions exist) -> live updates.
 */
export class HtmlActionCard extends HTMLElement {
  private _config?: CardConfig;
  private _hass?: HomeAssistant;
  private readonly _root: ShadowRoot;
  private _content?: HTMLElement;
  private _engine?: Engine;
  private _binder?: Binder;
  private _actions?: ActionController;
  private _scripts?: ScriptHost;
  private _ready = false;
  private _torn = false;
  private readonly _warned = new Set<string>();

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
  }

  /** Visual editor shown in the Lovelace card dialog. */
  static getConfigElement(): HTMLElement {
    return document.createElement('html-action-card-editor');
  }

  /** Config for a freshly added card (card picker). Uses a light if the user has one. */
  static getStubConfig(_hass?: unknown, entities?: string[]): CardConfig {
    const entity = entities?.find((e) => e.startsWith('light.')) ?? entities?.[0] ?? 'light.example';
    return {
      type: 'custom:html-action-card',
      content: `<style>
  button {
    padding: 12px 24px; border: 0; border-radius: 12px;
    background: var(--primary-color); color: white; font-size: 16px;
  }
</style>
<button data-action="toggle" data-entity="${entity}">
  {{ ${entity}.state }}
</button>`,
    };
  }

  setConfig(config: CardConfig): void {
    if (!config || typeof config.content !== 'string') {
      throw new Error('html-action-card: "content" (HTML string) is required');
    }
    // Lovelace may hand over the same config again; re-rendering would re-run all scripts.
    const unchanged = this._engine && this._config && JSON.stringify(this._config) === JSON.stringify(config);
    this._config = config;
    if (unchanged) return;
    if ('style' in config) this._warn('The "style" option was removed. Put the CSS into a <style> block in "content".');
    this._teardown();
    // Lovelace configures a card before it attaches it. Scripts that measure or read styles
    // (getComputedStyle, getBoundingClientRect) need the card in the page, so render on attach.
    if (this.isConnected) this._render();
    else this._torn = true;
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    if (!this._ready) return; // scripts still running: applied by start()
    this._engine?.setHass(hass);
    if (this._content) this._content.style.visibility = '';
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  connectedCallback(): void {
    // HA detaches and re-attaches cards (e.g. while editing a dashboard).
    if (this._torn && this._config) {
      this._torn = false;
      this._render();
    }
  }

  disconnectedCallback(): void {
    this._teardown();
    this._torn = true;
  }

  getCardSize(): number {
    return 3;
  }

  getGridOptions() {
    return { columns: 6, rows: 'auto' as const };
  }

  private _render(): void {
    const config = this._config!;

    const base = document.createElement('style');
    // Defaults the user's CSS may override. press/hold need touch-action:none, or the browser
    // starts scrolling and cancels the pointer.
    base.textContent =
      ':host{display:block}[hidden]{display:none !important}' +
      '[data-event=press],[data-event=hold]{touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}';
    const card = document.createElement('ha-card');
    const content = document.createElement('div');
    content.id = 'content';
    // Verbatim, no sanitizing by design. Only `<` inside {{ }} is escaped so the HTML parser
    // cannot mistake `{{ a<b }}` for a tag.
    content.innerHTML = protectExpressions(config.content);
    // Invisible until the first evaluation, but laid out: scripts may measure at start-up.
    content.style.visibility = 'hidden';
    card.append(content);
    this._root.replaceChildren(base, card);
    this._content = content;

    const engine = new Engine({
      refreshInterval: config.refresh_interval,
      onError: (message) => this._warn(message),
    });
    this._engine = engine;
    this._ready = false;

    const binder = new Binder(engine, content);
    this._binder = binder;
    binder.start();

    const ctx: ControllerContext = {
      hass: () => this._hass,
      host: this,
      report: (message) => this._warn(message),
      notify: (message) =>
        this.dispatchEvent(new CustomEvent('hass-notification', { detail: { message }, bubbles: true, composed: true })),
    };
    const actions = new ActionController(content, ctx);
    this._actions = actions;
    actions.start();

    const scripts = new ScriptHost({ engine, shadow: this._root, content, ctx });
    this._scripts = scripts;

    const start = () => {
      if (this._scripts !== scripts) return; // re-rendered or torn down meanwhile
      this._ready = true;
      if (this._hass) {
        engine.setHass(this._hass);
        content.style.visibility = '';
      }
    };
    const pending = scripts.run(); // external/module scripts make this asynchronous
    if (pending) void pending.then(start);
    else start();
  }

  private _teardown(): void {
    this._scripts?.dispose();
    this._actions?.stop();
    this._binder?.stop();
    this._engine?.dispose();
    this._scripts = undefined;
    this._actions = undefined;
    this._binder = undefined;
    this._engine = undefined;
    this._ready = false;
  }

  private _warn(message: string): void {
    if (this._warned.has(message)) return;
    this._warned.add(message);
    console.warn(`[html-action-card] ${message}`);
  }
}
