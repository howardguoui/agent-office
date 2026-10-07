import test from "node:test";
import assert from "node:assert/strict";

import { createStateStore } from "../broker/state-store.js";


test("tracks simultaneous Claude and Codex sessions independently", async () => {
  const persisted = [];
  const store = createStateStore({
    appendLog: async (event) => persisted.push(event),
    maxEvents: 10,
  });

  await store.apply({
    source: "claude",
    hook_event_name: "SessionStart",
    session_id: "same-session",
  });
  await store.apply({
    source: "codex",
    hook_event_name: "SessionStart",
    session_id: "same-session",
  });
  await store.apply({
    source: "codex",
    hook_event_name: "PreToolUse",
    session_id: "same-session",
    tool_name: "shell_command",
  });

  const state = store.snapshot();
  assert.equal(state.agents.length, 2);
  assert.equal(
    state.agents.find((agent) => agent.source === "claude").status,
    "idle",
  );
  assert.equal(
    state.agents.find((agent) => agent.source === "codex").status,
    "working",
  );
  assert.equal(state.toolCounts["codex:shell_command"], 1);
  assert.equal(persisted.length, 3);
});

test("persists normalized metadata but never raw hook payloads", async () => {
  const persisted = [];
  const store = createStateStore({
    appendLog: async (event) => persisted.push(event),
  });

  await store.apply({
    source: "codex",
    hook_event_name: "PostToolUse",
    session_id: "session",
    tool_name: "shell_command",
    prompt: "RAW-PROMPT-SECRET",
    tool_input: { command: "RAW-COMMAND-SECRET" },
    tool_response: { output: "RAW-OUTPUT-SECRET" },
  });

  const serialized = JSON.stringify(persisted);
  assert.doesNotMatch(serialized, /RAW-PROMPT-SECRET/);
  assert.doesNotMatch(serialized, /RAW-COMMAND-SECRET/);
  assert.doesNotMatch(serialized, /RAW-OUTPUT-SECRET/);
  assert.equal(persisted[0].source, "codex");
  assert.equal(persisted[0].toolName, "shell_command");
});

test("bounds in-memory event history", async () => {
  const store = createStateStore({ maxEvents: 2 });
  for (let index = 0; index < 3; index += 1) {
    await store.apply({
      source: "codex",
      hook_event_name: "PreToolUse",
      session_id: "session",
      tool_name: `tool-${index}`,
    });
  }
  assert.equal(store.snapshot().events.length, 2);
  assert.equal(store.snapshot().events[0].toolName, "tool-1");
});


test("shows an agent waiting for permission, then back at work, and remembers its project", async () => {
  const store = createStateStore();
  await store.apply({ source: "claude", hook_event_name: "PreToolUse", session_id: "s", cwd: "/home/p/workflow-copilot", tool_name: "Bash", tool_input: { command: "pytest -q" } });
  let agent = store.snapshot().agents[0];
  assert.equal(agent.currentTask, "Bash pytest");
  assert.equal(agent.project, "workflow-copilot");
  await store.apply({ source: "claude", hook_event_name: "Notification", session_id: "s", notification_type: "permission_prompt" });
  assert.equal(store.snapshot().agents[0].status, "waiting");
  await store.apply({ source: "claude", hook_event_name: "PostToolUseFailure", session_id: "s", tool_name: "Bash" });
  agent = store.snapshot().agents[0];
  assert.equal(agent.status, "working");
  assert.equal(agent.lastError.toolName, "Bash");
  await store.apply({ source: "claude", hook_event_name: "Stop", session_id: "s" });
  assert.equal(store.snapshot().agents[0].status, "done");
});
