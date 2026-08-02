import { ftsSearch, allPagesForRegex } from "./db.js";

function ftsQuote(term) {
  // Escape a plain-text term for FTS5 MATCH by quoting it and doubling inner quotes.
  return `"${term.replace(/"/g, '""')}"`;
}

function compileExclude(exclude) {
  if (!exclude) return null;
  try {
    return new RegExp(exclude, "i");
  } catch (err) {
    throw new Error(`Invalid exclude regex: ${err.message}`);
  }
}

function applyExclude(matches, exclude) {
  const excludeRe = compileExclude(exclude);
  if (!excludeRe) return matches;
  return matches.filter((m) => !excludeRe.test(m.snippet || ""));
}

export function searchText(query, limit = 20, exclude = null) {
  const matchQuery = query
    .trim()
    .split(/\s+/)
    .map(ftsQuote)
    .join(" ");
  const results = ftsSearch(matchQuery, exclude ? limit * 3 : limit);
  return applyExclude(results, exclude).slice(0, limit);
}

export function searchRegex(pattern, flags = "gi", contextChars = 60, limit = 20, exclude = null) {
  let re;
  try {
    re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
  } catch (err) {
    throw new Error(`Invalid regex: ${err.message}`);
  }

  const excludeRe = compileExclude(exclude);
  const pages = allPagesForRegex();
  const matches = [];

  for (const page of pages) {
    if (matches.length >= limit) break;
    const content = page.content || "";
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      const start = Math.max(0, m.index - contextChars);
      const end = Math.min(content.length, m.index + m[0].length + contextChars);
      const snippet = content.slice(start, end).replace(/\s+/g, " ").trim();

      if (!excludeRe || !excludeRe.test(snippet)) {
        matches.push({
          url: page.url,
          title: page.title,
          match: m[0],
          snippet: `...${snippet}...`,
        });
      }

      if (m[0].length === 0) re.lastIndex++; // avoid infinite loop on zero-length matches
      if (matches.length >= limit) break;
    }
  }

  return matches;
}
