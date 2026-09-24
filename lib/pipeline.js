import { generateJSON, generateGrounded, parseLooseJSON } from "./gemini.js";
import { lintDraft } from "./lint.js";
import { VOICE_SKILL } from "./voicePrompt.js";

// Vercel Hobby caps function execution at 60s. Each Gemini call realistically
// costs 5-15s, so the pipeline is built to minimise sequential round trips:
// combine steps into one call wherever they don't need each other's output,
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

async function research(noteText, facts) {
  const factsText = facts.map((f) => `- ${f.fact}`).join("\n");
  const prompt = `Search for one real, specific, CURRENT news item, data point, or industry development connected to the topic of this note. It must be something you can find and cite with a real source and URL.

Note: "${noteText}"
Known facts: ${factsText}

If you find something genuinely relevant and verifiable, respond with ONLY this JSON (no markdown fences, no commentary):
{"angle": {"claim": "...", "source_name": "...", "date": "...", "url": "...", "strength": "solid|thinner|essentially absent"}}

If nothing credible connects, respond with ONLY:
{"angle": null}`;
  const { text, sources } = await generateGrounded(prompt);
  let parsed;
  try {
    parsed = parseLooseJSON(text);
  } catch (_) {
    return { angle: null, sources };
  }
  if (!parsed.angle) return { angle: null, sources };
  const urlIsReal = sources.some((s) => s.url === parsed.angle.url);
  if (!urlIsReal) {
    // The model cited a URL that wasn't actually among its grounded search
    // results - treat it as unverified rather than trust it.
    return { angle: null, sources, discarded: parsed.angle };
  }
  return { angle: parsed.angle, sources };
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
    ? `Current angle you may use if it fits naturally: ${angle.claim} (${angle.source_name}, ${angle.date}, ${angle.strength} evidence)`
    : "No current angle was found - do not invent one.";
  const failureText = priorFailures && priorFailures.length
    ? `\n\nYour previous attempt had these specific problems. Fix every one of them and do not reintroduce them:\n${priorFailures.map((f) => `- [${f.rule}] ${f.detail}`).join("\n")}`
    : "";

  const prompt = `You are drafting a LinkedIn post for a skincare founder named Meera, following her voice profile exactly.

VOICE PROFILE:
${VOICE_SKILL}

The sharpest idea in her note: ${insight.insight}
${insight.keepLine ? `Keep this line of hers verbatim if it fits: "${insight.keepLine}"` : ""}

Facts you may draw on (this is the ONLY source of truth about people, products, timing and events - do not add anything beyond this list and well-established, unhedged formulation science):
${factsText}

${angleText}

Original note for reference (do not quote it, use it only for tone/context):
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
 * throwing - used for research(), whose grounded-search latency is the
 * least predictable and least critical step, so it should never be what
 * blows the function's time budget. */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
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

  // research() and preDraftInsight() are both independent given just
  // (noteText, facts) - run them concurrently rather than paying for two
  // sequential round trips. research() is also capped at 12s: grounded
  // search latency is unpredictable and a current angle is a nice-to-have,
  // not worth risking the whole request over.
  const [{ angle, sources, discarded }, insight] = await Promise.all([
    withTimeout(research(noteText, facts), 12000, { angle: null, sources: [], timedOut: true }),
    preDraftInsight(noteText, facts),
  ]);
  log.research = { angle, sources, discarded };
  log.insight = insight;
  const sourcesText = angle ? `${angle.claim} ${angle.source_name} ${angle.date}` : "";

  async function attempt(priorFailures) {
    const { draft: draftText, altOpening } = await draftWithAltOpening(noteText, facts, angle, insight, priorFailures);
    const unsupported = await verify(draftText, facts, angle);
    const lintFailures = lintDraft(draftText, { factsText, sourcesText, allowProductClaim });
    const allFailures = [...lintFailures, ...unsupported.map((u) => ({ rule: "unsupported-claim", detail: `"${u.sentence}" - ${u.reason}` }))];
    return { draftText, unsupported, lintFailures, allFailures, altOpening };
  }

  let result = await attempt(null);
  log.attempt1 = result;

  const elapsed = Date.now() - startedAt;
  if (result.allFailures.length > 0 && elapsed < TIME_BUDGET_MS) {
    result = await attempt(result.allFailures);
    log.attempt2 = result;
  } else if (result.allFailures.length > 0) {
    log.retrySkipped = `time budget exceeded (${elapsed}ms elapsed)`;
  }

  const { draftText, allFailures, altOpening } = result;

  const needsCheck = allFailures.map((f) => `[${f.rule}] ${f.detail}`);
  if (discarded) {
    needsCheck.push(`Gemini proposed a current angle it could not verify a real source for ("${discarded.claim}") - dropped rather than risk citing it.`);
  }
  if (log.retrySkipped) {
    needsCheck.push("Retry pass was skipped to stay under the function time limit - the failures above are from the first attempt, unreviewed.");
  }

  return {
    status: "DRAFT",
    message: formatMessage({ noteText, angle, draftText, altOpening, needsCheck }),
    log,
  };
}
