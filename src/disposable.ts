import { ASYNC_DISPOSE, DISPOSE } from "./symbols.js";

export type Disposable = { [Symbol.dispose](): void };
export type AsyncDisposable = { [Symbol.asyncDispose](): PromiseLike<void> };
export type AnyDisposable = Disposable | AsyncDisposable;

export function isDisposable(value: unknown): value is Disposable {
  return typeof value === "object" && value !== null && DISPOSE in value;
}

export function isAsyncDisposable(value: unknown): value is AsyncDisposable {
  return typeof value === "object" && value !== null && ASYNC_DISPOSE in value;
}

/**
 * Create a `Disposable` from a callback.
 * Like Go's `defer`, Python's `contextlib.contextmanager` cleanup, or Java `AutoCloseable`.
 */
export function toDisposable(fn: () => void): Disposable {
  return { [DISPOSE]: fn };
}

/** Alias for `toDisposable`. */
export const defer = toDisposable;

/**
 * Create an `AsyncDisposable` from an async callback.
 * Like Python's `async with contextlib.AsyncExitStack()`.
 */
export function toAsyncDisposable(fn: () => PromiseLike<void> | void): AsyncDisposable {
  return { [ASYNC_DISPOSE]: async () => { await fn(); } };
}

/** Alias for `toAsyncDisposable`. */
export const deferAsync = toAsyncDisposable;

/**
 * Combine multiple `Disposable`s into one, disposed in reverse order.
 * Like `contextlib.ExitStack` (Python) or `defer` stacking (Go).
 */
export function combine(...disposables: Disposable[]): Disposable {
  return {
    [DISPOSE]() {
      const errors: unknown[] = [];
      for (let i = disposables.length - 1; i >= 0; i--) {
        try { disposables[i][DISPOSE](); }
        catch (e) { errors.push(e); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Multiple dispose errors");
    },
  };
}

/**
 * Combine multiple `AnyDisposable`s into one async disposable, disposed in reverse order.
 */
export function combineAsync(...disposables: AnyDisposable[]): AsyncDisposable {
  return {
    async [ASYNC_DISPOSE]() {
      const errors: unknown[] = [];
      for (let i = disposables.length - 1; i >= 0; i--) {
        try {
          const d = disposables[i];
          if (ASYNC_DISPOSE in d) await (d as AsyncDisposable)[ASYNC_DISPOSE]();
          else (d as Disposable)[DISPOSE]();
        } catch (e) { errors.push(e); }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Multiple dispose errors");
    },
  };
}

/**
 * Dispose a resource, returning any error instead of throwing.
 * Like Rust's `drop` with error handling.
 */
export function tryDispose(d: Disposable): Error | null {
  try { d[DISPOSE](); return null; }
  catch (e) { return e instanceof Error ? e : new Error(String(e)); }
}

/**
 * Async version of `tryDispose`.
 */
export async function tryDisposeAsync(d: AnyDisposable): Promise<Error | null> {
  try {
    if (ASYNC_DISPOSE in d) await (d as AsyncDisposable)[ASYNC_DISPOSE]();
    else (d as Disposable)[DISPOSE]();
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Wrap a disposable to suppress all dispose errors.
 */
export function suppress(d: Disposable): Disposable {
  return { [DISPOSE]() { try { d[DISPOSE](); } catch { /* ignored */ } } };
}

/**
 * Async version of `suppress`.
 */
export function suppressAsync(d: AnyDisposable): AsyncDisposable {
  return {
    async [ASYNC_DISPOSE]() {
      try {
        if (ASYNC_DISPOSE in d) await (d as AsyncDisposable)[ASYNC_DISPOSE]();
        else (d as Disposable)[DISPOSE]();
      } catch { /* ignored */ }
    },
  };
}

// ── DisposableGroup ──────────────────────────────────────────────────────────

export class DisposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisposeError";
  }
}

/**
 * Collects `Disposable`s and disposes them all (in reverse order) when itself is disposed.
 * Like Python's `contextlib.ExitStack`, C#'s `CompositeDisposable`, or Java's `Cleaner`.
 *
 * @example
 * const group = new DisposableGroup();
 * group.add(fileHandle);
 * group.defer(() => console.log("done"));
 * group[Symbol.dispose](); // disposes all in reverse
 */
export class DisposableGroup implements Disposable {
  private readonly _items: Disposable[] = [];
  private _disposed = false;

  /**
   * Add a disposable to the group. Returns the added resource for chaining.
   * Like C# `CompositeDisposable.Add()` or Python `ExitStack.enter_context()`.
   */
  add<T extends Disposable>(d: T): T {
    if (this._disposed) throw new DisposeError("DisposableGroup already disposed");
    this._items.push(d);
    return d;
  }

  /**
   * Register a callback to run on dispose. Like Go's `defer`.
   */
  defer(fn: () => void): void {
    this.add(toDisposable(fn));
  }

  [DISPOSE](): void {
    if (this._disposed) return;
    this._disposed = true;
    const errors: unknown[] = [];
    for (let i = this._items.length - 1; i >= 0; i--) {
      try { this._items[i][DISPOSE](); }
      catch (e) { errors.push(e); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Multiple dispose errors");
  }

  get disposed(): boolean { return this._disposed; }
  get size(): number { return this._items.length; }
}

// ── AsyncDisposableGroup ─────────────────────────────────────────────────────

/**
 * Async version of `DisposableGroup`. Supports both sync and async disposables.
 * Like Python's `contextlib.AsyncExitStack`.
 */
export class AsyncDisposableGroup implements AsyncDisposable {
  private readonly _items: AnyDisposable[] = [];
  private _disposed = false;

  add<T extends AnyDisposable>(d: T): T {
    if (this._disposed) throw new DisposeError("AsyncDisposableGroup already disposed");
    this._items.push(d);
    return d;
  }

  defer(fn: () => PromiseLike<void> | void): void {
    this.add(toAsyncDisposable(fn));
  }

  async [ASYNC_DISPOSE](): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    const errors: unknown[] = [];
    for (let i = this._items.length - 1; i >= 0; i--) {
      try {
        const d = this._items[i];
        if (ASYNC_DISPOSE in d) await (d as AsyncDisposable)[ASYNC_DISPOSE]();
        else (d as Disposable)[DISPOSE]();
      } catch (e) { errors.push(e); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Multiple dispose errors");
  }

  get disposed(): boolean { return this._disposed; }
  get size(): number { return this._items.length; }
}

// ── scoped using ─────────────────────────────────────────────────────────────

/**
 * Run `fn` with the resource, then dispose it — even on error.
 * Pre-TS 5.2 alternative to the `using` keyword.
 * Like Python's `with` statement or Java's `try-with-resources`.
 *
 * @example
 * const result = using(openConnection(), (conn) => conn.query("SELECT 1"));
 */
export function using<T extends Disposable, R>(resource: T, fn: (r: T) => R): R {
  try {
    return fn(resource);
  } finally {
    resource[DISPOSE]();
  }
}

/**
 * Async version of `using`.
 */
export async function usingAsync<T extends AnyDisposable, R>(
  resource: T,
  fn: (r: T) => PromiseLike<R> | R,
): Promise<R> {
  try {
    return await fn(resource);
  } finally {
    if (ASYNC_DISPOSE in resource) await (resource as AsyncDisposable)[ASYNC_DISPOSE]();
    else (resource as Disposable)[DISPOSE]();
  }
}
