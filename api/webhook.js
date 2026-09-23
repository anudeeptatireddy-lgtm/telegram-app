import { draftPost } from "../lib/voice.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(200).send("Skinstinct content pipeline webhook is up.");
    return;
  }

  const update = req.body || {};
  const message = update.message;

  if (!message || !message.text) {
    res.status(200).json({ ok: true });
    return;
  }
  if (message.from && message.from.is_bot) {
    res.status(200).json({ ok: true });
    return;
  }
  if (message.text.startsWith("/")) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const noteText = message.text;

  try {
    const draft = await draftPost(noteText);
    await sendTelegramMessage(chatId, draft);
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    console.error("pipeline error:", detail);
    try {
      await sendTelegramMessage(chatId, `Debug: pipeline failed - ${detail}`.slice(0, 3900));
    } catch (sendErr) {
      res.status(200).json({ ok: true, draftError: detail, sendError: String(sendErr) });
      return;
    }
    res.status(200).json({ ok: true, draftError: detail });
    return;
  }

  res.status(200).json({ ok: true });
}

async function sendTelegramMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
  }
  return data;
}
