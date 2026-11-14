import type { Resources } from './resources';

const hasOwn = (o: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * `document` as seen by user scripts. Searches inside the card (shadow root) instead of the
 * page, so unchanged web-page code keeps working. Everything else falls through to the real
 * document. Listeners added to the document are tracked and removed with the card.
 */
export function createDocumentShim(shadow: ShadowRoot, content: HTMLElement, resources: Resources): Document {
  const own: Record<string, unknown> = {
    getElementById: (id: string) =>
      shadow.getElementById?.(id) ?? shadow.querySelector(`[id="${id.replace(/["\\]/g, '\\$&')}"]`),
    querySelector: (selector: string) => shadow.querySelector(selector),
    querySelectorAll: (selector: string) => shadow.querySelectorAll(selector),
    getElementsByClassName: (names: string) => content.getElementsByClassName(names),
    getElementsByTagName: (name: string) => content.getElementsByTagName(name),
    // document.body.appendChild(...) adds into the card; the binder picks the new nodes up.
    body: content,
    currentScript: null,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      // The page is long loaded: run "ready" listeners right away instead of never.
      if (type === 'DOMContentLoaded' || type === 'load') {
        queueMicrotask(() => {
          const event = new Event(type);
          if (typeof listener === 'function') listener.call(document, event);
          else listener.handleEvent(event);
        });
        return;
      }
      resources.listen(document, type, listener, options);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) =>
      resources.unlisten(document, type, listener, options),
  };

  return new Proxy(document, {
    get(target, key) {
      if (typeof key === 'string' && hasOwn(own, key)) return own[key];
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
}

/**
 * `window` as seen by user scripts: the real window, except for the names in `scope`
 * (tracked addEventListener, card-scoped timers, the document shim ...).
 */
export function createWindowShim(scope: Record<string, unknown>): Window {
  const proxy: Window = new Proxy(window, {
    get(target, key) {
      if (typeof key === 'string' && key in scope) return scope[key];
      const value = Reflect.get(target, key, target);
      if (value === target) return proxy; // window.self / top / parent stay consistent
      // Plain functions (fetch, alert, getComputedStyle) need the real window as `this`.
      // Constructors keep their statics (Promise.resolve), so they are not bound.
      return typeof value === 'function' && !('prototype' in value) ? value.bind(target) : value;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
  return proxy;
}
