const MODEL = "gemini-flash-latest";
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

async function callGemini(body) {
  const resp = await fetch(BASE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText}`);
  }
  return resp.json();
}

/** Plain text generation. */
export async function generateText(prompt) {
  const data = await callGemini({ contents: [{ parts: [{ text: prompt }] }] });
  return data.candidates[0].content.parts[0].text.trim();
}

/**
 * JSON-mode generation: Gemini is constrained to return valid JSON matching
 * the given schema. Use for every step where we need to parse the output
 * reliably (triage, fact extraction, verification) rather than hoping the
 * model's prose contains parseable JSON.
 */
export async function generateJSON(prompt, schema) {
  const data = await callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });
  const text = data.candidates[0].content.parts[0].text;
  return JSON.parse(text);
}

/**
 * Text generation grounded with Google Search. Returns both the raw text
 * (expected to be a JSON blob, since JSON mode can't be combined with tool
 * use) and the list of source chunks Gemini actually grounded on, so callers
 * can cross-check that any URL the model cites is one it genuinely found -
 * not one it invented while imitating the shape of a real citation.
 */
export async function generateGrounded(prompt) {
  const data = await callGemini({
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
  });
  const candidate = data.candidates[0];
  const text = candidate.content.parts.map((p) => p.text || "").join("").trim();
  const chunks = (candidate.groundingMetadata && candidate.groundingMetadata.groundingChunks) || [];
  const sources = chunks
    .map((c) => c.web)
    .filter(Boolean)
    .map((w) => ({ title: w.title, url: w.uri }));
  return { text, sources };
}

/** Strips ```json fences if the model wrapped its JSON in markdown anyway. */
export function parseLooseJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned);
}
