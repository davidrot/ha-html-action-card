import { analyze } from '../analyze';
import type { CardConfig, Finding, HomeAssistant, Severity } from '../types';

/**
 * Card editor: the security rating on top, then one field that holds the
 * whole card (HTML with <style> and <script> blocks). The Lovelace card dialog already shows
 * a live preview next to it, so none is built here.
 */
const TEMPLATE = `
<style>
  :host { display: block; }
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
</style>
<div id="rating" role="status" aria-live="polite">
  <div id="rating-title"></div>
  <div id="rating-note"></div>
  <ul id="findings"></ul>
</div>
<label for="content">Card (HTML, with &lt;style&gt; and &lt;script&gt; if you like)</label>
<textarea id="content" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
<div class="hint">
  Insert states with <code>{{ light.kitchen.state }}</code>, hide with <code>data-show-if="light.kitchen.state == on"</code>,
  act with <code>data-event="tap" data-action="light.toggle" data-entity="light.kitchen"</code>.
  CSS goes into a <code>&lt;style&gt;</code> block and stays inside the card. A <code>&lt;script&gt;</code> block can use <code>card</code>.
</div>
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

export class HtmlActionCardEditor extends HTMLElement {
  private _config?: CardConfig;
  private _hass?: HomeAssistant;
  private _timer?: ReturnType<typeof setTimeout>;
  private readonly _content: HTMLTextAreaElement;
  private readonly _rating: HTMLElement;
  private readonly _ratingTitle: HTMLElement;
  private readonly _ratingNote: HTMLElement;
  private readonly _findings: HTMLElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = TEMPLATE;
    this._content = root.getElementById('content') as HTMLTextAreaElement;
    this._rating = root.getElementById('rating')!;
    this._ratingTitle = root.getElementById('rating-title')!;
    this._ratingNote = root.getElementById('rating-note')!;
    this._findings = root.getElementById('findings')!;
    this._content.addEventListener('input', () => {
      this._rate(); // the rating reads text only, so it can follow every keystroke
      this._schedule();
    });
    this._content.addEventListener('change', () => this._emit()); // leaving the field: do not wait
    this._rate();
  }

  setConfig(config: CardConfig): void {
    this._config = config;
    if (this._timer) return; // the user is typing: the field is newer than this config
    // Only touch the field when it really differs: HA hands our own change back to us,
    // and rewriting the value would move the caret.
    const content = config.content ?? '';
    if (this._content.value !== content) this._content.value = content;
    this._rate();
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._rate(); // unknown-entity hints need hass; no need to redo it on every update
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  disconnectedCallback(): void {
    this._emit(); // dialog closed mid-typing: do not lose the last edit
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
    this._rating.className = report.severity;
    this._ratingTitle.textContent = title;
    this._ratingNote.textContent = note;
    // Messages quote the user's markup: build nodes with textContent, never innerHTML.
    this._findings.replaceChildren(...report.findings.map(renderFinding));
  }
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
