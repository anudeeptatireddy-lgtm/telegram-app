import { generateJSON } from "./gemini.js";
import { fetchTopNewsItem, fetchArticleText } from "./googleNews.js";
import { lintDraft } from "./lint.js";
import { VOICE_SKILL } from "./voicePrompt.js";
import { RECENT_POSTS, PIECE_TITLES } from "./recentPosts.js";

// Vercel Hobby caps function execution at 60s. Each Gemini call realistically
// costs 3-6s with thinking disabled, so the pipeline still minimises
// sequential round trips: combine steps that don't need each other's output,
// run genuinely independent calls concurrently, and skip the retry pass
// rather than risk a silent 504 if we're already close to the ceiling.
const TIME_BUDGET_MS = 40000;

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
    namedEntities: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Any real company, supplier, manufacturer, or competitor named in the note - never her own brand.",
    },
    overlapsWith: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Piece IDs from the provided published-excerpts list whose covered idea this note substantially re-treads.",
    },
  },
  required: ["status", "reason", "facts", "namedEntities", "overlapsWith"],
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

const SOURCE_GRADE_SCHEMA = {
  type: "OBJECT",
  properties: {
    usable: { type: "BOOLEAN" },
    sourceType: { type: "STRING", enum: ["regulatory", "independent study", "industry-funded or branded study", "trade press", "marketing"] },
    design: { type: "STRING" },
    sampleSize: { type: "STRING" },
    funding: { type: "STRING" },
    mainFinding: { type: "STRING" },
    brandNamesToScrub: { type: "ARRAY", items: { type: "STRING" } },
    distinctiveTerms: { type: "ARRAY", items: { type: "STRING" } },
    summaryForDraft: { type: "STRING", description: "One sentence, generic, no brand names, graded honestly - what the draft may say if it uses this at all." },
  },
  required: ["usable", "sourceType", "design", "sampleSize", "funding", "mainFinding", "brandNamesToScrub", "distinctiveTerms", "summaryForDraft"],
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

function overlapCandidatesText() {
  return Object.entries(RECENT_POSTS)
    .map(([id, excerpts]) => `${id}${PIECE_TITLES[id] ? ` ("${PIECE_TITLES[id]}")` : ""}: ${excerpts.join(" / ")}`)
    .join("\n");
}

async function triageAndExtractFacts(noteText) {
  const prompt = `Do four things with this raw note from a skincare founder, in one response.

1. Judge it against whether it's worth developing into a LinkedIn post:
   DRAFT: it has a specific angle, opinion, or observation that could be backed by a concrete example, number, or clear stance.
   PARK: it's too thin, vague, a logistics reminder, or a fragment with no throughline.
   COMBINE: it reads like part of a larger idea that needs more material to stand alone.
   Give a one-line reason.

2. Extract every atomic, checkable fact from the note - nothing invented, nothing summarised away. Mark each "certain" if the note states it plainly, or "hedged" if the note itself hedges it (words like "probably", "I think", "seems like"). If status is not DRAFT, an empty facts list is fine.

3. List any real company, supplier, manufacturer, or competitor named in the note. She never names competitors or suppliers in her published writing.

4. Compare the note against these excerpts from her already-published work (piece ID, then some verbatim lines from that piece). List the piece IDs whose covered idea this note substantially re-treads - the same explanation, metaphor, or point, not just the same general topic:
${overlapCandidatesText()}

Note:
"""
${noteText}
"""

This facts list, when present, will be the ONLY source of truth about people, timing, products and events for whatever drafts from it - do not paraphrase away specifics like exact time periods.`;
  return generateJSON(prompt, TRIAGE_AND_FACTS_SCHEMA);
}

/** Pulls 3-5 search terms out of the note, per the course spec's Google
 * News step, then hits Google News' free public RSS search - no API key,
 * no account - and tries to fetch and grade the actual article behind the
 * top result. If the article can't actually be read (Google News' redirect
 * links usually resolve via client-side JS, which a plain fetch can't
 * follow), the headline is kept only as an unread possibility, never as a
 * gradeable, citable source - grading requires the real text. */
async function findCurrentAngle(noteText, facts) {
  const factsText = facts.map((f) => `- ${f.fact}`).join("\n");
  const prompt = `Pull 3-5 search keywords from this note that would find real, current news connected to its topic (skincare ingredients, formulation, regulation, industry practice). Combine them into one short search phrase, the way you'd type it into a search box.

Note: "${noteText}"
Facts: ${factsText}

Respond with ONLY this JSON: {"phrase": "..."}`;
  const { phrase } = await generateJSON(prompt, SEARCH_PHRASE_SCHEMA);

  const item = await fetchTopNewsItem(phrase);
  if (!item) return { angle: null, searchPhrase: phrase, unreadHeadline: null };

  const { text: articleText, resolvedUrl, reason } = await fetchArticleText(item.url);
  if (!articleText) {
    return {
      angle: null,
      searchPhrase: phrase,
      unreadHeadline: { title: item.title, sourceName: item.sourceName, url: item.url, reason },
    };
  }

  const gradePrompt = `Grade this article as a source for a skincare formulation LinkedIn post. Read the actual content, not just the headline.

Article text (fetched from ${resolvedUrl}):
"""
${articleText}
"""

Note this article might be relevant to: "${noteText}"

Determine: is it usable at all as a citable source (real content, not an error page or paywall notice)? What type of source is it - regulatory, independent study, industry-funded or branded study (a source whose title or funding names a branded product is this at best, never "independent"), trade press, or marketing? What's the study design, sample size, and funding/sponsor if applicable? What's the main finding, stated plainly? List any specific brand or product names mentioned that must NEVER appear in the draft (describe the source generically instead, e.g. "a moisturiser" not the brand name). List a few distinctive terms from the finding that a draft referencing this source would naturally use. Write one honest, appropriately-hedged sentence (no brand names) summarising what the draft may say about this if it uses it at all.`;

  const grade = await generateJSON(gradePrompt, SOURCE_GRADE_SCHEMA);
  if (!grade.usable) {
    return {
      angle: null,
      searchPhrase: phrase,
      unreadHeadline: { title: item.title, sourceName: item.sourceName, url: item.url, reason: "fetched but not usable as a source" },
    };
  }

  return {
    angle: {
      claim: grade.summaryForDraft,
      source_name: item.sourceName,
      date: item.date,
      url: resolvedUrl,
      sourceType: grade.sourceType,
      design: grade.design,
      sampleSize: grade.sampleSize,
      funding: grade.funding,
      distinctiveTerms: grade.distinctiveTerms,
      brandNamesToScrub: grade.brandNamesToScrub,
    },
    searchPhrase: phrase,
    unreadHeadline: null,
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

async function draftWithAltOpening(noteText, facts, angle, insight, namedEntities, overlapsWith, priorFailures) {
  const factsText = facts.map((f) => `- ${f.fact} (${f.certainty})`).join("\n");

  const angleText = angle
    ? `Current angle you MUST reference in one or two sentences if it's genuinely relevant, graded honestly the way she grades evidence (design, size, funding/limits) - never as a settled fact: "${angle.claim}" (${angle.source_name}, ${angle.date}, ${angle.sourceType}${angle.design ? `, ${angle.design}` : ""}${angle.sampleSize ? `, ${angle.sampleSize}` : ""}). If it genuinely doesn't fit the note's point, ignore it rather than force it in.${angle.brandNamesToScrub && angle.brandNamesToScrub.length ? ` Never name: ${angle.brandNamesToScrub.join(", ")} - describe generically instead.` : ""}`
    : "No current angle was found - do not invent one.";

  const keepLineText = insight.keepLine
    ? `\n\nHer own line, if it is ALREADY a finished, publishable sentence (like "That's the entire problem."), keep it verbatim: "${insight.keepLine}". If instead it's rough note syntax - a run-on joined by commas, starting with "Like", an aside like "you've heard this", or an unfinished thought - do NOT paste it verbatim. Rewrite it into her published register and preserve the idea, not the typing.`
    : "";

  const overlapText = overlapsWith && overlapsWith.length
    ? `\n\nThis note substantially overlaps with what she already published in ${overlapsWith.join(", ")}. Assume readers may have seen it. Recap the already-covered idea in at most one sentence, then spend the post on what's actually new here.`
    : "";

  const medicalRule = `\n\nIf the post mentions a medical, genetic or chronic skin condition (eczema, atopic dermatitis, psoriasis, rosacea, a genetic condition, etc.), do not give management or treatment advice for it. Say plainly that this is for a dermatologist, in her own register ("I'm not a dermatologist, and this is where one matters"). Never ask the reader to diagnose themselves.`;

  const closingRule = `\n\nThe close is one or two sentences with one action the reader can actually take: a change to their own routine, or a concrete question a brand could answer in one email (a pH, a concentration, a study's size and design, which specific ingredient types). Never ask the reader to diagnose a condition, and never ask a brand for something no brand could answer.`;

  const namedEntitiesText = namedEntities && namedEntities.length
    ? `\n\nNever name these real companies/suppliers by name, even though the underlying story stays in - refer to them generically instead (e.g. "a supplier", "a major manufacturer"): ${namedEntities.join(", ")}`
    : "";

  const failureText = priorFailures && priorFailures.length
    ? `\n\nYour previous attempt had these specific problems. Fix every one of them without dropping below 400 words - cut nothing essential to reach the fix, expand elsewhere if needed:\n${priorFailures.map((f) => `- [${f.rule}] ${f.detail}`).join("\n")}`
    : "";

  const prompt = `You are drafting a LinkedIn post for a skincare founder named Meera, following her voice profile exactly.

VOICE PROFILE:
${VOICE_SKILL}

The sharpest idea in her note: ${insight.insight}${keepLineText}${overlapText}

Facts you may draw on (this is the ONLY source of truth about people, products, timing and events - do not add anything beyond this list and well-established, unhedged formulation science):
${factsText}

${angleText}${medicalRule}${closingRule}${namedEntitiesText}

Original note for reference (do not quote it beyond the one allowed line above, use it only for tone/context):
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

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Fabrication is worse than weak prose (the brief's own stated priority) -
 * an unsupported-claim (or equivalent hard-rule) failure counts far more
 * than a lint/style failure when deciding which of two attempts to send. */
const HIGH_SEVERITY_RULES = new Set([
  "unsupported-claim", "keep-line-missing", "named-supplier",
  "medical-advice", "medical-boundary", "verbatim-note-syntax",
]);
function severity(allFailures) {
  const highCount = allFailures.filter((f) => HIGH_SEVERITY_RULES.has(f.rule)).length;
  return highCount * 10 + allFailures.length;
}

/** Removes sentences the verifier flagged as UNSUPPORTED directly from the
 * draft text. This runs only after the retry has already tried to fix them
 * properly - it's the hard backstop so a fabricated sentence can never
 * actually reach Meera, per the brief's own priority ranking, even if the
 * model's regeneration didn't fully comply. A crude cut is safer than an
 * uncaught fabrication; the removal itself is logged in NEEDS YOUR CHECK. */
function stripUnsupportedSentences(draftText, unsupported) {
  let stripped = draftText;
  const removed = [];
  for (const u of unsupported) {
    if (stripped.includes(u.sentence)) {
      stripped = stripped.replace(u.sentence, "").replace(/[ \t]{2,}/g, " ");
      removed.push(u.sentence);
    }
  }
  // Clean up any now-empty lines/double spaces left by the removal.
  stripped = stripped
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""))
    .join("\n")
    .trim();
  return { stripped, removed };
}

function formatMessage({ noteText, angle, unreadHeadline, draftText, altOpening, needsCheck }) {
  let angleLine;
  if (angle) {
    angleLine = `${angle.claim} - ${angle.source_name}, ${angle.date}, ${angle.sourceType} (${angle.url})`;
  } else if (unreadHeadline) {
    angleLine = `No current angle used. Possible angle, unread: "${unreadHeadline.title}" - ${unreadHeadline.sourceName} (${unreadHeadline.url}) - couldn't fetch the actual article (${unreadHeadline.reason}), so it wasn't graded or used.`;
  } else {
    angleLine = "No current angle";
  }
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
  const namedEntities = triageAndFacts.namedEntities || [];
  const overlapsWith = triageAndFacts.overlapsWith || [];
  const overlappingExcerpts = overlapsWith.flatMap((id) => RECENT_POSTS[id] || []);

  const [{ angle, searchPhrase, unreadHeadline }, insight] = await Promise.all([
    withTimeout(findCurrentAngle(noteText, facts), 15000, { angle: null, searchPhrase: null, unreadHeadline: null, timedOut: true }),
    preDraftInsight(noteText, facts),
  ]);
  log.currentAngle = { angle, searchPhrase, unreadHeadline };
  log.insight = insight;
  const sourcesText = angle ? `${angle.claim} ${angle.source_name} ${angle.date} ${(angle.distinctiveTerms || []).join(" ")}` : "";
  const allNamedEntities = [...namedEntities, ...(angle && angle.brandNamesToScrub ? angle.brandNamesToScrub : [])];

  async function attempt(priorFailures) {
    const { draft: draftText, altOpening } = await draftWithAltOpening(
      noteText, facts, angle, insight, allNamedEntities, overlapsWith, priorFailures
    );
    const unsupported = await verify(draftText, facts, angle);
    const lintFailures = lintDraft(draftText, {
      factsText, sourcesText, allowProductClaim,
      noteText, keepLine: insight.keepLine, overlappingExcerpts,
    });
    const failures = [...lintFailures, ...unsupported.map((u) => ({ rule: "unsupported-claim", detail: `"${u.sentence}" - ${u.reason}` }))];
    if (insight.keepLine && !draftText.includes(insight.keepLine)) {
      failures.push({ rule: "keep-line-missing", detail: `Required verbatim line not found: "${insight.keepLine}"` });
    }
    for (const name of allNamedEntities) {
      if (draftText.toLowerCase().includes(name.toLowerCase())) {
        failures.push({ rule: "named-supplier", detail: `Names "${name}" directly - she never names competitors, suppliers, or a source's branded product` });
      }
    }
    if (angle && angle.distinctiveTerms && angle.distinctiveTerms.length) {
      const used = angle.distinctiveTerms.some((t) => draftText.toLowerCase().includes(t.toLowerCase()));
      if (!used) failures.push({ rule: "angle-not-used", detail: "Current angle was found but the draft never actually references it" });
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
    result = severity(attempt2.allFailures) <= severity(attempt1.allFailures) ? attempt2 : attempt1;
    log.chosenAttempt = result === attempt2 ? "attempt2" : "attempt1";
  } else if (attempt1.allFailures.length > 0) {
    log.retrySkipped = `time budget exceeded (${elapsed}ms elapsed)`;
  }

  let { draftText, allFailures, altOpening, unsupported } = result;

  // Hard backstop: any UNSUPPORTED sentence that survived both attempts is
  // cut from the text before anything is sent, not just listed. Fabrication
  // reaching Meera is the one failure mode this whole pipeline exists to
  // prevent - a flagged-but-still-sent sentence doesn't satisfy that.
  const stillUnsupported = unsupported.filter((u) => draftText.includes(u.sentence));
  if (stillUnsupported.length > 0) {
    const { stripped, removed } = stripUnsupportedSentences(draftText, stillUnsupported);
    draftText = stripped;
    log.strippedSentences = removed;
  }

  // Angle enforcement: if it's still unused after everything, don't present
  // it as if it were - drop it and say so, rather than send a decorative
  // citation the post never actually engages with.
  let finalAngle = angle;
  let usedButDropped = false;
  if (finalAngle && finalAngle.distinctiveTerms && finalAngle.distinctiveTerms.length) {
    const used = finalAngle.distinctiveTerms.some((t) => draftText.toLowerCase().includes(t.toLowerCase()));
    if (!used) {
      finalAngle = null;
      usedButDropped = true;
    }
  }

  const needsCheck = allFailures
    .filter((f) => f.rule !== "unsupported-claim" || !log.strippedSentences?.length)
    .map((f) => `[${f.rule}] ${f.detail}`);
  if (log.strippedSentences && log.strippedSentences.length) {
    needsCheck.push(`Removed ${log.strippedSentences.length} unsupported sentence(s) that survived retry rather than send them: ${log.strippedSentences.map((s) => `"${s}"`).join("; ")}`);
  }
  if (usedButDropped) {
    needsCheck.push(`A current angle was found ("${angle.claim}") but the draft never actually used it, even after retry - dropped rather than show a decorative citation.`);
  }
  if (log.retrySkipped) {
    needsCheck.push("Retry pass was skipped to stay under the function time limit - the failures above are from the first attempt, unreviewed.");
  }

  return {
    status: "DRAFT",
    message: formatMessage({ noteText, angle: finalAngle, unreadHeadline, draftText, altOpening, needsCheck }),
    log,
  };
}
