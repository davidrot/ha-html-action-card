import type { HassEntity, HomeAssistant } from './types';

type Spec = string | { state: string; attributes?: Record<string, unknown> };

export function ent(id: string, spec: Spec): HassEntity {
  const s = typeof spec === 'string' ? { state: spec } : spec;
  return {
    entity_id: id,
    state: s.state,
    attributes: s.attributes ?? {},
    last_changed: '2026-11-14T12:00:00Z',
    last_updated: '2026-11-14T12:00:00Z',
  };
}

export function hassOf(states: Record<string, Spec>): HomeAssistant {
  return {
    language: 'en',
    connected: true,
    states: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, ent(id, s)])),
    callService: async () => undefined,
  };
}

/** New hass where only the given entities are replaced (others keep their identity, like HA). */
export function patch(h: HomeAssistant, changes: Record<string, Spec>): HomeAssistant {
  const states = { ...h.states };
  for (const [id, s] of Object.entries(changes)) states[id] = ent(id, s);
  return { ...h, states };
}

export const sync = (fn: () => void) => fn();
