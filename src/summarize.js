const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.SUMMARY_MODEL || "gemma3:4b";

export async function digest(matches, query) {
  if (!matches.length) return "No matches found.";

  const bundle = matches
    .map((m, i) => `[${i + 1}] ${m.title || m.url}\n${m.snippet || m.match || ""}`)
    .join("\n\n");

  const prompt = `You are condensing local search-index results into a short digest. Do not invent facts not present below. Query: "${query}"\n\nResults:\n${bundle}\n\nWrite a concise bullet-point digest (max ${Math.min(matches.length, 8)} bullets) of what these results say, citing the [n] index for each bullet.`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`Ollama request failed: HTTP ${res.status} (${await res.text()})`);
  }

  const data = await res.json();
  return data.response.trim();
}
