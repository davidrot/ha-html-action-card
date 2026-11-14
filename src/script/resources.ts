/**
 * Everything a user script can leave behind outside the card's own DOM: timers, animation
 * frames, listeners on window/document, observers. Scripts re-run every time the card is
 * rendered or re-attached, so all of it is tracked here and released on teardown.
 * (Listeners on elements inside the card need no tracking: those elements are replaced.)
 */
type Listener = EventListenerOrEventListenerObject;
type Options = boolean | AddEventListenerOptions | undefined;

const captureOf = (o: Options): boolean => (typeof o === 'boolean' ? o : !!o?.capture);

export class Resources {
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();
  private readonly intervals = new Set<ReturnType<typeof setInterval>>();
  private readonly frames = new Set<number>();
  private readonly listeners: Array<{ target: EventTarget; type: string; listener: Listener; options: Options }> = [];
  private readonly disposers: Array<() => void> = [];
  /**
   * After teardown nothing may be registered any more. Async script code (a module still
   * loading, a pending promise) can outlive the card; whatever it registers is refused.
   */
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  constructor(private readonly report: (message: string) => void) {}

  /** Run a script callback; a throw is reported instead of escaping into the browser. */
  private safe(what: string, fn: unknown, args: unknown[]): void {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (err) {
      this.report(`Script error in ${what}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(err);
    }
  }

  setTimeout = (fn: unknown, ms?: number, ...args: unknown[]) => {
    if (this.disposed) return undefined;
    const id = setTimeout(() => {
      this.timeouts.delete(id);
      this.safe('timer', fn, args);
    }, ms);
    this.timeouts.add(id);
    return id;
  };

  setInterval = (fn: unknown, ms?: number, ...args: unknown[]) => {
    if (this.disposed) return undefined;
    const id = setInterval(() => this.safe('timer', fn, args), ms);
    this.intervals.add(id);
    return id;
  };

  clearTimeout = (id?: ReturnType<typeof setTimeout>) => {
    if (id === undefined) return;
    this.timeouts.delete(id);
    clearTimeout(id);
  };

  clearInterval = (id?: ReturnType<typeof setInterval>) => {
    if (id === undefined) return;
    this.intervals.delete(id);
    clearInterval(id);
  };

  requestAnimationFrame = (fn: unknown) => {
    if (this.disposed) return 0;
    const id = requestAnimationFrame((time) => {
      this.frames.delete(id);
      this.safe('animation frame', fn, [time]);
    });
    this.frames.add(id);
    return id;
  };

  cancelAnimationFrame = (id: number) => {
    this.frames.delete(id);
    cancelAnimationFrame(id);
  };

  /** addEventListener on a long-lived target (window, document), removed on dispose. */
  listen(target: EventTarget, type: string, listener: Listener, options?: Options): void {
    if (this.disposed) return;
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  unlisten(target: EventTarget, type: string, listener: Listener, options?: Options): void {
    target.removeEventListener(type, listener, options);
    const i = this.listeners.findIndex(
      (l) => l.target === target && l.type === type && l.listener === listener && captureOf(l.options) === captureOf(options),
    );
    if (i !== -1) this.listeners.splice(i, 1);
  }

  /** Anything else to undo on teardown (card.cleanup, observers). Runs in reverse order. */
  add(dispose: () => void): void {
    if (this.disposed) return this.runDisposer(dispose); // too late to keep: undo right away
    this.disposers.push(dispose);
  }

  dispose(): void {
    this.disposed = true;
    for (const id of this.timeouts) clearTimeout(id);
    for (const id of this.intervals) clearInterval(id);
    for (const id of this.frames) cancelAnimationFrame(id);
    this.timeouts.clear();
    this.intervals.clear();
    this.frames.clear();
    for (const l of this.listeners.splice(0)) l.target.removeEventListener(l.type, l.listener, l.options);
    for (const fn of this.disposers.splice(0).reverse()) this.runDisposer(fn);
  }

  private runDisposer(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.report(`Script cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
