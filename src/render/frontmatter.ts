/**
 * Optional frontmatter at the top of the card content, like a Home Assistant blueprint:
 *
 *   ---
 *   name: Kitchen timer
 *   description: A three-button kitchen timer.
 *   author: someone
 *   inputs:
 *     timer:
 *       name: Timer helper
 *       selector:
 *         entity:
 *           domain: timer
 *   ---
 *   <button data-action="timer.start" data-entity="{{ input.timer }}">Start</button>
 *
 * The values the user picks are stored in the card config (`inputs:`), not in the content,
 * so a newer version of the same card can replace the content without losing them.
 */
import { load } from 'js-yaml';

export interface InputSpec {
  name?: string;
  description?: string;
  default?: unknown;
  /** Home Assistant selector, exactly as in blueprints: `{ entity: { domain: light } }`. */
  selector?: Record<string, unknown>;
}

export interface CardMeta {
  name?: string;
  description?: string;
  author?: string;
  inputs: Record<string, InputSpec>;
}

export interface SplitContent {
  /** Parsed frontmatter, undefined when there is none (or it is not valid). */
  meta?: CardMeta;
  /** The content with the frontmatter replaced by empty lines, so line numbers stay right. */
  body: string;
  /** Set when a frontmatter block exists but cannot be read. */
  error?: string;
}

const FRONTMATTER = /^(\s*)---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/;

export function splitFrontmatter(content: string): SplitContent {
  const m = FRONTMATTER.exec(content);
  if (!m) return { body: content };
  const blank = m[0].replace(/[^\n]/g, '');
  const body = blank + content.slice(m[0].length);
  try {
    const data = load(m[2]) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('expected key: value pairs');
    return { meta: normalize(data as Record<string, unknown>), body };
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { body, error: `Frontmatter is not valid YAML: ${reason}` };
  }
}

function normalize(data: Record<string, unknown>): CardMeta {
  const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? undefined : String(v));
  const inputs: Record<string, InputSpec> = {};
  const raw = data.inputs;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const spec = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      inputs[key] = {
        name: text(spec.name),
        description: text(spec.description),
        default: spec.default,
        selector: spec.selector && typeof spec.selector === 'object' ? (spec.selector as Record<string, unknown>) : undefined,
      };
    }
  }
  return { name: text(data.name), description: text(data.description), author: text(data.author), inputs };
}

/** The values a card sees: what the user picked, else the default from the frontmatter. */
export function resolveInputs(meta: CardMeta | undefined, picked: Record<string, unknown> = {}): Record<string, unknown> {
  const values: Record<string, unknown> = { ...picked };
  for (const [key, spec] of Object.entries(meta?.inputs ?? {})) {
    const value = picked[key];
    if (value === undefined || value === null || value === '') values[key] = spec.default;
  }
  return values;
}
