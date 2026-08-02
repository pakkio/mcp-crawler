import { test, mock } from "node:test";
import assert from "node:assert/strict";

const capture = { lastPromptText: undefined };

class FakeSession {
  async prompt(text) {
    capture.lastPromptText = text;
    return "  [1] fine\n[2] fine  ";
  }
}

mock.module("node-llama-cpp", {
  namedExports: {
    getLlama: async () => ({
      loadModel: async () => ({
        createContext: async () => ({ getSequence: () => ({}) }),
      }),
    }),
    LlamaChatSession: FakeSession,
  },
});

const { digest } = await import("./summarize.js");

function match(i, title, snippet) {
  return { title, url: `https://example.com/${i}`, snippet };
}

test("digest returns early without calling the model when there are no matches", async () => {
  const result = await digest([], "anything");
  assert.equal(result, "No matches found.");
});

test("prompt enforces the /terse output contract and correct bullet cap", async () => {
  const matches = Array.from({ length: 3 }, (_, i) =>
    match(i, `Title ${i}`, `Snippet content ${i}`)
  );
  await digest(matches, "rate limiting");

  const prompt = capture.lastPromptText;

  assert.match(prompt, /Output ONLY the bullet list/);
  assert.match(prompt, /No preamble, no summary, no closing remarks/);
  assert.match(prompt, /Maximum 3 bullets/);
  assert.match(prompt, /Query: "rate limiting"/);
  assert.match(prompt, /\[1\] Title 0/);
  assert.match(prompt, /\[3\] Title 2/);
});

test("bullet cap clamps at 8 even with many more matches", async () => {
  const matches = Array.from({ length: 15 }, (_, i) => match(i, `T${i}`, `S${i}`));
  await digest(matches, "q");

  const prompt = capture.lastPromptText;

  assert.match(prompt, /Maximum 8 bullets/);
  assert.doesNotMatch(prompt, /Maximum 15 bullets/);
});

test("falls back to url when title is missing, and trims the model response", async () => {
  const matches = [{ url: "https://example.com/x", match: "raw match text" }];
  const result = await digest(matches, "q");

  const prompt = capture.lastPromptText;

  assert.match(prompt, /\[1\] https:\/\/example\.com\/x/);
  assert.match(prompt, /raw match text/);
  assert.equal(result, "[1] fine\n[2] fine");
});
