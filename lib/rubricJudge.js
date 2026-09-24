import { generateJSON } from "./gemini.js";

const RUBRIC_SCHEMA = {
  type: "OBJECT",
  properties: {
    factualIntegrity: { type: "NUMBER", description: "0-3" },
    voice: { type: "NUMBER", description: "0-3" },
    freshness: { type: "NUMBER", description: "0-1" },
    currentAngle: { type: "NUMBER", description: "0-1" },
    closeAndUsefulness: { type: "NUMBER", description: "0-1" },
    structureAndFormat: { type: "NUMBER", description: "0-1" },
    notes: { type: "STRING", description: "One or two sentences on what cost the most points." },
  },
  required: ["factualIntegrity", "voice", "freshness", "currentAngle", "closeAndUsefulness", "structureAndFormat", "notes"],
};

/**
 * Separate model call scoring a finished pipeline output against the
 * round-2 brief's rubric (out of 10). Not part of the live drafting
 * pipeline - used by tests to log a comparable score run to run, so a
 * prompt/lint change can be checked for whether it actually helped.
 */
export async function judgeAgainstRubric({ noteText, message }) {
  const prompt = `Score this LinkedIn post draft output against the rubric below. Be a strict, skeptical judge - the same standard the founder herself would apply, not a lenient one.

Rubric (10 points total):
- Factual integrity (3): every claim traces to the note, a source that was actually read, or settled science stated without numbers. No unsupported sentence should have reached the founder.
- Voice (3): her rhythm (a mix of long explanatory sentences and short landing ones, at least some sentences 8 words or fewer), technical terms glossed, a concession before the argument lands, no filler phrases, no rough dictated-note syntax pasted in, and her recurring tics (like "I want to...") appearing at most once.
- Freshness (1): doesn't re-explain something she's already published elsewhere; builds on it instead.
- Current angle (1): a real, honestly-graded source the draft actually uses in a sentence or two, or an honest "No current angle" if none was found - never a decorative, unused citation.
- Close and usefulness (1): one concrete, answerable action for the reader - never a diagnosis handed to the reader, never a question no brand could answer.
- Structure and format (1): the output's sections are complete and correctly rendered (SOURCE NOTE, CURRENT ANGLE, DRAFT, ALTERNATIVE OPENING, NEEDS YOUR CHECK), no formatting corruption.

Original note:
"""
${noteText}
"""

Full pipeline output to judge:
"""
${message}
"""

Score each dimension (integers or half-points), and say in one or two sentences what cost the most points.`;
  return generateJSON(prompt, RUBRIC_SCHEMA);
}

export function totalScore(scores) {
  return (
    scores.factualIntegrity +
    scores.voice +
    scores.freshness +
    scores.currentAngle +
    scores.closeAndUsefulness +
    scores.structureAndFormat
  );
}
