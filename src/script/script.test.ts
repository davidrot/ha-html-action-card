// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../main';
import type { HtmlActionCard } from '../card';
import { hassOf, patch } from '../testutil';
import type { HomeAssistant } from '../types';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const FLUSH = 300; // default hass flush: animation frame or 250 ms timer

let el: HtmlActionCard;
let call: ReturnType<typeof vi.fn>;
let hass: HomeAssistant;
let warn: ReturnType<typeof vi.spyOn>;

function mount(content: string, states: Record<string, string> = { 'light.a': 'on', 'sensor.t': '21' }) {
  call = vi.fn(async () => undefined);
  hass = { ...hassOf(states), callService: call } as unknown as HomeAssistant;
  el = document.createElement('html-action-card') as HtmlActionCard;
  document.body.append(el);
  el.hass = hass;
  el.setConfig({ type: 'custom:html-action-card', content });
  return el;
}
const sr = () => el.shadowRoot!;
// Visible text: script/style source is not content.
const text = () => {
  const copy = sr().getElementById('content')!.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('script,style').forEach((n) => n.remove());
  return copy.textContent!.replace(/\s+/g, ' ').trim();
};
const g = globalThis as unknown as Record<string, unknown>;
const update = async (changes: Record<string, string>) => {
  hass = patch(hass, changes);
  el.hass = hass;
  await wait(FLUSH);
};

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  g.__log = [];
});
afterEach(() => {
  el?.remove();
  vi.restoreAllMocks();
});

describe('script execution', () => {
  it('runs before the first evaluation, so exposed functions work in {{ }}', () => {
    mount('<p>{{ calc(1 + 2) > 3 }}</p><script>card.expose({ calc: n => n * 2 })</script>');
    expect(text()).toBe('true');
  });

  it('document shim searches the card, not the page', () => {
    mount('<button id="b">x</button><script>document.getElementById("b").textContent = "changed"</script>');
    expect(text()).toBe('changed');
    expect(document.getElementById('b')).toBeNull();
  });

  it('document.body appends into the card and the new nodes are bound', async () => {
    mount(
      '<script>const p = document.createElement("p"); p.textContent = "[{{ light.a.state }}]"; document.body.appendChild(p);</script>',
    );
    await wait();
    expect(text()).toBe('[on]');
  });

  it('DOMContentLoaded listeners run right away', async () => {
    mount('<script>document.addEventListener("DOMContentLoaded", () => globalThis.__log.push("ready"))</script>');
    await wait();
    expect(g.__log).toEqual(['ready']);
  });

  it('skips non-JavaScript script types', () => {
    mount('<script type="application/json">{"a":1}</script><p>ok</p>');
    expect(text()).toContain('ok');
    expect(warn).not.toHaveBeenCalled();
  });

  it('an error in one script is reported and the next script still runs', () => {
    mount('<p id="p">-</p><script>throw new Error("boom")</script><script>document.getElementById("p").textContent = "second"</script>');
    expect(text()).toBe('second');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Script error: boom'));
  });

  it('syntax errors are reported, not thrown', () => {
    mount('<script>this is not js</script><p>still here</p>');
    expect(text()).toContain('still here');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Script error'));
  });
});

describe('card API', () => {
  it('call / action / navigate / moreInfo / toggle', async () => {
    mount(`
      <button id="a">a</button>
      <script>
        document.getElementById('a').addEventListener('click', () => {
          card.call('light', 'turn_on', { entity_id: 'light.a', brightness_pct: 10 });
          card.action('light.toggle', { entity: 'light.a' });
          card.toggle('light.a');
          card.moreInfo('light.a');
          card.navigate('/lovelace/x');
        });
      </script>`);
    const seen: unknown[] = [];
    el.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    (sr().getElementById('a') as HTMLElement).click();
    await wait();
    expect(call).toHaveBeenCalledWith('light', 'turn_on', { entity_id: 'light.a', brightness_pct: 10 });
    expect(call).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.a' });
    expect(call).toHaveBeenCalledWith('homeassistant', 'toggle', { entity_id: 'light.a' });
    expect(seen).toEqual([{ entityId: 'light.a' }]);
    expect(location.pathname).toBe('/lovelace/x');
  });

  it('a failing service call toasts and rejects for scripts that await', async () => {
    mount(`<button id="a">a</button><script>
      document.getElementById('a').onclick = async () => {
        try { await card.call('x', 'y'); } catch (e) { globalThis.__log.push('caught ' + e.message); }
      };</script>`);
    call.mockRejectedValue(new Error('nope'));
    const toasts: unknown[] = [];
    el.addEventListener('hass-notification', (e) => toasts.push((e as CustomEvent).detail));
    (sr().getElementById('a') as HTMLElement).click();
    await wait(10);
    expect(toasts).toEqual([{ message: 'nope' }]);
    expect(g.__log).toEqual(['caught nope']);
  });

  it('effect re-runs when an entity read inside changes', async () => {
    mount(`<p id="p"></p><script>
      card.effect(() => { document.getElementById('p').textContent = 'light is ' + card.state('light.a'); });
    </script>`);
    expect(text()).toBe('light is on');
    await update({ 'light.a': 'off' });
    expect(text()).toBe('light is off');
  });

  it('onEntity gets (new, old) on change, not initially', async () => {
    mount(`<script>
      card.onEntity('light.a', (n, o) => globalThis.__log.push(o.state + '>' + n.state));
    </script>`);
    expect(g.__log).toEqual([]);
    await update({ 'light.a': 'off' });
    expect(g.__log).toEqual(['on>off']);
  });

  it('hass in scope is live', async () => {
    mount(`<button id="b">b</button><script>
      document.getElementById('b').onclick = () => globalThis.__log.push(hass.states['light.a'].state);
    </script>`);
    await update({ 'light.a': 'off' });
    (sr().getElementById('b') as HTMLElement).click();
    expect(g.__log).toEqual(['off']);
  });

  it('on("hass") fires after each update; unknown events throw a readable error', async () => {
    mount(`<script>card.on('hass', () => globalThis.__log.push('tick'));</script>`);
    expect(g.__log).toEqual(['tick']); // first hass
    await update({ 'sensor.t': '22' });
    expect(g.__log).toEqual(['tick', 'tick']);
    mount(`<script>card.on('nope', () => {})</script>`);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown event "nope"'));
  });

  it('card.root, $ and $$', () => {
    mount('<i class="x"></i><i class="x"></i><script>document.title; globalThis.__log.push(card.$$(".x").length, card.$("i") !== null, card.root === card.root.getRootNode());</script>');
    expect(g.__log).toEqual([2, true, true]);
  });
});

describe('lifecycle', () => {
  it('timers die with the card; card.cleanup runs', async () => {
    mount(`<script>
      globalThis.__ticks = 0;
      setInterval(() => globalThis.__ticks++, 10);
      setTimeout(() => globalThis.__log.push('late'), 40);
      card.cleanup(() => globalThis.__log.push('cleaned'));
    </script>`);
    await wait(25);
    el.remove(); // disconnectedCallback
    const ticks = (g.__ticks as number);
    await wait(80);
    expect((g.__ticks as number)).toBe(ticks);
    expect(g.__log).toEqual(['cleaned']);
  });

  it('errors thrown inside a timer are reported', async () => {
    mount('<script>setTimeout(() => { throw new Error("in timer") }, 0)</script>');
    await wait(20);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('in timer'));
  });

  it('a new setConfig disposes the old scripts and effects', async () => {
    mount(`<script>card.effect(() => globalThis.__log.push('old ' + card.state('sensor.t')))</script>`);
    el.setConfig({ type: 'custom:html-action-card', content: '<p>new</p>' });
    await update({ 'sensor.t': '99' });
    expect(g.__log).toEqual(['old 21']);
  });

  it('removing and re-adding the card re-renders and re-runs scripts', () => {
    mount('<p>{{ light.a.state }}</p><script>globalThis.__log.push("run")</script>');
    el.remove();
    document.body.append(el);
    expect(text()).toBe('on');
    expect(g.__log).toEqual(['run', 'run']);
  });
});
