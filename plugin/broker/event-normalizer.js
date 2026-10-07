const VALID_SOURCES = new Set(["claude", "codex", "unknown"]);

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
  if (searchable.includes("claude") || rawEvent.prompt_id) return "claude";
  return "unknown";
}

export function normalizeEvent(rawEvent, now = new Date()) {
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new TypeError("Hook event must be an object");
  }

  const source = inferSource(rawEvent);
  const eventName = boundedString(
    rawEvent.hook_event_name ?? rawEvent.event_name ?? rawEvent.event,
    "Unknown",
    64,
  );
  const sessionId = boundedString(
    rawEvent.session_id ?? rawEvent.sessionId ?? rawEvent.conversation_id,
    "default",
  );
  const agentId = boundedString(
    rawEvent.agent_id ?? rawEvent.agentId ?? rawEvent.subagent_id,
    "main",
  );
  const toolName = boundedString(
    rawEvent.tool_name ?? rawEvent.toolName,
    "",
    128,
  );

  return {
    timestamp: now.toISOString(),
    source,
    eventName,
    sessionId,
    agentId,
    actorKey: `${source}:${sessionId}:${agentId}`,
    ...(toolName ? { toolName } : {}),
    ...(typeof rawEvent.success === "boolean"
      ? { success: rawEvent.success }
      : {}),
  };
}

