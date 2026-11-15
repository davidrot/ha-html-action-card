// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../main';
import { HtmlActionCard } from '../card';
import type { CardConfig } from '../types';
import { EDITOR_DEBOUNCE_MS } from './editor';
import type { HtmlActionCardEditor } from './editor';

let editor: HtmlActionCardEditor;
let events: CardConfig[];

const field = (id: string) => editor.shadowRoot!.getElementById(id) as HTMLTextAreaElement;
const input = (id: string, value: string) => {
  field(id).value = value;
  field(id).dispatchEvent(new Event('input', { bubbles: true }));
};
/** Type and wait for the debounce. */
const type = (id: string, value: string) => {
  input(id, value);
  vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
};

beforeEach(() => {
  vi.useFakeTimers();
  editor = document.createElement('html-action-card-editor') as HtmlActionCardEditor;
  events = [];
  editor.addEventListener('config-changed', (e) => events.push((e as CustomEvent).detail.config));
});
afterEach(() => vi.useRealTimers());

describe('editor', () => {
  it('shows the card content in one field; there is no separate CSS field', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '<style>b{color:red}</style><b>x</b>' });
    expect(field('content').value).toBe('<style>b{color:red}</style><b>x</b>');
    expect(editor.shadowRoot!.querySelectorAll('textarea').length).toBe(1);
  });

  it('the rating sits above the field', () => {
    const order = Array.from(editor.shadowRoot!.querySelectorAll('#rating, #content')).map((e) => e.id);
    expect(order).toEqual(['rating', 'content']);
  });

  it('emits config-changed with the full config and keeps other keys', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: 'a', refresh_interval: 500 });
    type('content', '<i>new</i>');
    expect(events).toEqual([{ type: 'custom:html-action-card', content: '<i>new</i>', refresh_interval: 500 }]);
  });

  it('waits for a typing pause: many keystrokes, one event', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '' });
    input('content', '<');
    vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS - 1);
    input('content', '<b');
    vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS - 1);
    input('content', '<b>x</b>');
    expect(events).toEqual([]);
    vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
    expect(events.map((c) => c.content)).toEqual(['<b>x</b>']);
  });

  it('leaving the field or closing the dialog emits right away', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '' });
    input('content', 'a');
    field('content').dispatchEvent(new Event('change', { bubbles: true }));
    expect(events.map((c) => c.content)).toEqual(['a']);
    document.body.append(editor);
    input('content', 'ab');
    editor.remove();
    expect(events.map((c) => c.content)).toEqual(['a', 'ab']);
    vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS * 2);
    expect(events.length).toBe(2); // no late duplicate
  });

  it('setConfig with an unchanged value does not rewrite the field (caret stays)', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: 'a' });
    const ta = field('content');
    let writes = 0;
    let current = ta.value;
    Object.defineProperty(ta, 'value', {
      get: () => current,
      set: (v: string) => {
        writes++;
        current = v;
      },
    });
    editor.setConfig({ type: 'custom:html-action-card', content: 'a' });
    expect(writes).toBe(0);
    editor.setConfig({ type: 'custom:html-action-card', content: 'b' });
    expect(writes).toBe(1);
    expect(ta.value).toBe('b');
  });

  it('a setConfig arriving while typing does not overwrite what was typed', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: 'a' });
    input('content', 'abc');
    editor.setConfig({ type: 'custom:html-action-card', content: 'a' });
    expect(field('content').value).toBe('abc');
    vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
    expect(events.map((c) => c.content)).toEqual(['abc']);
  });

  it('works before setConfig is called', () => {
    type('content', 'hi');
    expect(events[0]).toEqual({ type: 'custom:html-action-card', content: 'hi' });
  });
});

describe('security rating in the editor', () => {
  const rating = () => editor.shadowRoot!.getElementById('rating')!;
  const items = () => Array.from(editor.shadowRoot!.querySelectorAll('#findings li')).map((li) => `${li.className}|${li.textContent}`);

  it('is green and empty for plain markup', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '<b>{{ light.a.state }}</b>' });
    expect(rating().className).toBe('green');
    expect(items()).toEqual([]);
    expect(rating().textContent).toContain('green');
  });

  it('follows typing immediately, before the debounced config change', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '' });
    input('content', '<p>a</p>\n<iframe src="/x"></iframe>');
    expect(rating().className).toBe('red');
    expect(items()[0]).toContain('red|Line 2');
    expect(events).toEqual([]);
    input('content', '<p>a</p>');
    expect(rating().className).toBe('green');
  });

  it('rates a <style> block inside the content', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '<p>a</p>\n<style>\np { background: url(https://example.com/x.png) }\n</style>' });
    expect(rating().className).toBe('yellow');
    expect(items()[0]).toContain('yellow|Line 3');
  });

  it('shows the message as text, never as HTML', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '<img src="https://x.example/<b>bold</b>">' });
    expect(editor.shadowRoot!.querySelector('#findings b')).toBeNull();
    expect(items()[0]).toContain('<b>bold</b>');
  });

  it('with hass, unknown entities show up as hints without changing the rating', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '<b>{{ light.nope.state }}</b>' });
    expect(items()).toEqual([]);
    editor.hass = { states: {}, callService: async () => undefined } as never;
    expect(rating().className).toBe('green');
    expect(items()[0]).toContain('Unknown entity light.nope');
  });
});

describe('form mode for cards with inputs', () => {
  const CARD = `---
name: Lamp switch
description: One button.
author: someone
inputs:
  lamp:
    name: Lamp
    description: The light to switch.
    selector:
      entity:
        domain: light
  label:
    name: Label
    default: Lamp
---
<button data-entity="{{ input.lamp }}">{{ input.label }}</button>`;
  const view = (id: string) => editor.shadowRoot!.getElementById(id)!;

  it('without inputs there is only the code', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: '<b>x</b>' });
    expect(view('form-view').hidden).toBe(true);
    expect(view('code-view').hidden).toBe(false);
    expect(view('code-bar').hidden).toBe(true);
  });

  it('with inputs it opens as a form with name, description and one field per input', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: CARD, inputs: { lamp: 'light.desk' } });
    expect(view('form-view').hidden).toBe(false);
    expect(view('code-view').hidden).toBe(true);
    expect(view('card-name').textContent).toBe('Lamp switch');
    expect(view('card-meta').textContent).toBe('One button. · by someone');
    const fields = Array.from(editor.shadowRoot!.querySelectorAll<HTMLInputElement>('#form input'));
    expect(fields.map((f) => [f.name, f.value, f.placeholder])).toEqual([
      ['lamp', 'light.desk', 'light.your_entity'],
      ['label', '', 'Lamp'],
    ]);
    expect(view('rating').className).toBe('green');
  });

  it('a picked value is saved under inputs, without touching the content', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: CARD });
    const field = editor.shadowRoot!.querySelector<HTMLInputElement>('#form input[name="lamp"]')!;
    field.value = 'light.kitchen';
    field.dispatchEvent(new Event('change'));
    expect(events).toEqual([{ type: 'custom:html-action-card', content: CARD, inputs: { lamp: 'light.kitchen' } }]);
  });

  it('switches between form and code; the code keeps the inputs', () => {
    editor.setConfig({ type: 'custom:html-action-card', content: CARD, inputs: { lamp: 'light.desk' } });
    view('to-code').click();
    expect(view('code-view').hidden).toBe(false);
    expect(view('code-bar').hidden).toBe(false);
    type('content', CARD + '<i></i>');
    expect(events[0].inputs).toEqual({ lamp: 'light.desk' });
    view('to-form').click();
    expect(view('form-view').hidden).toBe(false);
  });

  it("uses Home Assistant's ha-form with the selectors when it is available", () => {
    class FakeHaForm extends HTMLElement {
      hass: unknown;
      data: unknown;
      schema: unknown;
      computeLabel?: (s: { name: string }) => string;
    }
    if (!customElements.get('ha-form')) customElements.define('ha-form', FakeHaForm);
    const fresh = document.createElement('html-action-card-editor') as HtmlActionCardEditor;
    const seen: CardConfig[] = [];
    fresh.addEventListener('config-changed', (e) => seen.push((e as CustomEvent).detail.config));
    fresh.setConfig({ type: 'custom:html-action-card', content: CARD, inputs: { lamp: 'light.desk' } });
    const form = fresh.shadowRoot!.querySelector('ha-form') as FakeHaForm;
    expect(form.schema).toEqual([
      { name: 'lamp', selector: { entity: { domain: 'light' } } },
      { name: 'label', selector: { text: {} } },
    ]);
    expect(form.data).toEqual({ lamp: 'light.desk' });
    expect(form.computeLabel!({ name: 'lamp' })).toBe('Lamp');
    form.dispatchEvent(new CustomEvent('value-changed', { detail: { value: { lamp: 'light.desk', label: 'Desk' } } }));
    expect(seen[0].inputs).toEqual({ lamp: 'light.desk', label: 'Desk' });
  });
});

describe('card hooks for Lovelace', () => {
  it('getConfigElement returns the editor', () => {
    expect(HtmlActionCard.getConfigElement().localName).toBe('html-action-card-editor');
  });

  it('getStubConfig prefers a light and is a valid config', () => {
    const stub = HtmlActionCard.getStubConfig(undefined, ['sensor.t', 'light.desk', 'light.other']);
    expect(stub.type).toBe('custom:html-action-card');
    expect(stub.content).toContain('light.desk');
    const card = document.createElement('html-action-card') as HtmlActionCard;
    expect(() => card.setConfig(stub)).not.toThrow();
  });

  it('getStubConfig falls back without entities', () => {
    expect(HtmlActionCard.getStubConfig().content).toContain('light.example');
    expect(HtmlActionCard.getStubConfig(undefined, ['sensor.t']).content).toContain('sensor.t');
  });

  it('setConfig with an identical config does not re-render or re-run scripts', () => {
    (globalThis as unknown as Record<string, number>).__runs = 0;
    const card = document.createElement('html-action-card') as HtmlActionCard;
    document.body.append(card);
    const config = { type: 'custom:html-action-card', content: '<p>x</p><script>globalThis.__runs++</script>' };
    card.setConfig(config);
    card.setConfig({ ...config });
    expect((globalThis as unknown as Record<string, number>).__runs).toBe(1);
    card.setConfig({ ...config, content: config.content + '<i></i>' });
    expect((globalThis as unknown as Record<string, number>).__runs).toBe(2);
    card.remove();
  });

  it('a card configured before it is attached renders (and runs scripts) once, on attach', () => {
    (globalThis as unknown as Record<string, unknown>).__seen = [];
    const card = document.createElement('html-action-card') as HtmlActionCard;
    card.setConfig({
      type: 'custom:html-action-card',
      content: '<p>x</p><script>globalThis.__seen.push(document.querySelector("p").isConnected)</script>',
    });
    card.setConfig({ type: 'custom:html-action-card', content: '<p>y</p><script>globalThis.__seen.push(document.querySelector("p").isConnected)</script>' });
    expect((globalThis as unknown as Record<string, unknown>).__seen).toEqual([]);
    document.body.append(card);
    expect((globalThis as unknown as Record<string, unknown>).__seen).toEqual([true]);
    expect(card.shadowRoot!.querySelector('p')!.textContent).toBe('y');
    card.remove();
  });

  it('styles live in the content and stay inside the card; the old style option only warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const card = document.createElement('html-action-card') as HtmlActionCard;
    document.body.append(card);
    card.setConfig({ type: 'custom:html-action-card', content: '<style>p{color:red}</style><p>x</p>' });
    expect(card.shadowRoot!.querySelector('#content style')!.textContent).toBe('p{color:red}');
    expect(document.querySelector('style')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    card.setConfig({ type: 'custom:html-action-card', content: '<p>y</p>', style: 'p{}' } as never);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"style" option was removed'));
    warn.mockRestore();
    card.remove();
  });
});
