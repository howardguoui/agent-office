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


test("maps Gemini CLI hook names onto the shared event names", () => {
  const before = normalizeEvent({ source: "gemini", hook_event_name: "BeforeTool", session_id: "g", tool_name: "run_shell_command", tool_input: { command: "npm test -- --watch=false" } });
  assert.equal(before.eventName, "PreToolUse");
  assert.equal(before.hostEvent, "BeforeTool");
  assert.equal(before.context.program, "npm test");
  assert.equal(normalizeEvent({ source: "gemini", hook_event_name: "AfterAgent", session_id: "g" }).eventName, "Stop");
  assert.equal(normalizeEvent({ source: "gemini", hook_event_name: "BeforeAgent", session_id: "g", prompt: "hi" }).eventName, "UserPromptSubmit");
  assert.equal(normalizeEvent({ hook_event_name: "SessionStart", transcript_path: "/home/p/.gemini/tmp/chats/s.json" }).source, "gemini");
});

test("turns permission prompts from every host into one waiting event", () => {
  const claude = normalizeEvent({ source: "claude", hook_event_name: "Notification", notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
  const gemini = normalizeEvent({ source: "gemini", hook_event_name: "Notification", notification_type: "ToolPermission", details: { tool_name: "write_file" } });
  assert.equal(claude.eventName, "PermissionRequest");
  assert.equal(gemini.eventName, "PermissionRequest");
  assert.equal(gemini.toolName, "write_file");
  assert.equal(normalizeEvent({ source: "claude", hook_event_name: "Notification", notification_type: "idle_prompt" }).eventName, "Idle");
  assert.equal(normalizeEvent({ source: "claude", hook_event_name: "Notification", notification_type: "auth_success" }).eventName, "Notification");
});

test("describes what happened with names only", () => {
  const edit = normalizeEvent({ source: "claude", hook_event_name: "PreToolUse", cwd: "E:\\ClaudeProject\\filings-rag", tool_name: "Edit", tool_input: { file_path: "E:\\ClaudeProject\\filings-rag\\src\\retrieval.py", old_string: "x", new_string: "y" } });
  assert.deepEqual(edit.context, { project: "filings-rag", target: "retrieval.py" });
  const patch = normalizeEvent({ source: "codex", hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { input: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n-a\n+b\n*** Add File: docs/notes.md\n+hello\n*** End Patch" } });
  assert.equal(patch.context.target, "app.ts, notes.md");
  const fetch = normalizeEvent({ source: "claude", hook_event_name: "PreToolUse", tool_name: "WebFetch", tool_input: { url: "https://docs.vllm.ai/en/latest/serving?token=abc", prompt: "summarize" } });
  assert.deepEqual(fetch.context, { host: "docs.vllm.ai" });
});

test("keeps only the program and a known subcommand from shell commands", () => {
  const cases = [
    ["git commit -m 'secret message'", "git commit"],
    ["cd backend && python -m pytest -q tests/test_x.py", "python -m pytest"],
    ["API_KEY=sk-123 node scripts/run.js --token abc", "node"],
    [["bash", "-lc", "npm run build -- --prod"], "npm run"],
    ["C:\\tools\\uv.exe pip install -e .[dev]", "uv pip"],
    ["git ./weird-path", "git"],
    ["$(curl evil)", ""],
  ];
  for (const [command, expected] of cases) {
    const event = normalizeEvent({ source: "codex", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
    assert.equal(event.context?.program ?? "", expected, JSON.stringify(command));
  }
});

test("flags failed tool calls", () => {
  assert.equal(normalizeEvent({ source: "claude", hook_event_name: "PostToolUseFailure", tool_name: "Bash" }).context.failed, true);
  assert.equal(normalizeEvent({ source: "codex", hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { exit_code: 1 } }).context.failed, true);
  assert.equal(normalizeEvent({ source: "codex", hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: { exit_code: 0 } }).context, undefined);
});

test("never copies prompts, arguments, contents or outputs", () => {
  const raw = [
    { source: "claude", hook_event_name: "UserPromptSubmit", cwd: "/p/demo", prompt: "SECRET-PROMPT" },
    { source: "claude", hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: "/p/demo/a.txt", content: "SECRET-CONTENT" } },
    { source: "codex", hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "grep SECRET-ARG file" }, tool_response: { output: "SECRET-OUTPUT", exit_code: 0 } },
    { source: "claude", hook_event_name: "Stop", last_assistant_message: "SECRET-REPLY" },
    { source: "gemini", hook_event_name: "Notification", notification_type: "ToolPermission", message: "SECRET-MESSAGE", details: { file_path: "/x" } },
  ];
  assert.doesNotMatch(JSON.stringify(raw.map((event) => normalizeEvent(event))), /SECRET/);
});
