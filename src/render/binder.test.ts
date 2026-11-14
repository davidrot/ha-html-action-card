// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { hassOf, patch, sync } from '../testutil';
import { Engine } from '../reactive/tracker';
import { Binder } from './binder';

function setup(html: string, states: Record<string, string> = { 'light.a': 'on', 'sensor.t': '21' }) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const engine = new Engine({ schedule: sync });
  const binder = new Binder(engine, root);
  binder.start();
  let hass = hassOf(states);
  engine.setHass(hass);
  const set = (changes: Record<string, string>) => {
    hass = patch(hass, changes);
    engine.setHass(hass);
  };
  return { root, engine, binder, set };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('text and attributes', () => {
  it('interpolates text and attributes, and updates on change', () => {
    const { root, set } = setup('<p>Lamp: {{ light.a.state }}</p><i class="lamp {{ light.a.state }}" title="T {{ sensor.t.state }}"></i>');
    const p = root.querySelector('p')!;
    const i = root.querySelector('i')!;
    expect(p.textContent).toBe('Lamp: on');
    expect(i.className).toBe('lamp on');
    expect(i.title).toBe('T 21');
    set({ 'light.a': 'off' });
    expect(p.textContent).toBe('Lamp: off');
    expect(i.className).toBe('lamp off');
    expect(i.title).toBe('T 21');
  });

  it('does not touch the DOM when the result is unchanged', () => {
    const { root, set } = setup('<p>{{ sensor.t.state > 20 }}</p>');
    const text = root.querySelector('p')!.firstChild as Text;
    let writes = 0;
    Object.defineProperty(text, 'data', {
      get: () => 'true',
      set: () => void writes++,
    });
    set({ 'sensor.t': '25' }); // still true
    expect(writes).toBe(0);
  });

  it('missing entities render empty, no crash', () => {
    const { root } = setup('<p>[{{ light.nope.state }}]</p>');
    expect(root.querySelector('p')!.textContent).toBe('[]');
  });

  it('never interpolates script or style content', () => {
    const { root } = setup('<style>.a::after{content:"{{ light.a.state }}"}</style><script>var x = "{{ light.a.state }}";</script>');
    expect(root.querySelector('style')!.textContent).toContain('{{ light.a.state }}');
    expect(root.querySelector('script')!.textContent).toContain('{{ light.a.state }}');
  });
});

describe('boolean attributes', () => {
  it('are added and removed instead of being set to "false"', () => {
    const { root, set } = setup('<button disabled="{{ light.a.state == off }}">x</button>');
    const b = root.querySelector('button')!;
    expect(b.hasAttribute('disabled')).toBe(false);
    set({ 'light.a': 'off' });
    expect(b.hasAttribute('disabled')).toBe(true);
    expect(b.disabled).toBe(true);
    set({ 'light.a': 'on' });
    expect(b.hasAttribute('disabled')).toBe(false);
  });

  it('checked follows the state, also as live property', () => {
    const { root, set } = setup('<input type="checkbox" checked="{{ light.a.state == on }}">');
    const box = root.querySelector('input')!;
    expect(box.checked).toBe(true);
    box.checked = false; // the user clicked
    set({ 'light.a': 'off' });
    set({ 'light.a': 'on' });
    expect(box.checked).toBe(true);
  });

  it('missing entity or the text "false" means off', () => {
    const { root } = setup('<button disabled="{{ light.nope.state }}">a</button><button disabled="{{ \'false\' }}">b</button>');
    for (const b of root.querySelectorAll('button')) expect(b.hasAttribute('disabled')).toBe(false);
  });

  it('other attributes and mixed templates stay plain text', () => {
    const { root } = setup('<i title="{{ light.a.state == off }}" data-x="a {{ light.a.state }}"></i>');
    const i = root.querySelector('i')!;
    expect(i.getAttribute('title')).toBe('false');
    expect(i.getAttribute('data-x')).toBe('a on');
  });
});

describe('split text nodes', () => {
  it('a {{ }} split across adjacent text nodes is merged before binding', () => {
    const root = document.createElement('div');
    const p = document.createElement('p');
    p.append(document.createTextNode('{{ sensor.t.state >'), document.createTextNode(' 20 }}'));
    root.append(p);
    const engine = new Engine({ schedule: sync });
    new Binder(engine, root).start();
    engine.setHass(hassOf({ 'sensor.t': '21' }));
    expect(p.textContent).toBe('true');
  });
});

describe('data-show-if', () => {
  it('toggles hidden', () => {
    const { root, set } = setup('<span data-show-if="light.a.state == on && sensor.t.state > 20">x</span>');
    const el = root.querySelector('span')!;
    expect(el.hasAttribute('hidden')).toBe(false);
    set({ 'sensor.t': '10' });
    expect(el.hasAttribute('hidden')).toBe(true);
    set({ 'sensor.t': '30' });
    expect(el.hasAttribute('hidden')).toBe(false);
  });

  it('broken expression hides the element and does not crash', () => {
    const { root } = setup('<span data-show-if="1 +">x</span>');
    expect(root.querySelector('span')!.hasAttribute('hidden')).toBe(true);
  });
});

describe('dynamic HTML', () => {
  it('binds nodes added later', async () => {
    const { root, set } = setup('<div id="box"></div>');
    root.querySelector('#box')!.insertAdjacentHTML('beforeend', '<b class="{{ light.a.state }}">{{ sensor.t.state }}</b>');
    await tick();
    const b = root.querySelector('b')!;
    expect(b.textContent).toBe('21');
    expect(b.className).toBe('on');
    set({ 'sensor.t': '22' });
    expect(b.textContent).toBe('22');
  });

  it('stops updating removed nodes (bindings disposed)', async () => {
    const { root, set } = setup('<b>{{ sensor.t.state }}</b>');
    const b = root.querySelector('b')!;
    b.remove();
    await tick();
    set({ 'sensor.t': '99' });
    expect(b.textContent).toBe('21');
  });

  it('a moved node keeps working', async () => {
    const { root, set } = setup('<div id="a"><b>{{ sensor.t.state }}</b></div><div id="b"></div>');
    root.querySelector('#b')!.appendChild(root.querySelector('b')!);
    await tick();
    set({ 'sensor.t': '5' });
    expect(root.querySelector('#b b')!.textContent).toBe('5');
  });

  it('our own writes do not retrigger the observer', async () => {
    const { root, set } = setup('<p>{{ sensor.t.state }}</p>');
    set({ 'sensor.t': '1' });
    set({ 'sensor.t': '2' });
    await tick();
    expect(root.querySelector('p')!.textContent).toBe('2');
  });
});
