const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadFeature, makeChrome, makeFetch, tick } = require("./helpers/harness");

const SESSION_URL =
  "https://www.scaler.com/academy/mentee-dashboard/class/777/session";

const metaFetch = makeFetch((url) => {
  if (url.includes("/api/v2/classroom/777/meta")) {
    return { json: { data: { attributes: { slug: "lec-777", name: "Lecture 777" } } } };
  }
  return { ok: false, status: 404 };
});

const SESSION_HTML = `<!DOCTYPE html><html><body>
  <div class="me-cr-body">
    <div class="navigation-tabs"></div>
    <div class="me-cr-lecture-container">lecture</div>
  </div>
</body></html>`;

function clickTab(window) {
  const tab = window.document.getElementById("classroom-lecture-summary");
  tab.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

// Build a chrome mock whose sendMessage routes by action, recording calls.
function summaryChrome(handlers, stores = {}) {
  const calls = [];
  const chrome = makeChrome({
    localStore: stores.local,
    syncStore: stores.sync,
    sendMessage: (msg, cb) => {
      calls.push(msg);
      const h = handlers[msg.action];
      const resp = typeof h === "function" ? h(msg) : h;
      if (cb) cb(resp ?? { success: true });
    },
  });
  chrome.__calls = calls;
  return chrome;
}

test("renders a cached summary's sections", async () => {
  const chrome = summaryChrome({
    checkSummaryCache: {
      success: true,
      data: {
        cached: true,
        summary: { topics: ["Trees 101"], notes: [], deadlines: ["HW due Fri"], announcements: [] },
        generatedBy: "a@b.com",
        model: "gpt-4o-mini",
      },
    },
  });

  const { window } = loadFeature("content/features/lectureSummary.js", {
    url: SESSION_URL,
    html: SESSION_HTML,
    fetch: metaFetch,
    chrome,
  });

  window.initLectureSummary();
  await tick(20);
  clickTab(window);
  await tick(50);

  const panel = window.document.getElementById("scaler-summary-panel");
  assert.match(panel.textContent, /Topics Taught/);
  assert.match(panel.textContent, /Trees 101/);
  assert.match(panel.textContent, /HW due Fri/);
  assert.match(panel.textContent, /a@b\.com/);
});

test("shows Generate button when a transcript exists but no summary", async () => {
  const chrome = summaryChrome({
    checkSummaryCache: { success: true, data: { cached: false } },
    checkTranscriptCache: { success: true, data: { cached: true, text: "full transcript text" } },
  });

  const { window } = loadFeature("content/features/lectureSummary.js", {
    url: SESSION_URL,
    html: SESSION_HTML,
    fetch: metaFetch,
    chrome,
  });

  window.initLectureSummary();
  await tick(20);
  clickTab(window);
  await tick(50);

  const panel = window.document.getElementById("scaler-summary-panel");
  const buttons = [...panel.querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(buttons.includes("Generate Summary"), "Generate button should be shown");
});

test("asks for a transcript first when neither summary nor transcript is cached", async () => {
  const chrome = summaryChrome({
    checkSummaryCache: { success: true, data: { cached: false } },
    checkTranscriptCache: { success: true, data: { cached: false } },
  });

  const { window } = loadFeature("content/features/lectureSummary.js", {
    url: SESSION_URL,
    html: SESSION_HTML,
    fetch: metaFetch,
    chrome,
  });

  window.initLectureSummary();
  await tick(20);
  clickTab(window);
  await tick(50);

  const panel = window.document.getElementById("scaler-summary-panel");
  assert.match(panel.textContent, /transcript/i);
  assert.match(panel.textContent, /first/i);
});

test("Generate flow calls the LLM, renders the result and caches it", async () => {
  const generated = {
    topics: ["Recursion"],
    notes: ["Base case matters"],
    deadlines: [],
    announcements: ["Quiz next week"],
  };

  const chrome = summaryChrome(
    {
      checkSummaryCache: { success: true, data: { cached: false } },
      checkTranscriptCache: { success: true, data: { cached: true, text: "transcript" } },
      generateSummary: { success: true, summary: generated },
      saveSummary: { success: true, data: { saved: true } },
    },
    {
      local: { scaler_summary_config: { baseUrl: "https://api.x/v1", apiKey: "sk-1", model: "m" } },
      sync: { scaler_user: { email: "gen@scaler.com" } },
    },
  );

  const { window } = loadFeature("content/features/lectureSummary.js", {
    url: SESSION_URL,
    html: SESSION_HTML,
    fetch: metaFetch,
    chrome,
  });

  window.initLectureSummary();
  await tick(20);
  clickTab(window);
  await tick(50);

  const panel = window.document.getElementById("scaler-summary-panel");
  const genBtn = [...panel.querySelectorAll("button")].find(
    (b) => b.textContent === "Generate Summary",
  );
  assert.ok(genBtn, "Generate button present");
  genBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await tick(50);

  // rendered the generated summary
  assert.match(panel.textContent, /Recursion/);
  assert.match(panel.textContent, /Quiz next week/);

  // called generate + save with the right payload
  const calls = chrome.__calls;
  const gen = calls.find((c) => c.action === "generateSummary");
  assert.ok(gen, "generateSummary was called");
  assert.equal(gen.transcript, "transcript");
  assert.equal(gen.apiKey, "sk-1");

  const save = calls.find((c) => c.action === "saveSummary");
  assert.ok(save, "saveSummary was called");
  assert.equal(save.slug, "lec-777");
  assert.equal(save.classId, "777");
  assert.equal(save.generatedBy, "gen@scaler.com");
  assert.deepEqual(save.summary, generated);
});

test("does not inject the Summary tab on non-session pages", () => {
  const { window } = loadFeature("content/features/lectureSummary.js", {
    url: "https://www.scaler.com/academy/mentee-dashboard/todos",
    fetch: metaFetch,
  });
  window.initLectureSummary();
  assert.equal(window.document.getElementById("classroom-lecture-summary"), null);
});
