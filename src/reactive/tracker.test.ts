import { afterEach, describe, expect, it, vi } from 'vitest';
import { hassOf, patch, sync } from '../testutil';
import { Engine } from './tracker';

afterEach(() => vi.useRealTimers());

describe('dependency tracking', () => {
  it('runs deferred until the first hass, then once', () => {
    const e = new Engine({ schedule: sync });
    let runs = 0;
    e.computation(() => {
      runs++;
      e.evaluate('light.a.state');
    });
    expect(runs).toBe(0);
    e.setHass(hassOf({ 'light.a': 'on' }));
    expect(runs).toBe(1);
  });

  it('re-runs only when a read entity changed', () => {
    const e = new Engine({ schedule: sync });
    const h0 = hassOf({ 'light.a': 'on', 'light.b': 'on' });
    e.setHass(h0);
    let runs = 0;
    e.computation(() => {
      runs++;
      e.evaluate('light.a.state');
    });
    expect(runs).toBe(1);
    e.setHass(patch(h0, { 'light.b': 'off' }));
    expect(runs).toBe(1);
    e.setHass(patch(h0, { 'light.a': 'off' }));
    expect(runs).toBe(2);
  });

  it('re-records dependencies (short circuit)', () => {
    const e = new Engine({ schedule: sync });
    let h = hassOf({ 'light.a': 'off', 'light.b': 'off' });
    e.setHass(h);
    let runs = 0;
    e.computation(() => {
      runs++;
      e.evaluate('light.a.state == on && light.b.state == on');
    });
    h = patch(h, { 'light.b': 'on' }); // b is not a dependency yet
    e.setHass(h);
    expect(runs).toBe(1);
    h = patch(h, { 'light.a': 'on' }); // a changes -> now b is read too
    e.setHass(h);
    expect(runs).toBe(2);
    h = patch(h, { 'light.b': 'off' });
    e.setHass(h);
    expect(runs).toBe(3);
  });

  it('entity appearing and disappearing is detected', () => {
    const e = new Engine({ schedule: sync });
    const h0 = hassOf({});
    e.setHass(h0);
    const seen: unknown[] = [];
    e.computation(() => void seen.push(e.evaluate('light.a.state')));
    const h1 = patch(h0, { 'light.a': 'on' });
    e.setHass(h1);
    const { 'light.a': _gone, ...rest } = h1.states;
    e.setHass({ ...h1, states: rest });
    expect(seen).toEqual([undefined, 'on', undefined]);
  });

  it('tracks reads made inside called functions (card.state in exposed fns)', () => {
    const e = new Engine({ schedule: sync });
    e.exposed.set('isOn', () => e.state('light.a') === 'on');
    const h0 = hassOf({ 'light.a': 'off' });
    e.setHass(h0);
    const seen: unknown[] = [];
    e.computation(() => void seen.push(e.evaluate('isOn() ? 1 : 0')));
    e.setHass(patch(h0, { 'light.a': 'on' }));
    expect(seen).toEqual([0, 1]);
  });

  it('attribute-only change re-runs; timestamps are readable', () => {
    const e = new Engine({ schedule: sync });
    const h0 = hassOf({ 'light.a': { state: 'on', attributes: { brightness: 10 } } });
    e.setHass(h0);
    const seen: unknown[] = [];
    e.computation(() => void seen.push(e.evaluate('light.a.attributes.brightness')));
    e.setHass(patch(h0, { 'light.a': { state: 'on', attributes: { brightness: 20 } } }));
    expect(seen).toEqual([10, 20]);
    expect(e.evaluate('light.a.last_changed')).toBe('2026-11-14T12:00:00Z');
    expect(e.evaluate('light.a.state')).toBe('on'); // Home Assistant template habit
    expect(e.evaluate('light.a.entity_id')).toBe('light.a');
  });

  it('coalesces several updates into one flush against the last hass', () => {
    const queue: Array<() => void> = [];
    const e = new Engine({ schedule: (fn) => queue.push(fn) });
    const h0 = hassOf({ 'light.a': 'off' });
    e.setHass(h0);
    const seen: unknown[] = [];
    e.computation(() => void seen.push(e.evaluate('light.a.state')));
    const h1 = patch(h0, { 'light.a': 'on' });
    const h2 = patch(h1, { 'light.a': 'off' });
    const h3 = patch(h2, { 'light.a': 'on' });
    e.setHass(h1);
    e.setHass(h2);
    e.setHass(h3);
    expect(queue.length).toBe(1);
    queue.forEach((f) => f());
    expect(seen).toEqual(['off', 'on']);
  });

  it('effect cleanup runs before re-run and on dispose; dispose stops updates', () => {
    const e = new Engine({ schedule: sync });
    const h0 = hassOf({ 'light.a': 'off' });
    e.setHass(h0);
    const log: string[] = [];
    const c = e.computation(() => {
      const v = e.state('light.a');
      log.push(`run ${v}`);
      return () => log.push(`cleanup ${v}`);
    });
    e.setHass(patch(h0, { 'light.a': 'on' }));
    c.dispose();
    e.setHass(patch(e.hass!, { 'light.a': 'off' }));
    expect(log).toEqual(['run off', 'cleanup off', 'run on', 'cleanup on']);
  });

  it('errors in computations are reported, not thrown', () => {
    const errors: string[] = [];
    const e = new Engine({ schedule: sync, onError: (m) => errors.push(m) });
    e.setHass(hassOf({}));
    e.computation(() => {
      throw new Error('boom');
    });
    e.computation(() => void e.evaluate('nothere()'));
    expect(errors[0]).toBe('boom');
    expect(errors[1]).toContain('Unknown function "nothere"');
  });
});

describe('time', () => {
  it('now()/relative() re-run on the ticker only while something depends on it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T12:00:30Z'));
    const e = new Engine({ schedule: sync, refreshInterval: 1000 });
    e.setHass(hassOf({ 'light.a': 'on' }));
    const seen: unknown[] = [];
    const c = e.computation(() => void seen.push(e.evaluate('relative(light.a.last_changed)')));
    expect(seen).toEqual(['30 seconds ago']);
    vi.setSystemTime(new Date('2026-11-14T12:02:00Z'));
    vi.advanceTimersByTime(1000);
    expect(seen.at(-1)).toBe('2 minutes ago');
    expect(vi.getTimerCount()).toBe(1);
    c.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('computations without now() never start a ticker', () => {
    vi.useFakeTimers();
    const e = new Engine({ schedule: sync });
    e.setHass(hassOf({ 'light.a': 'on' }));
    e.computation(() => void e.evaluate('light.a.state'));
    expect(vi.getTimerCount()).toBe(0);
  });
});
