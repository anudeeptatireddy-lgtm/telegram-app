// Snapshot test of the rendered message format - guards against the
// "OURCE NOTE" header-corruption bug reported in round 2 (unreproducible
// in current code, but this test exists so it's caught immediately if it
// ever recurs).

import test from "node:test";
import assert from "node:assert/strict";

// formatMessage/formatParkedMessage aren't exported (internal to
// pipeline.js) - re-implement the exact same shape here as a black-box
// contract test against runPipeline's actual output instead, since that's
// what a Telegram user or the web frontend actually sees.
import { runPipeline } from "../lib/pipeline.js";

test("rendered message always starts with an intact SOURCE NOTE header", async () => {
  const result = await runPipeline("reorder packaging boxes, running low, check with the printer about the matte finish again");
  assert.ok(result.message.startsWith("SOURCE NOTE:"), `header corrupted: ${JSON.stringify(result.message.slice(0, 20))}`);
});

test("parked message preserves paragraph breaks between SOURCE NOTE, STATUS/REASON, and the closing line", async () => {
  const result = await runPipeline("reorder packaging boxes, running low, check with the printer about the matte finish again");
  const blocks = result.message.split("\n\n");
  assert.ok(blocks.length >= 3, `expected at least 3 paragraph blocks, got ${blocks.length}: ${JSON.stringify(result.message)}`);
  assert.ok(blocks[0].startsWith("SOURCE NOTE:"));
  assert.ok(result.message.includes("STATUS:"));
  assert.ok(result.message.includes("REASON:"));
});
