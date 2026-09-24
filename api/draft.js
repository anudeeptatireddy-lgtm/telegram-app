import { runPipeline } from "../lib/pipeline.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST with a JSON body: { note: string }" });
    return;
  }

  const note = (req.body || {}).note;
  if (!note || typeof note !== "string" || !note.trim()) {
    res.status(400).json({ error: "Missing note text." });
    return;
  }

  try {
    const result = await runPipeline(note.trim());
    res.status(200).json(result);
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    console.error("draft error:", detail);
    res.status(500).json({ error: detail });
  }
}
