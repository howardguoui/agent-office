import test from "node:test";
import assert from "node:assert/strict";

import { ensureBroker } from "../broker/client.js";


test("does not spawn when the singleton broker is already healthy", async () => {
  let spawns = 0;
  await ensureBroker({
    healthCheck: async () => true,
    spawnBroker: () => {
      spawns += 1;
    },
  });
  assert.equal(spawns, 0);
});

test("spawns once and waits for broker health", async () => {
  let checks = 0;
  let spawns = 0;
  await ensureBroker({
    healthCheck: async () => {
      checks += 1;
      return checks >= 3;
    },
    spawnBroker: () => {
      spawns += 1;
    },
    delay: async () => {},
    attempts: 4,
  });
  assert.equal(spawns, 1);
  assert.equal(checks, 3);
});

test("reports when a spawned broker never becomes healthy", async () => {
  await assert.rejects(
    ensureBroker({
      healthCheck: async () => false,
      spawnBroker: () => {},
      delay: async () => {},
      attempts: 2,
    }),
    /did not become healthy/,
  );
});

