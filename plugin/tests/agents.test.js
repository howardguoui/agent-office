import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { claudeCommand, codexCommand, createAgentRunner, describeTool, parseClaudeLine, parseCodexLine } from "../companion/agents.js";

// Lines recorded from Claude Code 2.1.285 and Codex 0.145.0 on the RTX 5070 Ti PC (trimmed).
const CLAUDE = [
  { type: "system", subtype: "hook_started" },
  { type: "system", subtype: "init", session_id: "8d9c259c", model: "claude-opus-5-5", permissionMode: "default" },
  { type: "system", subtype: "thinking_tokens", estimated_tokens: 269, estimated_tokens_delta: 119, session_id: "8d9c259c" },
  { type: "assistant", message: { content: [{ type: "thinking", thinking: "", signature: "CAQS..." }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: "C:\\Users\\c4999\\AppData\\Local\\Temp\\ao-agent-probe\\notes.txt" } }] } },
  { type: "rate_limit_event" },
  { type: "user", message: { content: [{ tool_use_id: "toolu_01", type: "tool_result", content: "1\tThe answer to the riddle is 42." }] } },
  { type: "assistant", message: { content: [{ type: "text", text: "The answer is 42, according to `notes.txt`." }] } },
  { type: "result", subtype: "success", is_error: false, result: "The answer is 42, according to `notes.txt`.", session_id: "8d9c259c", duration_ms: 9773 },
];
const CODEX = [
  { type: "thread.started", thread_id: "01a118ad" },
  { type: "item.completed", item: { id: "item_0", type: "error", message: "Configured service tier `priority` is not advertised" } },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_1", type: "agent_message", text: "Reading the file first." } },
  { type: "item.started", item: { id: "item_2", type: "command_execution", command: "\"powershell.exe\" -Command \"Get-Content -Raw notes.txt\"" } },
  { type: "item.completed", item: { id: "item_2", type: "command_execution", command: "...", exit_code: 0 } },
  { type: "item.completed", item: { id: "item_3", type: "agent_message", text: "The answer is 42." } },
  { type: "turn.completed", usage: { input_tokens: 10 } },
];

test("parses Claude Code's stream into thinking, tool steps, the answer and the session id", () => {
  const events = CLAUDE.flatMap(parseClaudeLine);
  assert.deepEqual(events.map((e) => e.phase), ["start", "thinking", "thinking", "tool", "tool_done", "message", "done"]);
  assert.equal(events[0].sessionId, "8d9c259c");
  assert.equal(events[1].tokens, 269);
  assert.equal(events[3].label, "Reading notes.txt");
  assert.equal(events[4].failed, false);
  assert.equal(events.at(-1).text, "The answer is 42, according to `notes.txt`.");
});

test("parses Codex's stream and ignores its warning items", () => {
  const events = CODEX.flatMap(parseCodexLine);
  assert.deepEqual(events.map((e) => e.phase), ["start", "thinking", "message", "tool", "tool_done", "message", "done"]);
  assert.equal(events[3].label, "Running powershell");
  assert.equal(parseCodexLine({ type: "turn.failed", error: { message: "model not supported" } })[0].text, "model not supported");
  assert.equal(parseCodexLine({ type: "item.completed", item: { id: "x", type: "command_execution", exit_code: 1 } })[0].failed, true);
});

test("tool labels use names only", () => {
  assert.equal(describeTool("Bash", { command: "API_KEY=secret npm test -- --grep token" }), "Running npm test");
  assert.equal(describeTool("Edit", { file_path: "/home/p/src/rerank.py", new_string: "SECRET" }), "Editing rerank.py");
  assert.equal(describeTool("WebFetch", { url: "https://docs.vllm.ai/x?token=1" }), "Reading docs.vllm.ai");
  assert.equal(describeTool("mcp__github__create_issue", {}), "Using github");
});

test("builds the CLI commands for each permission and sandbox setting", () => {
  assert.deepEqual(claudeCommand({ permission: "ask", approvalMcpConfig: "{}" }).args, ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "default", "--mcp-config", "{}", "--permission-prompt-tool", "mcp__companion__approve"]);
  assert.deepEqual(claudeCommand({ permission: "plan", sessionId: "s1", approvalMcpConfig: "{}" }).args.slice(4), ["--permission-mode", "plan", "--resume", "s1"]);
  const codex = codexCommand({ model: "gpt-5.6-terra", sandbox: "workspace-write", cwd: "E:\\p", env: { APPDATA: "C:\\Users\\h\\AppData\\Roaming" }, nodePath: "node", exists: () => true });
  assert.equal(codex.file, "node");
  assert.match(codex.args[0], /@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
  assert.deepEqual(codex.args.slice(1), ["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-m", "gpt-5.6-terra", "--cd", "E:\\p", "-"]);
  assert.deepEqual(codexCommand({ sessionId: "t1", env: {}, exists: () => false }).args, ["exec", "resume", "t1", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-"]);
});

function fakeSpawn(lines, { code = 0 } = {}) {
  const calls = [];
  const spawnImpl = (file, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let input = "";
    child.stdin = { end: (text) => { input = text; } };
    child.kill = () => child.emit("close", 1);
    calls.push({ file, args, options, input: () => input });
    setImmediate(() => {
      for (const line of lines) child.stdout.write(`${JSON.stringify(line)}\n`);
      child.stdout.end();
      setImmediate(() => child.emit("close", code));
    });
    return child;
  };
  return { spawnImpl, calls };
}

test("runs a turn in the project folder, streams events, and resumes the session next time", async () => {
  const { spawnImpl, calls } = fakeSpawn(CLAUDE);
  const events = [];
  const settings = { target: "claude", project: process.platform === "win32" ? "E:\\ClaudeProject\\filings-rag" : "/home/p/filings-rag", claudePermission: "acceptEdits" };
  const runner = createAgentRunner({ getSettings: () => settings, emit: (e) => events.push(e), spawnImpl });
  runner.run("What is the answer?");
  assert.equal(runner.busy, true);
  assert.throws(() => runner.run("again"), /still working/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(runner.busy, false);
  assert.equal(calls[0].file, "claude");
  assert.equal(calls[0].options.cwd, settings.project);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].input(), "What is the answer?");
  assert.deepEqual(events.map((e) => e.phase), ["queued", "start", "thinking", "thinking", "tool", "tool_done", "message", "done"]);
  assert.equal(events.at(-1).agent, "claude");
  assert.equal(events.at(-1).project, "filings-rag");
  runner.run("And why?");
  assert.deepEqual(calls[1].args.slice(-2), ["--resume", "8d9c259c"]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  runner.newConversation("claude", settings.project);
  runner.run("New topic");
  assert.equal(calls[2].args.includes("--resume"), false);
});

test("reports a failed run and refuses to run without a project", async () => {
  const { spawnImpl } = fakeSpawn([{ type: "thread.started", thread_id: "t" }, { type: "turn.failed", error: { message: "The 'gpt-5.6-sol' model is not supported" } }], { code: 1 });
  const events = [];
  const runner = createAgentRunner({ getSettings: () => ({ target: "codex", project: process.platform === "win32" ? "C:\\p" : "/p" }), emit: (e) => events.push(e), spawnImpl });
  runner.run("hi");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(events.at(-1).phase, "error");
  assert.match(events.at(-1).text, /not supported/);
  assert.equal(events.filter((e) => e.phase === "error").length, 1);
  const noProject = createAgentRunner({ getSettings: () => ({ target: "claude", project: "" }), emit: () => {}, spawnImpl });
  assert.throws(() => noProject.run("hi"), /project folder/);
});
