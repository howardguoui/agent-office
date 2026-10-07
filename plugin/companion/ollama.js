// Minimal Ollama chat client. Local and free: the companion's words never leave the machine.

export const DEFAULT_MODEL = process.env.COMPANION_MODEL || "qwen3:8b";
export const DEFAULT_OLLAMA_URL = process.env.OLLAMA_HOST
  ? process.env.OLLAMA_HOST.replace(/\/$/, "").replace(/^(?!https?:\/\/)/, "http://")
  : "http://127.0.0.1:11434";

/** Remove a reasoning block if the model emitted one, and tidy whitespace. */
export function cleanReply(text) {
  return String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*(assistant|[A-Z][a-z]+):\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function createOllama({
  baseUrl = DEFAULT_OLLAMA_URL,
  model = DEFAULT_MODEL,
  keepAlive = "10m",
  timeoutMs = 20_000,
  fetchImpl = fetch,
} = {}) {
  return {
    model,
    async chat(messages, { maxTokens = 120, temperature = 0.8 } = {}) {
      const response = await fetchImpl(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          think: false,
          keep_alive: keepAlive,
          options: { temperature, num_predict: maxTokens },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
      const body = await response.json();
      const text = cleanReply(body?.message?.content);
      if (!text) throw new Error("Ollama returned an empty reply");
      return text;
    },
  };
}
