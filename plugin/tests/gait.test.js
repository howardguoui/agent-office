import test from "node:test";
import assert from "node:assert/strict";

import { approach, STEPS_PER_SECOND, stepIndex, walkPose } from "../companion/overlay/gait.js";

test("each step is a hop that lands with a squash, and the waddle alternates sides", () => {
  const stepTime = 1 / STEPS_PER_SECOND;
  const landing = walkPose(stepTime); // a footfall
  const midStep = walkPose(stepTime * 1.5);
  assert.ok(landing.lift < 0.01 && landing.squash > 0.06);
  assert.ok(midStep.lift > 17 && midStep.squash < 0); // stretched in the air
  // Leans into the walk, waddling either side of the lean.
  assert.ok(walkPose(stepTime * 0.5).rotation > walkPose(stepTime * 1.5).rotation);
  assert.ok(walkPose(stepTime * 1.5, 1, 1).rotation > 0 && walkPose(stepTime * 0.5, 1, -1).rotation < 0);
  // Arms swing against the robe (the legs underneath).
  const pose = walkPose(stepTime * 0.5);
  assert.ok(pose.robeL > 0 && pose.armL < 0 && pose.armR > 0);
});

test("the pose fades with amount, so stopping and starting never snaps", () => {
  const still = walkPose(0.3, 0);
  for (const value of Object.values(still)) assert.equal(Math.abs(value), 0);
  assert.ok(Math.abs(walkPose(0.3, 0.5).rotation - walkPose(0.3).rotation / 2) < 1e-9);
  assert.equal(approach(0, 1, 5, 0.1), 0.5);
  assert.equal(approach(0.9, 1, 5, 0.1), 1);
  assert.equal(stepIndex(1 / STEPS_PER_SECOND + 0.001), 1);
});
