import { describe, expect, it } from 'vitest';
import { collectEntities, compile, ExprSyntaxError, parse, resolveFunction, run } from './index';
import type { Fn, Resolver } from './index';

interface Ent {
  state: string;
  attributes?: Record<string, unknown>;
}

function mk(entities: Record<string, Ent>, exposed: Record<string, Fn> = {}) {
  const reads: string[] = [];
  const map = new Map(Object.entries(exposed));
  const resolver: Resolver = {
    entity: (id) => {
      reads.push(id);
      return entities[id];
    },
    fn: (name) => resolveFunction(name, map),
  };
  const ev = (src: string) => {
    const r = run(src, resolver);
    if (r.error) throw new Error(r.error);
    return r.value;
  };
  return { resolver, reads, ev };
}

const ents: Record<string, Ent> = {
  'light.kitchen': { state: 'on', attributes: { brightness: 180, rgb_color: [255, 100, 0], effect: { name: 'rainbow' } } },
  'sensor.t': { state: '21.5' },
  'sensor.gone': { state: 'unavailable' },
  'sensor.1abc': { state: '7' },
};

describe('literals and refs', () => {
  const { ev } = mk(ents);
  it('literals', () => {
    expect(ev('42')).toBe(42);
    expect(ev('1.5')).toBe(1.5);
    expect(ev("'hi'")).toBe('hi');
    expect(ev('"a\\"b"')).toBe('a"b');
    expect(ev('true')).toBe(true);
    expect(ev('null')).toBe(null);
  });
  it('bare words are strings', () => {
    expect(ev('on')).toBe('on');
    expect(ev('not_home')).toBe('not_home');
  });
  it('entity state', () => {
    expect(ev('light.kitchen.state')).toBe('on');
    expect(ev('sensor.1abc.state')).toBe('7');
  });
  it('no default: a bare entity renders nothing, the property must be named', () => {
    expect(ev('light.kitchen')).toBeUndefined();
    expect(ev('light.kitchen == on')).toBe(false);
  });
  it('Jinja style states. prefix is accepted', () => {
    expect(ev('states.light.kitchen.state')).toBe('on');
    expect(ev('states.light.kitchen.attributes.brightness')).toBe(180);
  });
  it('attributes and nested paths', () => {
    expect(ev('light.kitchen.attributes.brightness')).toBe(180);
    expect(ev('light.kitchen.attributes.rgb_color.1')).toBe(100);
    expect(ev('light.kitchen.attributes.effect.name')).toBe('rainbow');
  });
  it('missing things are undefined, never throw', () => {
    expect(ev('light.nope.state')).toBeUndefined();
    expect(ev('light.kitchen.attributes.nope')).toBeUndefined();
    expect(ev('light.kitchen.attributes.nope.deeper')).toBeUndefined();
    expect(ev('light.kitchen.attributes.effect.constructor')).toBeUndefined();
  });
});

describe('comparison and logic', () => {
  const { ev } = mk(ents);
  it('equality with bare words', () => {
    expect(ev('light.kitchen.state == on')).toBe(true);
    expect(ev('light.kitchen.state != on')).toBe(false);
    expect(ev("light.kitchen.state === 'on'")).toBe(true);
  });
  it('numeric strings compare as numbers', () => {
    expect(ev('sensor.t.state > 20')).toBe(true);
    expect(ev('sensor.t.state >= 21.5')).toBe(true);
    expect(ev('sensor.t.state == 21.5')).toBe(true);
    expect(ev('sensor.t.state < 21')).toBe(false);
  });
  it('non numeric states: number comparisons are false', () => {
    expect(ev('sensor.gone.state > 5')).toBe(false);
    expect(ev('sensor.gone.state < 5')).toBe(false);
    expect(ev('sensor.gone.state == 5')).toBe(false);
    expect(ev('sensor.gone.state == unavailable')).toBe(true);
    expect(ev('light.nope.state > 5')).toBe(false);
  });
  it('null equals missing', () => {
    expect(ev('light.nope.state == null')).toBe(true);
    expect(ev('light.kitchen.state == null')).toBe(false);
  });
  it('logic, precedence, parentheses', () => {
    expect(ev('light.kitchen.state == on && sensor.t.state > 20')).toBe(true);
    expect(ev('light.kitchen.state == off || sensor.t.state > 30')).toBe(false);
    expect(ev('!(light.kitchen.state == off)')).toBe(true);
    expect(ev('true || false && false')).toBe(true);
    expect(ev('(true || false) && false')).toBe(false);
  });
  it('&& and || return operands like JS', () => {
    expect(ev("light.nope.state || 'fallback'")).toBe('fallback');
    expect(ev("light.kitchen.state && 'yes'")).toBe('yes');
  });
});

describe('arithmetic and ternary', () => {
  const { ev } = mk(ents);
  it('arithmetic', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('sensor.t.state * 2')).toBe(43);
    expect(ev('10 % 4')).toBe(2);
    expect(ev('-sensor.1abc.state')).toBe(-7);
    expect(ev('sensor.t.state + sensor.1abc.state')).toBe(28.5);
  });
  it('string concat when not numeric', () => {
    expect(ev("'Temp: ' + sensor.t.state")).toBe('Temp: 21.5');
    expect(ev("sensor.t.state + ' °C'")).toBe('21.5 °C');
  });
  it('invalid arithmetic is undefined', () => {
    expect(ev('sensor.gone.state * 2')).toBeUndefined();
    expect(ev('light.nope.state + 1')).toBeUndefined();
    expect(ev('1 / 0')).toBeUndefined();
  });
  it('ternary, nested and right associative', () => {
    expect(ev("sensor.t.state > 25 ? 'hot' : 'ok'")).toBe('ok');
    expect(ev("sensor.t.state > 25 ? 'hot' : sensor.t.state > 20 ? 'warm' : 'cold'")).toBe('warm');
    expect(ev("light.kitchen.state == on ? 'Off' : 'On'")).toBe('Off');
  });
});

describe('function calls', () => {
  it('builtins', () => {
    const { ev } = mk(ents);
    expect(ev('Math.round(sensor.t.state)')).toBe(22);
    expect(ev('Math.max(1, sensor.t.state, 3)')).toBe(21.5);
    expect(ev('parseFloat(sensor.t.state) > 20')).toBe(true);
  });
  it('exposed functions win and compose', () => {
    const { ev } = mk(ents, { calc: (...a) => (a as number[]).reduce((x, y) => x + y, 0) });
    expect(ev('calc(1+2) > 3')).toBe(false);
    expect(ev('calc(1, 2, 3) > 3')).toBe(true);
    expect(ev('calc()')).toBe(0);
  });
  it('unknown function and throwing function become errors, not crashes', () => {
    const { resolver } = mk(ents, {
      boom: () => {
        throw new Error('nope');
      },
    });
    expect(run('nothere(1)', resolver)).toEqual({ value: undefined, error: 'Unknown function "nothere"' });
    expect(run('boom()', resolver).error).toContain('boom');
  });
  it('does not expose prototype escape hatches', () => {
    const { resolver } = mk(ents);
    expect(run('Math.constructor(1)', resolver).error).toContain('Unknown function');
    expect(run('constructor()', resolver).error).toContain('Unknown function');
  });
});

describe('dependency recording', () => {
  it('short-circuit only reads what it needs', () => {
    const { ev, reads } = mk(ents);
    ev('light.kitchen.state == off && sensor.t.state > 20');
    expect(reads).toEqual(['light.kitchen']);
    reads.length = 0;
    ev("light.kitchen.state == on ? sensor.t.state : sensor.gone.state");
    expect(reads).toEqual(['light.kitchen', 'sensor.t']);
  });
  it('collectEntities is a static superset', () => {
    const ids = collectEntities(parse("light.kitchen.state == on ? sensor.t.state : Math.max(sensor.gone.state, light.kitchen.attributes.brightness)"));
    expect([...ids].sort()).toEqual(['light.kitchen', 'sensor.gone', 'sensor.t']);
  });
});

describe('syntax errors', () => {
  it.each(['', '   ', '1 +', '(1', '1 2', "'open", 'a ? b', 'light.', '#', 'f(1,', '1 && && 2'])('rejects %j', (src) => {
    expect(() => parse(src)).toThrow(ExprSyntaxError);
  });
  it('run() reports instead of throwing', () => {
    const { resolver } = mk(ents);
    const r = run('1 +', resolver);
    expect(r.value).toBeUndefined();
    expect(r.error).toMatch(/Unexpected end/);
  });
  it('compile caches the same AST', () => {
    expect(compile('1 + 1')).toBe(compile('1 + 1'));
  });
});
