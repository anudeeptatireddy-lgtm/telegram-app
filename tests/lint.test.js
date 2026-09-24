// Run with: node --test tests/lint.test.js
// Pure unit tests for lib/lint.js - no API calls, no network, no cost.
// These check the mechanically-testable rules from the improvement brief
// directly, the way the brief asks for rather than trusting model output.

import test from "node:test";
import assert from "node:assert/strict";
import { lintDraft } from "../lib/lint.js";

function hasRule(failures, rule) {
  return failures.some((f) => f.rule === rule);
}

// A realistic-length paragraph so word-count doesn't fire in tests that
// aren't specifically about word count.
const PADDING = Array(60).fill("This is a plain filler sentence about formulation.").join(" ");

test("flags exclamation marks", () => {
  const failures = lintDraft(`Great news! ${PADDING}`);
  assert.ok(hasRule(failures, "exclamation-mark"));
});

test("flags semicolons", () => {
  const failures = lintDraft(`The pH dropped; that matters. ${PADDING}`);
  assert.ok(hasRule(failures, "semicolon"));
});

test("flags em dashes and en dashes", () => {
  const em = lintDraft(`This is a claim — and a consequence. ${PADDING}`);
  assert.ok(hasRule(em, "em-dash"));
  const en = lintDraft(`A range of 3–10 percent-ish. ${PADDING}`);
  assert.ok(hasRule(en, "en-dash"));
});

test('flags the word "percent" instead of "%"', () => {
  const failures = lintDraft(`This affects 20 percent of formulas. ${PADDING}`);
  assert.ok(hasRule(failures, "percent-word"));
});

test("does not flag % itself", () => {
  const failures = lintDraft(`This affects 20% of formulas, which matches known facts. ${PADDING}`, {
    factsText: "20% of formulas",
  });
  assert.ok(!hasRule(failures, "percent-word"));
});

test("flags bullet/numbered list lines", () => {
  const failures = lintDraft(`Some intro text.\n- first point\n${PADDING}`);
  assert.ok(hasRule(failures, "list-or-header"));
});

test("flags a bare question mark outside quotes", () => {
  const failures = lintDraft(`Why does this happen? ${PADDING}`);
  assert.ok(hasRule(failures, "bare-question"));
});

test("does not flag a question mark inside quoted speech", () => {
  const failures = lintDraft(`She asked, "are they compatible?" ${PADDING}`);
  assert.ok(!hasRule(failures, "bare-question"));
});

test("flags banned hype words", () => {
  const failures = lintDraft(`This is an amazing result. ${PADDING}`);
  assert.ok(hasRule(failures, "banned-word"));
});

test("flags a tic used more than once, allows it once", () => {
  const twice = lintDraft(`I want to explain this. Also, I want to be clear. ${PADDING}`);
  assert.ok(hasRule(twice, "tic-cap"));
  const once = lintDraft(`I want to explain this. ${PADDING}`);
  assert.ok(!hasRule(once, "tic-cap"));
});

test("number-provenance: fails a number with no source, passes one that traces to facts", () => {
  const unsupported = lintDraft(`This affects 47% of cases. ${PADDING}`, { factsText: "", sourcesText: "" });
  assert.ok(hasRule(unsupported, "number-provenance"));

  const supported = lintDraft(`She used it for four months. ${PADDING}`, {
    factsText: "four months of serum use",
  });
  assert.ok(!hasRule(supported, "number-provenance"));
});

test("flags an unsupported product claim, allows one backed by the note", () => {
  const unsupported = lintDraft(`Our serum uses a proprietary blend. ${PADDING}`);
  assert.ok(hasRule(unsupported, "product-claim"));

  const allowed = lintDraft(`Our serum uses a proprietary blend. ${PADDING}`, { allowProductClaim: true });
  assert.ok(!hasRule(allowed, "product-claim"));
});

test("flags two closing-style paragraphs in a row", () => {
  const text = `${PADDING}\n\nAsk your brand for their documentation.\n\nIf they can't answer, that tells you something.`;
  const failures = lintDraft(text);
  assert.ok(hasRule(failures, "double-closing"));
});

test("a clean, in-range draft passes everything", () => {
  const clean = Array(30)
    .fill("A customer wrote in today about a genuine formulation question we take seriously.")
    .join(" ");
  const failures = lintDraft(clean, { factsText: "today", allowProductClaim: true });
  assert.deepEqual(failures, []);
});
