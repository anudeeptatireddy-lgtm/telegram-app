import { TIC_PATTERNS, BANNED_WORDS } from "./voicePrompt.js";

// Deliberately excludes "one" - in prose it's overwhelmingly a pronoun
// ("the one that changed", "no one") rather than a numeral, and treating
// it as a number produced false positives in testing.
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

/**
 * Every check here is deterministic code, not a model call - the brief's
 * point is that mechanically-checkable rules shouldn't be left to the LLM's
 * discretion. Returns an array of { rule, detail } failures, empty if clean.
 */
export function lintDraft(draftText, { factsText = "", sourcesText = "", allowProductClaim = false } = {}) {
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

  return failures;
}
