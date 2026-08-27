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

/* ReadableStream async iteration — polyfill for pdf.js 6.0.227.
 *
 * pdf.js reads a page's words with `for await (const chunk of streamTextContent())`,
 * iterating a ReadableStream directly. Chrome and Firefox implement async iteration on
 * ReadableStream; WebKit does not, and has not for years. So on Safari — Mac exactly as
 * much as iPad — getTextContent threw on every page, the text layer stayed empty, and
 * every marquee capture came back as "a figure" with no text, while the page itself
 * rendered perfectly. Nothing surfaced: the throw is caught into a console.warn that no
 * student can read.
 *
 * Found in the 318P app on 2026-08-27 and ported here the same day. The two apps vendor
 * the same pdf.js and have each missed a fix the other had — 284 fixed
 * getOrInsertComputed on 2026-07-31 and 318P went four weeks without it, until a student
 * lost a class to a white screen. When a compat fix lands in one, apply it to the other.
 *
 * Guarded, so it is a no-op wherever the engine already has it. Delete when WebKit ships.
 */
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  const values = function ({ preventCancel = false } = {}) {
    const reader = this.getReader();
    return {
      async next() {
        try {
          const { done, value } = await reader.read();
          if (done) { reader.releaseLock(); return { done: true, value: undefined }; }
          return { done: false, value };
        } catch (err) { reader.releaseLock(); throw err; }
      },
      // Honour early exit: a `break` out of the loop must cancel and release, or the
      // next getTextContent on that page waits forever on a lock nobody holds.
      async return(value) {
        if (preventCancel) { reader.releaseLock(); return { done: true, value }; }
        const cancelled = reader.cancel(value);
        reader.releaseLock();
        await cancelled;
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; }
    };
  };
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator,
    { value: values, writable: true, configurable: true });
  Object.defineProperty(ReadableStream.prototype, 'values',
    { value: values, writable: true, configurable: true });
}
