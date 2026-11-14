import { describe, expect, it } from 'vitest';
import { hassOf } from '../testutil';
import type { HomeAssistant } from '../types';
import { analyze } from './index';
import { scan } from './scanner';

const levels = (html: string, hass?: HomeAssistant) => analyze(html, { hass }).findings.map((f) => `${f.level}: ${f.message}`);
const rating = (html: string) => analyze(html).severity;
const has = (list: string[], level: string, text: string) => list.some((l) => l.startsWith(level) && l.includes(text));

describe('green', () => {
  it('plain markup with the building blocks is green and has no findings', () => {
    const r = analyze(
      `<style>.lamp { background: url(/local/x.png); color: var(--primary-color); }</style>
       <div class="lamp {{ light.kitchen.state }}"></div>
       <button data-event="tap" data-action="light.toggle" data-entity="light.kitchen">Kitchen: {{ light.kitchen.state }}</button>
       <p data-show-if="sensor.t.state > 25 && light.kitchen.attributes.brightness < 100">{{ Math.round(sensor.t.state) }} {{ relative(light.kitchen.last_changed) }}</p>
       <a href="/lovelace/1">local link</a><img src="/local/a.png"><img src="data:image/png;base64,AAAA">`,
    );
    expect(r).toEqual({ severity: 'green', findings: [] });
  });

  it('hints never change the rating', () => {
    const r = analyze('<p>{{ light.kitchen }}</p><b data-acton="x">t</b>');
    expect(r.severity).toBe('green');
    expect(r.findings.every((f) => f.level === 'info')).toBe(true);
    expect(r.findings.length).toBe(2);
  });
});

describe('yellow', () => {
  it('a script block', () => {
    const l = levels('<script>card.effect(() => {})</script>');
    expect(rating('<script>card.effect(() => {})</script>')).toBe('yellow');
    expect(has(l, 'yellow', 'Contains a script')).toBe(true);
  });
  it('a local script file', () => {
    expect(rating('<script src="/local/x.js"></script>')).toBe('yellow');
  });
  it('external resources', () => {
    expect(rating('<img src="https://example.com/a.png">')).toBe('yellow');
    expect(rating('<img src="//example.com/a.png">')).toBe('yellow');
    expect(rating('<link rel="stylesheet" href="https://example.com/a.css">')).toBe('yellow');
    expect(rating('<video poster="https://example.com/p.jpg"></video>')).toBe('yellow');
    expect(rating('<img srcset="a.png 1x, https://example.com/b.png 2x">')).toBe('yellow');
    expect(rating('<p style="background:url(https://example.com/x.png)">x</p>')).toBe('yellow');
    expect(rating('<style>@import url("https://fonts.example/css");</style>')).toBe('yellow');
    expect(rating('<style>.a { background: url("https://example.com/x.png") }</style><p>x</p>')).toBe('yellow');
  });
  it('sensitive actions without confirmation', () => {
    expect(rating('<button data-action="lock.unlock" data-entity="lock.door">x</button>')).toBe('yellow');
    expect(rating('<button data-action="toggle" data-entity="lock.door">x</button>')).toBe('yellow');
    expect(rating('<button data-action="alarm_control_panel.alarm_disarm" data-entity="alarm_control_panel.home">x</button>')).toBe('yellow');
    expect(rating('<button data-action="shell_command.reboot">x</button>')).toBe('yellow');
    expect(rating('<button data-action="homeassistant.restart">x</button>')).toBe('yellow');
  });
  it('data-confirm makes them green; harmless services stay green', () => {
    expect(rating('<button data-confirm="Sure?" data-action="lock.unlock" data-entity="lock.door">x</button>')).toBe('green');
    expect(rating('<button data-action="homeassistant.toggle" data-entity="light.a">x</button>')).toBe('green');
    expect(rating('<button data-action="cover.toggle" data-entity="cover.blind">x</button>')).toBe('green');
  });
  it('a garage door is sensitive when hass knows its device class', () => {
    const hass = hassOf({ 'cover.garage': { state: 'closed', attributes: { device_class: 'garage' } }, 'cover.blind': 'open' });
    const html = (id: string) => `<button data-action="toggle" data-entity="${id}">x</button>`;
    expect(analyze(html('cover.garage'), { hass }).severity).toBe('yellow');
    expect(analyze(html('cover.blind'), { hass }).severity).toBe('green');
  });
  it('very fast repeat', () => {
    expect(rating('<button data-event="press" data-repeat="50" data-action="button.press" data-entity="button.up">x</button>')).toBe('yellow');
    expect(rating('<button data-event="press" data-repeat="250" data-action="button.press" data-entity="button.up">x</button>')).toBe('green');
  });
  it('sensitive service called from a script', () => {
    const l = levels(`<script>b.onclick = () => card.call('lock', 'unlock', { entity_id: 'lock.door' })</script>`);
    expect(has(l, 'yellow', 'sensitive service (lock.unlock)')).toBe(true);
  });
});

describe('red', () => {
  it.each([
    ['<iframe src="/x"></iframe>', 'embeds'],
    ['<object data="x.swf"></object>', 'embeds'],
    ['<embed src="x">', 'embeds'],
    ['<script src="https://cdn.example/x.js"></script>', 'from another server'],
    ['<button onclick="alert(1)">x</button>', 'onclick'],
    ['<img src="/a.png" onerror="x()">', 'onerror'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['<b data-action="url" data-url="javascript:alert(1)">x</b>', 'javascript:'],
    ['<meta http-equiv="refresh" content="0;url=https://example.com">', 'redirect'],
    ['<form action="https://example.com/collect"><input name="a"></form>', 'another server'],
    ['<script>eval(code)</script>', 'eval()'],
    ['<script>new Function("return 1")()</script>', 'new Function()'],
    ['<script>fetch("https://example.com", { method: "POST" })</script>', 'fetch()'],
    ['<script>new XMLHttpRequest()</script>', 'XMLHttpRequest'],
    ['<script>new WebSocket("wss://example.com")</script>', 'network connection'],
    ['<script>const c = document.cookie</script>', 'cookies'],
    ['<script>localStorage.getItem("hassTokens")</script>', 'browser storage'],
    ['<script>const t = hass.auth.data.access_token</script>', 'login/token'],
    ['<script>window.parent.location = "x"</script>', 'surrounding window'],
    ['<script type="module">await import("https://example.com/x.js")</script>', 'import()'],
    ['<p>{{ eval("1") }}</p>', 'eval()'],
    ['<p data-show-if="fetch(\'https://example.com\')">x</p>', 'fetch()'],
    ['<i title="{{ setTimeout(x, 1) }}"></i>', 'setTimeout()'],
  ])('%s', (html, text) => {
    const r = analyze(html);
    expect(r.severity).toBe('red');
    expect(r.findings.some((f) => f.level === 'red' && f.message.includes(text))).toBe(true);
  });

  it('red wins over yellow and is listed first', () => {
    const r = analyze('<img src="https://example.com/a.png"><iframe src="/x"></iframe>');
    expect(r.severity).toBe('red');
    expect(r.findings.map((f) => f.level)).toEqual(['red', 'yellow']);
  });
});

describe('not fooled', () => {
  it('comments, data blocks and text are not code', () => {
    expect(rating('<!-- <iframe src="x"></iframe> <script>eval(1)</script> -->')).toBe('green');
    expect(rating('<script type="application/json">{"a":"eval(fetch())"}</script>')).toBe('green');
    expect(rating('<p>Use eval() and fetch() carefully, onclick="x"</p>')).toBe('green');
  });
  it('commented-out code in a script is not counted', () => {
    const l = levels('<script>\n// fetch("x")\n/* eval(1) */\nconst url = "https://example.com"; card.navigate("/a");\n</script>');
    expect(l.filter((x) => x.startsWith('red'))).toEqual([]);
  });
  it('an attribute value with > does not end the tag', () => {
    const r = analyze('<p data-show-if="sensor.t.state > 5" onclick="x()">a</p>');
    expect(r.severity).toBe('red');
  });
  it('words that merely contain a dangerous name are fine', () => {
    expect(rating('<script>const prefetch = 1; const evaluate = 2; card.state("a");</script>')).toBe('yellow');
  });
});

describe('hints', () => {
  it('bare entity, wrong property, syntax error, unknown function', () => {
    const l = levels('<p>{{ light.a }} {{ light.a.brightness }} {{ 1 + }} {{ calc(1) }}</p>');
    expect(has(l, 'info', 'Use light.a.state')).toBe(true);
    expect(has(l, 'info', 'light.a.attributes.brightness')).toBe(true);
    expect(has(l, 'info', 'is not valid')).toBe(true);
    expect(has(l, 'info', 'calls calc()')).toBe(true);
  });
  it('an exposed function is not reported when the card has a script', () => {
    const l = levels('<p>{{ calc(1) }}</p><script>card.expose({ calc: n => n })</script>');
    expect(has(l, 'info', 'calc()')).toBe(false);
  });
  it('typos and incomplete actions', () => {
    const l = levels(
      `<b data-acton="toggle">1</b><b data-action="toggle">2</b><b data-action="navigate">3</b><b data-action="url">4</b>
       <b data-action="whatever">5</b><b data-event="swipe" data-action="light.toggle">6</b><b data-event="tap">7</b>
       <b data-action="light.turn_on" data-data="{oops">8</b><b data-custom="mine">9</b>`,
    );
    expect(has(l, 'info', 'Did you mean data-action')).toBe(true);
    expect(has(l, 'info', '"toggle" needs data-entity')).toBe(true);
    expect(has(l, 'info', 'needs data-path')).toBe(true);
    expect(has(l, 'info', 'needs data-url')).toBe(true);
    expect(has(l, 'info', 'Unknown data-action "whatever"')).toBe(true);
    expect(has(l, 'info', 'Unknown data-event "swipe"')).toBe(true);
    expect(has(l, 'info', 'data-event without data-action')).toBe(true);
    expect(has(l, 'info', 'not valid JSON')).toBe(true);
    expect(l.some((x) => x.includes('data-custom'))).toBe(false); // the user's own data attributes are fine
  });
  it('with hass: unknown entities and services', () => {
    const hass = { ...hassOf({ 'light.a': 'on' }), services: { light: { toggle: {} } } } as unknown as HomeAssistant;
    const l = levels(
      '<b data-action="light.toggle" data-entity="light.b">{{ sensor.x.state }}</b><b data-action="light.dance" data-entity="light.a">{{ light.a.state }}</b>',
      hass,
    );
    expect(has(l, 'info', 'Unknown entity light.b')).toBe(true);
    expect(has(l, 'info', 'Unknown entity sensor.x')).toBe(true);
    expect(has(l, 'info', 'Unknown service light.dance')).toBe(true);
    expect(l.some((x) => x.includes('light.a'))).toBe(false);
  });
  it('external links are a hint, not a warning', () => {
    const r = analyze('<a href="https://example.com">x</a><b data-action="url" data-url="https://example.com">y</b>');
    expect(r.severity).toBe('green');
    expect(r.findings.length).toBe(2);
  });
});

describe('line numbers', () => {
  it('point at the offending line in markup, scripts and styles', () => {
    const html =
      '<p>ok</p>\n<p>fine</p>\n<iframe src="/x"></iframe>\n<script>\n  const a = 1;\n  eval(a);\n</script>\n<style>\n.a{}\n.b{ background: url(https://example.com/x.png) }\n</style>';
    const r = analyze(html);
    const find = (text: string) => r.findings.find((f) => f.message.includes(text))!;
    expect(find('embeds').line).toBe(3);
    expect(find('Contains a script').line).toBe(4);
    expect(find('eval()').line).toBe(6);
    expect(find('CSS loads').line).toBe(10);
  });
});

describe('scanner', () => {
  it('reads tags, quoted and bare attributes, raw blocks and expressions', () => {
    const t = scan(`<div class="a b" data-x='1' hidden id=main>{{ a<b }}</div><script type="module">if (a < b) {}</script>`);
    expect(t.map((x) => x.kind)).toEqual(['tag', 'expr', 'raw']);
    const div = t[0] as Extract<(typeof t)[number], { kind: 'tag' }>;
    expect(div.attrs.map((a) => [a.name, a.value])).toEqual([['class', 'a b'], ['data-x', '1'], ['hidden', ''], ['id', 'main']]);
    expect((t[1] as { source: string }).source).toBe('a<b');
    expect((t[2] as { content: string }).content).toBe('if (a < b) {}');
  });
  it('survives broken markup', () => {
    expect(() => scan('<div class="unclosed <p <<< {{ nope <script>never closed')).not.toThrow();
  });
});
