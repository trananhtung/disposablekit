// Polyfill for environments that don't have Symbol.dispose / Symbol.asyncDispose
// (Node.js < 18.20 / TypeScript < 5.2 runtimes)
export const DISPOSE: typeof Symbol.dispose =
  typeof Symbol.dispose !== "undefined"
    ? Symbol.dispose
    : (Symbol.for("Symbol.dispose") as typeof Symbol.dispose);

export const ASYNC_DISPOSE: typeof Symbol.asyncDispose =
  typeof Symbol.asyncDispose !== "undefined"
    ? Symbol.asyncDispose
    : (Symbol.for("Symbol.asyncDispose") as typeof Symbol.asyncDispose);
