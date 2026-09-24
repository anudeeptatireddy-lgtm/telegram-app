const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

function decodeEntities(text) {
  return text.replace(/&(#?\w+);/g, (m, name) => ENTITIES[name] ?? m);
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeEntities(match[1].trim()) : null;
}

/**
 * Fetches Google News' public RSS search feed - no account, no API key.
 * Returns the single most recent item, or null if the query returns
 * nothing. The URL comes straight from Google's feed, not from anything an
 * LLM generated, so unlike a model-grounded search there's no risk of a
 * fabricated-looking citation - it's either a real feed result or nothing.
 */
export async function fetchTopNewsItem(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const resp = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!resp.ok) return null;
  const xml = await resp.text();

  const itemMatch = xml.match(/<item>([\s\S]*?)<\/item>/);
  if (!itemMatch) return null;
  const block = itemMatch[1];

  const title = extractTag(block, "title");
  const link = extractTag(block, "link");
  const pubDate = extractTag(block, "pubDate");
  const sourceMatch = block.match(/<source url="([^"]*)">([\s\S]*?)<\/source>/);
  const sourceName = sourceMatch ? decodeEntities(sourceMatch[2].trim()) : null;

  if (!title || !link) return null;

  return {
    title: stripTags(title),
    url: link,
    date: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null,
    sourceName: sourceName || "Google News",
  };
}

/**
 * Best-effort fetch of the actual article behind a Google News RSS link.
 *
 * Known limitation: Google News' /rss/articles/... links resolve to the
 * real publisher via client-side JavaScript, not an HTTP redirect - a plain
 * fetch (no headless browser, which isn't viable in a serverless function
 * under a 60s ceiling) usually lands back on a news.google.com wrapper page,
 * not the article. This function still tries (some sources do resolve via
 * plain HTTP redirect), but callers MUST treat a failure here as "couldn't
 * read it" rather than force a grade from the headline alone - that's the
 * whole reason grading requires the actual text, not just the title.
 */
export async function fetchArticleText(url) {
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!resp.ok) return { text: null, resolvedUrl: resp.url, reason: `HTTP ${resp.status}` };

    const finalUrl = resp.url;
    if (new URL(finalUrl).hostname.endsWith("news.google.com")) {
      return { text: null, resolvedUrl: finalUrl, reason: "redirect did not resolve past Google News (needs JS)" };
    }

    const html = await resp.text();
    const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    const text = stripTags(withoutScripts).replace(/\s+/g, " ").trim();

    if (text.length < 300) {
      return { text: null, resolvedUrl: finalUrl, reason: "page had too little extractable text (likely paywalled or JS-rendered)" };
    }

    return { text: text.slice(0, 6000), resolvedUrl: finalUrl, reason: null };
  } catch (err) {
    return { text: null, resolvedUrl: url, reason: String(err && err.message ? err.message : err) };
  }
}
