/**
 * A browser stand-in for Node's `assert`, aliased in vite.config.ts. `ketcher-react` does
 * `import assert from 'assert'` and calls it as a plain function (`assert(x)`), which is all this
 * provides — the whole `assert` module would be a dependency for one call shape. `events` gets
 * the real `events` package instead, because Ketcher needs a working `EventEmitter`.
 */
function assert(condition: unknown, message?: string): asserts condition {
	if (!condition) throw new Error(message ?? 'Assertion failed');
}
assert.ok = assert;
export default assert;
