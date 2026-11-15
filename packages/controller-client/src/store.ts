/** Minimal observable store compatible with React's `useSyncExternalStore`. */
export class Store<T> {
  private listeners = new Set<() => void>();
  private value: T;

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  update(change: (current: T) => T): void {
    this.set(change(this.value));
  }
}
