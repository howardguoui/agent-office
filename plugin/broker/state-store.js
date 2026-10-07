import { normalizeEvent } from "./event-normalizer.js";


const STATUS_BY_EVENT = {
  SessionStart: "idle",
  SubagentStart: "idle",
  PreToolUse: "working",
  PostToolUse: "idle",
  SubagentStop: "done",
  Stop: "done",
};

export function createStateStore({ maxEvents = 200, appendLog } = {}) {
  const agents = new Map();
  const events = [];
  const toolCounts = Object.create(null);

  function ensureAgent(event) {
    if (!agents.has(event.actorKey)) {
      agents.set(event.actorKey, {
        key: event.actorKey,
        source: event.source,
        sessionId: event.sessionId,
        agentId: event.agentId,
        status: "idle",
        currentTask: "",
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      });
    }
    return agents.get(event.actorKey);
  }

  async function apply(rawEvent) {
    const event = normalizeEvent(rawEvent);
    const agent = ensureAgent(event);
    const nextStatus = STATUS_BY_EVENT[event.eventName];
    if (nextStatus) agent.status = nextStatus;
    agent.updatedAt = event.timestamp;

    if (event.eventName === "PreToolUse") {
      agent.currentTask = event.toolName || "tool";
      const countKey = `${event.source}:${event.toolName || "unknown"}`;
      toolCounts[countKey] = (toolCounts[countKey] || 0) + 1;
    } else if (event.eventName === "PostToolUse") {
      agent.currentTask = "";
    } else if (event.eventName === "Stop") {
      for (const candidate of agents.values()) {
        if (
          candidate.source === event.source &&
          candidate.sessionId === event.sessionId
        ) {
          candidate.status = "done";
          candidate.currentTask = "";
          candidate.updatedAt = event.timestamp;
        }
      }
    }

    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    if (appendLog) {
      try {
        await appendLog(event);
      } catch {
        // Logging is best-effort; the activity stream must remain available.
      }
    }
    return event;
  }

  function snapshot() {
    return {
      agents: Array.from(agents.values(), (agent) => ({ ...agent })),
      events: events.map((event) => ({ ...event })),
      toolCounts: { ...toolCounts },
    };
  }

  return { apply, snapshot };
}

