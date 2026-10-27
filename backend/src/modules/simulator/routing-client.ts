import type { PasoRequest, WorldSyncRequest } from "../../contracts/routing.ts";

export interface RoutingHttpResponse { status: number; body: unknown }
export interface RoutingClient {
  sync(request: WorldSyncRequest, signal: AbortSignal): Promise<RoutingHttpResponse>;
  status(gameId: string, signal: AbortSignal): Promise<RoutingHttpResponse>;
  step(request: PasoRequest, signal: AbortSignal): Promise<RoutingHttpResponse>;
}

/** Cliente del proceso existente. No registra secretos ni sigue redirecciones. */
export function createRoutingClient(options: { baseUrl: string; apiKey: string }): RoutingClient {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
      base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("Routing requiere una URL HTTP de loopback sin ruta ni credenciales");
  }
  if (!options.apiKey || options.apiKey.length < 16) throw new Error("Se requiere una clave de routing de al menos 16 caracteres");
  async function send(path: string, signal: AbortSignal, body?: unknown): Promise<RoutingHttpResponse> {
    const response = await fetch(new URL(path, base), {
      method: body === undefined ? "GET" : "POST", signal, redirect: "error",
      headers: { "x-api-key": options.apiKey, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text) as unknown; } catch { /* Mantener HTTP status incluso con JSON inválido. */ }
    return { status: response.status, body: parsed };
  }
  return {
    sync: (request, signal) => send("/motor/sincronizar", signal, request),
    status: (gameId, signal) => send(`/motor/estado/${encodeURIComponent(gameId)}`, signal),
    step: (request, signal) => send("/paso", signal, request),
  };
}
