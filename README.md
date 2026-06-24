# disposablekit

> Zero-dependency TypeScript resource management: `defer()`, `DisposableGroup`, `using()`, `AsyncDisposableGroup`. `Symbol.dispose` polyfill included. Port of Go `defer` / Python `contextlib.ExitStack` / C# `IDisposable` / Java `try-with-resources`.

[![npm](https://img.shields.io/npm/v/disposablekit)](https://www.npmjs.com/package/disposablekit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Install

```bash
npm install disposablekit
```

Works with any TypeScript version. Full `Symbol.dispose`/`Symbol.asyncDispose` support for TypeScript 5.2+ (with runtime polyfill for older Node.js).

## Quick start

```typescript
import { defer, DisposableGroup, using, usingAsync } from "disposablekit";

// Go-style defer — runs on dispose
const cleanup = defer(() => console.log("cleaned up"));
cleanup[Symbol.dispose]();

// Group multiple resources
const group = new DisposableGroup();
group.add(fileHandle);           // add any Disposable
group.defer(() => db.close());   // or schedule a callback
group[Symbol.dispose]();         // disposes all in reverse order

// Scoped using (like Java try-with-resources, Python with)
const result = using(openFile("data.txt"), (file) => file.readAll());
// file is closed automatically, even on error

// Async version
await usingAsync(openDbConn(), async (conn) => {
  return conn.query("SELECT 1");
});
```

## Why disposablekit?

TypeScript 5.2 added `using` / `await using` keywords (TC39 Explicit Resource Management). But:
- The `using` keyword needs TypeScript 5.2+ AND modern Node.js
- `DisposableStack`/`AsyncDisposableStack` are TC39 Stage 4 but not yet in all environments
- The `disposablestack` polyfill has **12 runtime dependencies**
- `@tioniq/disposiq` exists but has only 67 downloads/week

`disposablekit` is a single, zero-dep utility covering everything you need: `defer()`, `DisposableGroup`, `using()`, `combine()`, `tryDispose()`, `suppress()`, and their async counterparts.

## API

### `defer(fn)` / `toDisposable(fn)`

Create a `Disposable` from a callback. Like Go's `defer`, Python's `contextlib.contextmanager` cleanup section, or `finally` cleanup.

```typescript
import { defer } from "disposablekit";

const conn = openConnection();
const d = defer(() => conn.close());
// ... use conn ...
d[Symbol.dispose]();  // conn.close() called
```

### `DisposableGroup`

Collect multiple disposables; dispose all in **reverse order** on `Symbol.dispose`. Like Python's `contextlib.ExitStack` or C#'s `CompositeDisposable`.

```typescript
import { DisposableGroup } from "disposablekit";

const group = new DisposableGroup();
const file = group.add(openFile("data.txt"));  // add() returns the resource
const conn = group.add(openConnection());
group.defer(() => console.log("all done"));

group[Symbol.dispose]();
// → closes in reverse: "all done", conn.close(), file.close()
```

Properties: `group.size`, `group.disposed`

### `AsyncDisposableGroup`

Like `DisposableGroup` but async — accepts both sync and async disposables.

```typescript
import { AsyncDisposableGroup } from "disposablekit";

const group = new AsyncDisposableGroup();
group.add(syncResource);
group.add(asyncResource);
group.defer(async () => await flushLogs());
await group[Symbol.asyncDispose]();
```

### `using(resource, fn)` / `usingAsync(resource, fn)`

Functional scoped cleanup. Like Java `try (Resource r = ...) { ... }` or Python `with open(...) as f:`.

```typescript
// Sync
const content = using(openFile("data.txt"), (f) => f.read());
// file closed automatically

// Async
const rows = await usingAsync(openConnection(), async (conn) => {
  return conn.query("SELECT * FROM users");
});
```

### `combine(...disposables)` / `combineAsync(...disposables)`

Merge multiple disposables into one (disposes in reverse order).

```typescript
import { combine, defer } from "disposablekit";

const d = combine(
  defer(() => closeA()),
  defer(() => closeB()),
  defer(() => closeC()),
);
d[Symbol.dispose](); // C, B, A
```

### `tryDispose(d)` / `tryDisposeAsync(d)`

Dispose without throwing — returns the `Error` instead (or `null` on success).

```typescript
const err = tryDispose(resource);
if (err) console.error("dispose failed:", err);
```

### `suppress(d)` / `suppressAsync(d)`

Wrap a disposable to silently ignore all errors on dispose.

```typescript
const safe = suppress(flakyResource);
safe[Symbol.dispose](); // never throws
```

### `isDisposable(value)` / `isAsyncDisposable(value)`

Type guards.

```typescript
if (isDisposable(value)) value[Symbol.dispose]();
```

## Comparison

| Language | Pattern | `disposablekit` equivalent |
|---|---|---|
| Go | `defer fn()` | `defer(fn)` |
| Python | `with contextlib.ExitStack()` | `DisposableGroup` |
| Python | `async with contextlib.AsyncExitStack()` | `AsyncDisposableGroup` |
| C# | `using (var r = ...) { }` | `using(r, fn)` |
| Java | `try (Resource r = ...) { }` | `using(r, fn)` |
| TypeScript 5.2 | `using r = resource` | `using(resource, fn)` (pre-5.2) |

## License

MIT © [trananhtung](https://github.com/trananhtung)
