import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyReply, type FastifyRequest } from "fastify";
import { RoutingError, type RoutingStatusResponse } from "../../contracts/routing.ts";
import { RouteEngine } from "./route-engine.ts";

export interface RoutingServerOptions {
  engine: RouteEngine;
  apiKey: string;
  bodyLimitBytes?: number;
  logger?: boolean;
  readiness?: () => boolean;
  synchronize?: (value: unknown) => Promise<unknown>;
}

function authorized(header: string | string[] | undefined, expectedHash: Buffer) {
  const candidate = Array.isArray(header) ? header.join(",") : header;
  const candidateHash = createHash("sha256").update(candidate ?? "").digest();
  const matches = timingSafeEqual(candidateHash, expectedHash);
  return !!candidate && matches;
}

function sendError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof RoutingError) {
    return reply.code(error.status).send({ error: { code: error.code, message: error.message, requestId: request.id } });
  }
  const statusCode = error && typeof error === "object" && "statusCode" in error &&
    typeof error.statusCode === "number" ? error.statusCode : 500;
  if (statusCode >= 400 && statusCode < 500) {
    const code = statusCode === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR";
    return reply.code(statusCode).send({ error: { code, message: "Petición HTTP inválida", requestId: request.id } });
  }
  request.log.error({ event: "routing-request-failed", requestId: request.id,
    message: error instanceof Error ? error.message : "unknown error" });
  return reply.code(503).send({ error: { code: "ROUTE_UNAVAILABLE",
    message: "Motor de rutas no disponible", requestId: request.id } });
}

export const routingPlugin: FastifyPluginAsync<RoutingServerOptions> = async (app, options) => {
  if (!options.apiKey || options.apiKey.length < 16) throw new Error("Configure ROUTE_API_KEY con al menos 16 caracteres");
  const expectedHash = createHash("sha256").update(options.apiKey).digest();
  app.setErrorHandler((error, request, reply) => sendError(request, reply, error));
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (authorized(request.headers["x-api-key"], expectedHash)) return;
    request.log.error({ event: "routing-auth-failed", requestId: request.id, path: request.url },
      "Clave de routing ausente o inválida");
    return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Autenticación requerida", requestId: request.id } });
  };

  app.get("/health/live", async () => ({ status: "live" }));
  app.get("/health/ready", async (_request, reply) => {
    const ready = options.readiness?.() ?? options.engine.isInitialized();
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "not-ready" });
  });
  app.get<{ Params: { gameId: string }; Reply: RoutingStatusResponse }>("/motor/estado/:gameId", {
    preHandler: auth,
  }, async (request, reply) => {
    try { return options.engine.getStatus(request.params.gameId); }
    catch (error) { return sendError(request, reply, error); }
  });
  app.post("/motor/sincronizar", { preHandler: auth }, async (request, reply) => {
    try { return options.synchronize ? await options.synchronize(request.body) : options.engine.sync(request.body); }
    catch (error) { return sendError(request, reply, error); }
  });
  app.post("/paso", { preHandler: auth }, async (request, reply) => {
    try { return options.engine.step(request.body); }
    catch (error) { return sendError(request, reply, error); }
  });
};

export async function createRoutingApp(options: RoutingServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: options.bodyLimitBytes ?? 1_048_576, logger: options.logger ?? false });
  app.register(routingPlugin, options);
  return app;
}
