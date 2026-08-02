#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { crawl } from "./crawler.js";
import { searchText, searchRegex } from "./search.js";
import { listPages, clearAll, recordUsage, getTotalContentBytes, getUsageStats } from "./db.js";
import { digest } from "./summarize.js";

const server = new McpServer({
  name: "mcp-crawler-search",
  version: "1.0.0",
});

server.registerTool(
  "crawl_url",
  {
    title: "Crawl URL",
    description:
      "Fetch a URL (and optionally follow same-domain links up to maxPages), strip HTML via regex, and store the page text in a local SQLite index for later searching. No AI/LLM is used.",
    inputSchema: {
      url: z.string().url().describe("The starting URL to crawl"),
      maxPages: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(1)
        .describe("Max number of pages to crawl by following links (default 1 = just the given URL)"),
      sameDomainOnly: z
        .boolean()
        .default(true)
        .describe("Restrict link following to the same origin as the starting URL"),
    },
  },
  async ({ url, maxPages, sameDomainOnly }) => {
    const { pages, totalRawBytes } = await crawl({ url, maxPages, sameDomainOnly });
    const text = JSON.stringify(pages, null, 2);
    recordUsage("crawl_url", totalRawBytes, text.length);
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.registerTool(
  "search_text",
  {
    title: "Search indexed pages (plain text)",
    description:
      "Search previously crawled pages for a plain-text sentence/phrase using SQLite FTS5 full-text search (matching itself uses no AI). Terms are ANDed together. Set digest:true to have a local small model (<=3B params, e.g. gemma3:4b via Ollama) condense the raw matches into a short bullet summary instead of returning raw snippets, to save context.",
    inputSchema: {
      query: z.string().describe("The search sentence or keywords"),
      limit: z.number().int().min(1).max(100).default(20),
      exclude: z.string().optional().describe("Regex (case-insensitive); matches whose snippet matches this are dropped before returning/digesting, e.g. to exclude sports coverage: 'football|Baresi|Chelsea'"),
      digest: z.boolean().default(false).describe("If true, summarize results with a local small model instead of returning raw snippets"),
    },
  },
  async ({ query, limit, exclude, digest: useDigest }) => {
    const results = searchText(query, limit, exclude);
    const rawBytes = getTotalContentBytes();
    if (useDigest) {
      const summary = await digest(results, query);
      recordUsage("search_text", rawBytes, summary.length);
      return { content: [{ type: "text", text: summary }] };
    }
    const text = JSON.stringify(results, null, 2);
    recordUsage("search_text", rawBytes, text.length);
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.registerTool(
  "search_regex",
  {
    title: "Search indexed pages (regex)",
    description:
      "Search previously crawled pages using a raw JavaScript regular expression against the extracted page text (matching itself uses no AI). Returns matches with surrounding context. Set digest:true to have a local small model (<=3B params, e.g. gemma3:4b via Ollama) condense the raw matches into a short bullet summary instead of returning raw snippets, to save context.",
    inputSchema: {
      pattern: z.string().describe("JavaScript regex pattern (without slashes)"),
      flags: z.string().default("gi").describe("Regex flags, e.g. 'gi'"),
      contextChars: z.number().int().min(0).max(500).default(60),
      limit: z.number().int().min(1).max(200).default(20),
      exclude: z.string().optional().describe("Regex (case-insensitive); matches whose snippet matches this are dropped before returning/digesting, e.g. to exclude sports coverage: 'football|Baresi|Chelsea'"),
      digest: z.boolean().default(false).describe("If true, summarize results with a local small model instead of returning raw snippets"),
    },
  },
  async ({ pattern, flags, contextChars, limit, exclude, digest: useDigest }) => {
    const results = searchRegex(pattern, flags, contextChars, limit, exclude);
    const rawBytes = getTotalContentBytes();
    if (useDigest) {
      const summary = await digest(results, pattern);
      recordUsage("search_regex", rawBytes, summary.length);
      return { content: [{ type: "text", text: summary }] };
    }
    const text = JSON.stringify(results, null, 2);
    recordUsage("search_regex", rawBytes, text.length);
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.registerTool(
  "list_indexed_pages",
  {
    title: "List indexed pages",
    description: "List all pages currently stored in the local index.",
    inputSchema: {},
  },
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify(listPages(), null, 2) }],
    };
  }
);

server.registerTool(
  "clear_index",
  {
    title: "Clear index",
    description: "Delete all crawled pages from the local index.",
    inputSchema: {},
  },
  async () => {
    clearAll();
    return { content: [{ type: "text", text: "Index cleared." }] };
  }
);

server.registerTool(
  "crawler_stats",
  {
    title: "Crawler token savings stats",
    description:
      "Report cumulative raw bytes fetched/indexed vs bytes actually returned to the caller across crawl_url/search_text/search_regex calls in this index, plus an estimated token savings (bytes/4).",
    inputSchema: {},
  },
  async () => {
    const stats = getUsageStats();
    const estTokens = (bytes) => Math.round(bytes / 4);
    const saved = stats.totals.raw_bytes - stats.totals.returned_bytes;
    const ratio = stats.totals.raw_bytes > 0 ? ((100 * saved) / stats.totals.raw_bytes).toFixed(1) : "0.0";

    const lines = [
      `Tool calls tracked: ${stats.totals.calls}`,
      `Raw bytes considered: ${stats.totals.raw_bytes} (~${estTokens(stats.totals.raw_bytes)} tokens)`,
      `Bytes returned to caller: ${stats.totals.returned_bytes} (~${estTokens(stats.totals.returned_bytes)} tokens)`,
      `Estimated bytes kept out of context: ${saved} (~${estTokens(saved)} tokens)`,
      `Savings ratio: ${ratio}%`,
      "",
      "By tool:",
      ...stats.byTool.map(
        (row) =>
          `  ${row.tool}: ${row.calls} calls, raw ${row.raw_bytes}B, returned ${row.returned_bytes}B, saved ${row.raw_bytes - row.returned_bytes}B`
      ),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
