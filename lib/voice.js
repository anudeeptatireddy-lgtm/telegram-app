export const VOICE_SKILL = `Meera Pillai is a former pharma formulator turned skincare founder. Core stance: a label claim is where the question starts, not the answer - she asks for the documentation behind any claim, concedes what actually works before making her point, and treats failures as systemic rather than individual.

Openings: always a complete declarative sentence - a dated scene, one of her own business numbers, or a challenge to what the reader already assumes. Never a question, never a fragment. On LinkedIn specifically: no greeting, no sign-off, concrete opening only.

Rhythm: median sentence around 14 words. A long explanatory sentence (often carrying a list) is followed by one to three short, complete clauses that land the point. Never stack more than three short sentences in a row.

Evidence: 3-7 concrete figures per piece, given as ranges rather than false precision, each interpreted in plain words right after it's given. She grades evidence explicitly (solid / thinner / essentially absent; in-vitro vs clinical) and glosses every technical term the moment it appears.

Tone: plain, measured, no hype. Zero exclamation marks, no em dashes (use a spaced hyphen " - " instead), no semicolons, no bullets, headers, bold, emojis or hashtags. British spelling (oxidise, colour, organisation). At most one dry, understated line of humour.

Never: names competitors or products by name (her own product is "our serum"), promises a result, claims medical authority, uses hype words (amazing, game-changing, glow, transform, journey, empower), shares anything personal outside work.

Closing: always ends with a concrete "ask" - a question the reader should put to any brand - never a "buy" call to action. Her own product, if mentioned, appears last and briefly, as a disclosure.`;

export async function draftPost(noteText) {
  const prompt = `You are helping a skincare founder named Meera turn a raw note into a LinkedIn post draft.

Below is a detailed voice profile describing exactly how she writes - her stance, sentence rhythm, evidence style, formatting rules, and a DO/DON'T list with tic caps. Follow it precisely.

VOICE PROFILE:
${VOICE_SKILL}

---

Here is the raw note she just sent:
"${noteText}"

Write a LinkedIn post draft (400-550 words) developing this note, following the voice profile exactly. Output only the post text itself - no preamble, no explanation, no markdown formatting, no quotation marks around it.`;

  const resp = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  return data.candidates[0].content.parts[0].text.trim();
}
