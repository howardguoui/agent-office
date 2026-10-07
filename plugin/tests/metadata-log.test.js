import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMetadataLogger } from "../broker/metadata-log.js";


test("writes daily allowlisted metadata logs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-office-log-"));
  try {
    const logger = createMetadataLogger({ directory });
    await logger.append({
      timestamp: "2026-07-19T12:00:00.000Z",
      source: "codex",
      eventName: "PreToolUse",
      sessionId: "session",
      agentId: "main",
      actorKey: "codex:session:main",
      toolName: "shell_command",
      prompt: "RAW-PROMPT",
    });

    const content = await readFile(
      path.join(directory, "events-2026-07-19.jsonl"),
      "utf8",
    );
    const record = JSON.parse(content.trim());
    assert.equal(record.source, "codex");
    assert.equal(record.toolName, "shell_command");
    assert.equal("prompt" in record, false);
    assert.doesNotMatch(content, /RAW-PROMPT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

