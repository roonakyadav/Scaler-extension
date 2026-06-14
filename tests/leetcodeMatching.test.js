// ============================================================
// leetcodeMatching.test.js
// Unit tests for the confidence-based LeetCode matching helpers
// added to content/utils/stringUtils.js.
// ============================================================

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadFeature } = require("./helpers/harness");

function load() {
  return loadFeature("content/utils/stringUtils.js").window;
}

// ── titleMatchScore ──────────────────────────────────────────

test("titleMatchScore: exact titles score 1 regardless of case/punctuation", () => {
  const { titleMatchScore } = load();
  assert.equal(titleMatchScore("Two Sum", "two sum!"), 1);
});

test("titleMatchScore: reordered identical titles score 1", () => {
  const { titleMatchScore } = load();
  assert.equal(
    titleMatchScore(
      "Binary Tree Inorder Traversal",
      "Inorder Traversal of Binary Tree",
    ),
    1,
  );
});

test("titleMatchScore: near-but-different titles score below 1", () => {
  const { titleMatchScore } = load();
  const s = titleMatchScore("Two Sum", "Two Sum II");
  assert.ok(s > 0 && s < 1, `expected partial score, got ${s}`);
});

test("titleMatchScore: unrelated titles score 0", () => {
  const { titleMatchScore } = load();
  assert.equal(titleMatchScore("Memory Allocation", "Valid Parentheses"), 0);
});

// ── statementSimilarity ──────────────────────────────────────

test("statementSimilarity: identical statements score ~1", () => {
  const { statementSimilarity } = load();
  const t = "Given an array of integers nums return indices of two numbers";
  assert.ok(statementSimilarity(t, t) > 0.99);
});

test("statementSimilarity: same problem, HTML-wrapped + reworded scores high", () => {
  const { statementSimilarity } = load();
  const scaler =
    "Given an array of integers nums and a target, return the indices of the two numbers that add up to the target.";
  const lcHtml =
    "<p>Given an array of integers <code>nums</code> and an integer <code>target</code>, return <em>indices</em> of the two numbers such that they add up to <code>target</code>.</p>";
  assert.ok(
    statementSimilarity(scaler, lcHtml) >= 0.6,
    "expected high overlap for the same problem",
  );
});

test("statementSimilarity: different problems score low", () => {
  const { statementSimilarity } = load();
  const a = "Given an array of integers return indices of two numbers summing to target";
  const b = "Implement a thread-safe bounded blocking queue using semaphores and mutex locks";
  assert.ok(statementSimilarity(a, b) < 0.2);
});

// ── computeMatchConfidence ───────────────────────────────────

test("computeMatchConfidence: exact title + matching statement is accepted", () => {
  const { computeMatchConfidence } = load();
  const { confidence } = computeMatchConfidence({
    scalerTitle: "Two Sum",
    lcTitle: "Two Sum",
    scalerStatement:
      "Given an array of integers nums and a target return indices of the two numbers adding to target",
    lcContent:
      "<p>Given an array of integers nums and a target, return indices of the two numbers that add up to target.</p>",
  });
  assert.ok(confidence >= 0.6, `expected accept, got ${confidence}`);
});

test("computeMatchConfidence: exact title but different statement is suppressed (custom variation)", () => {
  const { computeMatchConfidence } = load();
  const { confidence } = computeMatchConfidence({
    scalerTitle: "Two Sum",
    lcTitle: "Two Sum",
    scalerStatement:
      "Design a distributed rate limiter that allows configuring requests per second per client using a token bucket",
    lcContent:
      "<p>Given an array of integers nums and a target, return indices of the two numbers that add up to target.</p>",
  });
  assert.ok(confidence < 0.6, `expected suppression, got ${confidence}`);
});

test("computeMatchConfidence: exact title with no statement falls back to conservative 0.8", () => {
  const { computeMatchConfidence } = load();
  const { confidence } = computeMatchConfidence({
    scalerTitle: "Valid Parentheses",
    lcTitle: "Valid Parentheses",
  });
  assert.equal(confidence, 0.8);
});

test("computeMatchConfidence: fuzzy title with no statement stays below accept threshold", () => {
  const { computeMatchConfidence } = load();
  const { confidence } = computeMatchConfidence({
    scalerTitle: "Two Sum",
    lcTitle: "Two Sum II",
  });
  assert.ok(confidence < 0.6, `expected reject, got ${confidence}`);
});

test("computeMatchConfidence: unrelated non-DSA title scores ~0", () => {
  const { computeMatchConfidence } = load();
  const { confidence } = computeMatchConfidence({
    scalerTitle: "Paging and Segmentation in Memory Allocation",
    lcTitle: "Two Sum",
  });
  assert.ok(confidence < 0.3, `expected near-zero, got ${confidence}`);
});
