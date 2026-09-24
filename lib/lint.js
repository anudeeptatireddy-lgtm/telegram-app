import { TIC_PATTERNS, BANNED_WORDS } from "./voicePrompt.js";

const SMALL_NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function wordsToDigits(text) {
  return text.replace(/\b([a-z]+)\b/gi, (word) => {
    const n = SMALL_NUMBER_WORDS[word.toLowerCase()];
    return n !== undefined ? String(n) : word;
  });
}

function extractNumbers(text) {
  const digitised = wordsToDigits(text);
  const matches = digitised.match(/\b\d+(\.\d+)?\b/g) || [];
  return [...new Set(matches)];
}

function splitParagraphs(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function stripQuoted(text) {
  return text.replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
}

function wordCount(sentence) {
  return sentence.trim().split(/\s+/).filter(Boolean).length;
}

const STOPWORDS = new Set(
  ("a an the and or but if then so because as of to in on at by for with without " +
   "is are was were be been being this that these those it its her his their our your my " +
   "you she he they we i not no do does did has have had can could would should will shall " +
   "than which who whom whose what when where why how there here also just very more most " +
   "some any all one two into onto over under about between across after before during while " +
   "up down out off again further once other same each own such only very own")
    .split(/\s+/)
);

const MEDICAL_CONDITION_TERMS = [
  "eczema", "atopic dermatitis", "psoriasis", "rosacea", "genetic condition",
  "dermatitis", "ichthyosis",
];
const DIRECTIVE_VERBS = /\b(requires?|should use|treat(s|ed|ing)?|manage(s|d|ment)?|prescri\w+)\b/i;

const FILLER_OPENERS = [
  "In standard textbooks", "It is worth noting", "Formulation work teaches you", "In today's",
];

/** Longest run of consecutive words shared between two texts, case- and
 * whitespace-insensitive. Used to catch the draft pasting the note's own
 * rough syntax in verbatim beyond the one deliberately-kept line. */
function longestSharedRun(a, b) {
  const wa = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wbArr = b.toLowerCase().split(/\s+/).filter(Boolean);
  let best = 0;
  for (let i = 0; i < wa.length; i++) {
    for (let j = 0; j < wbArr.length; j++) {
      let len = 0;
      while (i + len < wa.length && j + len < wbArr.length && wa[i + len] === wbArr[j + len]) {
        len++;
      }
      if (len > best) best = len;
    }
  }
  return best;
}

/**
 * Every check here is deterministic code, not a model call - the brief's
 * point is that mechanically-checkable rules shouldn't be left to the LLM's
 * discretion. Returns an array of { rule, detail } failures, empty if clean.
 *
 * options:
 *   factsText, sourcesText, allowProductClaim - as before (round 1)
 *   noteText - the original note, to catch rough-syntax verbatim pasting
 *   keepLine - the one line explicitly allowed to be verbatim (round 1 rule)
 *   overlappingExcerpts - flat array of excerpt strings from published
 *     pieces the triage step flagged as overlapping, for the recap check
 */
export function lintDraft(draftText, {
  factsText = "",
  sourcesText = "",
  allowProductClaim = false,
  noteText = "",
  keepLine = "",
  overlappingExcerpts = [],
} = {}) {
  const failures = [];
  const words = draftText.trim().split(/\s+/).filter(Boolean);

  if (words.length < 380 || words.length > 560) {
    failures.push({ rule: "word-count", detail: `${words.length} words (want 380-560)` });
  }

  if (draftText.includes("!")) failures.push({ rule: "exclamation-mark", detail: "contains !" });
  if (draftText.includes(";")) failures.push({ rule: "semicolon", detail: "contains ;" });
  if (draftText.includes("—")) failures.push({ rule: "em-dash", detail: "contains an em dash" });
  if (draftText.includes("–")) failures.push({ rule: "en-dash", detail: "contains an en dash" });
  if (/\bpercent\b/i.test(draftText)) failures.push({ rule: "percent-word", detail: 'uses "percent" instead of "%"' });

  const lines = draftText.split("\n");
  for (const line of lines) {
    if (/^\s*[-*•#]/.test(line) || /^\s*\d+\.\s/.test(line)) {
      failures.push({ rule: "list-or-header", detail: `line looks like a list/header: "${line.slice(0, 40)}"` });
      break;
    }
  }

  const withoutQuotes = stripQuoted(draftText);
  if (withoutQuotes.includes("?")) {
    failures.push({ rule: "bare-question", detail: "contains a ? outside quoted speech" });
  }

  for (const word of BANNED_WORDS) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(draftText)) failures.push({ rule: "banned-word", detail: `uses "${word}"` });
  }

  for (const opener of FILLER_OPENERS) {
    if (draftText.toLowerCase().includes(opener.toLowerCase())) {
      failures.push({ rule: "filler-opener", detail: `uses filler phrase "${opener}"` });
    }
  }

  for (const tic of TIC_PATTERNS) {
    const count = (draftText.match(tic.regex) || []).length;
    if (count > 1) failures.push({ rule: "tic-cap", detail: `"${tic.name}" used ${count} times (max 1)` });
  }

  const draftNumbers = extractNumbers(draftText);
  const allowedNumbers = new Set(extractNumbers(`${factsText} ${sourcesText}`));
  for (const n of draftNumbers) {
    if (!allowedNumbers.has(n)) {
      failures.push({ rule: "number-provenance", detail: `number "${n}" doesn't trace to a note fact or a cited source` });
    }
  }

  if (!allowProductClaim) {
    for (const sentence of splitSentences(draftText)) {
      if (/\bour (serum|product|formula)\b/i.test(sentence) && /\b(uses|contains|designed|formulated)\b/i.test(sentence)) {
        failures.push({ rule: "product-claim", detail: `unsupported product claim: "${sentence.slice(0, 80)}"` });
      }
    }
  }

  const paragraphs = splitParagraphs(draftText);
  if (paragraphs.length >= 2) {
    const closingStarters = /^(ask|check|try|look|consider|read|think|do|don'?t|never|always|before|if)\b/i;
    const last = paragraphs[paragraphs.length - 1];
    const secondLast = paragraphs[paragraphs.length - 2];
    if (closingStarters.test(last) && closingStarters.test(secondLast)) {
      failures.push({ rule: "double-closing", detail: "last two paragraphs both read like closings" });
    }
  }

  // --- Round 2 additions ---

  // Rhythm: at least 15% of sentences 8 words or fewer; no sentence over 45
  // words, and the closing sentence specifically is always checked.
  const sentences = splitSentences(draftText);
  if (sentences.length > 0) {
    const shortCount = sentences.filter((s) => wordCount(s) <= 8).length;
    const shortRatio = shortCount / sentences.length;
    if (shortRatio < 0.15) {
      failures.push({ rule: "flat-rhythm", detail: `only ${Math.round(shortRatio * 100)}% of sentences are 8 words or fewer (want 15%+)` });
    }
    for (const s of sentences) {
      if (wordCount(s) > 45) {
        failures.push({ rule: "long-sentence", detail: `${wordCount(s)}-word sentence: "${s.slice(0, 60)}..."` });
      }
    }
  }

  // Repetition: any content word other than the note's own apparent core
  // topic terms (its two most frequent content words - a piece can
  // legitimately anchor on more than one noun, e.g. "serum" AND "product")
  // appearing more than 4 times.
  const contentWords = (draftText.toLowerCase().match(/\b[a-z]+\b/g) || []).filter(
    (w) => w.length > 3 && !STOPWORDS.has(w)
  );
  const freq = {};
  for (const w of contentWords) freq[w] = (freq[w] || 0) + 1;
  const coreTerms = new Set(
    Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([w]) => w)
  );
  for (const [w, c] of Object.entries(freq)) {
    if (!coreTerms.has(w) && c > 4) {
      failures.push({ rule: "word-repetition", detail: `"${w}" appears ${c} times` });
    }
  }

  // Medical boundary: a named condition must be paired with "dermatologist"
  // and never with a directive management/treatment verb.
  const lowerDraft = draftText.toLowerCase();
  const mentionedCondition = MEDICAL_CONDITION_TERMS.find((c) => lowerDraft.includes(c));
  if (mentionedCondition) {
    if (!lowerDraft.includes("dermatologist")) {
      failures.push({ rule: "medical-boundary", detail: `mentions "${mentionedCondition}" but never says "dermatologist"` });
    }
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes(mentionedCondition) && DIRECTIVE_VERBS.test(sentence)) {
        failures.push({ rule: "medical-advice", detail: `gives management/treatment direction for "${mentionedCondition}": "${sentence.slice(0, 80)}"` });
      }
    }
  }

  // Verbatim note syntax: no 12+ consecutive word run shared with the note,
  // except the one line explicitly chosen to be kept.
  if (noteText) {
    const noteWithoutKeepLine = keepLine ? noteText.replace(keepLine, "") : noteText;
    const draftWithoutKeepLine = keepLine ? draftText.replace(keepLine, "") : draftText;
    const runLength = longestSharedRun(draftWithoutKeepLine, noteWithoutKeepLine);
    if (runLength >= 12) {
      failures.push({ rule: "verbatim-note-syntax", detail: `shares a run of ${runLength} consecutive words with the raw note - rewrite into publishable prose` });
    }
  }

  // Recap check: a paragraph that shares 3+ notable (4+ letter) words with
  // an overlapping published piece's excerpts, heuristic and best-effort
  // given only fragmentary excerpts are available, not full pieces.
  if (overlappingExcerpts.length > 0) {
    const excerptWords = new Set(
      overlappingExcerpts.join(" ").toLowerCase().match(/\b[a-z]{4,}\b/g) || []
    );
    for (const para of paragraphs) {
      const paraWords = new Set((para.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).filter((w) => !STOPWORDS.has(w)));
      let shared = 0;
      for (const w of paraWords) if (excerptWords.has(w)) shared++;
      if (shared >= 3) {
        failures.push({ rule: "possible-recap", detail: `paragraph shares ${shared} notable terms with an already-published piece: "${para.slice(0, 60)}..."` });
        break;
      }
    }
  }

  return failures;
}
