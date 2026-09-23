# Skinstinct webhook pipeline (MESA Case 1, L3 scope)

The course-spec version: Telegram webhook → Vercel serverless function →
Claude drafts a post in Meera's voice → sent back to the same chat.

This is the L3 scope only: note in, voice-matched draft out. No scoring gate,
no news angle, no memory yet — those are B1.

## Stack

- **Telegram** — bot `@Baconhamporkbot`, delivers notes via webhook (not polling)
- **Vercel** — hosts `api/webhook.js`, one serverless function, no framework
- **Claude** (Anthropic API) — drafts the post, used in place of Gemini
- **`lib/voiceSkill.js`** — the voice profile, embedded as a JS string constant

## Env vars (set in Vercel, not committed)

- `TELEGRAM_BOT_TOKEN`
- `ANTHROPIC_API_KEY`

## Wiring it up

Once deployed, point the bot's webhook at the live URL:

```
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<VERCEL_URL>/api/webhook
```

Send the bot a note — a draft should come back in the same chat within a few
seconds.

## Note

This intentionally duplicates the polling-based pipeline in
`~/skinstinct-pipeline` — that one is a working prototype built earlier;
this one follows the course's specified architecture (webhook + Vercel) so
it matches what's built and discussed in class. Only one can hold the
Telegram webhook/polling slot on the bot at a time.
