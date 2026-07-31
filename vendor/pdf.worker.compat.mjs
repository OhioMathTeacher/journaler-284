/* The pdf.js worker, with the getOrInsertComputed polyfill applied first.
 *
 * pdf.js spawns its worker with {type:"module"}, so this wrapper can simply import
 * the polyfill ahead of the real worker; ES module imports evaluate in declaration
 * order. GlobalWorkerOptions.workerSrc in index.html points here, NOT at
 * pdf.worker.min.mjs directly.
 *
 * A worker has its own global scope. Polyfilling the main thread does nothing for
 * it, and the worker is where most of pdf.js's getOrInsertComputed calls live.
 */
import './pdf-compat.mjs';
import './pdf.worker.min.mjs';
