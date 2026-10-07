// Permission requests from Claude Code, answered in the companion's bubble.
// Claude Code calls the MCP tool in approval-mcp.js, which posts here and waits; the overlay shows the
// request with Allow / Deny and posts the answer back. Requests are kept in memory only.

import { describeTool } from "./agents.js";

export function summarizeRequest(toolName, input = {}) {
  const command = typeof input.command === "string" ? input.command : Array.isArray(input.command) ? input.command.join(" ") : "";
  return {
    tool: String(toolName || "tool").slice(0, 80),
    label: describeTool(String(toolName || "tool"), input),
    // Show the exact command so Howard knows what he is approving (displayed live, never stored).
    ...(command ? { command: command.slice(0, 300) } : {}),
  };
}

export function createApprovals({ emit = () => {}, timeoutMs = 10 * 60_000, now = () => Date.now() } = {}) {
  const pending = new Map();
  let counter = 0;

  function settle(id, decision) {
    const entry = pending.get(id);
    if (!entry) return false;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(decision);
    emit({ type: "approval_closed", id, allowed: decision.behavior === "allow" });
    return true;
  }

  return {
    /** Resolves to Claude Code's permission-prompt result: { behavior: "allow", updatedInput } or { behavior: "deny", message }. */
    request({ toolName, input = {}, agent = "claude" }) {
      counter += 1;
      const id = `${now().toString(36)}-${counter}`;
      const summary = summarizeRequest(toolName, input);
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(id, { behavior: "deny", message: "No answer from Howard in time." }), timeoutMs);
        pending.set(id, { resolve, timer, input, request: { id, agent, ...summary } });
        emit({ type: "approval", id, agent, ...summary });
      });
    },
    decide(id, allow) {
      const entry = pending.get(id);
      if (!entry) return false;
      return settle(id, allow ? { behavior: "allow", updatedInput: entry.input } : { behavior: "deny", message: "Howard said no." });
    },
    denyAll(message = "Cancelled.") {
      for (const id of [...pending.keys()]) settle(id, { behavior: "deny", message });
    },
    list() {
      return [...pending.values()].map((entry) => entry.request);
    },
  };
}
