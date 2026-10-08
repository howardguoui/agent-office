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

test("passes events to the companion without waiting for it, and serves her routes", async () => {
  const observed = [];
  let release;
  const companion = {
    observe: (event) => { observed.push(event); return new Promise((resolve) => { release = resolve; }); },
    snapshot: async () => ({ name: "Mira", mood: "focused" }),
    chat: async (text) => ({ kind: "chat", text: `you said ${text}` }),
    noticeApp: async (app) => { observed.push({ app }); return null; },
  };
  const broker = createBrokerServer({ host: "127.0.0.1", port: 0, store: createStateStore(), companion });
  const { port } = await broker.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    const accepted = await fetch(`${base}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "claude", hook_event_name: "PreToolUse", session_id: "s", tool_name: "Bash", tool_input: { command: "git push --force" } }),
    });
    assert.equal(accepted.status, 202); // answered while observe() is still pending
    assert.equal(observed[0].context.program, "git push");
    release();

    assert.deepEqual(await (await fetch(`${base}/companion`)).json(), { name: "Mira", mood: "focused" });
    const reply = await fetch(`${base}/companion/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal((await reply.json()).line.text, "you said hello");
    const plain = await fetch(`${base}/companion/chat`, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" });
    assert.equal(plain.status, 415); // a web page cannot post here without a CORS preflight, which is refused
    const empty = await fetch(`${base}/companion/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(empty.status, 400);
    const notice = await fetch(`${base}/companion/notice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "app", app: "chrome" }) });
    assert.equal(notice.status, 202);
    assert.deepEqual(observed.at(-1), { app: "chrome" });
    const bad = await fetch(`${base}/companion/notice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "title", text: "secret" }) });
    assert.equal(bad.status, 400);
  } finally {
    await broker.close();
  }
});

test("broadcasts companion messages to WebSocket clients", async () => {
  const broker = createBrokerServer({ host: "127.0.0.1", port: 0, store: createStateStore() });
  const { port } = await broker.start();
  try {
    const { WebSocket } = await import("ws");
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages = [];
    await new Promise((resolve) => client.on("message", (data) => { messages.push(JSON.parse(data)); if (messages.length === 1) resolve(); }));
    const next = new Promise((resolve) => client.on("message", (data) => resolve(JSON.parse(data))));
    broker.broadcast({ type: "companion", data: { type: "say", text: "hi" } });
    assert.deepEqual(await next, { type: "companion", data: { type: "say", text: "hi" } });
    assert.equal(messages[0].type, "state");
    client.close();
  } finally {
    await broker.close();
  }
});

test("serves the companion overlay, its script and only the vendored libraries", async () => {
  const broker = createBrokerServer({ host: "127.0.0.1", port: 0, store: createStateStore() });
  const { port } = await broker.start();
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await fetch(`${base}/companion/overlay`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https:\/\/cubism\.live2d\.com/);
    assert.match(await page.text(), /<canvas id="stage">/);
    assert.match(await (await fetch(`${base}/companion/app.js`)).text(), /Live2DModel\.from/);
    assert.match(await (await fetch(`${base}/companion/behavior.js`)).text(), /export function step/);
    assert.match(await (await fetch(`${base}/companion/gait.js`)).text(), /export function walkPose/);
    assert.equal((await fetch(`${base}/companion/server.js`)).status, 404);
    for (const [file, minBytes] of [["pixi.min.js", 100_000], ["unsafe-eval.min.js", 1_000], ["cubism4.min.js", 100_000]]) {
      const lib = await fetch(`${base}/companion/vendor/${file}`);
      assert.equal(lib.status, 200, file);
      assert.ok((await lib.arrayBuffer()).byteLength > minBytes, file);
    }
    assert.equal((await fetch(`${base}/companion/vendor/../../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/companion/vendor/index.js`)).status, 404);
  } finally {
    await broker.close();
  }
});
