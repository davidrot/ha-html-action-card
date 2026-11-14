/**
 * Binds the rendered DOM to the engine:
 *  - `{{ }}` in text nodes and attribute values
 *  - `data-show-if` (toggles the `hidden` attribute)
 * Also picks up HTML added later (MutationObserver, childList + subtree only, so our own
 * text/attribute writes never trigger it) and disposes bindings of removed nodes.
 * <script> and <style> are never interpolated.
 */
import { STATE_CLASSES } from '../constants';
import type { Computation, Engine } from '../reactive/tracker';
import { hasExpressions, parseTemplate, renderParts, singleExpression } from './template';
import type { Part } from './template';

const SKIP = new Set(['script', 'style']);

/**
 * HTML boolean attributes work by being present: `disabled="false"` still disables.
 * For `disabled="{{ expr }}"` the attribute is therefore added or removed, never set to "false".
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer', 'disabled',
  'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate',
  'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected',
]);
/** After the user interacted, these attributes no longer drive the live state; the property does. */
const LIVE_PROPERTIES = new Set(['checked', 'selected', 'muted']);

const normalizeClass = (s: string | null): string =>
  (s ?? '')
    .split(/\s+/)
    .filter((c) => c && !(STATE_CLASSES as readonly string[]).includes(c))
    .join(' ');

/** Writes an attribute; `class` keeps the framework's state classes (is-pending, is-error ...). */
function writeAttribute(el: Element, name: string, value: string): void {
  if (name === 'class') {
    if (normalizeClass(el.getAttribute('class')) === normalizeClass(value)) return;
    const keep = STATE_CLASSES.filter((c) => el.classList.contains(c));
    el.setAttribute('class', value);
    for (const c of keep) el.classList.add(c);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export class Binder {
  private readonly boundText = new WeakSet<Text>();
  private readonly boundEl = new WeakSet<Element>();
  private readonly computations = new WeakMap<Node, Computation[]>();
  // Original templates survive a later rewrite of the node, so a moved node can be re-bound.
  private readonly textTemplates = new WeakMap<Text, Part[]>();
  private readonly attrTemplates = new WeakMap<Element, Map<string, Part[]>>();
  private observer?: MutationObserver;

  constructor(
    private readonly engine: Engine,
    private readonly root: Element,
  ) {}

  start(): void {
    // A "{{ ... }}" must live in one text node (comments or odd parsers can split it).
    // Only safe before anything is bound.
    this.root.normalize();
    for (const child of Array.from(this.root.childNodes)) this.scan(child);
    if (typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(this.root, { childList: true, subtree: true });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  /** Bind a node and its subtree. Idempotent. */
  scan(node: Node): void {
    if (node.nodeType === 3) return this.bindText(node as Text);
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIP.has(el.localName)) return;
    this.bindElement(el);
    for (const child of Array.from(el.childNodes)) this.scan(child);
  }

  /** Dispose the bindings of a node and its subtree. */
  release(node: Node): void {
    const list = this.computations.get(node);
    if (list) {
      for (const c of list) c.dispose();
      this.computations.delete(node);
    }
    if (node.nodeType === 3) this.boundText.delete(node as Text);
    if (node.nodeType === 1) this.boundEl.delete(node as Element);
    for (const child of Array.from(node.childNodes)) this.release(child);
  }

  private onMutations(records: MutationRecord[]): void {
    for (const r of records) {
      for (const n of Array.from(r.removedNodes)) if (!this.root.contains(n)) this.release(n);
    }
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) if (this.root.contains(n)) this.scan(n);
    }
  }

  private add(node: Node, c: Computation): void {
    const list = this.computations.get(node);
    if (list) list.push(c);
    else this.computations.set(node, [c]);
  }

  private bindText(node: Text): void {
    if (this.boundText.has(node)) return;
    let parts = this.textTemplates.get(node);
    if (!parts) {
      parts = parseTemplate(node.data);
      if (!hasExpressions(parts)) return;
      this.textTemplates.set(node, parts);
    }
    this.boundText.add(node);
    const tpl = parts;
    this.add(
      node,
      this.engine.computation(() => {
        const text = renderParts(tpl, (e) => this.engine.evaluate(e));
        if (node.data !== text) node.data = text;
      }),
    );
  }

  private bindElement(el: Element): void {
    if (this.boundEl.has(el)) return;

    let templates = this.attrTemplates.get(el);
    for (const attr of Array.from(el.attributes)) {
      if (!attr.value.includes('{{')) continue;
      const parts = parseTemplate(attr.value);
      if (!hasExpressions(parts)) continue;
      if (!templates) this.attrTemplates.set(el, (templates = new Map()));
      templates.set(attr.name, parts);
    }

    const hasShowIf = el.hasAttribute('data-show-if');
    const entityAction = el.hasAttribute('data-action') && el.hasAttribute('data-entity');
    if (!templates && !hasShowIf && !entityAction) return;
    this.boundEl.add(el);

    if (templates) {
      for (const [name, parts] of templates) {
        const flag = BOOLEAN_ATTRIBUTES.has(name.toLowerCase()) ? singleExpression(parts) : undefined;
        if (flag !== undefined) {
          this.add(
            el,
            this.engine.computation(() => {
              const value = this.engine.evaluate(flag);
              const on = !!value && value !== 'false';
              el.toggleAttribute(name, on);
              if (LIVE_PROPERTIES.has(name.toLowerCase()) && name in el) (el as unknown as Record<string, boolean>)[name] = on;
            }),
          );
          continue;
        }
        this.add(
          el,
          this.engine.computation(() => {
            const value = renderParts(parts, (e) => this.engine.evaluate(e));
            writeAttribute(el, name, value);
          }),
        );
      }
    }

    if (entityAction) {
      // Marks the element while its entity is unavailable (the action is blocked then).
      this.add(
        el,
        this.engine.computation(() => {
          const id = (el.getAttribute('data-entity') ?? '').trim();
          el.classList.toggle('is-unavailable', !!id && this.engine.state(id) === 'unavailable');
        }),
      );
    }

    if (hasShowIf) {
      const source = el.getAttribute('data-show-if') ?? '';
      this.add(
        el,
        this.engine.computation(() => {
          const visible = !!this.engine.evaluate(source);
          el.toggleAttribute('hidden', !visible);
        }),
      );
    }
  }
}
