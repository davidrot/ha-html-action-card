/**
 * Executes a Home Assistant action.
 * Shared by the declarative path (data-event/data-action) and by `card.action()`.
 */
import type { HomeAssistant } from '../types';

export interface ActionContext {
  hass(): HomeAssistant | undefined;
  /** The card element: frontend events (more-info) are dispatched from here. */
  host: HTMLElement;
}

export interface ActionParams {
  entity?: string;
  data?: Record<string, unknown>;
  path?: string;
  url?: string;
  target?: string;
}

const SERVICE = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export async function runAction(ctx: ActionContext, action: string, p: ActionParams = {}): Promise<void> {
  switch (action) {
    case 'more-info':
      ctx.host.dispatchEvent(
        new CustomEvent('hass-more-info', { detail: { entityId: need(p.entity, action) }, bubbles: true, composed: true }),
      );
      return;

    case 'navigate': {
      const path = need(p.path, action, 'data-path');
      history.pushState(null, '', path);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
      return;
    }

    case 'url':
      window.open(need(p.url, action, 'data-url'), p.target || '_blank', 'noopener');
      return;

    case 'toggle': {
      const id = need(p.entity, action);
      const [domain] = id.split('.');
      const state = ctx.hass()?.states[id]?.state;
      if (domain === 'lock') return call(ctx, 'lock', state === 'locked' ? 'unlock' : 'lock', id, p.data);
      if (domain === 'button' || domain === 'input_button') return call(ctx, domain, 'press', id, p.data);
      if (domain === 'scene' || domain === 'script') return call(ctx, domain, 'turn_on', id, p.data);
      if (domain === 'cover') return call(ctx, 'cover', 'toggle', id, p.data);
      return call(ctx, 'homeassistant', 'toggle', id, p.data);
    }

    default: {
      if (!SERVICE.test(action)) throw new Error(`Unknown action "${action}"`);
      const [domain, service] = action.split('.');
      return call(ctx, domain, service, p.entity, p.data);
    }
  }
}

async function call(
  ctx: ActionContext,
  domain: string,
  service: string,
  entity: string | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const hass = ctx.hass();
  if (!hass) throw new Error('Home Assistant is not ready yet');
  await hass.callService(domain, service, { ...(entity ? { entity_id: entity } : {}), ...data });
}

function need(value: string | undefined, action: string, attr = 'data-entity'): string {
  if (!value) throw new Error(`Action "${action}" needs ${attr}`);
  return value;
}
