// Sends Howard's message straight to a coding agent (Claude Code or Codex) and turns its JSON stream into
// small events the companion can animate: start, thinking, tool, tool_done, message, done, error.
// Agents run on the user's own subscriptions through their CLIs; nothing here calls a paid API directly.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { baseName, programOf } from "../broker/event-normalizer.js";

export const AGENTS = { claude: "Claude Code", codex: "Codex" };

/** A short, name-only label for a tool step: "Reading notes.txt", "Running npm test". */
export function describeTool(tool, input = {}) {
  const file = baseName(input.file_path || input.path || input.notebook_path || "");
  switch (tool) {
    case "Read": return file ? `Reading ${file}` : "Reading a file";
    case "Write": return file ? `Writing ${file}` : "Writing a file";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit": return file ? `Editing ${file}` : "Editing a file";
    case "Bash": {
      const program = programOf(input.command);
      return program ? `Running ${program}` : "Running a command";
    }
    case "Glob":
    case "Grep": return "Searching the code";
    case "WebFetch": {
      try { return `Reading ${new URL(input.url).hostname}`; } catch { return "Reading a web page"; }
    }
    case "WebSearch": return "Searching the web";
    case "Task":
    case "Agent": return "Starting a helper agent";
    case "TodoWrite": return "Updating its to-do list";
    default: return tool.startsWith("mcp__") ? `Using ${tool.split("__")[1] || "a tool"}` : `Using ${tool}`;
  }
}

/** Claude Code `--output-format stream-json` line -> companion events. */
export function parseClaudeLine(line) {
  if (line?.type === "system" && line.subtype === "init") return [{ phase: "start", sessionId: line.session_id, model: line.model }];
  if (line?.type === "system" && line.subtype === "thinking_tokens") return [{ phase: "thinking", tokens: line.estimated_tokens }];
  if (line?.type === "assistant") {
    return (line.message?.content || []).flatMap((block) => {
      if (block.type === "thinking") return [{ phase: "thinking", text: block.thinking || "" }];
      if (block.type === "tool_use") return [{ phase: "tool", tool: block.name, toolId: block.id, label: describeTool(block.name, block.input) }];
      if (block.type === "text" && block.text) return [{ phase: "message", text: block.text }];
      return [];
    });
  }
  if (line?.type === "user") {
    return (line.message?.content || [])
      .filter((block) => block.type === "tool_result")
      .map((block) => ({ phase: "tool_done", toolId: block.tool_use_id, failed: block.is_error === true }));
  }
  if (line?.type === "result") {
    return [{
      phase: line.subtype === "success" && !line.is_error ? "done" : "error",
      text: line.result || line.error || "",
      sessionId: line.session_id,
      durationMs: line.duration_ms,
    }];
  }
  return [];
}

/** Codex `exec --json` line -> companion events. The final answer is the last agent message. */
export function parseCodexLine(line) {
  const item = line?.item;
  if (line?.type === "thread.started") return [{ phase: "start", sessionId: line.thread_id }];
  if (line?.type === "turn.started") return [{ phase: "thinking" }];
  if (line?.type === "item.started" && item?.type === "command_execution") {
    const program = programOf(item.command);
    return [{ phase: "tool", tool: "shell", toolId: item.id, label: program ? `Running ${program}` : "Running a command" }];
  }
  if (line?.type === "item.completed" && item) {
    if (item.type === "command_execution") return [{ phase: "tool_done", toolId: item.id, failed: typeof item.exit_code === "number" && item.exit_code !== 0 }];
    if (item.type === "agent_message" && item.text) return [{ phase: "message", text: item.text }];
    if (item.type === "reasoning") return [{ phase: "thinking", text: item.text || "" }];
    if (item.type === "file_change") {
      const files = (item.changes || []).map((change) => baseName(change.path)).filter(Boolean);
      return [{ phase: "tool", tool: "edit", toolId: item.id, label: files.length ? `Editing ${files.slice(0, 3).join(", ")}` : "Editing files" }, { phase: "tool_done", toolId: item.id }];
    }
    return []; // "error" items are warnings (unsupported service tier and the like)
  }
  if (line?.type === "turn.completed") return [{ phase: "done" }];
  if (line?.type === "turn.failed") return [{ phase: "error", text: line.error?.message || "Codex failed" }];
  if (line?.type === "error") return [{ phase: "error", text: String(line.message || "Codex error") }];
  return [];
}

export const ASK_ALWAYS = ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch"];
export const ASK_WHEN_ACCEPTING_EDITS = ["Bash", "WebFetch"];

export function claudeCommand({ sessionId, permission = "ask", approvalMcpConfig } = {}) {
  const args = ["-p", "--output-format", "stream-json", "--verbose"];
  const mode = { ask: "default", acceptEdits: "acceptEdits", plan: "plan" }[permission] || "default";
  args.push("--permission-mode", mode);
  if (approvalMcpConfig && mode !== "plan") {
    args.push("--mcp-config", approvalMcpConfig, "--permission-prompt-tool", "mcp__companion__approve");
    // "ask" rules beat "allow" rules, so even with allow-everything user settings these tools come to
    // Howard for approval on runs started from the companion. His settings files are not changed.
    const ask = mode === "acceptEdits" ? ASK_WHEN_ACCEPTING_EDITS : ASK_ALWAYS;
    args.push("--settings", JSON.stringify({ permissions: { ask } }));
  }
  if (sessionId) args.push("--resume", sessionId);
  return { file: "claude", args };
}

/** Codex is an npm package; run its JS entry with node to avoid shell quoting on Windows. */
export function codexCommand({ sessionId, model, sandbox = "read-only", cwd, env = process.env, nodePath = process.execPath, exists = existsSync } = {}) {
  const npmEntry = env.APPDATA ? path.join(env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js") : "";
  const base = npmEntry && exists(npmEntry) ? { file: nodePath, args: [npmEntry] } : { file: "codex", args: [] };
  const args = [...base.args, "exec"];
  if (sessionId) args.push("resume", sessionId);
  args.push("--json", "--skip-git-repo-check", "--sandbox", sandbox === "workspace-write" ? "workspace-write" : "read-only");
  if (model) args.push("-m", model);
  if (cwd && !sessionId) args.push("--cd", cwd);
  args.push("-"); // read the prompt from stdin
  return { file: base.file, args };
}

/**
 * Runs one agent turn at a time. `getSettings()` gives { target, project, claudePermission, codexModel, codexSandbox }.
 * emit(event) receives { type: "agent", agent, project, ...companionEvent }.
 */
export function createAgentRunner({ getSettings, emit, approvalMcpConfig, spawnImpl = spawn } = {}) {
  let current = null;
  const sessions = new Map(); // `${agent}:${project}` -> session/thread id, so follow-ups continue the conversation

  function send(agent, project, event) {
    emit({ type: "agent", agent, project: baseName(project), at: new Date().toISOString(), ...event });
  }

  return {
    get busy() { return Boolean(current); },
    newConversation(agent, project) { sessions.delete(`${agent}:${project}`); },
    cancel() {
      if (!current) return false;
      try { current.child.kill(); } catch { /* already exited */ }
      return true;
    },
    run(prompt) {
      const settings = getSettings();
      const agent = settings.target;
      const project = settings.project;
      if (!AGENTS[agent]) throw new Error(`Unknown agent: ${agent}`);
      if (!project || !path.isAbsolute(project)) throw new Error("Pick a project folder in the companion settings first.");
      if (current) throw new Error(`${AGENTS[current.agent]} is still working on the last message.`);
      const key = `${agent}:${project}`;
      const command = agent === "claude"
        ? claudeCommand({ sessionId: sessions.get(key), permission: settings.claudePermission, approvalMcpConfig })
        : codexCommand({ sessionId: sessions.get(key), model: settings.codexModel, sandbox: settings.codexSandbox, cwd: project });
      const child = spawnImpl(command.file, command.args, { cwd: project, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const parse = agent === "claude" ? parseClaudeLine : parseCodexLine;
      const run = { agent, project, child, lastMessage: "", finished: false, stderr: "" };
      current = run;
      send(agent, project, { phase: "queued", prompt: prompt.slice(0, 200) });

      const finish = (event) => {
        if (run.finished) return;
        run.finished = true;
        current = null;
        send(agent, project, event);
      };
      readline.createInterface({ input: child.stdout }).on("line", (text) => {
        let line;
        try { line = JSON.parse(text); } catch { return; }
        for (const event of parse(line)) {
          if (event.sessionId) sessions.set(key, event.sessionId);
          if (event.phase === "message") run.lastMessage = event.text;
          if (event.phase === "done") finish({ ...event, text: event.text || run.lastMessage });
          else if (event.phase === "error") finish(event);
          else send(agent, project, event);
        }
      });
      child.stderr.on("data", (chunk) => { run.stderr = (run.stderr + chunk.toString("utf8")).slice(-2000); });
      child.on("error", (error) => finish({ phase: "error", text: `Could not start ${AGENTS[agent]}: ${error.message}` }));
      child.on("close", (code) => {
        if (code === 0 && run.lastMessage) finish({ phase: "done", text: run.lastMessage });
        else finish({ phase: "error", text: run.stderr.trim().split("\n").at(-1) || `${AGENTS[agent]} stopped (exit ${code}).` });
      });
      child.stdin.end(prompt);
      return { agent, project: baseName(project) };
    },
  };
}
