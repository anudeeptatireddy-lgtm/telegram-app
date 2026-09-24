import { generateJSON } from "./gemini.js";
import { fetchTopNewsItem } from "./googleNews.js";
import { lintDraft } from "./lint.js";
import { VOICE_SKILL } from "./voicePrompt.js";

// Vercel Hobby caps function execution at 60s. Each Gemini call realistically
// costs 3-6s with thinking disabled, so the pipeline still minimises
// sequential round trips: combine steps that don't need each other's output,
// run genuinely independent calls concurrently, and skip the retry pass
// rather than risk a silent 504 if we're already close to the ceiling.
const TIME_BUDGET_MS = 45000;

const TRIAGE_AND_FACTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["DRAFT", "PARK", "COMBINE"] },
    reason: { type: "STRING" },
    facts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          fact: { type: "STRING" },
          certainty: { type: "STRING", enum: ["certain", "hedged"] },
        },
        required: ["fact", "certainty"],
      },
    },
  },
  required: ["status", "reason", "facts"],
};

const INSIGHT_SCHEMA = {
  type: "OBJECT",
  properties: {
    insight: { type: "STRING" },
    keepLine: { type: "STRING" },
  },
  required: ["insight", "keepLine"],
};

const SEARCH_PHRASE_SCHEMA = {
  type: "OBJECT",
  properties: {
    phrase: { type: "STRING" },
  },
  required: ["phrase"],
};

const DRAFT_SCHEMA = {
  type: "OBJECT",
  properties: {
    draft: { type: "STRING" },
    altOpening: { type: "STRING" },
  },
  required: ["draft", "altOpening"],
};

// Only asks for the failures, not a verdict on every sentence - a clean
// draft (the common case) should cost a small output, not one JSON object
// per sentence in the post.
const VERIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    unsupported: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sentence: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["sentence", "reason"],
      },
    },
  },
  required: ["unsupported"],
};

async function triageAndExtractFacts(noteText) {
  const prompt = `Do two things with this raw note from a skincare founder, in one response.

1. Judge it against whether it's worth developing into a LinkedIn post:
   DRAFT: it has a specific angle, opinion, or observation that could be backed by a concrete example, number, or clear stance.
   PARK: it's too thin, vague, a logistics reminder, or a fragment with no throughline.
   COMBINE: it reads like part of a larger idea that needs more material to stand alone.
   Give a one-line reason.

2. Extract every atomic, checkable fact from the note - nothing invented, nothing summarised away. Mark each "certain" if the note states it plainly, or "hedged" if the note itself hedges it (words like "probably", "I think", "seems like"). If status is not DRAFT, an empty facts list is fine.

Note:
"""
${noteText}
"""

This facts list, when present, will be the ONLY source of truth about people, timing, products and events for whatever drafts from it - do not paraphrase away specifics like exact time periods.`;
  return generateJSON(prompt, TRIAGE_AND_FACTS_SCHEMA);
}

/** Pulls 3-5 search terms out of the note, per the course spec's Google
 * News step, then hits Google News' free public RSS search - no API key,
 * no account. The returned URL comes straight from Google's feed, not from
 * anything a model generated, so there's nothing to fabricate here. */
async function findCurrentAngle(noteText, facts) {
  const factsText = facts.map((f) => `- ${f.fact}`).join("\n");
  const prompt = `Pull 3-5 search keywords from this note that would find real, current news connected to its topic (skincare ingredients, formulation, regulation, industry practice). Combine them into one short search phrase, the way you'd type it into a search box.

Note: "${noteText}"
Facts: ${factsText}

Respond with ONLY this JSON: {"phrase": "..."}`;
  const { phrase } = await generateJSON(prompt, SEARCH_PHRASE_SCHEMA);
  const item = await fetchTopNewsItem(phrase);
  if (!item) return { angle: null, searchPhrase: phrase };
  return {
    angle: { claim: item.title, source_name: item.sourceName, date: item.date, url: item.url },
    searchPhrase: phrase,
  };
}

async function preDraftInsight(noteText, facts) {
  const factsText = facts.map((f) => `- ${f.fact} (${f.certainty})`).join("\n");
  const prompt = `Read this note and its extracted facts. State the single sharpest idea in the note in one sentence, and quote the exact line from the note (verbatim, if one exists) that sounds most like the author's own voice and should survive into the final post.

Note: "${noteText}"
Facts:
${factsText}

Respond with ONLY this JSON: {"insight": "...", "keepLine": "..."} (keepLine can be an empty string if no single line stands out).`;
  return generateJSON(prompt, INSIGHT_SCHEMA);
}

async function draftWithAltOpening(noteText, facts, angle, insight, priorFailures) {
  const factsText = facts.map((f) => `- ${f.fact} (${f.certainty})`).join("\n");
  const angleText = angle
    ? `Current angle you may use ONLY if it's genuinely relevant and fits naturally - if it doesn't fit, ignore it rather than force it in: "${angle.claim}" (${angle.source_name}, ${angle.date})`
    : "No current angle was found - do not invent one.";
  const keepLineText = insight.keepLine
    ? `\n\nHer own line you must keep verbatim, word for word, somewhere in the post (this is a hard requirement, not a suggestion): "${insight.keepLine}"`
    : "";
  const failureText = priorFailures && priorFailures.length
    ? `\n\nYour previous attempt had these specific problems. Fix every one of them without dropping below 400 words - cut nothing essential to reach the fix, expand elsewhere if needed:\n${priorFailures.map((f) => `- [${f.rule}] ${f.detail}`).join("\n")}`
    : "";

  const prompt = `You are drafting a LinkedIn post for a skincare founder named Meera, following her voice profile exactly.

VOICE PROFILE:
${VOICE_SKILL}

The sharpest idea in her note: ${insight.insight}${keepLineText}

Facts you may draw on (this is the ONLY source of truth about people, products, timing and events - do not add anything beyond this list and well-established, unhedged formulation science):
${factsText}

${angleText}

Original note for reference (do not quote it beyond the required line above, use it only for tone/context):
"""
${noteText}
"""

If the post needs something only Meera can supply (a real figure, a confirmed detail, a framing decision), write it inline as [MEERA: the question], don't invent an answer.

Write a 400-550 word LinkedIn post developing the sharpest idea, following the voice profile exactly - no preamble, no markdown, no quotation marks around it. Then separately suggest one alternative opening sentence: a different valid way the post could start, still in the same voice.${failureText}

Respond with ONLY this JSON: {"draft": "...", "altOpening": "..."}`;

  return generateJSON(prompt, DRAFT_SCHEMA);
}

async function verify(draftText, facts, angle) {
  const factsText = facts.map((f) => f.fact).join("\n");
  const sourceText = angle ? `${angle.claim} (${angle.url})` : "none";
  const prompt = `Adversarially check this draft against its known facts and cited source. Read it sentence by sentence, but only report the ones that are UNSUPPORTED - a sentence carrying a number, a named detail, or a mechanism that isn't backed by the facts below, the cited source, or well-established unhedged general science. Say nothing about sentences that are fine.

Draft:
"""
${draftText}
"""

Known facts:
${factsText}

Cited source: ${sourceText}

Be strict - a sentence that sounds plausible but adds specifics not in the facts (a date, a percentage, a named detail) is UNSUPPORTED. Give a short reason for each one you flag.`;
  const result = await generateJSON(prompt, VERIFY_SCHEMA);
  return result.unsupported.map((u) => ({ sentence: u.sentence, supported_by: "UNSUPPORTED", reason: u.reason }));
}

/** Races a promise against a timeout, returning a fallback value instead of
 * throwing - kept for any step whose latency is unpredictable and whose
 * result is a nice-to-have, not worth risking the whole request over. */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Fabrication is worse than weak prose (the brief's own stated priority) -
 * an unsupported-claim failure counts far more than a lint/style failure
 * when deciding which of two attempts to actually send. */
function severity(allFailures) {
  const unsupportedCount = allFailures.filter((f) => f.rule === "unsupported-claim" || f.rule === "keep-line-missing").length;
  return unsupportedCount * 10 + allFailures.length;
}

function formatMessage({ noteText, angle, draftText, altOpening, needsCheck }) {
  const angleLine = angle
    ? `${angle.claim} - ${angle.source_name}, ${angle.date} (${angle.url})`
    : "No current angle";
  const checkLines = needsCheck.length
    ? needsCheck.map((c) => `- ${c}`).join("\n")
    : "- (none flagged)";

  return [
    `SOURCE NOTE: ${noteText}`,
    "",
    `CURRENT ANGLE: ${angleLine}`,
    "",
    "DRAFT:",
    draftText,
    "",
    `ALTERNATIVE OPENING: ${altOpening}`,
    "",
    "NEEDS YOUR CHECK:",
    checkLines,
  ].join("\n");
}

function formatParkedMessage(noteText, status, reason) {
  return [
    `SOURCE NOTE: ${noteText}`,
    "",
    `STATUS: ${status}`,
    `REASON: ${reason}`,
    "",
    status === "COMBINE"
      ? "This reads like it needs another note for context. This pipeline doesn't have note history/memory yet, so it can't actually combine it with anything - flagging it instead of drafting from it alone."
      : "Not drafted - not enough here to develop on its own.",
  ].join("\n");
}

/**
 * Runs the full pipeline for one note. Returns { status, message, log }
 * where `message` is the final Telegram-ready text and `log` is every
 * intermediate step's output, for debugging a bad draft back to its cause.
 */
export async function runPipeline(noteText) {
  const startedAt = Date.now();
  const log = {};

  const triageAndFacts = await triageAndExtractFacts(noteText);
  log.triageAndFacts = triageAndFacts;
  if (triageAndFacts.status !== "DRAFT") {
    return {
      status: triageAndFacts.status,
      message: formatParkedMessage(noteText, triageAndFacts.status, triageAndFacts.reason),
      log,
    };
  }

  const facts = triageAndFacts.facts;
  const factsText = facts.map((f) => f.fact).join(" ");
  const allowProductClaim = facts.some((f) => /our (serum|product)/i.test(f.fact));

  // findCurrentAngle() and preDraftInsight() are both independent given just
  // (noteText, facts) - run them concurrently. findCurrentAngle is capped
  // at 12s: the RSS fetch itself is fast, but network latency is never
  // guaranteed, and a current angle is a nice-to-have, not worth risking
  // the whole request over.
  const [{ angle, searchPhrase }, insight] = await Promise.all([
    withTimeout(findCurrentAngle(noteText, facts), 12000, { angle: null, searchPhrase: null, timedOut: true }),
    preDraftInsight(noteText, facts),
  ]);
  log.currentAngle = { angle, searchPhrase };
  log.insight = insight;
  const sourcesText = angle ? `${angle.claim} ${angle.source_name} ${angle.date}` : "";

  async function attempt(priorFailures) {
    const { draft: draftText, altOpening } = await draftWithAltOpening(noteText, facts, angle, insight, priorFailures);
    const unsupported = await verify(draftText, facts, angle);
    const lintFailures = lintDraft(draftText, { factsText, sourcesText, allowProductClaim });
    const failures = [...lintFailures, ...unsupported.map((u) => ({ rule: "unsupported-claim", detail: `"${u.sentence}" - ${u.reason}` }))];
    if (insight.keepLine && !draftText.includes(insight.keepLine)) {
      failures.push({ rule: "keep-line-missing", detail: `Required verbatim line not found: "${insight.keepLine}"` });
    }
    return { draftText, unsupported, lintFailures, allFailures: failures, altOpening };
  }

  const attempt1 = await attempt(null);
  log.attempt1 = attempt1;

  let result = attempt1;
  const elapsed = Date.now() - startedAt;
  if (attempt1.allFailures.length > 0 && elapsed < TIME_BUDGET_MS) {
    const attempt2 = await attempt(attempt1.allFailures);
    log.attempt2 = attempt2;
    // Pick whichever attempt is actually better, weighted toward fabrication
    // over style - the retry isn't guaranteed to improve on every axis (it
    // can trade word-count compliance for fewer invented claims), so don't
    // blindly prefer the later attempt.
    result = severity(attempt2.allFailures) <= severity(attempt1.allFailures) ? attempt2 : attempt1;
    log.chosenAttempt = result === attempt2 ? "attempt2" : "attempt1";
  } else if (attempt1.allFailures.length > 0) {
    log.retrySkipped = `time budget exceeded (${elapsed}ms elapsed)`;
  }

  const { draftText, allFailures, altOpening } = result;

  const needsCheck = allFailures.map((f) => `[${f.rule}] ${f.detail}`);
  if (log.retrySkipped) {
    needsCheck.push("Retry pass was skipped to stay under the function time limit - the failures above are from the first attempt, unreviewed.");
  }

  return {
    status: "DRAFT",
    message: formatMessage({ noteText, angle, draftText, altOpening, needsCheck }),
    log,
  };
}
