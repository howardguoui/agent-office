import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";

import { createStateStore } from "./state-store.js";


const DEFAULT_MAX_BODY_BYTES = 128 * 1024;
const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_UI_PATH = path.join(PROJECT_ROOT, "sidebar", "index.html");

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let oversized = false;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (oversized) {
        const error = new Error("Event body is too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        error.code = "INVALID_JSON";
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

export function createBrokerServer({
  host = "127.0.0.1",
  port = 4242,
  store = createStateStore(),
  openSidebar = async () => {},
  uiPath = DEFAULT_UI_PATH,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  companion = null,
  onCompanionError = () => {},
} = {}) {
  const webSockets = new WebSocketServer({ noServer: true });

  function broadcast(message) {
    const payload = JSON.stringify(message);
    for (const client of webSockets.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  function broadcastState() {
    broadcast({ type: "state", data: store.snapshot() });
  }

  function requireJson(request, response) {
    if (String(request.headers["content-type"] || "").startsWith("application/json")) return true;
    sendJson(response, 415, { error: "content_type_required" });
    return false;
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, pid: process.pid });
        return;
      }
      if (request.method === "GET" && url.pathname === "/state") {
        sendJson(response, 200, store.snapshot());
        return;
      }
      if (request.method === "POST" && url.pathname === "/event") {
        if (!requireJson(request, response)) return;
        const rawEvent = await readJsonBody(request, maxBodyBytes);
        const event = await store.apply(rawEvent);
        if (event.eventName === "SessionStart") await openSidebar();
        sendJson(response, 202, { accepted: true });
        broadcastState();
        // The companion reacts in the background; a slow model must never delay the agent's hook.
        if (companion) companion.observe(event).catch(onCompanionError);
        return;
      }
      if (companion && request.method === "GET" && url.pathname === "/companion") {
        sendJson(response, 200, await companion.snapshot());
        return;
      }
      if (companion && request.method === "POST" && url.pathname === "/companion/chat") {
        if (!requireJson(request, response)) return;
        const body = await readJsonBody(request, 16 * 1024);
        if (typeof body?.text !== "string" || !body.text.trim()) {
          sendJson(response, 400, { error: "text_required" });
          return;
        }
        sendJson(response, 200, { line: await companion.chat(body.text) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/open") {
        await openSidebar();
        sendJson(response, 202, { opened: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        const html = await readFile(uiPath);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; frame-src http://127.0.0.1:3737 http://localhost:3737",
          "cache-control": "no-store",
        });
        response.end(html);
        return;
      }
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      if (error.code === "BODY_TOO_LARGE") {
        sendJson(response, 413, { error: "body_too_large" });
      } else if (error.code === "INVALID_JSON" || error instanceof SyntaxError) {
        sendJson(response, 400, { error: "invalid_json" });
      } else {
        sendJson(response, 500, { error: "internal_error" });
      }
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (client) => {
      webSockets.emit("connection", client, request);
    });
  });
  webSockets.on("connection", (client) => {
    client.send(JSON.stringify({ type: "state", data: store.snapshot() }));
  });

  return {
    broadcast,
    start() {
      return new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(port, host, () => {
          server.off("error", onError);
          resolve(server.address());
        });
      });
    },
    close() {
      for (const client of webSockets.clients) client.close();
      return new Promise((resolve, reject) => {
        webSockets.close(() => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      });
    },
  };
}
