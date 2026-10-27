import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { RoutingError } from "../../contracts/routing.ts";
import { RouteEngine } from "./route-engine.ts";

interface RoutingServerOptions {
  engine: RouteEngine;
  apiKey: string;
  bodyLimitBytes?: number;
}

function send(response: ServerResponse, status: number, body: unknown) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": bytes.length,
    "cache-control": "no-store" });
  response.end(bytes);
}

function authorized(header: string | string[] | undefined, expectedHash: Buffer) {
  const candidate = Array.isArray(header) ? header.join(",") : header;
  if (!candidate) {
    const dummy = createHash("sha256").update("").digest();
    timingSafeEqual(dummy, expectedHash);
    return false;
  }
  const candidateHash = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

function readJson(request: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const lengthHeader = request.headers["content-length"];
    const declaredLength = typeof lengthHeader === "string" ? Number(lengthHeader) : NaN;
    if (Number.isFinite(declaredLength) && declaredLength > limit) {
      request.resume(); reject(new RoutingError(413, "PAYLOAD_TOO_LARGE", "El cuerpo supera el límite permitido")); return;
    }
    const chunks: Buffer[] = []; let size = 0; let settled = false;
    request.on("data", chunk => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > limit) {
        settled = true; chunks.length = 0;
        reject(new RoutingError(413, "PAYLOAD_TOO_LARGE", "El cuerpo supera el límite permitido"));
        return;
      }
      chunks.push(bytes);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown); }
      catch { reject(new RoutingError(400, "VALIDATION_ERROR", "El cuerpo debe ser JSON válido")); }
    });
    request.on("error", error => { if (!settled) { settled = true; reject(error); } });
    request.on("aborted", () => { if (!settled) { settled = true; reject(new RoutingError(400, "VALIDATION_ERROR", "Petición interrumpida")); } });
  });
}

export function createRoutingServer(options: RoutingServerOptions): Server {
  if (!options.apiKey || options.apiKey.length < 16) throw new Error("Configure ROUTE_API_KEY con al menos 16 caracteres");
  const expectedHash = createHash("sha256").update(options.apiKey).digest();
  const bodyLimitBytes = options.bodyLimitBytes ?? 1_048_576;
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    try {
      const url = new URL(request.url ?? "/", "http://routing.local");
      if (request.method === "GET" && url.pathname === "/health/live") {
        send(response, 200, { status: "live" }); return;
      }
      if (request.method === "GET" && url.pathname === "/health/ready") {
        const ready = options.engine.isReady();
        send(response, ready ? 200 : 503, { status: ready ? "ready" : "not-ready" }); return;
      }
      const knownRoute = request.method === "POST" &&
        (url.pathname === "/motor/sincronizar" || url.pathname === "/paso");
      if (!knownRoute) {
        send(response, 404, { error: { code: "NOT_FOUND", message: "Ruta no encontrada", requestId } }); return;
      }
      if (!authorized(request.headers["x-api-key"], expectedHash)) {
        send(response, 401, { error: { code: "UNAUTHORIZED", message: "Autenticación requerida", requestId } }); return;
      }
      const body = await readJson(request, bodyLimitBytes);
      if (url.pathname === "/motor/sincronizar") {
        send(response, 200, options.engine.sync(body)); return;
      }
      send(response, 200, options.engine.step(body));
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof RoutingError) {
        send(response, error.status, { error: { code: error.code, message: error.message, requestId } }); return;
      }
      console.error(JSON.stringify({ event: "routing-request-failed", requestId,
        message: error instanceof Error ? error.message : "unknown error" }));
      send(response, 503, { error: { code: "ROUTE_UNAVAILABLE", message: "Motor de rutas no disponible", requestId } });
    }
  });
}
