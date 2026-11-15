import { analyze } from '../analyze';
import { splitFrontmatter } from '../render/frontmatter';
import type { CardMeta } from '../render/frontmatter';
import type { CardConfig, Finding, HomeAssistant, Severity } from '../types';

/**
 * Card editor. The security rating sits on top. Below it:
 *  - form mode, when the content declares inputs in its frontmatter (like a blueprint): the
 *    card's name and description and one field per input, built with Home Assistant's own
 *    `ha-form` and selectors;
 *  - code mode: one field that holds the whole card (frontmatter, HTML, <style>, <script>).
 * The Lovelace card dialog shows the live preview next to it.
 */
const TEMPLATE = `
<style>
  :host { display: block; }
  [hidden] { display: none !important; }
  label { display: block; margin: 12px 0 4px; font-weight: 500; color: var(--primary-text-color); }
  textarea {
    box-sizing: border-box; width: 100%; min-height: 360px; padding: 8px; resize: vertical;
    font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; white-space: pre;
    color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, #ccc); border-radius: 6px;
  }
  textarea:focus { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -1px; }
  .hint { margin-top: 4px; font-size: 12px; color: var(--secondary-text-color); }
  code { font-size: 12px; }

  #rating { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--divider-color, #ccc);
            border-left-width: 6px; color: var(--primary-text-color); }
  #rating.green { border-left-color: var(--success-color, #43a047); }
  #rating.yellow { border-left-color: var(--warning-color, #ffa600); }
  #rating.red { border-left-color: var(--error-color, #db4437); }
  #rating-title { font-weight: 600; }
  #rating-note { font-size: 12px; color: var(--secondary-text-color); }
  #findings { list-style: none; margin: 8px 0 0; padding: 0; font-size: 13px; max-height: 160px; overflow: auto; }
  #findings:empty { display: none; }
  #findings li { display: flex; gap: 8px; padding: 3px 0; align-items: baseline; }
  .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--secondary-text-color, #888); }
  li.red .dot { background: var(--error-color, #db4437); }
  li.yellow .dot { background: var(--warning-color, #ffa600); }
  .where { flex: none; color: var(--secondary-text-color); font-size: 12px; min-width: 48px; }

  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
  .bar h3 { margin: 0; font-size: 16px; font-weight: 500; color: var(--primary-text-color); }
  .meta { margin: 4px 0 0; font-size: 13px; color: var(--secondary-text-color); }
  .switch {
    flex: none; padding: 6px 12px; cursor: pointer; font: inherit; font-size: 13px;
    color: var(--primary-color, #03a9f4); background: none;
    border: 1px solid var(--divider-color, #ccc); border-radius: 18px;
  }
  #form { margin-top: 12px; }
  .field { display: block; margin-bottom: 12px; }
  .field span { display: block; margin-bottom: 4px; font-size: 13px; font-weight: 500; color: var(--primary-text-color); }
  .field small { display: block; margin-top: 3px; font-size: 12px; color: var(--secondary-text-color); }
  .field input {
    box-sizing: border-box; width: 100%; padding: 8px; font: inherit; font-size: 14px;
    color: var(--primary-text-color); background: var(--card-background-color, #fff);
    border: 1px solid var(--divider-color, #ccc); border-radius: 6px;
  }
</style>
<div id="rating" role="status" aria-live="polite">
  <div id="rating-title"></div>
  <div id="rating-note"></div>
  <ul id="findings"></ul>
</div>

<section id="form-view" hidden>
  <div class="bar">
    <h3 id="card-name"></h3>
    <button class="switch" id="to-code" type="button">Edit code</button>
  </div>
  <p class="meta" id="card-meta"></p>
  <div id="form"></div>
</section>

<section id="code-view">
  <div class="bar" id="code-bar" hidden>
    <h3>Code</h3>
    <button class="switch" id="to-form" type="button">Back to the form</button>
  </div>
  <label for="content">Card (HTML, with &lt;style&gt; and &lt;script&gt; if you like)</label>
  <textarea id="content" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
  <div class="hint">
    Insert states with <code>{{ light.kitchen.state }}</code>, hide with <code>data-show-if="light.kitchen.state == on"</code>,
    act with <code>data-event="tap" data-action="light.toggle" data-entity="light.kitchen"</code>.
    CSS goes into a <code>&lt;style&gt;</code> block and stays inside the card. A <code>&lt;script&gt;</code> block can use <code>card</code>.
    A frontmatter block with <code>inputs</code> at the top turns this into a form.
  </div>
</section>
`;

const RATING_TEXT: Record<Severity, [title: string, note: string]> = {
  green: ['Security rating: green', 'Plain markup. Nothing here runs code or loads anything from elsewhere.'],
  yellow: ['Security rating: yellow', 'Worth a look before you use it. Nothing is blocked; you decide.'],
  red: ['Security rating: red', 'This card can run or load foreign code. Only use it if you understand it. Nothing is blocked; you decide.'],
};

/**
 * Every emitted change re-renders the preview card and re-runs its scripts. While someone is
 * typing, the markup and scripts are half finished, so wait for a pause before emitting.
 */
export const EDITOR_DEBOUNCE_MS = 400;

interface HaForm extends HTMLElement {
  hass?: HomeAssistant;
  data?: Record<string, unknown>;
  schema?: unknown[];
  computeLabel?: (s: { name: string }) => string;
  computeHelper?: (s: { name: string }) => string | undefined;
}

export class HtmlActionCardEditor extends HTMLElement {
  private _config?: CardConfig;
  private _hass?: HomeAssistant;
  private _timer?: ReturnType<typeof setTimeout>;
  private _meta?: CardMeta;
  private _mode: 'form' | 'code' = 'form';
  private _formKey = '';
  private readonly _root: ShadowRoot;
  private readonly _content: HTMLTextAreaElement;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    this._root.innerHTML = TEMPLATE;
    this._content = this._root.getElementById('content') as HTMLTextAreaElement;
    this._content.addEventListener('input', () => {
      this._update(); // rating and form follow every keystroke: they only read text
      this._schedule();
    });
    this._content.addEventListener('change', () => this._emit()); // leaving the field: do not wait
    this._el('to-code').addEventListener('click', () => this._setMode('code'));
    this._el('to-form').addEventListener('click', () => this._setMode('form'));
    this._update();
  }

  setConfig(config: CardConfig): void {
    this._config = config;
    if (this._timer) return; // the user is typing: the field is newer than this config
    // Only touch the field when it really differs: HA hands our own change back to us,
    // and rewriting the value would move the caret.
    const content = config.content ?? '';
    if (this._content.value !== content) this._content.value = content;
    this._update();
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    this._hass = hass;
    const form = this._root.querySelector('ha-form') as HaForm | null;
    if (form) form.hass = hass;
    if (first) {
      this._formKey = ''; // entity pickers need hass: build the form again
      this._update();
    }
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  disconnectedCallback(): void {
    this._emit(); // dialog closed mid-typing: do not lose the last edit
  }

  // ---- views ----

  private _el(id: string): HTMLElement {
    return this._root.getElementById(id)!;
  }

  private _hasInputs(): boolean {
    return Object.keys(this._meta?.inputs ?? {}).length > 0;
  }

  private _setMode(mode: 'form' | 'code'): void {
    this._mode = mode;
    this._update();
  }

  private _update(): void {
    const { meta } = splitFrontmatter(this._content.value);
    this._meta = meta;
    const form = this._hasInputs() && this._mode === 'form';
    this._el('form-view').hidden = !form;
    this._el('code-view').hidden = form;
    this._el('code-bar').hidden = !this._hasInputs();
    this._rate();
    if (form) this._renderForm();
  }

  private _renderForm(): void {
    const meta = this._meta!;
    this._el('card-name').textContent = meta.name ?? 'Card';
    this._el('card-meta').textContent = [meta.description, meta.author && `by ${meta.author}`].filter(Boolean).join(' · ');

    const values = this._config?.inputs ?? {};
    const key = JSON.stringify(meta.inputs) + (customElements.get('ha-form') ? ':ha' : ':plain');
    if (key === this._formKey) {
      // Same inputs: only refresh the values, keep focus and open pickers.
      const haForm = this._root.querySelector('ha-form') as HaForm | null;
      if (haForm) haForm.data = { ...values };
      return;
    }
    this._formKey = key;
    const container = this._el('form');

    if (customElements.get('ha-form')) {
      const haForm = document.createElement('ha-form') as HaForm;
      haForm.hass = this._hass;
      haForm.data = { ...values };
      haForm.schema = Object.entries(meta.inputs).map(([name, spec]) => ({
        name,
        selector: spec.selector ?? { text: {} },
      }));
      haForm.computeLabel = (s) => meta.inputs[s.name]?.name ?? s.name;
      haForm.computeHelper = (s) => meta.inputs[s.name]?.description;
      haForm.addEventListener('value-changed', (e) => this._setInputs((e as CustomEvent).detail.value));
      container.replaceChildren(haForm);
      return;
    }

    // Outside Home Assistant (or before its form has loaded): plain fields.
    container.replaceChildren(
      ...Object.entries(meta.inputs).map(([name, spec]) => {
        const label = document.createElement('label');
        label.className = 'field';
        const title = document.createElement('span');
        title.textContent = spec.name ?? name;
        const input = document.createElement('input');
        input.name = name;
        input.value = values[name] == null ? '' : String(values[name]);
        input.placeholder = spec.default == null ? entityPlaceholder(spec.selector) : String(spec.default);
        input.addEventListener('change', () => this._setInputs({ ...(this._config?.inputs ?? {}), [name]: input.value }));
        label.append(title, input);
        if (spec.description) {
          const help = document.createElement('small');
          help.textContent = spec.description;
          label.append(help);
        }
        return label;
      }),
    );
    loadHaForm().then((loaded) => {
      if (loaded && this._mode === 'form' && this._hasInputs()) {
        this._formKey = '';
        this._renderForm();
      }
    });
  }

  // ---- config changes ----

  private _setInputs(values: Record<string, unknown>): void {
    const inputs: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values ?? {})) {
      if (value !== undefined && value !== null && value !== '') inputs[name] = value;
    }
    const config: CardConfig = { ...(this._config ?? { type: 'custom:html-action-card', content: this._content.value }) };
    if (Object.keys(inputs).length) config.inputs = inputs;
    else delete config.inputs;
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  private _schedule(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._emit(), EDITOR_DEBOUNCE_MS);
  }

  private _emit(): void {
    if (!this._timer) return; // nothing pending
    clearTimeout(this._timer);
    this._timer = undefined;

    const config: CardConfig = { ...(this._config ?? { type: 'custom:html-action-card', content: '' }) };
    config.content = this._content.value;
    this._config = config;
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config }, bubbles: true, composed: true }));
  }

  private _rate(): void {
    const report = analyze(this._content.value, { hass: this._hass });
    const [title, note] = RATING_TEXT[report.severity];
    this._el('rating').className = report.severity;
    this._el('rating-title').textContent = title;
    this._el('rating-note').textContent = note;
    // Messages quote the user's markup: build nodes with textContent, never innerHTML.
    this._el('findings').replaceChildren(...report.findings.map(renderFinding));
  }
}

function entityPlaceholder(selector: Record<string, unknown> | undefined): string {
  const entity = selector?.entity as { domain?: unknown } | undefined;
  if (!entity) return '';
  const domain = Array.isArray(entity.domain) ? entity.domain[0] : entity.domain;
  return `${typeof domain === 'string' ? domain : 'domain'}.your_entity`;
}

let haFormLoading: Promise<boolean> | undefined;

/**
 * Home Assistant loads its form elements lazily. Creating the config element of a built-in
 * card is the common way to make them available to a custom card editor.
 */
function loadHaForm(): Promise<boolean> {
  if (customElements.get('ha-form')) return Promise.resolve(true);
  haFormLoading ??= (async () => {
    const helpers = await (window as { loadCardHelpers?: () => Promise<{ createCardElement(c: unknown): HTMLElement }> })
      .loadCardHelpers?.()
      .catch(() => undefined);
    if (!helpers) return false;
    try {
      const card = helpers.createCardElement({ type: 'entities', entities: [] });
      await (card.constructor as { getConfigElement?: () => Promise<unknown> }).getConfigElement?.();
    } catch {
      /* fall through to the timeout */
    }
    return Promise.race([
      customElements.whenDefined('ha-form').then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
  })();
  return haFormLoading;
}

function renderFinding(f: Finding): HTMLElement {
  const li = document.createElement('li');
  li.className = f.level;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const where = document.createElement('span');
  where.className = 'where';
  where.textContent = f.line ? `Line ${f.line}` : '';
  const text = document.createElement('span');
  text.textContent = f.message;
  li.append(dot, where, text);
  return li;
}
