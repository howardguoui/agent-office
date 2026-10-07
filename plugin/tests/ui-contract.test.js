import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";


const UI_PATH = new URL("../sidebar/index.html", import.meta.url);

test("sidebar consumes broker state snapshots over the dedicated WebSocket path", async () => {
  const html = await readFile(UI_PATH, "utf8");
  assert.match(html, /new WebSocket\(`ws:\/\/\$\{window\.location\.host\}\/ws`\)/);
  assert.match(html, /ev\.type === ['"]state['"]/);
});

test("sidebar exposes All, Claude, and Codex source filters and badges", async () => {
  const html = await readFile(UI_PATH, "utf8");
  assert.match(html, />All<\/button>/);
  assert.match(html, />Claude<\/button>/);
  assert.match(html, />Codex<\/button>/);
  assert.match(html, /source-badge/);
});

test("empty state names both supported hosts", async () => {
  const html = await readFile(UI_PATH, "utf8");
  assert.match(html, /Claude Code or Codex/);
});

