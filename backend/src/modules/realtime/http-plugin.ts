import type { FastifyPluginAsync } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { SimulationRuntime } from "../simulator/simulation-runtime.ts";
import { MAX_MESSAGE_BYTES, RealtimeHub } from "./realtime-hub.ts";

export interface RealtimeOptions { runtime: SimulationRuntime; allowedOrigins?: readonly string[] }

/** Comparación exacta de orígenes configurados. Sin configuración, solo mismo origen y clientes sin Origin. */
function originPolicy(allowed: readonly string[]) {
  const configured = new Set(allowed.map(origin => {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) throw new Error("Origen frontend inválido");
    return origin;
  }));
  return (origin: string | undefined, host: string | undefined): boolean => {
    if (origin === undefined) return true;
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) return false;
      return configured.size ? configured.has(origin) : url.host === host;
    } catch { return false; }
  };
}

/** GET /estado y /ws públicos de solo lectura en el HTTP existente; TLS termina en ALB. */
export const realtimePlugin: FastifyPluginAsync<RealtimeOptions> = async (app, options) => {
  const allowed = originPolicy(options.allowedOrigins ?? []);
  const hub = new RealtimeHub();
  const current = options.runtime.getCommittedSnapshot();
  if (current) hub.publish(current);
  const unsubscribe = options.runtime.subscribeCommitted(snapshot => hub.publish(snapshot));
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });
  wss.on("connection", socket => {
    socket.on("pong", () => hub.pong(socket));
    socket.on("close", () => hub.remove(socket));
    socket.on("error", () => { hub.remove(socket); socket.terminate(); });
    socket.on("message", () => socket.close(1008, "Canal de solo lectura"));
    hub.add(socket);
  });
  wss.on("error", () => { app.log.error({ event: "realtime-server-error" }); hub.close(); });
  const heartbeat = setInterval(() => hub.heartbeat(), 30_000);
  heartbeat.unref();
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    let path: string;
    try { path = new URL(request.url ?? "/", "http://local").pathname; }
    catch { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); return; }
    if (path !== "/ws") { socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n"); return; }
    if (!allowed(request.headers.origin, request.headers.host)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
  };
  app.server.on("upgrade", upgrade);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("Vary", "Origin");
    if (!allowed(request.headers.origin, request.headers.host)) return reply.code(403).send({ error: {
      code: "ORIGIN_NOT_ALLOWED", message: "Origen no permitido", requestId: request.id,
    } });
    if (request.headers.origin) reply.header("Access-Control-Allow-Origin", request.headers.origin);
  });
  app.get("/estado", async (request, reply) => {
    const snapshot = options.runtime.getCommittedSnapshot();
    if (!snapshot) return reply.code(503).send({ error: {
      code: "GAME_NOT_STARTED", message: "Todavía no existe una partida", requestId: request.id,
    } });
    return snapshot;
  });
  app.options("/estado", async (_request, reply) => reply.header("Access-Control-Allow-Methods", "GET").code(204).send());
  app.get("/ws", async (request, reply) => reply.code(426).send({ error: {
    code: "UPGRADE_REQUIRED", message: "Se requiere conexión WebSocket", requestId: request.id,
  } }));
  app.addHook("preClose", async () => {
    unsubscribe(); clearInterval(heartbeat); app.server.off("upgrade", upgrade); hub.close();
    await new Promise<void>(resolve => wss.close(() => resolve()));
  });
};
