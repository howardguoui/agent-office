// Companion overlay: a Live2D character with a speech bubble and a chat box.
// Runs in the Electron window (live feed from the broker) and in the web demo (recorded feed).
// window.COMPANION_CONFIG = { vendor: { pixi, live2d }, core, feed: "live" | { replay: url }, chatUrl }

const MODEL_BASE = "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@5-r.5/Samples/Resources";

// Mood -> expression for each sample model, chosen from the expression parameters (see README).
export const MODELS = {
  mao: {
    label: "Mao",
    url: `${MODEL_BASE}/Mao/Mao.model3.json`,
    mouth: "ParamA",
    zoom: 1.75, top: 0.07,
    expressions: { idle: "exp_01", focused: "exp_01", curious: "exp_04", happy: "exp_02", worried: "exp_05", alert: "exp_07", sleepy: "exp_03", shy: "exp_06" },
    tap: "TapBody",
  },
  haru: {
    label: "Haru",
    url: `${MODEL_BASE}/Haru/Haru.model3.json`,
    mouth: "ParamMouthOpenY",
    zoom: 1.75, top: 0.07,
    expressions: { idle: "F01", focused: "F01", curious: "F02", happy: "F05", worried: "F04", alert: "F06", sleepy: "F01", shy: "F07" },
    sleepyEyes: 0.25,
    tap: "TapBody",
  },
};

export const MOOD_LABEL = {
  idle: "relaxing", focused: "watching the agents", curious: "curious", happy: "happy",
  worried: "worried", alert: "needs you", sleepy: "sleepy",
};

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
  const key = [fromQuery, saved, "mao"].find((candidate) => candidate && MODELS[candidate]);
  return key;
}

const ui = {
  bubble: $("#bubble"),
  text: $("#bubble-text"),
  mood: $("#mood"),
  chat: $("#chat"),
  input: $("#chat-input"),
  status: $("#status"),
};

const state = { model: null, spec: null, mood: "idle", talking: 0, typing: null, hideTimer: null, interactive: null, key: null, fit: null };

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
  const model = await window.PIXI.live2d.Live2DModel.from(spec.url, { autoHitTest: true, autoFocus: true });
  // Frame her from the top of the head to about mid-thigh, centred, leaving room for the bubble.
  const fit = () => {
    const { width, height } = app.screen;
    if (!width || !height) return;
    const naturalW = model.internalModel.originalWidth;
    const naturalH = model.internalModel.originalHeight;
    const scale = Math.min((height * spec.zoom) / naturalH, (width * 1.35) / naturalW);
    model.scale.set(scale);
    model.x = (width - naturalW * scale) / 2;
    model.y = height * spec.top;
  };
  fit();
  app.renderer.on("resize", fit);
  app.ticker.addOnce(fit);
  state.fit = fit;
  app.stage.addChild(model);

  // Mouth moves while the bubble types (no audio), eyes droop when sleepy.
  model.internalModel.on("beforeModelUpdate", () => {
    const core = model.internalModel.coreModel;
    if (state.talking) core.setParameterValueById(spec.mouth, 0.25 + Math.abs(Math.sin(performance.now() / 85)) * 0.6);
    if (state.mood === "sleepy" && spec.sleepyEyes !== undefined) {
      core.setParameterValueById("ParamEyeLOpen", spec.sleepyEyes);
      core.setParameterValueById("ParamEyeROpen", spec.sleepyEyes);
    }
  });

  model.on("hit", (areas) => {
    if (areas.includes("Head") || areas.includes("Body")) {
      model.motion(spec.tap);
      openChat();
    }
  });
  state.model = model;
  state.spec = spec;
  state.key = key;
  setMood(state.mood);
  return model;
}

async function switchModel(app, next) {
  if (!MODELS[next] || next === state.key) return;
  try { localStorage.setItem("companion-model", next); } catch { /* ignore */ }
  const old = state.model;
  if (state.fit) app.renderer.off("resize", state.fit);
  state.model = null;
  if (old) {
    app.stage.removeChild(old);
    old.destroy();
  }
  setStatus("Loading...");
  try {
    await loadModel(app, next);
    setStatus("");
  } catch (error) {
    setStatus(`Could not load the Live2D model: ${error.message}`);
  }
}

function openChat() {
  if (!config.chatUrl) return;
  ui.chat.hidden = false;
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
  return { session_start: "curious", failure: "worried", waiting: "alert", done: "happy", sleepy: "sleepy" }[message.kind] || message.mood;
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
    setStatus("Waiting for the Agent Office broker...");
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
  let start = performance.now();
  for (const item of events) {
    const wait = item.t / speed - (performance.now() - start);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    window.dispatchEvent(new CustomEvent("companion-replay-step", { detail: item }));
    if (item.companion) handleCompanionMessage(item.companion);
  }
  window.dispatchEvent(new CustomEvent("companion-replay-end"));
}

async function main() {
  setStatus("Loading...");
  await loadScript(config.core);
  await loadScript(config.vendor.pixi);
  if (config.vendor.unsafeEval) await loadScript(config.vendor.unsafeEval);
  await loadScript(config.vendor.live2d);
  const PIXI = window.PIXI;
  const canvas = $("#stage");
  const app = new PIXI.Application({ view: canvas, resizeTo: canvas.parentElement, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
  window.companionApp = app;
  const key = pickModel();
  try {
    await loadModel(app, key);
  } catch (error) {
    setStatus(`Could not load the Live2D model: ${error.message}`);
    throw error;
  }
  setStatus("");
  setInteractive(false); // sync Electron with this page's starting state

  // Click-through outside the character, bubble and chat (Electron only).
  window.addEventListener("pointermove", (event) => {
    const overUi = event.target.closest?.("#bubble, #chat, #grip, #mood");
    const overModel = state.model && state.model.getBounds().contains(event.clientX, event.clientY) && state.model.hitTest(event.clientX, event.clientY).length > 0;
    setInteractive(Boolean(overUi || overModel));
  });
  canvas.addEventListener("contextmenu", (event) => { event.preventDefault(); bridge?.showMenu({ models: Object.keys(MODELS), current: state.key }); });
  ui.chat.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.input.value.trim();
    if (text) sendChat(text);
  });
  ui.input.addEventListener("keydown", (event) => { if (event.key === "Escape") ui.chat.hidden = true; });
  // Switch characters in place. A page reload would break Electron's forwarded mouse events,
  // leaving the window click-through so the chat box could not be clicked or typed into.
  bridge?.onSwitchModel?.((next) => switchModel(app, next));

  if (config.feed === "live") connectLive();
  else if (config.feed?.replay) playReplay(config.feed.replay);
}

window.companion = { say, setMood, MODELS };
main().catch((error) => console.error(error));
