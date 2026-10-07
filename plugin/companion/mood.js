// What the companion feels and notices, derived from normalized broker events. Pure functions, no I/O.

export const MOODS = ["idle", "curious", "focused", "worried", "alert", "happy", "sleepy"];

export const SLEEPY_AFTER_MS = 10 * 60_000;

const AGENT_NAMES = { claude: "Claude", codex: "Codex", gemini: "Gemini", unknown: "an agent" };
export const agentName = (source) => AGENT_NAMES[source] || "an agent";

/** Running summary of one agent session, built from metadata only. */
export function emptyDigest(event) {
  return {
    source: event.source,
    sessionId: event.sessionId,
    project: event.context?.project || "",
    startedAt: event.timestamp,
    lastAt: event.timestamp,
    turns: 0,
    toolCalls: 0,
    failures: 0,
    tools: {},
    files: [],
    programs: [],
    hosts: [],
    waits: 0,
  };
}

function remember(list, value, max = 12) {
  if (value && !list.includes(value)) list.push(value);
  if (list.length > max) list.shift();
}

export function updateDigest(digest, event) {
  const next = {
    ...digest,
    tools: { ...digest.tools },
    files: [...digest.files],
    programs: [...digest.programs],
    hosts: [...digest.hosts],
  };
  next.lastAt = event.timestamp;
  if (!next.project && event.context?.project) next.project = event.context.project;
  if (event.eventName === "UserPromptSubmit") next.turns += 1;
  if (event.eventName === "PreToolUse") {
    next.toolCalls += 1;
    if (event.toolName) next.tools[event.toolName] = (next.tools[event.toolName] || 0) + 1;
    for (const file of String(event.context?.target || "").split(", ")) remember(next.files, file);
    remember(next.programs, event.context?.program);
    remember(next.hosts, event.context?.host);
  }
  if (event.context?.failed) next.failures += 1;
  if (event.eventName === "PermissionRequest") next.waits += 1;
  return next;
}

/** One line a model can read: what happened in a session, names only. */
export function describeDigest(digest) {
  const minutes = Math.max(1, Math.round((Date.parse(digest.lastAt) - Date.parse(digest.startedAt)) / 60_000));
  const topTools = Object.entries(digest.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([tool, count]) => `${tool} x${count}`)
    .join(", ");
  return [
    `${agentName(digest.source)} session${digest.project ? ` in ${digest.project}` : ""}, about ${minutes} min`,
    digest.turns ? `${digest.turns} prompt(s)` : "",
    digest.toolCalls ? `${digest.toolCalls} tool calls (${topTools})` : "no tool calls",
    digest.files.length ? `files: ${digest.files.slice(-6).join(", ")}` : "",
    digest.programs.length ? `ran: ${digest.programs.slice(-5).join(", ")}` : "",
    digest.failures ? `${digest.failures} failed step(s)` : "no failures",
    digest.waits ? `waited for approval ${digest.waits} time(s)` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Mood after an event, and whether it is a moment worth speaking about.
 * moment: { kind, line } where line is a plain-language description for the model.
 */
export function react(state, event) {
  const who = agentName(event.source);
  const where = event.context?.project ? ` in ${event.context.project}` : "";
  const what = event.context?.target || event.context?.program || event.context?.host || event.toolName || "";
  const digest = state.digests[`${event.source}:${event.sessionId}`];

  switch (event.eventName) {
    case "SessionStart":
      return { mood: "curious", moment: { kind: "session_start", line: `${who} just started a session${where}.` } };
    case "UserPromptSubmit":
      return { mood: "focused", moment: null };
    case "PreToolUse":
      return { mood: state.mood === "worried" ? "worried" : "focused", moment: null };
    case "PostToolUse":
    case "PostToolUseFailure":
      if (event.context?.failed) {
        const streak = (state.failStreak || 0) + 1;
        return {
          mood: "worried",
          failStreak: streak,
          moment: streak === 1 || streak === 3
            ? { kind: "failure", line: `${who}'s ${event.toolName || "step"}${what && what !== event.toolName ? ` (${what})` : ""} just failed${where}${streak > 1 ? `, ${streak} failures in a row` : ""}.` }
            : null,
        };
      }
      return { mood: "focused", failStreak: 0, moment: null };
    case "PermissionRequest":
      return {
        mood: "alert",
        moment: { kind: "waiting", line: `${who} is waiting for Howard's approval${event.toolName ? ` to use ${event.toolName}` : ""}${where}.` },
      };
    case "Stop":
    case "Idle": {
      const busy = digest && (digest.toolCalls >= 3 || Date.parse(event.timestamp) - Date.parse(digest.startedAt) > 60_000);
      return {
        mood: "happy",
        failStreak: 0,
        moment: busy && event.eventName === "Stop"
          ? { kind: "done", line: `${who} finished its turn${where}. So far: ${describeDigest(digest)}.` }
          : null,
      };
    }
    case "SubagentStart":
      return { mood: "focused", moment: null };
    case "SessionEnd":
      return { mood: "idle", moment: null };
    default:
      return { mood: state.mood, moment: null };
  }
}
