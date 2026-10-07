// Companion overlay: a Live2D character who walks around the desktop, with a speech bubble and a chat box.
// Runs in the Electron window that covers the work area (live feed from the broker) and in the web demo
// (recorded feed, where the page itself is her world).
// window.COMPANION_CONFIG = { vendor: { pixi, unsafeEval, live2d }, core, feed: "live" | { replay: url }, chatUrl }

import { createBody, drop, startDrag, step, surfacesFrom } from "./behavior.js";

const MODEL_BASE = "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@5-r.5/Samples/Resources";

// Mood -> expression for each sample model, chosen from the expression parameters (see README).
// `feet` is how far above the bottom of the model canvas her soles are, as a fraction of its height.
export const MODELS = {
  mao: {
    label: "Mao",
    url: `${MODEL_BASE}/Mao/Mao.model3.json`,
    mouth: "ParamA",
    feet: 0.02,
    expressions: { idle: "exp_01", focused: "exp_01", curious: "exp_04", happy: "exp_02", worried: "exp_05", alert: "exp_07", sleepy: "exp_03", shy: "exp_06" },
    tap: "TapBody",
  },
  haru: {
    label: "Haru",
    url: `${MODEL_BASE}/Haru/Haru.model3.json`,
    mouth: "ParamMouthOpenY",
    feet: 0.0,
    expressions: { idle: "F01", focused: "F01", curious: "F02", happy: "F05", worried: "F04", alert: "F06", sleepy: "F01", shy: "F07" },
    sleepyEyes: 0.25,
    tap: "TapBody",
  },
};

export const MOOD_LABEL = {
  idle: "relaxing", focused: "watching the agents", curious: "curious", happy: "happy",
  worried: "worried", alert: "needs you", sleepy: "sleepy",
};

const HEIGHT = 380; // her height on screen, CSS px
const $ = (selector) => document.querySelector(selector);
const config = window.COMPANION_CONFIG || {};
const bridge = window.companionBridge || null; // Electron preload, absent on the web

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

function pickModel() {
  const fromQuery = new URLSearchParams(location.search).get("model");
  let saved = null;
  try { saved = localStorage.getItem("companion-model"); } catch { /* storage may be unavailable */ }
  return [fromQuery, saved, "mao"].find((candidate) => candidate && MODELS[candidate]);
}

const ui = {
  bubble: $("#bubble"),
  text: $("#bubble-text"),
  mood: $("#mood"),
  chat: $("#chat"),
  input: $("#chat-input"),
  status: $("#status"),
};

const state = {
  app: null, model: null, spec: null, key: null, mood: "idle", talking: 0, typing: null, hideTimer: null,
  interactive: null, body: null, windows: [], surfaces: [], foregroundId: null, foregroundChanged: false,
  lastVisitAt: 0, pointer: { x: 0, y: 0, vx: 0, t: 0 }, press: null, busy: false,
};

function setStatus(text) { ui.status.textContent = text || ""; ui.status.hidden = !text; }

function setMood(mood) {
  if (!MOOD_LABEL[mood]) return;
  state.mood = mood;
  ui.mood.dataset.mood = mood;
  ui.mood.querySelector("span").textContent = MOOD_LABEL[mood];
  const expression = state.spec?.expressions[mood];
  if (state.model && expression) state.model.expression(expression);
}

function say(text, { mood, hold = 9000 } = {}) {
  if (!text) return;
  if (mood) setMood(mood);
  clearInterval(state.typing);
  clearTimeout(state.hideTimer);
  ui.bubble.hidden = false;
  ui.text.textContent = "";
  let index = 0;
  state.talking = 1;
  state.typing = setInterval(() => {
    index += 2;
    ui.text.textContent = text.slice(0, index);
    if (index >= text.length) {
      clearInterval(state.typing);
      state.talking = 0;
      state.hideTimer = setTimeout(() => { ui.bubble.hidden = true; }, hold + text.length * 40);
    }
  }, 28);
}

function setInteractive(on) {
  if (state.interactive === on) return;
  state.interactive = on;
  bridge?.setInteractive(on);
}

async function loadModel(app, key) {
  const spec = MODELS[key];
  const model = await window.PIXI.live2d.Live2DModel.from(spec.url, { autoHitTest: false, autoFocus: true });
  model.anchor.set(0.5, 1 - spec.feet);
  app.stage.addChild(model);

  // Mouth moves while the bubble types (no audio), she leans and bobs when walking, eyes droop when sleepy.
  model.internalModel.on("beforeModelUpdate", () => {
    const core = model.internalModel.coreModel;
    const now = performance.now();
    const mode = state.body?.mode;
    if (state.talking) core.setParameterValueById(spec.mouth, 0.25 + Math.abs(Math.sin(now / 85)) * 0.6);
    if (mode === "walk") {
      core.setParameterValueById("ParamBodyAngleX", 6 * Math.sin(now / 160));
      core.setParameterValueById("ParamAngleZ", 4 * Math.sin(now / 160));
    } else if (mode === "jump" || mode === "fall") {
      core.setParameterValueById("ParamAngleY", -12);
    } else if (mode === "drag") {
      core.setParameterValueById("ParamAngleZ", 14 * Math.sin(now / 220));
      core.setParameterValueById("ParamBodyAngleZ", 10 * Math.sin(now / 220));
    }
    if (state.mood === "sleepy" && spec.sleepyEyes !== undefined) {
      core.setParameterValueById("ParamEyeLOpen", spec.sleepyEyes);
      core.setParameterValueById("ParamEyeROpen", spec.sleepyEyes);
    }
  });

  state.model = model;
  state.spec = spec;
  state.key = key;
  setMood(state.mood);
  return model;
}

async function switchModel(next) {
  if (!MODELS[next] || next === state.key) return;
  try { localStorage.setItem("companion-model", next); } catch { /* ignore */ }
  const old = state.model;
  state.model = null;
  if (old) {
    state.app.stage.removeChild(old);
    old.destroy();
  }
  setStatus("Loading...");
  try {
    await loadModel(state.app, next);
    setStatus("");
  } catch (error) {
    setStatus(`Could not load the Live2D model: ${error.message}`);
  }
}

// ---- her place in the world ----

function world() {
  const { width, height } = state.app.screen;
  return { width, height };
}

function updateSurfaces() {
  state.surfaces = surfacesFrom(state.windows, world());
}

function onWindows(windows) {
  state.windows = windows;
  const fg = windows.find((w) => w.foreground);
  if (fg && fg.id !== state.foregroundId) {
    const first = state.foregroundId === null;
    state.foregroundId = fg.id;
    // Visit the new front window now and then, not on every alt-tab.
    if (!first && performance.now() - state.lastVisitAt > 20_000 && Math.random() < 0.6) state.foregroundChanged = true;
  }
  updateSurfaces();
}

function overHer(x, y) {
  const model = state.model;
  if (!model) return false;
  const bounds = model.getBounds();
  if (!bounds.contains(x, y)) return false;
  // Inside the body's middle 60% of width counts, so the empty canvas margins stay click-through.
  return Math.abs(x - state.body.x) < bounds.width * 0.3 && y < state.body.y && y > bounds.y + bounds.height * 0.05;
}

function layoutUi() {
  const { body, model } = state;
  if (!model) return;
  const { width } = world();
  const head = body.y - HEIGHT * 0.98;
  const bubbleW = ui.bubble.offsetWidth || 260;
  const bubbleH = ui.bubble.offsetHeight || 60;
  const left = Math.max(8, Math.min(width - bubbleW - 8, body.x - bubbleW / 2));
  let top = head - bubbleH - 6;
  if (top < 8) top = 8;
  ui.bubble.style.transform = `translate(${left}px, ${top}px)`;
  ui.bubble.style.setProperty("--tail", `${Math.max(16, Math.min(bubbleW - 16, body.x - left))}px`);
  const chatW = ui.chat.offsetWidth || 280;
  ui.chat.style.transform = `translate(${Math.max(8, Math.min(width - chatW - 8, body.x - chatW / 2))}px, ${Math.max(8, body.y - 46)}px)`;
  const moodW = ui.mood.offsetWidth || 90;
  ui.mood.style.transform = `translate(${Math.max(8, Math.min(width - moodW - 8, body.x - moodW / 2))}px, ${Math.min(world().height - 26, body.y + 4)}px)`;
}

function tick() {
  const { model, body } = state;
  if (!model || !body) return;
  const dt = Math.min(0.05, state.app.ticker.deltaMS / 1000);
  const events = step(body, dt, {
    ...world(),
    surfaces: state.surfaces,
    pointer: state.pointer,
    foregroundChanged: state.foregroundChanged,
    busy: state.busy,
    sleepy: state.mood === "sleepy",
  });
  state.foregroundChanged = false;
  for (const event of events) {
    if (event.type === "visit") {
      state.lastVisitAt = performance.now();
      noticeApp(event.app);
    }
    if (event.type === "landed" && Math.random() < 0.3) model.motion(state.spec.tap);
  }
  const scale = HEIGHT / model.internalModel.originalHeight;
  const bob = body.mode === "walk" ? -Math.abs(Math.sin(performance.now() / 160)) * 6 : 0;
  model.scale.set(scale * (body.facing > 0 ? -1 : 1), scale);
  model.x = body.x;
  model.y = body.y + bob;
  layoutUi();
}

function noticeApp(app) {
  if (!app || config.feed !== "live") return;
  fetch("/companion/notice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "app", app }),
  }).catch(() => {});
}

// ---- chat ----

function openChat() {
  if (!config.chatUrl) return;
  ui.chat.hidden = false;
  layoutUi();
  ui.input.focus();
}

async function sendChat(text) {
  ui.input.value = "";
  say("...", { hold: 60_000 });
  try {
    const response = await fetch(config.chatUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // The reply also arrives over the WebSocket as a "say"; only show it here if there is no socket.
    if (!state.socket) say((await response.json()).line.text);
  } catch {
    say("I couldn't reach the broker. Is it running?", { mood: "worried" });
  }
}

function handleCompanionMessage(message) {
  if (message.type === "mood") setMood(message.mood);
  if (message.type === "say") say(message.text, { mood: message.kind === "chat" ? undefined : moodFor(message) });
}

function moodFor(message) {
  return { session_start: "curious", failure: "worried", waiting: "alert", done: "happy", sleepy: "sleepy", app: "curious" }[message.kind] || message.mood;
}

function connectLive() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const socket = new WebSocket(url);
  socket.onopen = () => { state.socket = socket; setStatus(""); };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "companion") handleCompanionMessage(message.data);
  };
  socket.onclose = () => {
    state.socket = null;
    setTimeout(connectLive, 3000);
  };
  fetch("/companion").then((r) => r.json()).then((snapshot) => {
    setMood(snapshot.mood);
    const last = snapshot.lines?.at(-1);
    say(last ? last.text : `Hi, I'm ${snapshot.name}. I'll keep an eye on your agents.`);
  }).catch(() => {});
}

async function playReplay(url) {
  const recording = await (await fetch(url)).json();
  const events = recording.timeline || [];
  const speed = Number(new URLSearchParams(location.search).get("speed")) || 1;
  window.dispatchEvent(new CustomEvent("companion-replay", { detail: { recording } }));
  const start = performance.now();
  for (const item of events) {
    const wait = item.t / speed - (performance.now() - start);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    window.dispatchEvent(new CustomEvent("companion-replay-step", { detail: item }));
    if (item.companion) handleCompanionMessage(item.companion);
  }
  window.dispatchEvent(new CustomEvent("companion-replay-end"));
}

// ---- pointer: hover, click to chat, drag and throw ----

function setupPointer(canvas) {
  window.addEventListener("pointermove", (event) => {
    const now = performance.now();
    const dt = Math.max(1, now - state.pointer.t);
    state.pointer = { x: event.clientX, y: event.clientY + HEIGHT * 0.45, vx: ((event.clientX - state.pointer.x) / dt) * 1000, t: now };
    if (state.press && !state.press.dragging && Math.hypot(event.clientX - state.press.x, event.clientY - state.press.y) > 6) {
      state.press.dragging = true;
      startDrag(state.body);
      setMood("curious");
    }
    const overUi = event.target.closest?.("#bubble, #chat, #mood");
    setInteractive(Boolean(state.press || overUi || overHer(event.clientX, event.clientY)));
  });
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !overHer(event.clientX, event.clientY)) return;
    state.press = { x: event.clientX, y: event.clientY, dragging: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerup", (event) => {
    const press = state.press;
    state.press = null;
    if (!press) return;
    canvas.releasePointerCapture(event.pointerId);
    if (press.dragging) {
      drop(state.body, state.pointer.vx * 0.5);
    } else {
      state.model.motion(state.spec.tap);
      openChat();
    }
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (overHer(event.clientX, event.clientY)) bridge?.showMenu({ models: Object.keys(MODELS), current: state.key });
  });
}

async function main() {
  setStatus("Loading...");
  await loadScript(config.core);
  await loadScript(config.vendor.pixi);
  if (config.vendor.unsafeEval) await loadScript(config.vendor.unsafeEval);
  await loadScript(config.vendor.live2d);
  const PIXI = window.PIXI;
  const canvas = $("#stage");
  const app = new PIXI.Application({ view: canvas, resizeTo: window, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  state.app = app;
  window.companionApp = app;
  try {
    await loadModel(app, pickModel());
  } catch (error) {
    setStatus(`Could not load the Live2D model: ${error.message}`);
    throw error;
  }
  setStatus("");
  state.body = createBody(world());
  updateSurfaces();
  app.renderer.on("resize", updateSurfaces);
  app.ticker.add(tick);
  setInteractive(false); // sync Electron with this page's starting state
  setupPointer(canvas);

  ui.chat.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.input.value.trim();
    if (text) sendChat(text);
  });
  ui.input.addEventListener("keydown", (event) => { if (event.key === "Escape") ui.chat.hidden = true; });
  // Switch characters in place: a page reload would break Electron's forwarded mouse events.
  bridge?.onSwitchModel?.((next) => switchModel(next));
  bridge?.onWindows?.(onWindows);

  if (config.feed === "live") connectLive();
  else if (config.feed?.replay) playReplay(config.feed.replay);
}

window.companion = { say, setMood, MODELS, state };
main().catch((error) => console.error(error));
