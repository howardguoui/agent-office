const VALID_SOURCES = new Set(["claude", "codex", "gemini", "unknown"]);

// Gemini CLI names its hooks differently; map them onto the Claude/Codex names the rest of the broker uses.
const GEMINI_EVENTS = {
  BeforeTool: "PreToolUse",
  AfterTool: "PostToolUse",
  BeforeAgent: "UserPromptSubmit",
  AfterAgent: "Stop",
};

// Notification types that mean "an agent is waiting for the person": Claude Code's permission_prompt,
// Gemini CLI's ToolPermission. Claude Code's idle_prompt means it finished and waits for the next prompt.
const PERMISSION_NOTIFICATIONS = new Set(["permission_prompt", "toolpermission"]);
const IDLE_NOTIFICATIONS = new Set(["idle_prompt"]);

const FILE_TOOLS = new Set([
  "Read", "Write", "Edit", "MultiEdit", "NotebookEdit",
  "read_file", "write_file", "replace", "read_many_files",
]);
const SHELL_TOOLS = new Set(["Bash", "shell", "shell_command", "local_shell", "run_shell_command", "exec_command"]);
const PATCH_TOOLS = new Set(["apply_patch"]);
const WEB_TOOLS = new Set(["WebFetch", "web_fetch"]);
// Programs whose first argument is a harmless subcommand worth knowing ("git commit", "npm test").
const SUBCOMMAND_PROGRAMS = new Set([
  "git", "npm", "pnpm", "yarn", "npx", "uv", "pip", "docker", "cargo", "go", "dotnet", "gh", "make", "bun",
]);

function boundedString(value, fallback, maxLength = 256) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).slice(0, maxLength);
}

function inferSource(rawEvent) {
  const declared = String(rawEvent.source ?? "").toLowerCase();
  if (VALID_SOURCES.has(declared)) return declared;

  const searchable = [
    rawEvent.client_name,
    rawEvent.transcript_path,
    rawEvent.cwd,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (searchable.includes("codex") || rawEvent.turn_id) return "codex";
  if (searchable.includes("gemini")) return "gemini";
  if (searchable.includes("claude") || rawEvent.prompt_id) return "claude";
  return "unknown";
}

export function baseName(value, maxLength = 64) {
  if (typeof value !== "string" || !value.trim()) return "";
  const parts = value.trim().replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1].slice(0, maxLength);
}

function commandString(command) {
  if (Array.isArray(command)) {
    // Codex sends argv arrays such as ["bash", "-lc", "npm test"]; the script is the last element then.
    const strings = command.filter((part) => typeof part === "string");
    const shellFlag = strings.findIndex((part) => /^-l?c$/.test(part));
    return shellFlag >= 0 ? strings.slice(shellFlag + 1).join(" ") : strings.join(" ");
  }
  return typeof command === "string" ? command : "";
}

/** The program a shell command runs, plus a subcommand for well-known tools. Never any other argument. */
export function programOf(command) {
  const segments = commandString(command)
    .split(/&&|\|\||;|\|/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const segment = segments.find((candidate) => !/^(cd|pushd|set|export)\b/i.test(candidate)) || "";
  const tokens = segment.split(/\s+/).filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  if (!tokens.length) return "";
  const program = baseName(tokens[0].replace(/^["']|["']$/g, ""), 32).replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase();
  if (!/^[a-z0-9._+-]+$/.test(program)) return "";
  if (/^(python|python3|py)$/.test(program) && tokens[1] === "-m" && /^[a-z0-9_.]+$/i.test(tokens[2] || "")) {
    return `${program} -m ${tokens[2].toLowerCase()}`.slice(0, 40);
  }
  const subcommand = tokens[1] || "";
  if (SUBCOMMAND_PROGRAMS.has(program) && /^[a-z][a-z0-9:-]*$/.test(subcommand)) {
    return `${program} ${subcommand}`.slice(0, 40);
  }
  return program;
}

function patchTargets(patch) {
  if (typeof patch !== "string") return [];
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => baseName(match[1]));
}

function hostOf(url) {
  try {
    return new URL(String(url)).hostname.slice(0, 64);
  } catch {
    return "";
  }
}

function failed(rawEvent, eventName) {
  if (eventName === "PostToolUseFailure" || rawEvent.success === false) return true;
  const response = rawEvent.tool_response;
  if (response && typeof response === "object") {
    const code = response.exit_code ?? response.exitCode;
    if (typeof code === "number" && code !== 0) return true;
    if (response.success === false || response.is_error === true) return true;
  }
  return false;
}

/**
 * A short, privacy-preserving description of what happened, for the companion: project folder name,
 * file names, the program a command ran, a web host. Never prompts, arguments, file contents or outputs.
 */
export function contextOf(rawEvent, eventName, toolName) {
  const context = {};
  const project = baseName(rawEvent.cwd);
  if (project) context.project = project;
  const input = rawEvent.tool_input && typeof rawEvent.tool_input === "object" ? rawEvent.tool_input : {};

  if (FILE_TOOLS.has(toolName)) {
    const paths = [input.file_path, input.path, input.notebook_path, input.absolute_path]
      .concat(Array.isArray(input.paths) ? input.paths : [])
      .map((value) => baseName(value))
      .filter(Boolean);
    if (paths.length) context.target = paths.slice(0, 3).join(", ");
  } else if (SHELL_TOOLS.has(toolName)) {
    const program = programOf(input.command ?? input.cmd);
    if (program) context.program = program;
  } else if (PATCH_TOOLS.has(toolName)) {
    const targets = patchTargets(input.input ?? input.patch ?? input.command);
    if (targets.length) context.target = targets.slice(0, 3).join(", ");
  } else if (WEB_TOOLS.has(toolName)) {
    const host = hostOf(input.url);
    if (host) context.host = host;
  }

  if ((eventName === "PostToolUse" || eventName === "PostToolUseFailure") && failed(rawEvent, eventName)) {
    context.failed = true;
  }
  return context;
}

function canonicalEvent(source, rawName, rawEvent) {
  let name = source === "gemini" && GEMINI_EVENTS[rawName] ? GEMINI_EVENTS[rawName] : rawName;
  if (name === "Notification") {
    const type = String(rawEvent.notification_type ?? "").toLowerCase();
    if (PERMISSION_NOTIFICATIONS.has(type)) name = "PermissionRequest";
    else if (IDLE_NOTIFICATIONS.has(type)) name = "Idle";
  }
  return name;
}

export function normalizeEvent(rawEvent, now = new Date()) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new TypeError("Hook event must be an object");
  }

  const source = inferSource(rawEvent);
  const hostEvent = boundedString(
    rawEvent.hook_event_name ?? rawEvent.event_name ?? rawEvent.event,
    "Unknown",
    64,
  );
  const eventName = canonicalEvent(source, hostEvent, rawEvent);
  const sessionId = boundedString(
    rawEvent.session_id ?? rawEvent.sessionId ?? rawEvent.conversation_id,
    "default",
  );
  const agentId = boundedString(
    rawEvent.agent_id ?? rawEvent.agentId ?? rawEvent.subagent_id,
    "main",
  );
  const toolName = boundedString(
    rawEvent.tool_name ?? rawEvent.toolName ?? rawEvent.details?.tool_name,
    "",
    128,
  );
  const context = contextOf(rawEvent, eventName, toolName);

  return {
    timestamp: now.toISOString(),
    source,
    eventName,
    ...(hostEvent !== eventName ? { hostEvent } : {}),
    sessionId,
    agentId,
    actorKey: `${source}:${sessionId}:${agentId}`,
    ...(toolName ? { toolName } : {}),
    ...(typeof rawEvent.success === "boolean"
      ? { success: rawEvent.success }
      : {}),
    ...(Object.keys(context).length ? { context } : {}),
  };
}
