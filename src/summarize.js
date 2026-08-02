import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLlama, LlamaChatSession } from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH =
  process.env.SUMMARY_MODEL_PATH ||
  path.join(__dirname, "..", "..", "dotenv", "models", "gemma-4-E2B-qat", "gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf");

let sessionPromise;

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath: MODEL_PATH });
      const context = await model.createContext();
      return new LlamaChatSession({ contextSequence: context.getSequence() });
    })();
  }
  return sessionPromise;
}

export async function digest(matches, query) {
  if (!matches.length) return "No matches found.";

  const bundle = matches
    .map((m, i) => `[${i + 1}] ${m.title || m.url}\n${m.snippet || m.match || ""}`)
    .join("\n\n");

  const maxBullets = Math.min(matches.length, 8);
  const prompt = `You are condensing local search-index results into a short digest. Do not invent facts not present below. Query: "${query}"\n\nResults:\n${bundle}\n\nOutput ONLY the bullet list, one bullet per line, each citing its [n] index. No preamble, no summary, no closing remarks. Maximum ${maxBullets} bullets, one line each.`;

  const session = await getSession();
  const response = await session.prompt(prompt);
  return response.trim();
}
