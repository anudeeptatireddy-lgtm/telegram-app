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
  // Realistic prose, not a repeated sentence - needs rhythm variation and
  // no word repeated more than 4 times to actually pass the round-2 checks.
  const clean = [
    "A customer wrote in today with a formulation question that turned out to matter more than it first looked.",
    "Her cream had stopped absorbing the way it used to.",
    "She assumed the product had changed. It hadn't.",
    "What changed was the order she applied things in, and that single detail explained the whole complaint.",
    "This comes up constantly in formulation work.",
    "People notice the step that behaves differently and blame it, even when the real cause sits one layer earlier in the routine.",
    "A heavier cream applied first can sit on the surface and block everything that follows.",
    "That is a sequencing problem, not a formulation failure.",
    "It is a distinction worth making plainly, because customers rarely think to check it themselves.",
    "Concentration matters too, but order is the variable most people skip entirely.",
    "None of this is exotic chemistry.",
    "It is the kind of detail that only shows up once you actually ask what changed.",
    "Before assuming a product has failed, look at what else moved around it first.",
    "Check the sequence before you check the formula.",
    "The same pattern shows up with actives generally, not just moisturisers.",
    "Layer a dense film underneath something you want absorbed and the film wins.",
    "That holds whether the film comes from a rich night cream, a mineral sunscreen, or an occlusive balm applied too early in the routine.",
    "None of these steps are wrong on their own.",
    "The mistake is purely about timing, and timing gets overlooked because ingredient lists get all the attention instead.",
    "A brand can list excellent actives and still ship instructions that quietly undercut them.",
    "Ask what a product was actually tested to sit under or over, not just what it contains.",
    "That single question tends to reveal more than any ingredient list does.",
    "Routines fail in the gaps between products, not usually inside a single bottle.",
    "Worth remembering next time something you trusted seems to stop working overnight.",
    "None of this requires a lab to notice.",
    "Write down the order you apply things in for a week and look back at it honestly.",
    "Most people have never actually done that simple exercise before blaming a bottle.",
    "It takes very little time and often answers the question a return request never could.",
    "Formulators think in sequence constantly because early steps genuinely change what later steps can accomplish.",
    "Customers rarely get taught to think the same way, and that gap causes most of the confusion.",
    "Fixing it does not require new products.",
    "It usually just requires putting the same shelf of products back in a different order.",
  ].join(" ");
  const failures = lintDraft(clean, { factsText: "today", allowProductClaim: true });
  assert.deepEqual(failures, []);
});

// --- Round 2 additions ---

test("flags flat rhythm (too few short sentences)", () => {
  const flat = Array(20).fill("This particular formulation approach tends to create noticeably different outcomes across skin types.").join(" ");
  const failures = lintDraft(flat);
  assert.ok(hasRule(failures, "flat-rhythm"));
});

test("flags a sentence over 45 words", () => {
  const longSentence = Array(50).fill("word").join(" ") + ".";
  const failures = lintDraft(`${longSentence} ${PADDING}`);
  assert.ok(hasRule(failures, "long-sentence"));
});

test("flags a non-core word repeated more than 4 times", () => {
  const repetitive = "The silicone film blocks absorption. The silicone layer sits on top. The silicone barrier traps everything below. The silicone residue builds up over time. The silicone coating never really breaks down. " + PADDING;
  const failures = lintDraft(repetitive);
  assert.ok(hasRule(failures, "word-repetition"));
});

test("medical boundary: flags a condition mentioned without dermatologist, and flags management advice", () => {
  const noDerm = lintDraft(`Her eczema flared up again this week. ${PADDING}`);
  assert.ok(hasRule(noDerm, "medical-boundary"));

  const withDerm = lintDraft(`Her eczema flared up again this week. See a dermatologist about it. ${PADDING}`);
  assert.ok(!hasRule(withDerm, "medical-boundary"));

  const advice = lintDraft(`For eczema, you should treat it with a heavier moisturiser twice daily. See a dermatologist too. ${PADDING}`);
  assert.ok(hasRule(advice, "medical-advice"));
});

test("verbatim-note-syntax: flags a 12+ word run pasted from the note, exempts the chosen keepLine", () => {
  const note = "Like if you have over-exfoliated you have removed corneocytes that is different from if you have depleted the lipid matrix through harsh cleansing";
  const draftWithPastedSyntax = `Like if you have over-exfoliated you have removed corneocytes that is different from if you have depleted the lipid matrix. ${PADDING}`;
  const failures = lintDraft(draftWithPastedSyntax, { noteText: note });
  assert.ok(hasRule(failures, "verbatim-note-syntax"));

  const keepLine = "That's the entire problem.";
  const noteWithKeepLine = `${note} ${keepLine}`;
  const draftWithOnlyKeepLine = `${keepLine} ${PADDING}`;
  const clean = lintDraft(draftWithOnlyKeepLine, { noteText: noteWithKeepLine, keepLine });
  assert.ok(!hasRule(clean, "verbatim-note-syntax"));
});
