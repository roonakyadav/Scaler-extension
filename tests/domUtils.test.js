const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadFeature } = require("./helpers/harness");

test("getElementByXPath returns the matching node", () => {
  const { window } = loadFeature("content/utils/domUtils.js", {
    html: `<!DOCTYPE html><html><body>
      <div id="a"><span class="target">hello</span></div>
    </body></html>`,
  });

  const node = window.getElementByXPath('//span[@class="target"]');
  assert.ok(node, "node should be found");
  assert.equal(node.textContent, "hello");
});

test("getElementByXPath returns null when nothing matches", () => {
  const { window } = loadFeature("content/utils/domUtils.js");
  assert.equal(window.getElementByXPath('//div[@id="nope"]'), null);
});
