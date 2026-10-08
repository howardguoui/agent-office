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
  target: $("#target"),
  gear: $("#gear"),
  settings: $("#settings"),
  thought: $("#thought"),
  work: $("#work"),
  answer: $("#answer"),
  approval: $("#approval"),
};
const AGENT_NAMES = { claude: "Claude Code", codex: "Codex" };

const state = {
  app: null, model: null, spec: null, key: null, mood: "idle", talking: 0, typing: null, hideTimer: null,
  interactive: null, body: null, windows: [], surfaces: [], foregroundId: null, foregroundChanged: false,
  lastVisitAt: 0, pointer: { x: 0, y: 0, vx: 0, t: 0 }, press: null, busy: false,
  activity: null, // null | "thinking" | "working" while an agent runs a message from her chat box
  settings: null, traits: [], codexModels: [], approvalId: null, answerSide: 1,
  raised: null, // whether her window is above other apps (a panel is open); null until first synced
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
    if (state.activity === "thinking") {
      // Head tilted, eyes up, slow sway: pondering.
      core.setParameterValueById("ParamAngleZ", 10 + 3 * Math.sin(now / 700));
      core.setParameterValueById("ParamAngleX", 8 * Math.sin(now / 1100));
      core.setParameterValueById("ParamEyeBallY", 0.7);
      core.setParameterValueById("ParamEyeBallX", 0.4 * Math.sin(now / 900));
    } else if (state.activity === "working") {
      // Looking down at the laptop, quick little nods as she types along.
      core.setParameterValueById("ParamAngleY", -14 + 4 * Math.sin(now / 120));
      core.setParameterValueById("ParamEyeBallY", -0.6);
      core.setParameterValueById("ParamBodyAngleX", 2 * Math.sin(now / 240));
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
  // The renderer can report 0x0 before its first resize; fall back to the window size.
  const { width, height } = state.app.screen;
  return { width: width || window.innerWidth, height: height || window.innerHeight };
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
  const moodX = Math.max(8, Math.min(width - moodW - 40, body.x - moodW / 2));
  const moodY = Math.min(world().height - 26, body.y + 4);
  ui.mood.style.transform = `translate(${moodX}px, ${moodY}px)`;
  ui.gear.style.transform = `translate(${moodX + moodW + 6}px, ${moodY - 1}px)`;
  const height = world().height;
  const place = (el, x, y) => {
    const w = el.offsetWidth || 300;
    const h = el.offsetHeight || 200;
    el.style.transform = `translate(${Math.max(8, Math.min(width - w - 8, x))}px, ${Math.max(8, Math.min(height - h - 8, y))}px)`;
  };
  if (!ui.thought.hidden) place(ui.thought, body.x + 30, head - 70);
  if (!ui.work.hidden) place(ui.work, body.x - 75, body.y - HEIGHT * 0.52);
  if (!ui.approval.hidden) place(ui.approval, body.x - 150, head - (ui.approval.offsetHeight || 150) - 10);
  // Cards go on whichever side of her has more room.
  const side = body.x > width / 2 ? -1 : 1;
  if (!ui.answer.hidden) place(ui.answer, side > 0 ? body.x + 90 : body.x - 90 - (ui.answer.offsetWidth || 360), body.y - (ui.answer.offsetHeight || 300) - 40);
  if (!ui.settings.hidden) place(ui.settings, side > 0 ? body.x + 90 : body.x - 90 - (ui.settings.offsetWidth || 340), body.y - (ui.settings.offsetHeight || 500));
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
  syncRaised();
}

// Her window lives on the desktop layer, under other apps. It comes forward only while Howard is using one of
// her panels or an agent is waiting for his approval, and goes back as soon as they close.
function syncRaised() {
  const raised = !ui.chat.hidden || !ui.settings.hidden || !ui.approval.hidden || !ui.answer.hidden;
  if (raised === state.raised) return;
  state.raised = raised;
  bridge?.setRaised?.(raised);
}

function onDisplayChanged() {
  // New monitor: start again on its floor, away from the edges.
  state.windows = [];
  state.foregroundId = null;
  state.body = createBody(world(), { x: Math.round(world().width * 0.7) });
  updateSurfaces();
}

function noticeApp(app) {
  if (!app || config.feed !== "live") return;
  fetch("/companion/notice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "app", app }),
  }).catch(() => {});
}

// ---- agents: activity animation, answers, approvals ----

function setActivity(activity, label = "") {
  state.activity = activity;
  ui.thought.hidden = activity !== "thinking";
  ui.work.hidden = activity !== "working";
  if (activity === "thinking") ui.thought.querySelector(".label").textContent = label || "thinking";
  if (activity === "working") ui.work.querySelector(".label").textContent = label || "working";
  layoutUi();
}

function showAnswer(event) {
  $("#answer-title").textContent = `${AGENT_NAMES[event.agent] || "Agent"} · ${event.project || ""}`;
  $("#answer-body").textContent = event.text || "(no answer)";
  ui.answer.hidden = false;
  layoutUi();
}

function handleAgent(event) {
  const who = AGENT_NAMES[event.agent] || "The agent";
  switch (event.phase) {
    case "queued":
      state.busy = true;
      ui.answer.hidden = true;
      setMood("focused");
      setActivity("thinking", `sending to ${who}`);
      break;
    case "start":
      setActivity("thinking", `${who} is reading`);
      break;
    case "thinking":
      setActivity("thinking", event.tokens ? `thinking · ${event.tokens} tokens` : "thinking");
      break;
    case "tool":
      setActivity("working", event.label);
      break;
    case "tool_done":
      if (event.failed) ui.work.querySelector(".label").textContent = "that step failed, retrying...";
      break;
    case "message":
      if (event.agent === "codex" && state.activity !== "working") setActivity("thinking", event.text.slice(0, 60));
      break;
    case "done":
      state.busy = false;
      setActivity(null);
      setMood("happy");
      state.model?.motion(state.spec.tap);
      showAnswer(event);
      break;
    case "error":
      state.busy = false;
      setActivity(null);
      say(`${who} ran into a problem: ${event.text}`, { mood: "worried", hold: 15000 });
      break;
    default:
      break;
  }
}

function showApproval(message) {
  state.approvalId = message.id;
  $("#approval-title").textContent = `${AGENT_NAMES[message.agent] || "Claude Code"} wants to:`;
  $("#approval-label").textContent = message.label;
  const command = $("#approval-command");
  command.hidden = !message.command;
  command.textContent = message.command || "";
  ui.approval.hidden = false;
  ui.bubble.hidden = true;
  setMood("alert");
  layoutUi();
}

async function decide(allow) {
  const id = state.approvalId;
  ui.approval.hidden = true;
  state.approvalId = null;
  if (!id) return;
  await postJson("/companion/approval/decide", { id, allow }).catch(() => {});
}

// ---- settings ----

async function postJson(url, body, method = "POST") {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
}

function updateTargetBadge() {
  const s = state.settings;
  if (!s) return;
  const name = s.persona?.name || "her";
  const project = s.project ? s.project.split(/[\\/]/).pop() : "";
  ui.target.textContent = s.target === "mira" ? name : `${AGENT_NAMES[s.target]}${project ? ` · ${project}` : ""}`;
  ui.input.placeholder = s.target === "mira" ? `Talk to ${name}...` : `Message ${AGENT_NAMES[s.target]}...`;
}

async function loadSettings() {
  if (config.feed !== "live") return;
  try {
    const data = await (await fetch("/companion/settings")).json();
    state.settings = data.settings;
    state.traits = data.traits || [];
    state.codexModels = data.codexModels || [];
    updateTargetBadge();
    if (data.settings.character && data.settings.character !== state.key) switchModel(data.settings.character);
    if (data.approvals?.length) showApproval(data.approvals.at(-1));
  } catch { /* broker not ready yet */ }
}

function fillSettingsForm() {
  const s = state.settings;
  const form = ui.settings.querySelector("form");
  $("#settings-error").textContent = "";
  form.dataset.target = s.target;
  form.querySelectorAll("#set-target button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === s.target)));
  $("#set-project").value = s.project || "";
  $("#recent-projects").innerHTML = (s.recentProjects || []).map((p) => `<option value="${p.replace(/"/g, "&quot;")}"></option>`).join("");
  $("#set-claude-permission").value = s.claudePermission;
  $("#set-codex-model").innerHTML = `<option value="">My Codex config</option>` + state.codexModels.map((m) => `<option value="${m.slug}">${m.name}</option>`).join("");
  $("#set-codex-model").value = s.codexModel || "";
  $("#set-codex-sandbox").value = s.codexSandbox;
  $("#set-character").value = s.character || state.key;
  $("#set-name").value = s.persona?.name || "";
  $("#set-notes").value = s.persona?.notes || "";
  $("#set-apps").checked = s.commentOnApps !== false;
  $("#set-traits").innerHTML = state.traits.map((trait) => `<button type="button" data-trait="${trait}" aria-pressed="${(s.persona?.traits || []).includes(trait)}">${trait}</button>`).join("");
  showAgentFields(s.target);
}

function showAgentFields(target) {
  ui.settings.querySelectorAll(".agent-only").forEach((el) => {
    el.hidden = target === "mira" || (el.dataset.agent && el.dataset.agent !== target);
  });
}

function openSettings() {
  if (!state.settings) return;
  fillSettingsForm();
  ui.settings.hidden = false;
  layoutUi();
}

async function saveSettings() {
  const form = ui.settings.querySelector("form");
  const traits = [...form.querySelectorAll("#set-traits button[aria-pressed=true]")].map((b) => b.dataset.trait);
  const patch = {
    target: form.dataset.target,
    project: $("#set-project").value.trim(),
    claudePermission: $("#set-claude-permission").value,
    codexModel: $("#set-codex-model").value,
    codexSandbox: $("#set-codex-sandbox").value,
    character: $("#set-character").value,
    commentOnApps: $("#set-apps").checked,
    persona: { name: $("#set-name").value, traits, notes: $("#set-notes").value },
  };
  const result = await postJson("/companion/settings", patch, "PUT");
  if (!result.ok) {
    $("#settings-error").textContent = (result.body.errors || ["Could not save."]).join(" ");
    return;
  }
  applySettings(result.body.settings);
  ui.settings.hidden = true;
}

function applySettings(settings) {
  const characterChanged = settings.character && settings.character !== state.key;
  state.settings = settings;
  updateTargetBadge();
  if (characterChanged) switchModel(settings.character);
}

function setupPanels() {
  ui.gear.addEventListener("click", () => (ui.settings.hidden ? openSettings() : (ui.settings.hidden = true)));
  ui.settings.querySelector(".x").addEventListener("click", () => { ui.settings.hidden = true; });
  $("#settings-cancel").addEventListener("click", () => { ui.settings.hidden = true; });
  ui.settings.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); saveSettings(); });
  $("#set-target").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-v]");
    if (!button) return;
    const form = ui.settings.querySelector("form");
    form.dataset.target = button.dataset.v;
    form.querySelectorAll("#set-target button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    showAgentFields(button.dataset.v);
    layoutUi();
  });
  $("#set-traits").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-trait]");
    if (!chip) return;
    const on = chip.getAttribute("aria-pressed") !== "true";
    if (on && ui.settings.querySelectorAll("#set-traits button[aria-pressed=true]").length >= 4) return;
    chip.setAttribute("aria-pressed", String(on));
  });
  $("#pick-folder").addEventListener("click", async () => {
    const folder = await bridge?.pickFolder?.();
    if (folder) $("#set-project").value = folder;
  });
  if (!bridge?.pickFolder) $("#pick-folder").hidden = true;
  ui.answer.querySelector(".x").addEventListener("click", () => { ui.answer.hidden = true; });
  $("#answer-copy").addEventListener("click", () => navigator.clipboard?.writeText($("#answer-body").textContent).catch(() => {}));
  $("#answer-new").addEventListener("click", async () => {
    await postJson("/companion/agent/new", {}).catch(() => {});
    ui.answer.hidden = true;
    say("Fresh start. What's next?");
  });
  $("#approval-allow").addEventListener("click", () => decide(true));
  $("#approval-deny").addEventListener("click", () => decide(false));
  ui.work.querySelector(".stop").addEventListener("click", () => postJson("/companion/agent/cancel", {}).catch(() => {}));
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
  const toAgent = state.settings && state.settings.target !== "mira";
  if (!toAgent) say("...", { hold: 60_000 });
  try {
    const result = await postJson(config.chatUrl, { text });
    if (result.status === 409) {
      say(result.body.error, { mood: "worried" });
      return;
    }
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    // Replies arrive over the WebSocket; only show it here if there is no socket.
    if (!toAgent && !state.socket && result.body.line) say(result.body.line.text);
  } catch {
    say("I couldn't reach the broker. Is it running?", { mood: "worried" });
  }
}

function handleCompanionMessage(message) {
  if (message.type === "agent") return handleAgent(message);
  if (message.type === "approval") return showApproval(message);
  if (message.type === "approval_closed") {
    if (message.id === state.approvalId) { ui.approval.hidden = true; state.approvalId = null; }
    return undefined;
  }
  if (message.type === "settings") return applySettings(message.settings);
  if (message.type === "mood") setMood(message.mood);
  if (message.type === "say") say(message.text, { mood: message.kind === "chat" ? undefined : moodFor(message) });
}

function moodFor(message) {
  return { session_start: "curious", failure: "worried", waiting: "alert", done: "happy", sleepy: "sleepy", app: "curious" }[message.kind] || message.mood;
}

function connectLive() {
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const socket = new WebSocket(url);
  socket.onopen = () => { state.socket = socket; setStatus(""); loadSettings(); };
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
    const overUi = event.target.closest?.("#bubble, #chat, #mood, #gear, #settings, #answer, #approval, #work .stop");
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
  app.resize();
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
  setupPanels();

  ui.chat.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.input.value.trim();
    if (text) sendChat(text);
  });
  ui.input.addEventListener("keydown", (event) => { if (event.key === "Escape") ui.chat.hidden = true; });
  // Switch characters in place: a page reload would break Electron's forwarded mouse events.
  bridge?.onSwitchModel?.((next) => switchModel(next));
  bridge?.onWindows?.(onWindows);
  bridge?.onDisplay?.(() => setTimeout(onDisplayChanged, 50)); // after the window has resized

  if (config.feed === "live") connectLive();
  else if (config.feed?.replay) playReplay(config.feed.replay);
}

window.companion = { say, setMood, MODELS, state };
main().catch((error) => console.error(error));
