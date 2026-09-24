// Run with: node --test tests/regression.acceptance.test.js
// Needs GEMINI_API_KEY set in the environment - this calls the real
// pipeline (real Gemini calls), it is not free or instant.
//
// Checks the brief's acceptance criteria against a live run of the
// original failing note. Also exercises the three additional cases the
// brief asked for: a note with real numbers to preserve, a too-thin note
// that should be parked, and a note naming a real supplier that must be
// caught and removed.

import test from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../lib/pipeline.js";
import {
  LAYERING_ORDER_NOTE,
  OWN_NUMBERS_NOTE,
  TOO_THIN_NOTE,
  NAMES_SUPPLIER_NOTE,
} from "./fixtures.js";

test("layering-order note: full acceptance criteria from the brief", async () => {
  const result = await runPipeline(LAYERING_ORDER_NOTE);
  assert.equal(result.status, "DRAFT");
  const draft = result.log.attempt2 ? result.log.attempt2.draftText : result.log.attempt1.draftText;

  assert.ok(!/yesterday/i.test(draft), 'must not say "yesterday" - the note says today');

  // Only "four" and "two" (from "four months" / "two weeks") should appear
  // as numbers unless a verified source backs something else.
  const digits = draft.match(/\b\d+(\.\d+)?\b/g) || [];
  const spelledFour = /\bfour\b/i.test(draft);
  const spelledTwo = /\btwo\b/i.test(draft);
  const onlyAllowedNumbersPresent = digits.length === 0 || digits.every((d) => d === "4" || d === "2");
  assert.ok(onlyAllowedNumbersPresent || (spelledFour && spelledTwo), "unexplained numbers present");

  assert.ok(!/\bnovember\b/i.test(draft), "must not invent a batch/date detail like November");
  assert.ok(!/our serum (uses|contains|designed)/i.test(draft), "must not invent a product claim");
  assert.ok(!/raincoat|jumper/i.test(draft), "must not use a metaphor");

  const finalLint = result.log.attempt2 ? result.log.attempt2.lintFailures : result.log.attempt1.lintFailures;
  const finalUnsupported = result.log.attempt2 ? result.log.attempt2.unsupported : result.log.attempt1.unsupported;
  assert.equal(finalLint.length, 0, `lint should be clean after retry: ${JSON.stringify(finalLint)}`);
  assert.equal(finalUnsupported.length, 0, `no unsupported claims after retry: ${JSON.stringify(finalUnsupported)}`);

  assert.ok(result.message.includes("CURRENT ANGLE:"));
  assert.ok(result.message.includes("NEEDS YOUR CHECK:"));
});

test("own-numbers note: real figures from the note must survive, not get flagged", async () => {
  const result = await runPipeline(OWN_NUMBERS_NOTE);
  assert.equal(result.status, "DRAFT");
  const draft = result.log.attempt2 ? result.log.attempt2.draftText : result.log.attempt1.draftText;
  assert.ok(/0\.4/.test(draft) || /fourteen|14/i.test(draft), "her real batch/pH figures should appear somewhere");
});

test("too-thin note: triage should PARK it, not draft from it", async () => {
  const result = await runPipeline(TOO_THIN_NOTE);
  assert.notEqual(result.status, "DRAFT");
  assert.ok(["PARK", "COMBINE"].includes(result.status));
});

test("names-supplier note: the supplier name must not reach the final message", async () => {
  const result = await runPipeline(NAMES_SUPPLIER_NOTE);
  if (result.status === "DRAFT") {
    assert.ok(!/BASF/i.test(result.message), "supplier name leaked into the output");
  }
});
