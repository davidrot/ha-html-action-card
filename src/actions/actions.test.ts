// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Binder } from '../render/binder';
import { Engine } from '../reactive/tracker';
import { hassOf, patch, sync } from '../testutil';
import type { HomeAssistant } from '../types';
import { ActionController } from './controller';

interface Env {
  root: HTMLElement;
  host: HTMLElement;
  call: ReturnType<typeof vi.fn>;
  report: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  hass: HomeAssistant;
  controller: ActionController;
}

let env: Env;

function setup(html: string, states: Record<string, string> = { 'light.a': 'on', 'lock.door': 'locked' }): Env {
  const root = document.createElement('div');
  const host = document.createElement('div');
  host.append(root);
  document.body.append(host);
  root.innerHTML = html;
  const call = vi.fn(async () => undefined);
  const hass = { ...hassOf(states), callService: call } as unknown as HomeAssistant;
  const report = vi.fn();
  const notify = vi.fn();
  const controller = new ActionController(root, { hass: () => hass, host, report, notify });
  controller.start();
  return { root, host, call, report, notify, hass, controller };
}

const ptr = (type: string, el: Element, init: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, ...init }));
const q = (sel: string) => env.root.querySelector(sel)!;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  env = setup('');
});
afterEach(() => {
  env.controller.stop();
  env.host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('tap and services', () => {
  it('click calls the service with entity and data', async () => {
    env = setup(`<button data-action="light.turn_on" data-entity="light.a" data-data='{"brightness_pct":50}'>x</button>`);
    (q('button') as HTMLElement).click();
    await flush();
    expect(env.call).toHaveBeenCalledWith('light', 'turn_on', { entity_id: 'light.a', brightness_pct: 50 });
  });

  it('works without entity and ignores elements without data-action', async () => {
    env = setup('<button data-action="scene.turn_on" data-data=\'{"entity_id":"scene.x"}\'>x</button><button>plain</button>');
    (env.root.querySelectorAll('button')[0] as HTMLElement).click();
    (env.root.querySelectorAll('button')[1] as HTMLElement).click();
    await flush();
    expect(env.call).toHaveBeenCalledTimes(1);
    expect(env.call).toHaveBeenCalledWith('scene', 'turn_on', { entity_id: 'scene.x' });
  });

  it('click on a child inside the action element', async () => {
    env = setup('<div data-action="light.toggle" data-entity="light.a"><span id="c">x</span></div>');
    (q('#c') as HTMLElement).click();
    await flush();
    expect(env.call).toHaveBeenCalledWith('light', 'toggle', { entity_id: 'light.a' });
  });

  it('dbltap fires on dblclick only', async () => {
    env = setup('<button data-event="dbltap" data-action="light.toggle" data-entity="light.a">x</button>');
    (q('button') as HTMLElement).click();
    await flush();
    expect(env.call).not.toHaveBeenCalled();
    q('button').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await flush();
    expect(env.call).toHaveBeenCalledTimes(1);
  });
});

describe('built-in actions', () => {
  it('toggle picks the right service per domain', async () => {
    env = setup(
      '<i id="l" data-action="toggle" data-entity="light.a"></i><i id="k" data-action="toggle" data-entity="lock.door"></i>',
    );
    (q('#l') as HTMLElement).click();
    (q('#k') as HTMLElement).click();
    await flush();
    expect(env.call).toHaveBeenCalledWith('homeassistant', 'toggle', { entity_id: 'light.a' });
    expect(env.call).toHaveBeenCalledWith('lock', 'unlock', { entity_id: 'lock.door' });
  });

  it('more-info dispatches a frontend event', () => {
    env = setup('<b data-action="more-info" data-entity="light.a">x</b>');
    const seen: unknown[] = [];
    env.host.addEventListener('hass-more-info', (e) => seen.push((e as CustomEvent).detail));
    (q('b') as HTMLElement).click();
    return flush().then(() => expect(seen).toEqual([{ entityId: 'light.a' }]));
  });

  it('navigate pushes history and notifies the frontend', async () => {
    env = setup('<b data-action="navigate" data-path="/lovelace/cams">x</b>');
    const seen: unknown[] = [];
    window.addEventListener('location-changed', (e) => seen.push((e as CustomEvent).detail), { once: true });
    (q('b') as HTMLElement).click();
    await flush();
    expect(location.pathname).toBe('/lovelace/cams');
    expect(seen).toEqual([{ replace: false }]);
  });

  it('url opens a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    env = setup('<b data-action="url" data-url="https://example.com">x</b>');
    (q('b') as HTMLElement).click();
    await flush();
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });
});

describe('hold, press, release', () => {
  it('hold fires after the delay, not when released early or moved away', () => {
    vi.useFakeTimers();
    env = setup('<button data-event="hold" data-action="light.toggle" data-entity="light.a">x</button>');
    const b = q('button');
    ptr('pointerdown', b);
    vi.advanceTimersByTime(499);
    expect(env.call).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(env.call).toHaveBeenCalledTimes(1);
    ptr('pointerup', b);

    ptr('pointerdown', b);
    vi.advanceTimersByTime(200);
    ptr('pointerup', b);
    vi.advanceTimersByTime(1000);
    expect(env.call).toHaveBeenCalledTimes(1); // released early

    ptr('pointerdown', b, { clientX: 0, clientY: 0 });
    ptr('pointermove', b, { clientX: 40, clientY: 0 });
    vi.advanceTimersByTime(1000);
    expect(env.call).toHaveBeenCalledTimes(1); // moved away
  });

  it('press fires immediately and repeats until release', async () => {
    vi.useFakeTimers();
    env = setup('<button data-event="press" data-repeat="100" data-action="button.press" data-entity="light.a">x</button>');
    const b = q('button');
    ptr('pointerdown', b);
    expect(env.call).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(350); // async: each call must settle before the next tick
    expect(env.call).toHaveBeenCalledTimes(4);
    ptr('pointerup', b);
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.call).toHaveBeenCalledTimes(4);
  });

  it('a slow service call does not pile up repeat ticks', async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    env = setup('<button data-event="press" data-repeat="50" data-action="button.press" data-entity="light.a">x</button>');
    env.call.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    ptr('pointerdown', q('button'));
    vi.advanceTimersByTime(500);
    expect(env.call).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(60);
    expect(env.call.mock.calls.length).toBeGreaterThan(1);
    ptr('pointerup', q('button'));
  });

  it('repeat stops when the controller stops (card removed)', () => {
    vi.useFakeTimers();
    env = setup('<button data-event="press" data-repeat="100" data-action="button.press" data-entity="light.a">x</button>');
    ptr('pointerdown', q('button'));
    env.controller.stop();
    vi.advanceTimersByTime(1000);
    expect(env.call).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pointercancel stops everything', () => {
    vi.useFakeTimers();
    env = setup('<button data-event="press" data-repeat="100" data-action="button.press" data-entity="light.a">x</button>');
    ptr('pointerdown', q('button'));
    ptr('pointercancel', q('button'));
    vi.advanceTimersByTime(1000);
    expect(env.call).toHaveBeenCalledTimes(1);
  });

  it('release fires on pointer up', () => {
    env = setup('<button data-event="release" data-action="light.toggle" data-entity="light.a">x</button>');
    ptr('pointerdown', q('button'));
    expect(env.call).not.toHaveBeenCalled();
    ptr('pointerup', q('button'));
    expect(env.call).toHaveBeenCalledTimes(1);
  });

  it('keyboard activation (click with detail 0) fires press once', () => {
    env = setup('<button data-event="press" data-repeat="100" data-action="light.toggle" data-entity="light.a">x</button>');
    (q('button') as HTMLElement).click(); // detail 0, like Enter/Space
    expect(env.call).toHaveBeenCalledTimes(1);
  });

  it('right mouse button does not start a press', () => {
    env = setup('<button data-event="press" data-action="light.toggle" data-entity="light.a">x</button>');
    ptr('pointerdown', q('button'), { button: 2 });
    expect(env.call).not.toHaveBeenCalled();
  });
});

describe('guards and feedback', () => {
  it('unavailable entity blocks the action', async () => {
    env = setup('<button data-action="light.toggle" data-entity="light.a">x</button>', { 'light.a': 'unavailable' });
    (q('button') as HTMLElement).click();
    await flush();
    expect(env.call).not.toHaveBeenCalled();
  });

  it('unknown state is NOT blocked (button entities are unknown until first press)', async () => {
    env = setup('<button data-action="button.press" data-entity="button.up">x</button>', { 'button.up': 'unknown' });
    (q('button') as HTMLElement).click();
    await flush();
    expect(env.call).toHaveBeenCalledTimes(1);
  });

  it('data-confirm can cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    env = setup('<button data-confirm="Sure?" data-action="lock.unlock" data-entity="lock.door">x</button>');
    (q('button') as HTMLElement).click();
    await flush();
    expect(confirm).toHaveBeenCalledWith('Sure?');
    expect(env.call).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    (q('button') as HTMLElement).click();
    await flush();
    expect(env.call).toHaveBeenCalledTimes(1);
  });

  it('is-pending while running, double click ignored until done', async () => {
    let resolve!: () => void;
    env = setup('<button data-action="light.toggle" data-entity="light.a">x</button>');
    env.call.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const b = q('button') as HTMLElement;
    b.click();
    b.click();
    expect(env.call).toHaveBeenCalledTimes(1);
    expect(b.classList.contains('is-pending')).toBe(true);
    resolve();
    await flush();
    expect(b.classList.contains('is-pending')).toBe(false);
    b.click();
    expect(env.call).toHaveBeenCalledTimes(2);
  });

  it('service failure: is-error, toast, report; error clears later', async () => {
    vi.useFakeTimers();
    env = setup('<button data-action="light.toggle" data-entity="light.a">x</button>');
    env.call.mockRejectedValue(new Error('Service not found'));
    const b = q('button') as HTMLElement;
    b.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(b.classList.contains('is-error')).toBe(true);
    expect(env.notify).toHaveBeenCalledWith('Service not found');
    expect(env.report).toHaveBeenCalledWith('Service not found');
    await vi.advanceTimersByTimeAsync(3100);
    expect(b.classList.contains('is-error')).toBe(false);
  });

  it('invalid JSON, unknown action and missing entity are reported, no service call', async () => {
    env = setup(
      `<a data-action="light.toggle" data-data="{oops">1</a><a data-action="nonsense">2</a><a data-action="more-info">3</a>`,
    );
    for (const a of env.root.querySelectorAll('a')) (a as HTMLElement).click();
    await flush();
    expect(env.call).not.toHaveBeenCalled();
    expect(env.report).toHaveBeenCalledTimes(3);
    expect(env.report.mock.calls[0][0]).toContain('not valid JSON');
    expect(env.report.mock.calls[1][0]).toContain('Unknown action');
    expect(env.report.mock.calls[2][0]).toContain('needs data-entity');
  });

  it('unknown data-event is reported and ignored', () => {
    env = setup('<button data-event="swipe" data-action="light.toggle" data-entity="light.a">x</button>');
    (q('button') as HTMLElement).click();
    expect(env.call).not.toHaveBeenCalled();
    expect(env.report.mock.calls[0][0]).toContain('Unknown data-event');
  });

  it('disconnected Home Assistant blocks with a message', () => {
    env = setup('<button data-action="light.toggle" data-entity="light.a">x</button>');
    (env.hass as { connected?: boolean }).connected = false;
    (q('button') as HTMLElement).click();
    expect(env.call).not.toHaveBeenCalled();
    expect(env.notify).toHaveBeenCalledWith('Not connected to Home Assistant');
  });

  it('stop() removes all listeners', () => {
    env = setup('<button data-action="light.toggle" data-entity="light.a">x</button>');
    env.controller.stop();
    (q('button') as HTMLElement).click();
    expect(env.call).not.toHaveBeenCalled();
  });
});

describe('binder integration: is-unavailable class', () => {
  it('marks action elements while their entity is unavailable and keeps state classes on class rewrites', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button class="btn {{ light.a.state }}" data-action="light.toggle" data-entity="light.a">x</button>';
    const engine = new Engine({ schedule: sync });
    new Binder(engine, root).start();
    let h = hassOf({ 'light.a': 'on' });
    engine.setHass(h);
    const b = root.querySelector('button')!;
    expect(b.className).toBe('btn on');
    b.classList.add('is-pending');
    h = patch(h, { 'light.a': 'unavailable' });
    engine.setHass(h);
    expect(b.classList.contains('is-unavailable')).toBe(true);
    expect(b.classList.contains('is-pending')).toBe(true); // survived the class rewrite
    expect(b.classList.contains('unavailable')).toBe(true); // from {{ light.a.state }}
    expect(b.classList.contains('on')).toBe(false);
    h = patch(h, { 'light.a': 'off' });
    engine.setHass(h);
    expect(b.classList.contains('is-unavailable')).toBe(false);
  });
});
