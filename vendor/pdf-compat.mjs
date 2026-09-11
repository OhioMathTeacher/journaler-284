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

/* Promise.withResolvers — polyfill for pdf.js 6.0.227.
 *
 * pdf.js 6 calls Promise.withResolvers() in both bundles. It is ES2024: Chrome 119,
 * Firefox 121, Safari 17.4. Older than that -- an iPad stuck on iPadOS 16, a Galaxy
 * tablet on Samsung Internet 24 (Chromium 117), the Android 14 Play image's Chrome 113
 * -- and the reader dies with "Promise.withResolvers is not a function" behind the
 * same "Could not render this PDF" that blames the file. Found on the Android tablet
 * emulator, 2026-09-11, the day after two other exports on that platform.
 *
 * Same rule as above: loaded on the main thread AND in the worker, guarded so it is a
 * no-op where the engine has it, and a separate file so a pdf.js update cannot lose it.
 */
if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    value: function withResolvers() {
      let resolve, reject;
      const promise = new this((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/* Promise.try, URL.parse, Set.prototype.intersection, Uint8Array base64 — polyfills for
 * pdf.js 6.0.227.
 *
 * Found on an Android 14 emulator (Chrome 113), 2026-09-11, once withResolvers was in:
 * the reader still died, now with "Setting up fake worker failed". The worker itself
 * starts fine; what fails is the handshake, because pdf.js's message handler calls
 * Promise.try on EVERY message and Promise.try is ES2025 -- Chrome 128, Safari 18.2,
 * Firefox 134. pdf.js catches the throw and falls back to running the worker on the
 * main thread, which then imports workerSrc relative to pdf.min.mjs instead of the
 * page and 404s on vendor/vendor/. (index.html now hands it an absolute URL.)
 *
 * The others are bare in the bundle too, on paths a student will hit:
 *   URL.parse                    Chrome 126 / Safari 18 / Firefox 126   every link in a PDF
 *   Uint8Array.prototype.toBase64  Chrome 140 / Safari 18.2 / Firefox 133  every embedded FONT
 *   Uint8Array.fromBase64        same                                   XFA images
 *   Uint8Array.prototype.toHex   same                                   the document FINGERPRINT, i.e. every PDF
 *   Set.prototype.intersection   Chrome 122 / Safari 17 / Firefox 127   named destinations
 *   Math.sumPrecise              Chrome 141 / Firefox 143 / no Safari    glyph table sizes -- every TrueType font
 *   ArrayBuffer.prototype.transferToFixedLength  Chrome 114 / Safari 17.4  packing font info for the main thread
 * The last two were found the same afternoon by a different route: the worker parsed the
 * page up to its first font and stopped, the operator list ended at beginText, and the
 * render simply never finished -- a page of rules and no words, with nothing in the
 * console. Force the worker onto the main thread (import pdf.worker.compat.mjs before
 * getDocument) and the TypeErrors appear as warnings. That is the way to find the next one.
 * So pdf.js 6.0.227 effectively wants a 2025 browser. An iPad on iPadOS 17 or a Galaxy
 * tablet on Samsung Internet 27 (Chromium 125) does not have one. Float16Array is the
 * one the bundle guards itself; structuredClone, .at and .findLast are old enough.
 *
 * Each is guarded and spec-shaped for the calls pdf.js makes; none is a full
 * implementation of its proposal. When the next pdf.js bump lands, re-run the reader
 * on the emulator's Chrome 113 -- it is the oldest engine to hand -- and delete
 * whatever it no longer complains about.
 */
if (typeof Promise.try !== 'function') {
  Object.defineProperty(Promise, 'try', {
    value: function tryFn(fn, ...args) {
      return new this(resolve => resolve(fn(...args)));   // a sync throw becomes a rejection
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof URL.parse !== 'function') {
  Object.defineProperty(URL, 'parse', {
    value: function parse(url, base) {
      try { return base === undefined ? new URL(url) : new URL(url, base); } catch { return null; }
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof Set.prototype.intersection !== 'function') {
  Object.defineProperty(Set.prototype, 'intersection', {
    value: function intersection(other) {
      const out = new Set();
      for (const v of this) if (other.has(v)) out.add(v);
      return out;
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof Uint8Array.prototype.toBase64 !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value: function toBase64(opts) {
      let s = '';
      for (let i = 0; i < this.length; i += 0x8000)          // chunked: apply() has an argument limit
        s += String.fromCharCode.apply(null, this.subarray(i, i + 0x8000));
      let b64 = btoa(s);
      if (opts && opts.alphabet === 'base64url') b64 = b64.replace(/\+/g, '-').replace(/\//g, '_');
      if (opts && opts.omitPadding) b64 = b64.replace(/=+$/, '');
      return b64;
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof Uint8Array.fromBase64 !== 'function') {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    value: function fromBase64(str, opts) {
      let s = String(str).replace(/\s+/g, '');
      if (opts && opts.alphabet === 'base64url') s = s.replace(/-/g, '+').replace(/_/g, '/');
      if (s.length % 4) s += '='.repeat(4 - (s.length % 4));
      const bin = atob(s), out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof Uint8Array.prototype.toHex !== 'function') {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    value: function toHex() {
      let s = '';
      for (let i = 0; i < this.length; i++) s += (this[i] < 16 ? '0' : '') + this[i].toString(16);
      return s;
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof Math.sumPrecise !== 'function') {
  // Neumaier's compensated sum: exact enough for sizes and offsets, which is what pdf.js
  // adds with it. The proposal's fully-correct rounding is not needed here.
  Object.defineProperty(Math, 'sumPrecise', {
    value: function sumPrecise(iterable) {
      let sum = 0, c = 0;
      for (const x of iterable) {
        const t = sum + x;
        c += Math.abs(sum) >= Math.abs(x) ? (sum - t) + x : (x - t) + sum;
        sum = t;
      }
      return sum + c;
    },
    writable: true, configurable: true, enumerable: false,
  });
}
if (typeof ArrayBuffer.prototype.transferToFixedLength !== 'function') {
  // A copy, not a transfer: the engine cannot detach the source, so the old buffer stays
  // alive until it is dropped. pdf.js only reads the result.
  Object.defineProperty(ArrayBuffer.prototype, 'transferToFixedLength', {
    value: function transferToFixedLength(newLength) {
      const n = newLength === undefined ? this.byteLength : newLength;
      const out = new ArrayBuffer(n);
      new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(n, this.byteLength)));
      return out;
    },
    writable: true, configurable: true, enumerable: false,
  });
}
