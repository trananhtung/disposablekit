import {
  toDisposable,
  defer,
  toAsyncDisposable,
  deferAsync,
  combine,
  combineAsync,
  tryDispose,
  tryDisposeAsync,
  suppress,
  suppressAsync,
  using,
  usingAsync,
  DisposableGroup,
  AsyncDisposableGroup,
  DisposeError,
  isDisposable,
  isAsyncDisposable,
  DISPOSE,
  ASYNC_DISPOSE,
} from "../src/index.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeResource(log: string[], label: string) {
  return {
    [Symbol.dispose]() { log.push(label); },
  };
}

function makeAsyncResource(log: string[], label: string) {
  return {
    async [Symbol.asyncDispose]() {
      await Promise.resolve();
      log.push(label);
    },
  };
}

// ── toDisposable / defer ───────────────────────────────────────────────────

describe("toDisposable / defer", () => {
  test("calls fn on dispose", () => {
    const log: string[] = [];
    const d = toDisposable(() => log.push("done"));
    d[DISPOSE]();
    expect(log).toEqual(["done"]);
  });

  test("defer is alias for toDisposable", () => {
    const log: string[] = [];
    const d = defer(() => log.push("defer"));
    d[DISPOSE]();
    expect(log).toEqual(["defer"]);
  });

  test("can be called multiple times", () => {
    let count = 0;
    const d = toDisposable(() => count++);
    d[DISPOSE](); d[DISPOSE](); d[DISPOSE]();
    expect(count).toBe(3);
  });
});

// ── toAsyncDisposable / deferAsync ────────────────────────────────────────

describe("toAsyncDisposable / deferAsync", () => {
  test("calls async fn on dispose", async () => {
    const log: string[] = [];
    const d = toAsyncDisposable(async () => { log.push("async"); });
    await d[ASYNC_DISPOSE]();
    expect(log).toEqual(["async"]);
  });

  test("deferAsync is alias", async () => {
    const log: string[] = [];
    const d = deferAsync(() => { log.push("deferAsync"); });
    await d[ASYNC_DISPOSE]();
    expect(log).toEqual(["deferAsync"]);
  });

  test("works with sync fn too", async () => {
    const log: string[] = [];
    const d = toAsyncDisposable(() => { log.push("sync"); });
    await d[ASYNC_DISPOSE]();
    expect(log).toEqual(["sync"]);
  });
});

// ── isDisposable / isAsyncDisposable ──────────────────────────────────────

describe("isDisposable / isAsyncDisposable", () => {
  test("isDisposable - true for objects with Symbol.dispose", () => {
    expect(isDisposable(toDisposable(() => {}))).toBe(true);
  });

  test("isDisposable - false for plain objects", () => {
    expect(isDisposable({ close: () => {} })).toBe(false);
    expect(isDisposable(null)).toBe(false);
    expect(isDisposable("string")).toBe(false);
  });

  test("isAsyncDisposable - true for async disposables", () => {
    expect(isAsyncDisposable(toAsyncDisposable(async () => {}))).toBe(true);
  });

  test("isAsyncDisposable - false for sync disposables", () => {
    expect(isAsyncDisposable(toDisposable(() => {}))).toBe(false);
  });
});

// ── combine ────────────────────────────────────────────────────────────────

describe("combine", () => {
  test("disposes in reverse order", () => {
    const log: string[] = [];
    const d = combine(
      makeResource(log, "first"),
      makeResource(log, "second"),
      makeResource(log, "third"),
    );
    d[DISPOSE]();
    expect(log).toEqual(["third", "second", "first"]);
  });

  test("propagates single error", () => {
    const error = new Error("oops");
    const d = combine(
      toDisposable(() => {}),
      toDisposable(() => { throw error; }),
    );
    expect(() => d[DISPOSE]()).toThrow(error);
  });

  test("throws AggregateError for multiple errors", () => {
    const d = combine(
      toDisposable(() => { throw new Error("A"); }),
      toDisposable(() => { throw new Error("B"); }),
    );
    try {
      d[DISPOSE]();
      fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError);
    }
  });

  test("empty combine — no-op", () => {
    expect(() => combine()[DISPOSE]()).not.toThrow();
  });
});

// ── combineAsync ───────────────────────────────────────────────────────────

describe("combineAsync", () => {
  test("disposes async items in reverse", async () => {
    const log: string[] = [];
    const d = combineAsync(
      makeAsyncResource(log, "A"),
      makeResource(log, "B"),
      makeAsyncResource(log, "C"),
    );
    await d[ASYNC_DISPOSE]();
    expect(log).toEqual(["C", "B", "A"]);
  });

  test("collects errors as AggregateError", async () => {
    const d = combineAsync(
      toAsyncDisposable(async () => { throw new Error("X"); }),
      toAsyncDisposable(async () => { throw new Error("Y"); }),
    );
    await expect(d[ASYNC_DISPOSE]()).rejects.toBeInstanceOf(AggregateError);
  });
});

// ── tryDispose ─────────────────────────────────────────────────────────────

describe("tryDispose", () => {
  test("returns null on success", () => {
    const d = toDisposable(() => {});
    expect(tryDispose(d)).toBeNull();
  });

  test("returns Error on failure", () => {
    const d = toDisposable(() => { throw new Error("fail"); });
    const err = tryDispose(d);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toBe("fail");
  });

  test("wraps non-Error throws", () => {
    const d = toDisposable(() => { throw "string error"; });
    const err = tryDispose(d);
    expect(err).toBeInstanceOf(Error);
  });
});

// ── tryDisposeAsync ────────────────────────────────────────────────────────

describe("tryDisposeAsync", () => {
  test("returns null on success", async () => {
    expect(await tryDisposeAsync(toAsyncDisposable(async () => {}))).toBeNull();
  });

  test("returns Error on failure", async () => {
    const d = toAsyncDisposable(async () => { throw new Error("async fail"); });
    const err = await tryDisposeAsync(d);
    expect(err!.message).toBe("async fail");
  });

  test("works on sync Disposable too", async () => {
    expect(await tryDisposeAsync(toDisposable(() => {}))).toBeNull();
  });
});

// ── suppress ───────────────────────────────────────────────────────────────

describe("suppress", () => {
  test("silences errors", () => {
    const d = suppress(toDisposable(() => { throw new Error("shh"); }));
    expect(() => d[DISPOSE]()).not.toThrow();
  });

  test("still calls dispose", () => {
    const log: string[] = [];
    const d = suppress(toDisposable(() => log.push("ok")));
    d[DISPOSE]();
    expect(log).toEqual(["ok"]);
  });
});

describe("suppressAsync", () => {
  test("silences async errors", async () => {
    const d = suppressAsync(toAsyncDisposable(async () => { throw new Error("silent"); }));
    await expect(d[ASYNC_DISPOSE]()).resolves.toBeUndefined();
  });
});

// ── using ──────────────────────────────────────────────────────────────────

describe("using", () => {
  test("disposes after fn returns", () => {
    const log: string[] = [];
    const resource = makeResource(log, "disposed");
    const result = using(resource, (r) => {
      expect(log).toEqual([]);
      return 42;
    });
    expect(result).toBe(42);
    expect(log).toEqual(["disposed"]);
  });

  test("disposes even if fn throws", () => {
    const log: string[] = [];
    const resource = makeResource(log, "disposed");
    expect(() =>
      using(resource, () => { throw new Error("fn error"); })
    ).toThrow("fn error");
    expect(log).toEqual(["disposed"]);
  });

  test("returns fn result", () => {
    const r = toDisposable(() => {});
    expect(using(r, (): string => "hello")).toBe("hello");
  });
});

// ── usingAsync ────────────────────────────────────────────────────────────

describe("usingAsync", () => {
  test("disposes after async fn resolves", async () => {
    const log: string[] = [];
    const r = makeAsyncResource(log, "closed");
    const result = await usingAsync(r, async () => {
      expect(log).toEqual([]);
      return 99;
    });
    expect(result).toBe(99);
    expect(log).toEqual(["closed"]);
  });

  test("disposes even if async fn throws", async () => {
    const log: string[] = [];
    const r = makeAsyncResource(log, "closed");
    await expect(usingAsync(r, async () => { throw new Error("oops"); })).rejects.toThrow("oops");
    expect(log).toEqual(["closed"]);
  });

  test("works with sync Disposable", async () => {
    const log: string[] = [];
    const r = makeResource(log, "sync");
    await usingAsync(r, async () => 1);
    expect(log).toEqual(["sync"]);
  });
});

// ── DisposableGroup ────────────────────────────────────────────────────────

describe("DisposableGroup", () => {
  test("disposes added resources in reverse order", () => {
    const log: string[] = [];
    const group = new DisposableGroup();
    group.add(makeResource(log, "first"));
    group.add(makeResource(log, "second"));
    group.add(makeResource(log, "third"));
    group[DISPOSE]();
    expect(log).toEqual(["third", "second", "first"]);
  });

  test("defer() schedules a callback", () => {
    const log: string[] = [];
    const group = new DisposableGroup();
    group.defer(() => log.push("deferred"));
    group[DISPOSE]();
    expect(log).toEqual(["deferred"]);
  });

  test("add() returns the resource", () => {
    const group = new DisposableGroup();
    const r = makeResource([], "x");
    expect(group.add(r)).toBe(r);
  });

  test("size property", () => {
    const group = new DisposableGroup();
    expect(group.size).toBe(0);
    group.defer(() => {});
    group.defer(() => {});
    expect(group.size).toBe(2);
  });

  test("disposed property", () => {
    const group = new DisposableGroup();
    expect(group.disposed).toBe(false);
    group[DISPOSE]();
    expect(group.disposed).toBe(true);
  });

  test("second dispose is no-op (idempotent)", () => {
    const log: string[] = [];
    const group = new DisposableGroup();
    group.defer(() => log.push("x"));
    group[DISPOSE]();
    group[DISPOSE]();
    expect(log).toEqual(["x"]);
  });

  test("throws DisposeError if add() called after dispose", () => {
    const group = new DisposableGroup();
    group[DISPOSE]();
    expect(() => group.add(makeResource([], "x"))).toThrow(DisposeError);
  });

  test("throws AggregateError if multiple disposals fail", () => {
    const group = new DisposableGroup();
    group.defer(() => { throw new Error("A"); });
    group.defer(() => { throw new Error("B"); });
    try {
      group[DISPOSE]();
      fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AggregateError);
    }
  });

  test("propagates single error", () => {
    const group = new DisposableGroup();
    const err = new Error("solo");
    group.defer(() => { throw err; });
    expect(() => group[DISPOSE]()).toThrow(err);
  });
});

// ── AsyncDisposableGroup ──────────────────────────────────────────────────

describe("AsyncDisposableGroup", () => {
  test("disposes async + sync in reverse", async () => {
    const log: string[] = [];
    const group = new AsyncDisposableGroup();
    group.add(makeResource(log, "A"));
    group.add(makeAsyncResource(log, "B"));
    group.defer(async () => { log.push("C"); });
    await group[ASYNC_DISPOSE]();
    expect(log).toEqual(["C", "B", "A"]);
  });

  test("size and disposed properties", async () => {
    const group = new AsyncDisposableGroup();
    group.defer(() => {});
    expect(group.size).toBe(1);
    expect(group.disposed).toBe(false);
    await group[ASYNC_DISPOSE]();
    expect(group.disposed).toBe(true);
  });

  test("idempotent — second dispose is no-op", async () => {
    const log: string[] = [];
    const group = new AsyncDisposableGroup();
    group.defer(() => { log.push("x"); });
    await group[ASYNC_DISPOSE]();
    await group[ASYNC_DISPOSE]();
    expect(log).toEqual(["x"]);
  });

  test("throws DisposeError if add() after dispose", async () => {
    const group = new AsyncDisposableGroup();
    await group[ASYNC_DISPOSE]();
    expect(() => group.add(makeResource([], "x"))).toThrow(DisposeError);
  });

  test("collects errors as AggregateError", async () => {
    const group = new AsyncDisposableGroup();
    group.defer(async () => { throw new Error("P"); });
    group.defer(async () => { throw new Error("Q"); });
    await expect(group[ASYNC_DISPOSE]()).rejects.toBeInstanceOf(AggregateError);
  });
});
