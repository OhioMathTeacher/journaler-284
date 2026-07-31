/* Map/WeakMap.prototype.getOrInsertComputed — polyfill for pdf.js 6.0.227.
 *
 * pdf.js 6 calls this method in BOTH pdf.min.mjs and pdf.worker.min.mjs. It is a
 * very new TC39 proposal: recent Firefox and Chromium have it, and iOS Safari does
 * not. The failure is not graceful — the reader dies with
 * "getOrInsertComputed is not a function" and the app reports "Could not render
 * this PDF", which reads like a bad file rather than a missing browser feature.
 * Found on an iPad, 2026-07-31, against a PDF that opens fine on the desktop.
 *
 * This file is loaded first on the main thread AND, via pdf.worker.compat.mjs,
 * inside the worker — a worker has its own global scope, so patching only the
 * main thread fixes nothing.
 *
 * Deliberately a separate file rather than an edit to the vendored bundles: those
 * get replaced wholesale on the next pdf.js update, and a hand-patch would vanish
 * without a sound. If you update pdf.js, check whether this is still needed — when
 * Safari ships the method, the guard below makes this a no-op and it can be deleted.
 *
 * Semantics per the proposal: return the existing value if the key is present,
 * otherwise call the callback WITH THE KEY, store the result, and return it.
 */
for (const Ctor of [Map, WeakMap]) {
  if (Ctor && Ctor.prototype && typeof Ctor.prototype.getOrInsertComputed !== 'function') {
    Object.defineProperty(Ctor.prototype, 'getOrInsertComputed', {
      value: function getOrInsertComputed(key, callbackfn) {
        if (this.has(key)) return this.get(key);
        const value = callbackfn(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}
