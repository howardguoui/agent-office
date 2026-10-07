import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEvent } from "../broker/event-normalizer.js";


test("normalizes an explicitly tagged Codex tool event", () => {
  const event = normalizeEvent({
    source: "codex",
    hook_event_name: "PreToolUse",
    session_id: "shared-session",
    agent_id: "worker-1",
    tool_name: "shell_command",
    tool_input: { secret: "must-not-be-copied" },
  });

  assert.equal(event.source, "codex");
  assert.equal(event.eventName, "PreToolUse");
  assert.equal(event.sessionId, "shared-session");
  assert.equal(event.agentId, "worker-1");
  assert.equal(event.actorKey, "codex:shared-session:worker-1");
  assert.equal(event.toolName, "shell_command");
  assert.equal("toolInput" in event, false);
  assert.doesNotMatch(JSON.stringify(event), /must-not-be-copied/);
});

test("keeps Claude and Codex actor keys distinct", () => {
  const base = {
    hook_event_name: "SessionStart",
    session_id: "same-id",
  };
  const claude = normalizeEvent({ ...base, source: "claude" });
  const codex = normalizeEvent({ ...base, source: "codex" });

  assert.notEqual(claude.actorKey, codex.actorKey);
  assert.equal(claude.agentId, "main");
  assert.equal(codex.agentId, "main");
});

test("uses conservative source inference only as a fallback", () => {
  assert.equal(
    normalizeEvent({ hook_event_name: "Stop", turn_id: "turn-1" }).source,
    "codex",
  );
  assert.equal(
    normalizeEvent({
      hook_event_name: "Stop",
      transcript_path: "C:/Users/person/.claude/projects/session.jsonl",
    }).source,
    "claude",
  );
  assert.equal(normalizeEvent({ hook_event_name: "Stop" }).source, "unknown");
});

