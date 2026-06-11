# Scaler++ extension tests

Unit + integration tests for the content-script features in
[`../extension-main`](../extension-main).

## Running

```bash
cd Scaler++/tests
npm install      # one-time: installs jsdom
npm test         # runs everything (node:test runner)
npm run test:watch
```

Requires Node 18+ (uses the built-in `node:test` runner; no Jest).

## How it works

The content scripts are plain browser scripts (no `module.exports`). Some
declare top-level `function foo() {}`, others are IIFEs that attach
`window.initX`. The harness ([`helpers/harness.js`](helpers/harness.js)) loads a
script into a fresh **jsdom** window via `window.eval` (indirect eval → globals),
with mocked `chrome.*` (`makeChrome`) and `fetch` (`makeFetch`). After load, the
script's functions/globals are reachable on the returned `window`.

Two gotchas the harness/tests account for:

- **Cross-realm equality:** arrays/objects created inside jsdom have a different
  prototype than Node's, so `assert.deepStrictEqual` rejects identical contents.
  Rebase with `Array.from(x)` / `{ ...x }` before comparing.
- **Leaked timers/observers:** content scripts start `setInterval`s,
  `MutationObserver`s, and the videoDownloader/liveStreamRecorder singletons,
  which keep Node's event loop alive. `npm test` uses `--test-force-exit`.

## Coverage

| File | What it tests |
|------|---------------|
| `stringUtils.test.js` | `tokenize`, `isTitleSimilar`, `normalizeTitleForCache`, `escapeRegex` |
| `domUtils.test.js` | `getElementByXPath` |
| `joinClassButton.test.js` | time parsing, live-window logic, active-date detection, card time extraction (Date frozen) |
| `customMessage.test.js` | message selection/dismissal logic + banner injection |
| `instructorInfo.test.js` | session-page tab/panel injection, dashboard card tagging, container hiding |
| `lectureSummary.test.js` | cached-summary render, Generate-button state, no-transcript state, full Generate→cache flow |
| `smoke.test.js` | loads the **entire** manifest content-script bundle in one scope and asserts every feature entrypoint is wired up |

`smoke.test.js` reads the file list straight from `manifest.json`, so a newly
added content script is covered automatically (it must at least load without
throwing).
