import type { PasoRequest, WorldSyncRequest } from "../../contracts/routing.ts";
import { Agent, request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";

/** Diagnóstico interno acotado; no forma parte de los DTO HTTP/WS.
 * totalMs termina al observar respuesta/error, incluso si el timeout ya venció.
 * beforeSocketMs incluye construcción y cola; responseWaitMs incluye I/O y servidor.
 */
export interface RoutingRequestTiming {
  operation: "sync" | "status" | "step";
  turnId: number | null;
  totalMs: number;
  beforeSocketMs: number;
  queuedForSocket: boolean;
  socketQueueMs: number;
  connectMs: number;
  responseWaitMs: number;
  bodyMs: number;
  engineMs: number | null;
  httpStatus: number | null;
  aborted: boolean;
  errorCode: string | null;
  reusedSocket: boolean;
}

export interface RoutingHttpResponse { status: number; body: unknown }
export interface RoutingClient {
  sync(request: WorldSyncRequest, signal: AbortSignal): Promise<RoutingHttpResponse>;
  status(gameId: string, signal: AbortSignal): Promise<RoutingHttpResponse>;
  step(request: PasoRequest, signal: AbortSignal): Promise<RoutingHttpResponse>;
  close?(): void;
  getTimings?(): readonly Readonly<RoutingRequestTiming>[];
}

/** Cliente del proceso existente. No registra secretos ni sigue redirecciones. */
export function createRoutingClient(options: { baseUrl: string; apiKey: string; maxSockets?: number }): RoutingClient {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Routing requiere una URL HTTP de loopback sin ruta ni credenciales");
  }
  if (!options.apiKey || options.apiKey.length < 16) throw new Error("Se requiere una clave de routing de al menos 16 caracteres");
  const maxSockets = options.maxSockets ?? 16;
  if (!Number.isSafeInteger(maxSockets) || maxSockets < 1 || maxSockets > 200) throw new Error("maxSockets debe estar entre 1 y 200");
  // Los 200 intentos se despachan juntos; limitar conexiones reduce el coste
  // de conexión/escritura de los lotes HTTP sin excluir la cola del timeout.
  // La espera dentro del Agent forma parte de elapsedMs y del timeout individual.
  const agent = new Agent({ keepAlive: true, maxSockets, maxTotalSockets: maxSockets, maxFreeSockets: maxSockets });
  const timings: Readonly<RoutingRequestTiming>[] = [];
  function send(operation: RoutingRequestTiming["operation"], path: string, signal: AbortSignal, body?: unknown): Promise<RoutingHttpResponse> {
    const started = performance.now();
    let socketAt: number | undefined, connectedAt: number | undefined, headersAt: number | undefined;
    let queuedAt: number | undefined;
    let httpStatus: number | null = null, recorded = false;
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const record = (errorCode: string | null, parsed?: unknown) => {
        if (recorded) return; recorded = true;
        const ended = performance.now();
        const payload = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
        const engineMs = operation === "sync" ? payload.buildLatencyMs : payload.latencyMs;
        const turnId = body && typeof body === "object" && "turnId" in body ? (body as { turnId: number }).turnId : null;
        timings.push(Object.freeze({ operation, turnId, totalMs: ended - started,
          beforeSocketMs: (socketAt ?? ended) - started,
          queuedForSocket: queuedAt !== undefined,
          socketQueueMs: queuedAt === undefined ? 0 : (socketAt ?? ended) - queuedAt,
          connectMs: socketAt === undefined ? 0 : (connectedAt ?? ended) - socketAt,
          responseWaitMs: connectedAt === undefined ? 0 : (headersAt ?? ended) - connectedAt,
          bodyMs: headersAt === undefined ? 0 : ended - headersAt,
          engineMs: typeof engineMs === "number" && Number.isFinite(engineMs) ? engineMs : null,
          httpStatus, aborted: signal.aborted, errorCode, reusedSocket: request.reusedSocket }));
        if (timings.length > 1_000) timings.shift();
      };
      const failed = (error: Error & { code?: string }) => { record(error.code ?? error.name); reject(error); };
      const request = httpRequest(new URL(path, base), {
        method: payload === undefined ? "GET" : "POST", signal, agent,
        headers: { "x-api-key": options.apiKey, "content-type": "application/json",
          ...(payload === undefined ? {} : { "content-length": payload.length }) },
      }, response => {
        headersAt = performance.now(); httpStatus = response.statusCode ?? null;
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("error", failed);
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_048_576) { response.destroy(new Error("Respuesta de routing demasiado grande")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => {
          let parsed: unknown = null;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
          catch { /* Mantener el status incluso si routing no devuelve JSON válido. */ }
          record(null, parsed);
          resolve({ status: response.statusCode ?? 503, body: parsed });
        });
      });
      // Leer la cola pública del Agent distingue espera real de construcción y
      // callbacks de asignación del socket. No modificar sus solicitudes.
      if (Object.values(agent.requests).some(queue => queue?.includes(request))) queuedAt = performance.now();
      request.on("socket", socket => {
        socketAt = performance.now();
        if (socket.connecting) socket.once("connect", () => { connectedAt = performance.now(); });
        else connectedAt = socketAt;
      });
      request.on("error", failed);
      request.end(payload);
    });
  }
  return {
    sync: (request, signal) => send("sync", "/motor/sincronizar", signal, request),
    status: (gameId, signal) => send("status", `/motor/estado/${encodeURIComponent(gameId)}`, signal),
    step: (request, signal) => send("step", "/paso", signal, request),
    close: () => agent.destroy(),
    getTimings: () => Object.freeze([...timings]),
  };
}
