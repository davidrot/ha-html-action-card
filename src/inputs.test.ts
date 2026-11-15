// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './main';
import { analyze } from './analyze';
import type { HtmlActionCard } from './card';
import { resolveInputs, splitFrontmatter } from './render/frontmatter';
import { hassOf } from './testutil';

const FRONT = `---
name: Lamp switch
description: One button.
author: someone
inputs:
  lamp:
    name: Lamp
    selector:
      entity:
        domain: light
  label:
    name: Label
    default: Lamp
    selector:
      text: {}
---
`;

describe('frontmatter', () => {
  it('is split off and parsed; line numbers of the body stay the same', () => {
    const { meta, body, error } = splitFrontmatter(FRONT + '<b>x</b>');
    expect(error).toBeUndefined();
    expect(meta?.name).toBe('Lamp switch');
    expect(meta?.author).toBe('someone');
    expect(meta?.inputs.lamp.selector).toEqual({ entity: { domain: 'light' } });
    expect(meta?.inputs.label.default).toBe('Lamp');
    expect(body.split('\n').length).toBe((FRONT + '<b>x</b>').split('\n').length);
    expect(body.trim()).toBe('<b>x</b>');
  });

  it('is optional', () => {
    expect(splitFrontmatter('<b>x</b>')).toEqual({ body: '<b>x</b>' });
    expect(splitFrontmatter('<p>---</p>')).toEqual({ body: '<p>---</p>' });
  });

  it('reports invalid YAML instead of throwing', () => {
    const r = splitFrontmatter('---\nname: [oops\n---\n<b>x</b>');
    expect(r.meta).toBeUndefined();
    expect(r.error).toMatch(/not valid YAML/);
    expect(r.body.trim()).toBe('<b>x</b>');
  });

  it('picked values win over defaults; empty picks fall back', () => {
    const { meta } = splitFrontmatter(FRONT);
    expect(resolveInputs(meta, { lamp: 'light.desk' })).toEqual({ lamp: 'light.desk', label: 'Lamp' });
    expect(resolveInputs(meta, { lamp: 'light.desk', label: '' })).toEqual({ lamp: 'light.desk', label: 'Lamp' });
    expect(resolveInputs(meta, { label: 'Desk' })).toEqual({ lamp: undefined, label: 'Desk' });
  });
});

describe('inputs in the card', () => {
  let el: HtmlActionCard;
  let call: ReturnType<typeof vi.fn>;
  const sr = () => el.shadowRoot!;
  const g = globalThis as unknown as Record<string, unknown>;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    call = vi.fn(async () => undefined);
    el = document.createElement('html-action-card') as HtmlActionCard;
    document.body.append(el);
    el.hass = { ...hassOf({ 'light.desk': 'on' }), callService: call } as never;
  });
  afterEach(() => {
    el.remove();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('input.x is the picked entity id, input.x.state reads that entity, defaults apply', async () => {
    el.setConfig({
      type: 'custom:html-action-card',
      inputs: { lamp: 'light.desk' },
      content: FRONT + '<button data-action="toggle" data-entity="{{ input.lamp }}">{{ input.label }}: {{ input.lamp.state }}</button>',
    });
    const button = sr().querySelector('button')!;
    expect(button.textContent).toBe('Lamp: on');
    expect(button.getAttribute('data-entity')).toBe('light.desk');
    expect(sr().getElementById('content')!.textContent).not.toContain('name:'); // frontmatter is not rendered
    button.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(call).toHaveBeenCalledWith('homeassistant', 'toggle', { entity_id: 'light.desk' });
  });

  it('an input that is not picked renders empty', () => {
    el.setConfig({ type: 'custom:html-action-card', content: FRONT + '<p>[{{ input.lamp.state }}]</p>' });
    expect(sr().querySelector('p')!.textContent).toBe('[]');
  });

  it('scripts read inputs with card.input()', () => {
    el.setConfig({
      type: 'custom:html-action-card',
      inputs: { lamp: 'light.desk' },
      content: FRONT + '<script>globalThis.__input = [card.input("lamp"), card.input("label")]</script>',
    });
    expect(g.__input).toEqual(['light.desk', 'Lamp']);
  });

  it('card.store keeps values across a re-render, namespaced by the card name', () => {
    const content = FRONT + '<script>globalThis.__seen = card.store.get("count", 0); card.store.set("count", globalThis.__seen + 1)</script>';
    el.setConfig({ type: 'custom:html-action-card', content });
    expect(g.__seen).toBe(0);
    el.remove();
    document.body.append(el); // re-attach re-runs the script
    expect(g.__seen).toBe(1);
    expect(localStorage.getItem('html-action-card:Lamp switch:count')).toBe('2');
  });

  it('card.store returns the fallback for bad data and can remove keys', () => {
    localStorage.setItem('html-action-card:card:x', '{not json');
    el.setConfig({
      type: 'custom:html-action-card',
      content: '<script>globalThis.__v = card.store.get("x", "fallback"); card.store.set("y", {a: 1}); card.store.remove("y"); globalThis.__y = card.store.get("y")</script>',
    });
    expect(g.__v).toBe('fallback');
    expect(g.__y).toBeUndefined();
  });
});

describe('inputs in the security rating', () => {
  it('frontmatter is not rated as markup, inputs are not entities', () => {
    const r = analyze(FRONT + '<button data-action="toggle" data-entity="{{ input.lamp }}">{{ input.label }} {{ input.lamp.state }}</button>');
    expect(r).toEqual({ severity: 'green', findings: [] });
  });

  it('undeclared inputs and invalid YAML are hints', () => {
    const r = analyze('---\nname: [oops\n---\n<p>{{ input.nope }}</p>');
    expect(r.severity).toBe('green');
    expect(r.findings.map((f) => f.message)).toEqual([
      expect.stringContaining('not valid YAML'),
      'Input "nope" is not declared in the frontmatter',
    ]);
  });

  it('keeps the line numbers of the body', () => {
    const r = analyze(FRONT + '<p>ok</p>\n<iframe src="/x"></iframe>');
    expect(r.findings[0].line).toBe(FRONT.split('\n').length + 1);
  });
});
