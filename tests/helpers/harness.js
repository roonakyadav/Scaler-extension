// ============================================================
// helpers/harness.js
// Shared test harness for loading Scaler++ content scripts into a
// jsdom environment with mocked chrome.* and fetch.
//
// The content scripts are plain (non-module) browser scripts:
//   - Some declare top-level `function foo() {}` (become window.foo).
//   - Some are IIFEs that attach `global.initX` to window.
// We load them via window.eval (indirect eval → global scope), so both
// patterns end up reachable on the returned `window`.
// ============================================================

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const EXTENSION_ROOT = path.resolve(__dirname, "..", "..", "extension-main");

function featurePath(relPath) {
  return path.join(EXTENSION_ROOT, relPath);
}

/**
 * Read a content-script source file (relative to extension-main/).
 */
function readFeature(relPath) {
  return fs.readFileSync(featurePath(relPath), "utf8");
}

/**
 * Shallow helper that mimics chrome.storage.*.get's flexible key argument.
 */
function pickKeys(store, keys) {
  if (keys === null || keys === undefined) return { ...store };
  if (typeof keys === "string") {
    return keys in store ? { [keys]: store[keys] } : {};
  }
  if (Array.isArray(keys)) {
    const out = {};
    for (const k of keys) if (k in store) out[k] = store[k];
    return out;
  }
  // object form: keys are defaults
  const out = { ...keys };
  for (const k of Object.keys(keys)) if (k in store) out[k] = store[k];
  return out;
}

/**
 * Build a configurable chrome.* mock.
 *
 * @param {object} opts
 * @param {function} [opts.sendMessage]  - custom (msg, cb) => void handler
 * @param {object}   [opts.localStore]   - initial chrome.storage.local data
 * @param {object}   [opts.syncStore]    - initial chrome.storage.sync data
 */
function makeChrome(opts = {}) {
  const local = { ...(opts.localStore || {}) };
  const sync = { ...(opts.syncStore || {}) };

  const messageListeners = [];

  const chrome = {
    runtime: {
      id: "test-extension-id",
      lastError: null,
      sendMessage: opts.sendMessage
        ? (msg, cb) => opts.sendMessage(msg, cb)
        : (msg, cb) => {
            if (typeof cb === "function") cb(undefined);
          },
      onMessage: {
        addListener: (fn) => messageListeners.push(fn),
        removeListener: () => {},
      },
    },
    storage: {
      local: {
        get: (keys, cb) => cb(pickKeys(local, keys)),
        set: (obj, cb) => {
          Object.assign(local, obj);
          if (cb) cb();
        },
        remove: (keys, cb) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete local[k]);
          if (cb) cb();
        },
      },
      sync: {
        get: (keys, cb) => cb(pickKeys(sync, keys)),
        set: (obj, cb) => {
          Object.assign(sync, obj);
          if (cb) cb();
        },
        remove: (keys, cb) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete sync[k]);
          if (cb) cb();
        },
      },
    },
    // expose for assertions
    __local: local,
    __sync: sync,
    __messageListeners: messageListeners,
  };

  return chrome;
}

/**
 * Build a fetch mock from a router function.
 * @param {function} router (url, options) => responseSpec | Promise<responseSpec>
 *   responseSpec: { ok?, status?, json?, text? } or a value to JSON-return.
 */
function makeFetch(router) {
  return async function fetch(url, options) {
    const spec = await router(String(url), options || {});
    if (spec && (spec.json || spec.text || "ok" in spec || "status" in spec)) {
      const status = spec.status ?? (spec.ok === false ? 500 : 200);
      return {
        ok: spec.ok ?? (status >= 200 && status < 300),
        status,
        json: async () =>
          typeof spec.json === "function" ? spec.json() : spec.json,
        text: async () =>
          typeof spec.text === "function" ? spec.text() : spec.text ?? "",
      };
    }
    // bare value → 200 JSON
    return {
      ok: true,
      status: 200,
      json: async () => spec,
      text: async () => JSON.stringify(spec),
    };
  };
}

/**
 * Load one or more content scripts into a fresh jsdom window.
 *
 * @param {string|string[]} relPaths  - file(s) relative to extension-main/
 * @param {object} opts
 * @param {string} [opts.url]    - page URL (drives location.*)
 * @param {string} [opts.html]   - initial document HTML
 * @param {object} [opts.chrome] - chrome mock (defaults to makeChrome())
 * @param {function} [opts.fetch]- fetch implementation
 * @param {object} [opts.globals]- extra props to set on window before eval
 * @returns {{ dom, window, chrome }}
 */
function loadFeature(relPaths, opts = {}) {
  const files = Array.isArray(relPaths) ? relPaths : [relPaths];
  const dom = new JSDOM(opts.html || "<!DOCTYPE html><html><body></body></html>", {
    url: opts.url || "https://www.scaler.com/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  const { window } = dom;
  const chrome = opts.chrome || makeChrome();

  window.chrome = chrome;
  if (opts.fetch) window.fetch = opts.fetch;
  // jsdom has no console wiring by default in tests — pass ours through.
  window.console = console;

  if (opts.globals) {
    for (const [k, v] of Object.entries(opts.globals)) window[k] = v;
  }

  for (const rel of files) {
    // Indirect eval → top-level declarations land on the window global.
    window.eval(readFeature(rel));
  }

  return { dom, window, chrome };
}

/**
 * Flush pending microtasks/timers so async init code settles.
 */
function tick(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  EXTENSION_ROOT,
  featurePath,
  readFeature,
  loadFeature,
  makeChrome,
  makeFetch,
  tick,
};
