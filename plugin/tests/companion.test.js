import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCompanion, SESSION_IDLE_MS } from "../companion/companion.js";
import { createMemory } from "../companion/memory.js";
import { DEFAULT_PERSONA, createPersonaSource, parsePersona } from "../companion/persona.js";
import { cleanReply, createOllama } from "../companion/ollama.js";
import { describeDigest, emptyDigest, updateDigest, SLEEPY_AFTER_MS } from "../companion/mood.js";
import { normalizeEvent } from "../broker/event-normalizer.js";

function fakeLlm(reply = (messages) => `ok: ${messages.at(-1).content.slice(0, 40)}`) {
  const calls = [];
  return {
    model: "fake",
    calls,
    async chat(messages, options) {
      calls.push({ messages, options });
      if (reply instanceof Error) throw reply;
      return typeof reply === "function" ? reply(messages) : reply;
    },
  };
}

function setup({ llm = fakeLlm(), cooldownMs = 30_000 } = {}) {
  let t = Date.parse("2026-10-07T20:00:00Z");
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const emitted = [];
  const memory = createMemory();
  const companion = createCompanion({
    llm,
    memory,
    loadPersona: createPersonaSource(),
    emit: (message) => emitted.push(message),
    now: clock.now,
    cooldownMs,
  });
  const at = () => new Date(clock.now());
  const ev = (raw) => normalizeEvent({ session_id: "s1", cwd: "/home/howard/filings-rag", ...raw }, at());
  return { companion, llm, memory, clock, emitted, ev };
}

test("greets a new session, focuses while tools run, and worries on failure", async () => {
  const { companion, llm, clock, ev } = setup();
  const hello = await companion.observe(ev({ source: "claude", hook_event_name: "SessionStart" }));
  assert.equal(companion.state.mood, "curious");
  assert.equal(hello.kind, "session_start");
  assert.match(llm.calls[0].messages.at(-1).content, /Claude just started a session in filings-rag/);
  assert.match(llm.calls[0].messages[0].content, /You are Mira/);

  await companion.observe(ev({ source: "claude", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pytest -q" } }));
  assert.equal(companion.state.mood, "focused");

  clock.advance(31_000);
  const worry = await companion.observe(ev({ source: "claude", hook_event_name: "PostToolUseFailure", tool_name: "Bash" }));
  assert.equal(companion.state.mood, "worried");
  assert.equal(worry.kind, "failure");
  assert.match(llm.calls.at(-1).messages.at(-1).content, /Claude's Bash just failed in filings-rag/);
});

test("respects the cooldown, except when an agent is waiting for approval", async () => {
  const { companion, llm, clock, ev } = setup();
  await companion.observe(ev({ source: "codex", hook_event_name: "SessionStart" }));
  clock.advance(5_000);
  assert.equal(await companion.observe(ev({ source: "codex", hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { exit_code: 2 } })), null);
  const waiting = await companion.observe(ev({ source: "claude", hook_event_name: "Notification", notification_type: "permission_prompt", tool_name: "Bash" }));
  assert.equal(waiting.kind, "waiting");
  assert.equal(companion.state.mood, "alert");
  assert.equal(llm.calls.length, 2);
});

test("cheers when a busy turn ends, stays quiet after a trivial one", async () => {
  const { companion, clock, ev } = setup({ cooldownMs: 0 });
  await companion.observe(ev({ source: "gemini", hook_event_name: "SessionStart" }));
  assert.equal(await companion.observe(ev({ source: "gemini", hook_event_name: "AfterAgent" })), null);
  for (const file of ["a.py", "b.py", "c.py"]) {
    await companion.observe(ev({ source: "gemini", hook_event_name: "BeforeTool", tool_name: "replace", tool_input: { file_path: `/x/${file}` } }));
  }
  clock.advance(2_000);
  const done = await companion.observe(ev({ source: "gemini", hook_event_name: "AfterAgent" }));
  assert.equal(done.kind, "done");
  assert.equal(companion.state.mood, "happy");
});

test("falls back to plain lines when the model is down", async () => {
  const { companion, ev } = setup({ llm: fakeLlm(new Error("connection refused")) });
  const line = await companion.observe(ev({ source: "codex", hook_event_name: "SessionStart" }));
  assert.equal(line.origin, "fallback");
  assert.match(line.text, /Codex is up/);
  const reply = await companion.chat("hi Mira");
  assert.equal(reply.origin, "fallback");
  assert.match(reply.text, /Ollama/);
});

test("dozes off after a quiet stretch and files away idle sessions with a summary", async () => {
  const { companion, memory, clock, ev, llm } = setup();
  await companion.observe(ev({ source: "claude", hook_event_name: "SessionStart" }));
  await companion.observe(ev({ source: "claude", hook_event_name: "UserPromptSubmit", prompt: "PRIVATE" }));
  await companion.observe(ev({ source: "claude", hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: "/r/src/rerank.py" } }));
  clock.advance(SLEEPY_AFTER_MS);
  const sleepy = await companion.tick();
  assert.equal(sleepy.kind, "sleepy");
  assert.equal(companion.state.mood, "sleepy");
  clock.advance(SESSION_IDLE_MS);
  await companion.tick();
  const recall = await memory.recall();
  assert.equal(recall.sessions.length, 1);
  assert.equal(recall.sessions[0].project, "filings-rag");
  assert.deepEqual(recall.sessions[0].files, ["rerank.py"]);
  const summaryPrompt = llm.calls.at(-1).messages.at(-1).content;
  assert.match(summaryPrompt, /Claude session in filings-rag/);
  assert.match(summaryPrompt, /files: rerank.py/);
  assert.doesNotMatch(JSON.stringify(llm.calls), /PRIVATE/);
});

test("chat knows the live sessions, remembers facts and keeps history", async () => {
  const { companion, llm, memory, ev } = setup({ llm: fakeLlm("Sure thing.") });
  await companion.observe(ev({ source: "codex", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } }));
  await companion.chat("Remember that the demo is due Friday");
  const system = llm.calls.at(-1).messages[0].content;
  assert.match(system, /Codex session in filings-rag/);
  assert.match(system, /ran: npm test/);
  assert.equal((await memory.recall()).facts[0].text, "the demo is due Friday");
  await companion.chat("what's due?");
  const second = llm.calls.at(-1).messages;
  assert.match(second[0].content, /the demo is due Friday/);
  assert.deepEqual(second.slice(1, -1).map((m) => m.role), ["user", "assistant"]);
  const snapshot = await companion.snapshot();
  assert.equal(snapshot.name, "Mira");
  assert.equal(snapshot.memory.facts, 1);
});

test("memory persists to disk and reloads", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "companion-"));
  const file = path.join(dir, "memory.json");
  const first = createMemory({ file });
  await first.addFact("likes pixel art");
  await first.addSession({ date: "2026-10-07T20:00:00Z", project: "agent-office", summary: "Built the broker." });
  await first.flush();
  const second = createMemory({ file });
  const recall = await second.recall({ project: "agent-office" });
  assert.equal(recall.facts[0].text, "likes pixel art");
  assert.equal(recall.sessions[0].summary, "Built the broker.");
  assert.match(await readFile(file, "utf8"), /likes pixel art/);
});

test("persona file overrides the default, and a missing file falls back", async () => {
  assert.equal(parsePersona(DEFAULT_PERSONA).name, "Mira");
  const custom = createPersonaSource({ path: "/p.md", read: async () => "name: Haru\n---\nYou are Haru." });
  assert.deepEqual(await custom(), { name: "Haru", text: "You are Haru." });
  const missing = createPersonaSource({ path: "/nope.md", read: async () => { throw new Error("ENOENT"); } });
  assert.equal((await missing()).name, "Mira");
});

test("digest descriptions use names only", () => {
  const start = normalizeEvent({ source: "codex", hook_event_name: "SessionStart", session_id: "x", cwd: "/w/local-inference-lab" }, new Date("2026-10-07T20:00:00Z"));
  let digest = emptyDigest(start);
  digest = updateDigest(digest, normalizeEvent({ source: "codex", hook_event_name: "PreToolUse", session_id: "x", tool_name: "Bash", tool_input: { command: "python -m pytest -k secret_name" } }, new Date("2026-10-07T20:05:00Z")));
  const text = describeDigest(digest);
  assert.equal(text, "Codex session in local-inference-lab, about 5 min; 1 tool calls (Bash x1); ran: python -m pytest; no failures");
});

test("Ollama client sends a non-thinking chat request and cleans the reply", async () => {
  let sent;
  const llm = createOllama({
    baseUrl: "http://ollama.test",
    model: "qwen3:8b",
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ message: { content: "<think>\nhmm\n</think>\n\nMira: Nice  work!" } }) };
    },
  });
  assert.equal(await llm.chat([{ role: "user", content: "hi" }], { maxTokens: 50 }), "Nice work!");
  assert.equal(sent.url, "http://ollama.test/api/chat");
  assert.equal(sent.body.think, false);
  assert.equal(sent.body.stream, false);
  assert.equal(sent.body.options.num_predict, 50);
  assert.equal(cleanReply("  assistant: hello "), "hello");
});
