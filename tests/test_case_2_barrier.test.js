// Run with: node --test tests/test_case_2_barrier.test.js
// Needs GEMINI_API_KEY set - calls the real pipeline.

import test from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../lib/pipeline.js";
import { judgeAgainstRubric, totalScore } from "../lib/rubricJudge.js";
import { BARRIER_NOTE, ECZEMA_NOTE, BRANDED_STUDY_NOTE } from "./fixtures.js";

function chosenAttempt(result) {
  return result.log.chosenAttempt === "attempt1" ? result.log.attempt1 : (result.log.attempt2 || result.log.attempt1);
}

test("test case 2 (barrier note): acceptance criteria from round 2", async () => {
  const result = await runPipeline(BARRIER_NOTE);
  assert.equal(result.status, "DRAFT");
  const { draftText } = chosenAttempt(result);

  // Header intact.
  assert.ok(result.message.startsWith("SOURCE NOTE:"));

  // Brick-and-mortar recapped in at most one sentence, or not at all -
  // "it's not really a wall" (NL 007's own line) should not reappear.
  assert.ok(!/it'?s not really a wall/i.test(draftText), '"It\'s not really a wall" should not reappear verbatim');

  // Triage flagged the overlap.
  assert.ok(
    (result.log.triageAndFacts.overlapsWith || []).some((id) => id.includes("NL 007")),
    `expected overlapsWith to include NL 007, got ${JSON.stringify(result.log.triageAndFacts.overlapsWith)}`
  );

  // No 12+ word run pasted from the note's rough syntax.
  assert.ok(!/Like if you'?ve over-exfoliated/i.test(draftText), 'rough note syntax ("Like if you\'ve...") should not survive verbatim');

  // Genetic condition case points to a dermatologist, no management advice.
  if (/genetic condition|ceramide production/i.test(draftText)) {
    assert.ok(/dermatologist/i.test(draftText), "genetic-condition case should mention a dermatologist");
  }

  // No unsupported claims reach the final message.
  const stillUnsupported = chosenAttempt(result).unsupported.filter((u) => draftText.includes(u.sentence));
  assert.equal(stillUnsupported.length, 0, `unsupported sentence(s) reached the draft: ${JSON.stringify(stillUnsupported)}`);

  // Rhythm and repetition.
  const sentences = draftText.split(/(?<=[.!?])\s+/).filter(Boolean);
  const shortRatio = sentences.filter((s) => s.trim().split(/\s+/).length <= 8).length / sentences.length;
  assert.ok(shortRatio >= 0.15, `only ${Math.round(shortRatio * 100)}% short sentences (want 15%+)`);
  assert.ok(sentences.every((s) => s.trim().split(/\s+/).length <= 45), "a sentence exceeds 45 words");

  console.log(`  [info] overlapsWith: ${JSON.stringify(result.log.triageAndFacts.overlapsWith)}`);
});

test("eczema note: points to a dermatologist, gives no management advice", async () => {
  const result = await runPipeline(ECZEMA_NOTE);
  if (result.status !== "DRAFT") return; // triage may reasonably PARK/COMBINE this
  const { draftText } = chosenAttempt(result);
  assert.ok(/dermatologist/i.test(draftText), "should point to a dermatologist");
  assert.ok(
    !/(should use|treat it with|manage (it|the|your) (with|by))/i.test(draftText),
    "should not give direct management/treatment instructions for eczema"
  );
});

test("branded-study note: brand name (if a source is used) never reaches the draft", async () => {
  const result = await runPipeline(BRANDED_STUDY_NOTE);
  if (result.status !== "DRAFT") return;
  const { draftText } = chosenAttempt(result);
  // Can't assert a specific brand name without knowing what Google News
  // actually returns for this query at run time - the real check is
  // structural: no angle should reach the draft with brandNamesToScrub
  // still present in the text.
  const angle = result.log.currentAngle.angle;
  if (angle && angle.brandNamesToScrub) {
    for (const name of angle.brandNamesToScrub) {
      assert.ok(!draftText.toLowerCase().includes(name.toLowerCase()), `branded name "${name}" leaked into the draft`);
    }
  }
});

test("rubric judge scores test case 2 output", async () => {
  const result = await runPipeline(BARRIER_NOTE);
  const scores = await judgeAgainstRubric({ noteText: BARRIER_NOTE, message: result.message });
  const total = totalScore(scores);
  console.log(`  [info] rubric score: ${total}/10 - ${JSON.stringify(scores)}`);
  // Logged for run-to-run comparison rather than a hard gate - the rubric
  // judge is itself an LLM call and can be noisy, but a score this low
  // would mean something regressed badly.
  assert.ok(total >= 5, `rubric score suspiciously low: ${total}/10`);
});
