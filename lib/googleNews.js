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
