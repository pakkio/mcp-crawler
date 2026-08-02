import { savePage } from "./db.js";

const UA = "mcp-crawler-search/1.0 (+regex-based indexer)";

function stripHtml(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const re = /<a\s[^>]*href\s*=\s*["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const abs = new URL(m[1], baseUrl).toString();
      if (abs.startsWith("http")) links.add(abs);
    } catch {
      // ignore invalid urls
    }
  }
  return [...links];
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text")) {
    throw new Error(`Unsupported content-type "${contentType}" for ${url}`);
  }
  return res.text();
}

export async function crawl({ url, maxPages = 1, sameDomainOnly = true }) {
  const visited = new Set();
  const queue = [url];
  const results = [];
  const origin = new URL(url).origin;
  let totalRawBytes = 0;

  while (queue.length && visited.size < maxPages) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      const html = await fetchPage(current);
      totalRawBytes += html.length;
      const title = extractTitle(html);
      const content = stripHtml(html);
      savePage({ url: current, title, content });
      results.push({ url: current, title, contentLength: content.length });

      if (visited.size < maxPages) {
        const links = extractLinks(html, current);
        for (const link of links) {
          if (sameDomainOnly && new URL(link).origin !== origin) continue;
          if (!visited.has(link) && !queue.includes(link)) queue.push(link);
        }
      }
    } catch (err) {
      results.push({ url: current, error: err.message });
    }
  }

  return { pages: results, totalRawBytes };
}
