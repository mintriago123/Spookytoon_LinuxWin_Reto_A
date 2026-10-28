import type { PasoRequest, WorldSyncRequest } from "../../contracts/routing.ts";
import { Agent, request as httpRequest } from "node:http";

export interface RoutingHttpResponse { status: number; body: unknown }
export interface RoutingClient {
  sync(request: WorldSyncRequest, signal: AbortSignal): Promise<RoutingHttpResponse>;
  status(gameId: string, signal: AbortSignal): Promise<RoutingHttpResponse>;
  step(request: PasoRequest, signal: AbortSignal): Promise<RoutingHttpResponse>;
  close?(): void;
}

/** Cliente del proceso existente. No registra secretos ni sigue redirecciones. */
export function createRoutingClient(options: { baseUrl: string; apiKey: string; maxSockets?: number }): RoutingClient {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Routing requiere una URL HTTP de loopback sin ruta ni credenciales");
  }
  if (!options.apiKey || options.apiKey.length < 16) throw new Error("Se requiere una clave de routing de al menos 16 caracteres");
  const maxSockets = options.maxSockets ?? 32;
  if (!Number.isSafeInteger(maxSockets) || maxSockets < 1 || maxSockets > 200) throw new Error("maxSockets debe estar entre 1 y 200");
  // Los 200 intentos se despachan juntos; un pool acotado evita abrir 200 conexiones frías.
  // La espera dentro del Agent forma parte de elapsedMs y del timeout individual.
  const agent = new Agent({ keepAlive: true, maxSockets, maxTotalSockets: maxSockets, maxFreeSockets: maxSockets });
  function send(path: string, signal: AbortSignal, body?: unknown): Promise<RoutingHttpResponse> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const request = httpRequest(new URL(path, base), {
        method: payload === undefined ? "GET" : "POST", signal, agent,
        headers: { "x-api-key": options.apiKey, "content-type": "application/json",
          ...(payload === undefined ? {} : { "content-length": payload.length }) },
      }, response => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("error", reject);
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1_048_576) { response.destroy(new Error("Respuesta de routing demasiado grande")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => {
          let parsed: unknown = null;
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
          catch { /* Mantener el status incluso si routing no devuelve JSON válido. */ }
          resolve({ status: response.statusCode ?? 503, body: parsed });
        });
      });
      request.on("error", reject);
      request.end(payload);
    });
  }
  return {
    sync: (request, signal) => send("/motor/sincronizar", signal, request),
    status: (gameId, signal) => send(`/motor/estado/${encodeURIComponent(gameId)}`, signal),
    step: (request, signal) => send("/paso", signal, request),
    close: () => agent.destroy(),
  };
}
