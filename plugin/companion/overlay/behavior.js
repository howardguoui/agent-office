// Where the companion walks. Pure logic, no DOM or Electron, so it can be tested in Node.
//
// The world is the desktop work area: a floor (the top of the taskbar) plus the top edges of open windows,
// which she can stand and sit on. Coordinates are CSS pixels with the origin at the work area's top left;
// `y` is the line her feet touch.

export const SPEED = 110; // px/s walking
export const GRAVITY = 2600; // px/s^2
const JUMP_TIME = 0.75; // seconds for a hop between surfaces

/** Turn window rectangles (top-most first) into standable surfaces, dropping edges hidden by windows above. */
export function surfacesFrom(windows, world) {
  const surfaces = [{ id: "floor", x1: 0, x2: world.width, y: world.height, app: "" }];
  const visible = windows.filter((w) => !w.minimized && w.w > 160 && w.h > 80 && w.y > 120 && w.y < world.height - 60);
  visible.forEach((win, index) => {
    const above = visible.slice(0, index);
    let x1 = Math.max(0, win.x);
    let x2 = Math.min(world.width, win.x + win.w);
    for (const cover of above) {
      const covers = cover.y <= win.y && cover.y + cover.h >= win.y;
      if (!covers) continue;
      if (cover.x <= x1 && cover.x + cover.w >= x2) { x2 = x1; break; }
      if (cover.x <= x1 && cover.x + cover.w > x1) x1 = cover.x + cover.w;
      else if (cover.x < x2 && cover.x + cover.w >= x2) x2 = cover.x;
    }
    if (x2 - x1 >= 120) surfaces.push({ id: String(win.id), x1, x2, y: win.y, app: win.app || "", foreground: Boolean(win.foreground) });
  });
  return surfaces;
}

/** The highest surface at x whose top is at or below y (where she lands when falling). */
export function landingSurface(surfaces, x, y) {
  return surfaces
    .filter((s) => x >= s.x1 && x <= s.x2 && s.y >= y - 1)
    .sort((a, b) => a.y - b.y)[0] || surfaces.find((s) => s.id === "floor");
}

export function createBody(world, { x = world.width - 220, random = Math.random } = {}) {
  return {
    x,
    y: world.height,
    vx: 0,
    vy: 0,
    facing: -1,
    mode: "idle", // idle | walk | jump | fall | drag | stay
    surface: "floor",
    surfaceOffset: 0,
    targetX: x,
    targetSurface: null,
    jump: null,
    timer: 2 + random() * 3,
    random,
  };
}

function goTo(body, surface, x) {
  const clamped = Math.min(surface.x2 - 40, Math.max(surface.x1 + 40, x));
  if (surface.id === body.surface) {
    body.mode = "walk";
    body.targetX = clamped;
    body.facing = clamped >= body.x ? 1 : -1;
    return;
  }
  // Hop: a parabola from here to the target point, timed to land in JUMP_TIME.
  const dx = clamped - body.x;
  const dy = surface.y - body.y;
  // Long enough that she is already coming down when she reaches a higher ledge.
  const time = Math.max(JUMP_TIME, Math.sqrt((2 * Math.max(0, -dy)) / GRAVITY) * 1.3);
  body.mode = "jump";
  body.facing = dx >= 0 ? 1 : -1;
  body.jump = { surface: surface.id };
  body.vx = dx / time;
  body.vy = dy / time - (GRAVITY * time) / 2;
}

/**
 * Advance the body by dt seconds. `world` = { width, height, surfaces, pointer, foregroundChanged, busy, sleepy, hold }.
 * `hold` means Howard is using one of her panels (chat, settings, a card): she stops where she is.
 * Returns events such as { type: "landed", surface } or { type: "visit", app } for the caller to react to.
 */
export function step(body, dt, world) {
  const events = [];
  const surfaces = world.surfaces;
  const byId = (id) => surfaces.find((s) => s.id === id);
  let current = byId(body.surface);

  if (body.mode === "drag") {
    body.x = world.pointer.x;
    body.y = world.pointer.y;
    return events;
  }

  // The window she stands on moved or closed: ride along, or fall.
  if (["idle", "walk", "stay"].includes(body.mode)) {
    if (!current) {
      body.mode = "fall";
      body.vy = 0;
    } else {
      if (current.id !== "floor") {
        if (Math.abs(current.y - body.y) > 2) body.y = current.y;
        if (body.x < current.x1 || body.x > current.x2) {
          body.mode = "fall";
          body.vy = 0;
        }
      } else {
        body.y = current.y;
      }
    }
  }

  switch (body.mode) {
    case "walk": {
      if (world.hold) { body.mode = "stay"; break; }
      const dir = Math.sign(body.targetX - body.x);
      body.facing = dir || body.facing;
      body.x += dir * Math.min(SPEED * dt, Math.abs(body.targetX - body.x));
      if (Math.abs(body.targetX - body.x) < 1) {
        body.mode = "idle";
        body.timer = 2 + body.random() * 5;
      }
      break;
    }
    case "jump":
    case "fall": {
      body.vy += GRAVITY * dt;
      body.x += body.vx * dt;
      const nextY = body.y + body.vy * dt;
      if (body.vy > 0) {
        const target = body.mode === "jump" ? byId(body.jump.surface) : null;
        const landing = target && body.x >= target.x1 && body.x <= target.x2 && nextY >= target.y && body.y <= target.y + 1
          ? target
          : surfaces.filter((s) => body.x >= s.x1 && body.x <= s.x2 && s.y >= body.y - 1 && s.y <= nextY).sort((a, b) => a.y - b.y)[0];
        if (landing) {
          body.y = landing.y;
          body.vx = 0;
          body.vy = 0;
          body.surface = landing.id;
          body.mode = world.busy || world.sleepy || world.hold ? "stay" : "idle";
          body.timer = 1.5 + body.random() * 3;
          body.jump = null;
          events.push({ type: "landed", surface: landing });
          break;
        }
      }
      body.y = Math.min(nextY, world.height);
      if (body.y >= world.height) {
        body.y = world.height;
        body.surface = "floor";
        body.vx = 0;
        body.vy = 0;
        body.mode = "idle";
        body.jump = null;
      }
      break;
    }
    case "stay":
      if (!world.busy && !world.sleepy && !world.hold) body.mode = "idle";
      break;
    case "idle": {
      if (world.busy || world.sleepy || world.hold) { body.mode = "stay"; break; }
      body.timer -= dt;
      const fg = world.foregroundChanged && surfaces.find((s) => s.foreground && s.id !== "floor");
      if (fg) {
        // Curious: go and sit on the window that just came to the front.
        goTo(body, fg, fg.x1 + 60 + body.random() * Math.max(10, fg.x2 - fg.x1 - 120));
        events.push({ type: "visit", app: fg.app });
        break;
      }
      if (body.timer <= 0) {
        current = byId(body.surface) || byId("floor");
        const roll = body.random();
        const others = surfaces.filter((s) => s.id !== body.surface);
        if (roll < 0.25 && others.length) {
          const pick = others[Math.floor(body.random() * others.length)];
          goTo(body, pick, pick.x1 + body.random() * (pick.x2 - pick.x1));
        } else if (roll < 0.8) {
          goTo(body, current, current.x1 + body.random() * (current.x2 - current.x1));
        } else {
          body.timer = 3 + body.random() * 6; // just stand there a while
        }
      }
      break;
    }
    default:
      break;
  }
  body.x = Math.min(world.width - 30, Math.max(30, body.x));
  return events;
}

export function startDrag(body) {
  body.mode = "drag";
  body.vx = 0;
  body.vy = 0;
}

export function drop(body, throwVx = 0) {
  body.mode = "fall";
  body.vx = Math.max(-900, Math.min(900, throwVx));
  body.vy = 0;
  body.jump = null;
}
