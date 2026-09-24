import { generateText, generateJSON, generateGrounded, parseLooseJSON } from "./gemini.js";
import { lintDraft } from "./lint.js";
import { VOICE_SKILL } from "./voicePrompt.js";

const TRIAGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["DRAFT", "PARK", "COMBINE"] },
    reason: { type: "STRING" },
  },
  required: ["status", "reason"],
};

const FACTS_SCHEMA = {
  type: "OBJECT",
  properties: {
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
  required: ["facts"],
};

const INSIGHT_SCHEMA = {
  type: "OBJECT",
  properties: {
    insight: { type: "STRING" },
    keepLine: { type: "STRING" },
  },
  required: ["insight", "keepLine"],
};

const VERIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    sentences: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sentence: { type: "STRING" },
          supported_by: { type: "STRING" },
        },
        required: ["sentence", "supported_by"],
      },
    },
  },
  required: ["sentences"],
};

async function triage(noteText) {
  const prompt = `Judge this raw note from a skincare founder against whether it's worth developing into a LinkedIn post.

DRAFT: it has a specific angle, opinion, or observation that could be backed by a concrete example, number, or clear stance.
PARK: it's too thin, vague, a logistics reminder, or a fragment with no throughline.
COMBINE: it reads like part of a larger idea that needs more material to stand alone (e.g. it references something not explained here).

Note:
"""
${noteText}
"""

Give a one-line reason either way.`;
  return generateJSON(prompt, TRIAGE_SCHEMA);
}

async function extractFacts(noteText) {
  const prompt = `Extract every atomic, checkable fact from this note - nothing invented, nothing summarised away. Mark each "certain" if the note states it plainly, or "hedged" if the note itself hedges it (words like "probably", "I think", "seems like").

Note:
"""
${noteText}
"""

This list will be the ONLY source of truth about people, timing, products and events available to whatever drafts from it - do not paraphrase away specifics like exact time periods.`;
  const result = await generateJSON(prompt, FACTS_SCHEMA);
  return result.facts;
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

async function draft(noteText, facts, angle, insight, priorFailures) {
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

Write a 400-550 word LinkedIn post developing the sharpest idea, following the voice profile exactly. Output only the post text itself - no preamble, no markdown, no quotation marks around it.${failureText}`;

  return generateText(prompt);
}

async function verify(draftText, facts, angle) {
  const factsText = facts.map((f) => f.fact).join("\n");
  const sourceText = angle ? `${angle.claim} (${angle.url})` : "none";
  const prompt = `Adversarially check this draft sentence by sentence. For each sentence carrying a factual claim (a number, a named detail, a mechanism, a claim about a product), say what supports it: the exact fact it traces to, the cited source URL, "general_science" (only for well-established, unhedged mechanisms), or "UNSUPPORTED" if it's invented or goes beyond what the facts/source actually say.

Draft:
"""
${draftText}
"""

Known facts:
${factsText}

Cited source: ${sourceText}

Be strict - a sentence that sounds plausible but adds specifics not in the facts (a date, a percentage, a named detail) is UNSUPPORTED.`;
  const result = await generateJSON(prompt, VERIFY_SCHEMA);
  return result.sentences.filter((s) => s.supported_by === "UNSUPPORTED");
}

async function alternativeOpening(draftText) {
  const prompt = `Here is a finished LinkedIn post draft:
"""
${draftText}
"""

Suggest one alternative opening sentence - a different valid way this post could start, still in the same voice. Respond with just the sentence, nothing else.`;
  return generateText(prompt);
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
  const log = {};

  const triageResult = await triage(noteText);
  log.triage = triageResult;
  if (triageResult.status !== "DRAFT") {
    return { status: triageResult.status, message: formatParkedMessage(noteText, triageResult.status, triageResult.reason), log };
  }

  const facts = await extractFacts(noteText);
  log.facts = facts;
  const factsText = facts.map((f) => f.fact).join(" ");
  const allowProductClaim = facts.some((f) => /our (serum|product)/i.test(f.fact));

  // research() and preDraftInsight() are both independent given just
  // (noteText, facts) - run them concurrently rather than paying for two
  // sequential round trips.
  const [{ angle, sources, discarded }, insight] = await Promise.all([
    research(noteText, facts),
    preDraftInsight(noteText, facts),
  ]);
  log.research = { angle, sources, discarded };
  log.insight = insight;
  const sourcesText = angle ? `${angle.claim} ${angle.source_name} ${angle.date}` : "";

  async function attempt(priorFailures) {
    const draftText = await draft(noteText, facts, angle, insight, priorFailures);
    // verify() and alternativeOpening() both only need the draft text -
    // also independent, also run concurrently.
    const [unsupported, altOpening] = await Promise.all([
      verify(draftText, facts, angle),
      alternativeOpening(draftText),
    ]);
    const lintFailures = lintDraft(draftText, { factsText, sourcesText, allowProductClaim });
    const allFailures = [...lintFailures, ...unsupported.map((u) => ({ rule: "unsupported-claim", detail: u.sentence }))];
    return { draftText, unsupported, lintFailures, allFailures, altOpening };
  }

  let result = await attempt(null);
  log.attempt1 = result;

  if (result.allFailures.length > 0) {
    result = await attempt(result.allFailures);
    log.attempt2 = result;
  }

  const { draftText, allFailures, altOpening } = result;

  const needsCheck = allFailures.map((f) => `[${f.rule}] ${f.detail}`);
  if (discarded) {
    needsCheck.push(`Gemini proposed a current angle it could not verify a real source for ("${discarded.claim}") - dropped rather than risk citing it.`);
  }

  return {
    status: "DRAFT",
    message: formatMessage({ noteText, angle, draftText, altOpening, needsCheck }),
    log,
  };
}
