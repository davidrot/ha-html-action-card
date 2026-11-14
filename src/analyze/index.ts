/**
 * Security rating. A pure function: it reads the card content and
 * reports what they can do. It never modifies or blocks anything; the user decides.
 *
 *   green   plain markup, CSS, data attributes and expressions
 *   yellow  worth a look: scripts, external resources, sensitive actions without confirmation
 *   red     can run or load foreign code, or reach credentials/network
 *   info    hints that do not change the rating (typos, unknown entities, syntax errors)
 */
import { lookupBuiltin, parse } from '../expr';
import type { Expr } from '../expr';
import { parseTemplate } from '../render/template';
import type { Finding, HomeAssistant, Report } from '../types';
import { lineCounter, scan } from './scanner';
import type { Attr } from './scanner';

export interface AnalyzeOptions {
  /** With hass, unknown entities and services are reported as hints. */
  hass?: HomeAssistant;
}

const KNOWN_DATA = [
  'data-event', 'data-action', 'data-entity', 'data-data', 'data-path', 'data-url', 'data-target',
  'data-confirm', 'data-repeat', 'data-delay', 'data-show-if',
];
const EVENTS = new Set(['tap', 'hold', 'dbltap', 'press', 'release']);
const BUILTIN_ACTIONS = new Set(['toggle', 'more-info', 'navigate', 'url']);
const SERVICE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const EXTERNAL = /^\s*(https?:)?\/\//i;
const STATE_KEYS = new Set(['state', 'attributes', 'last_changed', 'last_updated', 'last_reported', 'entity_id', 'context']);

/** Domains where a wrong tap has real-world consequences. */
const SENSITIVE_DOMAINS = new Set([
  'lock', 'alarm_control_panel', 'shell_command', 'python_script', 'pyscript', 'rest_command', 'hassio', 'backup',
]);
const HARMLESS_HA_SERVICES = new Set(['toggle', 'turn_on', 'turn_off', 'update_entity']);
const SENSITIVE_COVERS = new Set(['garage', 'gate', 'door']);

/** Functions that run code or talk to the network when called from an expression. */
const DANGEROUS_CALLS = new Set([
  'eval', 'Function', 'fetch', 'setTimeout', 'setInterval', 'importScripts', 'open', 'postMessage', 'XMLHttpRequest',
  'WebSocket', 'EventSource',
]);
const EXPRESSION_HELPERS = new Set(['now', 'relative']);

const SCRIPT_RED: Array<[RegExp, string]> = [
  [/\beval\s*\(/, 'uses eval(), which runs text as code'],
  [/\bnew\s+Function\b/, 'uses new Function(), which runs text as code'],
  [/\bimport\s*\(/, 'loads more code with import()'],
  [/\bfetch\s*\(/, 'sends network requests with fetch()'],
  [/\bXMLHttpRequest\b/, 'sends network requests with XMLHttpRequest'],
  [/\b(WebSocket|EventSource)\b/, 'opens its own network connection'],
  [/\bsendBeacon\s*\(/, 'sends data out with sendBeacon()'],
  [/\bdocument\s*\.\s*cookie\b/, 'reads or writes cookies'],
  [/\b(localStorage|sessionStorage|indexedDB)\b/, 'accesses browser storage (Home Assistant keeps the login token there)'],
  [/\.auth\b|access_token|refresh_token/, 'touches the Home Assistant login/token'],
  [/\bwindow\s*\.\s*(parent|top|opener)\b/, 'reaches into the surrounding window'],
];
const SCRIPT_YELLOW: Array<[RegExp, string]> = [
  [/\b(callWS|callApi|sendMessagePromise|sendMessage|subscribeEvents|subscribeMessage)\b/, 'talks to the Home Assistant API directly'],
  [/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|document\s*\.\s*write\s*\(/, 'builds HTML from text at runtime'],
];

export function analyze(html: string, options: AnalyzeOptions = {}): Report {
  const findings: Finding[] = [];
  const lineOf = lineCounter(html);
  const hass = options.hass;
  const tokens = scan(html);
  const hasScript = tokens.some((t) => t.kind === 'raw' && t.name === 'script');

  const add = (level: Finding['level'], message: string, offset: number) =>
    findings.push({ level, message, line: lineOf(offset) });

  const checkExpression = (source: string, offset: number) => {
    let ast: Expr;
    try {
      ast = parse(source);
    } catch (err) {
      add('info', `Expression "${short(source)}" is not valid: ${err instanceof Error ? err.message : String(err)}`, offset);
      return;
    }
    walk(ast, (e) => {
      if (e.t === 'call') {
        const root = e.name.split('.')[0];
        if (DANGEROUS_CALLS.has(root) || DANGEROUS_CALLS.has(e.name)) {
          add('red', `Expression calls ${e.name}(), which can run code or reach the network`, offset);
        } else if (!hasScript && !EXPRESSION_HELPERS.has(e.name) && !lookupBuiltin(e.name)) {
          add('info', `Expression calls ${e.name}(), but no script exposes it (card.expose)`, offset);
        }
      } else if (e.t === 'ref') {
        if (e.path.length === 0) {
          add('info', `"${e.entity}" names no property and renders empty. Use ${e.entity}.state`, offset);
        } else if (!STATE_KEYS.has(e.path[0])) {
          add('info', `"${e.entity}.${e.path.join('.')}" is not a state property. Attributes are under ${e.entity}.attributes.${e.path[0]}`, offset);
        }
        if (hass && !(e.entity in hass.states)) add('info', `Unknown entity ${e.entity}`, offset);
      }
    });
  };

  const checkCss = (text: string, base: number) => {
    for (const m of text.matchAll(/@import\b[^;]*/gi)) {
      add('yellow', `CSS loads another stylesheet (${short(m[0])})`, base + m.index);
    }
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
      if (EXTERNAL.test(m[2])) add('yellow', `CSS loads an external resource (${short(m[2])})`, base + m.index);
    }
  };

  for (const t of tokens) {
    if (t.kind === 'expr') {
      checkExpression(t.source, t.offset);
      continue;
    }

    if (t.kind === 'raw' && t.name === 'style') {
      checkCss(t.content, t.contentOffset);
      continue;
    }

    if (t.kind === 'raw') {
      const type = (attr(t.attrs, 'type') ?? '').trim().toLowerCase();
      const isJs = type === '' || type === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
      if (!isJs) continue; // data block, never executed
      const src = attr(t.attrs, 'src');
      if (src !== undefined) {
        if (EXTERNAL.test(src)) add('red', `Loads and runs a script from another server (${short(src)})`, t.offset);
        else add('yellow', `Loads and runs a script file (${short(src)})`, t.offset);
        continue;
      }
      if (!t.content.trim()) continue;
      add('yellow', 'Contains a script. Scripts can do anything the dashboard can do', t.offset);
      const code = stripComments(t.content);
      for (const [pattern, what] of SCRIPT_RED) {
        const m = pattern.exec(code);
        if (m) add('red', `Script ${what}`, t.contentOffset + m.index);
      }
      for (const [pattern, what] of SCRIPT_YELLOW) {
        const m = pattern.exec(code);
        if (m) add('yellow', `Script ${what}`, t.contentOffset + m.index);
      }
      for (const m of code.matchAll(/\b(?:call|callService)\s*\(\s*['"]([a-z0-9_]+)['"]\s*(?:,\s*['"]([a-z0-9_]+)['"])?/g)) {
        if (isSensitive(m[1], m[2])) add('yellow', `Script calls a sensitive service (${m[1]}${m[2] ? '.' + m[2] : ''})`, t.contentOffset + m.index);
      }
      continue;
    }

    // ---- ordinary tags ----
    const { name, attrs } = t;
    if (name === 'iframe' || name === 'frame' || name === 'object' || name === 'embed') {
      add('red', `<${name}> embeds another page or plugin inside the dashboard`, t.offset);
    }
    if (name === 'meta' && (attr(attrs, 'http-equiv') ?? '').toLowerCase() === 'refresh') {
      add('red', '<meta http-equiv="refresh"> can redirect the dashboard', t.offset);
    }
    if (name === 'base') add('yellow', '<base> changes where all relative links point', t.offset);
    if (name === 'form' && EXTERNAL.test(attr(attrs, 'action') ?? '')) {
      add('red', `Form sends its data to another server (${short(attr(attrs, 'action')!)})`, t.offset);
    }

    for (const a of attrs) {
      if (/^on[a-z]+$/.test(a.name)) {
        add('red', `${a.name}="…" runs JavaScript`, a.offset);
      }
      if (/^\s*javascript:/i.test(a.value)) {
        add('red', `${a.name} uses a javascript: URL, which runs code`, a.offset);
      }
      if (a.name === 'style') checkCss(a.value, a.offset);

      const isLink = name === 'a' && a.name === 'href';
      if (['src', 'href', 'poster', 'data', 'xlink:href'].includes(a.name) && EXTERNAL.test(a.value)) {
        if (isLink) add('info', `Links to an external site (${short(a.value)})`, a.offset);
        else add('yellow', `Loads an external resource (${short(a.value)})`, a.offset);
      }
      if (a.name === 'srcset' && /(^|,)\s*(https?:)?\/\//i.test(a.value)) {
        add('yellow', 'Loads external images (srcset)', a.offset);
      }

      // expressions inside attribute values
      if (a.name === 'data-show-if') {
        checkExpression(a.value, a.offset);
      } else if (a.value.includes('{{')) {
        for (const part of parseTemplate(a.value)) if (typeof part !== 'string') checkExpression(part.expr, a.offset);
      }

      // typos in our own attributes
      if (a.name.startsWith('data-') && !KNOWN_DATA.includes(a.name)) {
        const near = KNOWN_DATA.find((k) => distance(k, a.name) <= 2);
        if (near) add('info', `Unknown attribute ${a.name}. Did you mean ${near}?`, a.offset);
      }
    }

    checkAction(attrs, t.offset);
  }

  // ---- data-event / data-action ----
  function checkAction(attrs: Attr[], offset: number): void {
    const action = attr(attrs, 'data-action')?.trim();
    const event = attr(attrs, 'data-event')?.trim().toLowerCase();
    if (event !== undefined && !event.includes('{{') && !EVENTS.has(event)) {
      add('info', `Unknown data-event "${event}". Use tap, hold, dbltap, press or release`, offset);
    }
    if (action === undefined) {
      if (event !== undefined) add('info', 'data-event without data-action does nothing', offset);
      return;
    }
    if (action.includes('{{')) return; // decided at runtime

    const entity = attr(attrs, 'data-entity')?.trim();
    const dynamicEntity = !!entity && entity.includes('{{');
    const confirmed = attr(attrs, 'data-confirm') !== undefined;
    const data = attr(attrs, 'data-data')?.trim();
    if (data && !data.includes('{{')) {
      try {
        const parsed: unknown = JSON.parse(data);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('must be a JSON object');
      } catch (err) {
        add('info', `data-data is not valid JSON (${err instanceof Error ? err.message : String(err)})`, offset);
      }
    }
    const repeat = parseInt(attr(attrs, 'data-repeat') ?? '', 10);
    if (repeat > 0 && repeat < 100) add('yellow', `data-repeat="${repeat}" fires more than 10 times per second`, offset);
    if (hass && entity && !dynamicEntity && !(entity in hass.states)) add('info', `Unknown entity ${entity}`, offset);

    if (action === 'toggle' || action === 'more-info') {
      if (!entity) add('info', `data-action="${action}" needs data-entity`, offset);
    } else if (action === 'navigate') {
      if (!attr(attrs, 'data-path')) add('info', 'data-action="navigate" needs data-path', offset);
    } else if (action === 'url') {
      const url = attr(attrs, 'data-url');
      if (!url) add('info', 'data-action="url" needs data-url', offset);
      else if (/^\s*javascript:/i.test(url)) add('red', 'data-url uses a javascript: URL, which runs code', offset);
      else if (EXTERNAL.test(url)) add('info', `Opens an external site (${short(url)})`, offset);
    } else if (!SERVICE.test(action)) {
      add('info', `Unknown data-action "${action}". Use domain.service, toggle, more-info, navigate or url`, offset);
    } else {
      const [domain, service] = action.split('.');
      if (hass && !serviceExists(hass, domain, service)) add('info', `Unknown service ${action}`, offset);
    }

    // sensitive targets without a confirmation
    if (confirmed) return;
    let domain: string | undefined;
    let service: string | undefined;
    if (action === 'toggle') domain = entity?.split('.')[0];
    else if (SERVICE.test(action) && !BUILTIN_ACTIONS.has(action)) [domain, service] = action.split('.');
    if (!domain) return;
    const deviceClass = entity && hass ? String(hass.states[entity]?.attributes?.device_class ?? '') : '';
    const sensitiveCover = (domain === 'cover' || entity?.startsWith('cover.')) && SENSITIVE_COVERS.has(deviceClass);
    if (isSensitive(domain, service) || sensitiveCover) {
      const what = sensitiveCover ? deviceClass : domain.replace(/_/g, ' ');
      add('yellow', `Sensitive action (${what}) without confirmation. Consider data-confirm`, offset);
    }
  }

  const rank = { red: 0, yellow: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.level] - rank[b.level] || (a.line ?? 0) - (b.line ?? 0));
  const severity = findings.some((f) => f.level === 'red') ? 'red' : findings.some((f) => f.level === 'yellow') ? 'yellow' : 'green';
  return { severity, findings };
}

// ---- helpers ----

function attr(attrs: Attr[], name: string): string | undefined {
  return attrs.find((a) => a.name === name)?.value;
}

function isSensitive(domain: string, service?: string): boolean {
  if (SENSITIVE_DOMAINS.has(domain)) return true;
  return domain === 'homeassistant' && !!service && !HARMLESS_HA_SERVICES.has(service);
}

function serviceExists(hass: HomeAssistant, domain: string, service: string): boolean {
  const services = (hass as { services?: Record<string, Record<string, unknown>> }).services;
  if (!services) return true; // cannot tell
  return !!services[domain] && service in services[domain];
}

function walk(e: Expr, visit: (e: Expr) => void): void {
  visit(e);
  switch (e.t) {
    case 'call':
      e.args.forEach((a) => walk(a, visit));
      break;
    case 'unary':
      walk(e.arg, visit);
      break;
    case 'bin':
      walk(e.l, visit);
      walk(e.r, visit);
      break;
    case 'cond':
      walk(e.test, visit);
      walk(e.a, visit);
      walk(e.b, visit);
      break;
  }
}

/** Blank out comments (same length, so offsets and line numbers stay right). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\/|(^|[^:\\'"`])\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

function short(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}

/** Levenshtein distance, for "did you mean". */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}
