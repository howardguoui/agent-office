import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createApprovals, summarizeRequest } from "../companion/approvals.js";
import { askBroker } from "../companion/approval-client.js";
import { TRAITS, buildPersona, codexModels, createSettings, validateSettings, DEFAULTS } from "../companion/settings.js";
import { createBrokerServer } from "../broker/server.js";
import { createStateStore } from "../broker/state-store.js";

const dirStat = (dirs) => async (p) => { if (dirs.includes(p)) return { isDirectory: () => true }; throw new Error("ENOENT"); };
const project = process.platform === "win32" ? "E:\\ClaudeProject\\filings-rag" : "/home/howard/filings-rag";

test("settings validate choices, check the project folder exists and keep recent projects", async () => {
  const current = structuredClone(DEFAULTS);
  const statImpl = dirStat([project]);
  let { value, errors } = await validateSettings({ target: "claude", project, claudePermission: "acceptEdits", codexModel: "gpt-5.6-terra" }, current, { statImpl });
  assert.deepEqual(errors, []);
  assert.equal(value.target, "claude");
  assert.deepEqual(value.recentProjects, [project]);
  ({ errors } = await validateSettings({ target: "gemini", claudePermission: "yolo", codexModel: "rm -rf /" }, current, { statImpl }));
  assert.equal(errors.length, 3);
  ({ errors } = await validateSettings({ project: "relative/path" }, current, { statImpl }));
  assert.match(errors[0], /not found/);
  ({ errors } = await validateSettings({ target: "codex" }, current, { statImpl }));
  assert.match(errors[0], /Pick a project folder/);
  ({ value } = await validateSettings({ persona: { name: "  Hana  ", traits: ["shy", "nope", "nerdy"], notes: "Loves cats." } }, current, { statImpl }));
  assert.deepEqual(value.persona, { name: "Hana", traits: ["shy", "nerdy"], notes: "Loves cats." });
  // Walking around is opt-in: by default she stays where Howard puts her.
  assert.equal(DEFAULTS.roam, false);
  ({ value } = await validateSettings({ roam: 1 }, current, { statImpl }));
  assert.equal(value.roam, true);
});

test("the persona is built from name, traits and notes", () => {
  const persona = buildPersona({ name: "Hana", traits: ["tsundere", "nerdy"], notes: "Calls Howard 'boss'." });
  assert.equal(persona.name, "Hana");
  assert.match(persona.text, /^You are Hana/);
  assert.ok(persona.text.includes(TRAITS.tsundere));
  assert.match(persona.text, /Calls Howard 'boss'\./);
  assert.match(persona.text, /never code,\s+prompts or outputs/);
});

test("settings persist to disk", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "settings-"));
  const file = path.join(dir, "settings.json");
  const settings = createSettings({ file, statImpl: dirStat([project]) });
  assert.equal((await settings.update({ target: "codex", project, codexSandbox: "workspace-write" })).ok, true);
  const reloaded = createSettings({ file });
  await reloaded.load();
  assert.equal(reloaded.get().codexSandbox, "workspace-write");
  assert.equal(JSON.parse(await readFile(file, "utf8")).target, "codex");
});

test("lists only the Codex models the account offers", async () => {
  const read = async () => JSON.stringify({ models: [{ slug: "gpt-reserve", visibility: "hide" }, { slug: "gpt-5.6-terra", visibility: "list", display_name: "GPT-5.6-Terra" }] });
  assert.deepEqual(await codexModels({ home: "/h", read }), [{ slug: "gpt-5.6-terra", name: "GPT-5.6-Terra" }]);
  assert.deepEqual(await codexModels({ home: "/h", read: async () => { throw new Error("none"); } }), []);
});

test("approvals wait for Howard, allow with the original input, deny on timeout", async () => {
  const emitted = [];
  const approvals = createApprovals({ emit: (m) => emitted.push(m), timeoutMs: 50 });
  const pending = approvals.request({ toolName: "Bash", input: { command: "npm test" } });
  assert.equal(emitted[0].type, "approval");
  assert.equal(emitted[0].label, "Running npm test");
  assert.equal(emitted[0].command, "npm test");
  assert.equal(approvals.decide(emitted[0].id, true), true);
  assert.deepEqual(await pending, { behavior: "allow", updatedInput: { command: "npm test" } });
  const late = await approvals.request({ toolName: "Write", input: { file_path: "/x/a.txt" } });
  assert.equal(late.behavior, "deny");
  assert.deepEqual(summarizeRequest("Write", { file_path: "/x/a.txt", content: "SECRET" }), { tool: "Write", label: "Writing a.txt" });
});

test("the MCP side denies safely when the broker cannot be reached", async () => {
  const down = await askBroker({ toolName: "Bash", input: {} }, { url: "http://x", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.behavior, "deny");
  const weird = await askBroker({ toolName: "Bash", input: {} }, { url: "http://x", fetchImpl: async () => ({ ok: true, json: async () => ({ behavior: "sure" }) }) });
  assert.equal(weird.behavior, "deny");
});

test("broker routes: settings, chat goes to the selected agent, approval round trip", async () => {
  const runs = [];
  const settings = createSettings({ statImpl: dirStat([project]) });
  const approvals = createApprovals({});
  const runner = { busy: false, run: (text) => { runs.push(text); return { agent: "claude", project: "filings-rag" }; }, cancel: () => true, newConversation: () => {} };
  const companion = { observe: async () => null, snapshot: async () => ({}), chat: async (text) => ({ text: `Mira heard ${text}` }), noticeApp: async () => null };
  const broker = createBrokerServer({ host: "127.0.0.1", port: 0, store: createStateStore(), companion, controls: { settings, runner, approvals, codexModels: async () => [], traits: Object.keys(TRAITS) } });
  const { port } = await broker.start();
  const base = `http://127.0.0.1:${port}`;
  const json = (method, url, body) => fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(`${base}/companion/settings`)).json()).settings.target, "mira");
    assert.equal((await (await json("POST", "/companion/chat", { text: "hi" })).json()).line.text, "Mira heard hi");
    const bad = await json("PUT", "/companion/settings", { target: "claude" });
    assert.equal(bad.status, 400);
    assert.equal((await json("PUT", "/companion/settings", { target: "claude", project })).status, 200);
    const queued = await json("POST", "/companion/chat", { text: "fix the failing test" });
    assert.equal(queued.status, 202);
    assert.deepEqual(runs, ["fix the failing test"]);

    const answer = json("POST", "/companion/approval", { tool_name: "Bash", input: { command: "pytest -q" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [request] = (await (await fetch(`${base}/companion/settings`)).json()).approvals;
    assert.equal(request.label, "Running pytest");
    assert.equal((await json("POST", "/companion/approval/decide", { id: request.id, allow: false })).status, 200);
    assert.equal((await (await answer).json()).behavior, "deny");
    assert.equal((await json("POST", "/companion/approval/decide", { id: request.id, allow: true })).status, 404);
  } finally {
    await broker.close();
  }
});
