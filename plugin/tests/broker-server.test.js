import test from "node:test";
import assert from "node:assert/strict";

import { createBrokerServer } from "../broker/server.js";
import { createStateStore } from "../broker/state-store.js";


async function withServer(run, { openSidebar = async () => {} } = {}) {
  const store = createStateStore();
  const broker = createBrokerServer({
    host: "127.0.0.1",
    port: 0,
    store,
    openSidebar,
  });
  const address = await broker.start();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await broker.close();
  }
}

test("exposes health and accepts a tagged event", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const accepted = await fetch(`${baseUrl}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "codex",
        hook_event_name: "SessionStart",
        session_id: "integration-session",
      }),
    });
    assert.equal(accepted.status, 202);

    const state = await (await fetch(`${baseUrl}/state`)).json();
    assert.equal(state.agents.length, 1);
    assert.equal(state.agents[0].source, "codex");
  });
});

test("reopens the sidebar when a session starts", async () => {
  let openCount = 0;
  await withServer(
    async (baseUrl) => {
      const accepted = await fetch(`${baseUrl}/event`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "codex",
          hook_event_name: "SessionStart",
          session_id: "visible-session",
        }),
      });

      assert.equal(accepted.status, 202);
      assert.equal(openCount, 1);
    },
    { openSidebar: async () => { openCount += 1; } },
  );
});

test("rejects malformed JSON without terminating the broker", async () => {
  await withServer(async (baseUrl) => {
    const malformed = await fetch(`${baseUrl}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
  });
});

test("rejects oversized event bodies", async () => {
  await withServer(async (baseUrl) => {
    const oversized = await fetch(`${baseUrl}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(140_000) }),
    });
    assert.equal(oversized.status, 413);
  });
});
