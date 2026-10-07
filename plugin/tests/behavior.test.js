import test from "node:test";
import assert from "node:assert/strict";

import { createBody, drop, landingSurface, startDrag, step, surfacesFrom } from "../companion/overlay/behavior.js";

const world = { width: 2560, height: 1392 };
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

function run(body, seconds, w) {
  const events = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...step(body, 1 / 60, w));
  return events;
}

test("window tops become surfaces, minus parts hidden by windows above", () => {
  const surfaces = surfacesFrom([
    { id: 1, x: 300, y: 200, w: 800, h: 600, app: "chrome", foreground: true },
    { id: 2, x: 900, y: 400, w: 700, h: 500, app: "code" }, // left part covered by window 1
    { id: 3, x: 400, y: 300, w: 500, h: 300, app: "explorer" }, // entirely under window 1
    { id: 4, x: 0, y: 500, w: 100, h: 50, app: "tiny" }, // too small
    { id: 5, x: 1700, y: 300, w: 500, h: 400, app: "notepad", minimized: true },
  ], world);
  assert.deepEqual(surfaces.map((s) => [s.id, s.x1, s.x2, s.y]), [["floor", 0, 2560, 1392], ["1", 300, 1100, 200], ["2", 1100, 1600, 400]]);
  assert.equal(landingSurface(surfaces, 1200, 100).id, "2");
  assert.equal(landingSurface(surfaces, 500, 100).id, "1");
  assert.equal(landingSurface(surfaces, 2000, 100).id, "floor");
});

test("wanders along the floor and stops at her target", () => {
  const body = createBody(world, { x: 1000, random: seq(0, 0.5, 0.5) });
  const surfaces = surfacesFrom([], world);
  run(body, 0.1, { ...world, surfaces });
  body.timer = 0;
  step(body, 1 / 60, { ...world, surfaces });
  assert.equal(body.mode, "walk");
  const target = body.targetX;
  run(body, 15, { ...world, surfaces });
  assert.ok(Math.abs(body.x - target) < 1);
  assert.equal(body.y, world.height);
});

test("hops onto a window that comes to the front, including a high one", () => {
  const body = createBody(world, { x: 2200, random: () => 0.5 });
  const surfaces = surfacesFrom([{ id: 7, x: 400, y: 150, w: 900, h: 700, app: "code", foreground: true }], world);
  const events = step(body, 1 / 60, { ...world, surfaces, foregroundChanged: true });
  assert.deepEqual(events, [{ type: "visit", app: "code" }]);
  assert.equal(body.mode, "jump");
  const landed = run(body, 3, { ...world, surfaces });
  assert.equal(body.surface, "7");
  assert.equal(body.y, 150);
  assert.ok(body.x >= 400 && body.x <= 1300);
  assert.equal(landed.find((e) => e.type === "landed").surface.id, "7");
});

test("rides a window she sits on and falls when it closes", () => {
  const body = createBody(world, { x: 700, random: () => 0.9 });
  body.surface = "7";
  body.y = 300;
  let surfaces = surfacesFrom([{ id: 7, x: 400, y: 300, w: 900, h: 700, app: "code" }], world);
  step(body, 1 / 60, { ...world, surfaces });
  surfaces = surfacesFrom([{ id: 7, x: 400, y: 260, w: 900, h: 700, app: "code" }], world);
  step(body, 1 / 60, { ...world, surfaces });
  assert.equal(body.y, 260);
  surfaces = surfacesFrom([], world);
  step(body, 1 / 60, { ...world, surfaces });
  assert.equal(body.mode, "fall");
  run(body, 2, { ...world, surfaces });
  assert.equal(body.surface, "floor");
  assert.equal(body.y, world.height);
});

test("can be dragged and dropped onto a window below the pointer", () => {
  const body = createBody(world, { x: 500 });
  const surfaces = surfacesFrom([{ id: 3, x: 1000, y: 700, w: 800, h: 500, app: "chrome" }], world);
  startDrag(body);
  step(body, 1 / 60, { ...world, surfaces, pointer: { x: 1400, y: 300 } });
  assert.deepEqual([body.x, body.y], [1400, 300]);
  drop(body, 0);
  run(body, 2, { ...world, surfaces });
  assert.equal(body.surface, "3");
  assert.equal(body.y, 700);
});

test("stays put while an agent is working or she is sleepy", () => {
  const body = createBody(world, { x: 900, random: () => 0.1 });
  const surfaces = surfacesFrom([], world);
  step(body, 1 / 60, { ...world, surfaces, busy: true });
  assert.equal(body.mode, "stay");
  run(body, 10, { ...world, surfaces, busy: true });
  assert.equal(body.x, 900);
  step(body, 1 / 60, { ...world, surfaces });
  assert.equal(body.mode, "idle");
});
