// Forwards one Claude Code permission request to the local broker and waits for Howard's answer.

export async function askBroker({ toolName, input }, { url, fetchImpl = fetch, timeoutMs = 11 * 60_000 } = {}) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool_name: toolName, input }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const decision = await response.json();
    if (decision?.behavior === "allow" || decision?.behavior === "deny") return decision;
    throw new Error("unexpected answer");
  } catch (error) {
    return { behavior: "deny", message: `Could not reach the companion to ask Howard (${error.message}).` };
  }
}
