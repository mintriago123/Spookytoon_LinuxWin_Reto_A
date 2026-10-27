import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { parseEdgeCommand, parsePauseCommand, parseStartCommand, SimulatorControlError } from "./controls.ts";
import type { SimulationRuntime } from "./simulation-runtime.ts";

/** Registra únicamente controles en la aplicación compartida, sin otro servidor. */
export const simulatorPlugin: FastifyPluginAsync<{ runtime: SimulationRuntime; apiKey: string }> = async (app, options) => {
  if (!options.apiKey || options.apiKey.length < 16) throw new Error("Se requiere una clave de controles de al menos 16 caracteres");
  const expectedHash = createHash("sha256").update(options.apiKey).digest();
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SimulatorControlError) return reply.code(error.status).send({ error: {
      code: error.code, message: error.message, requestId: request.id,
    } });
    const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    return reply.code(status >= 400 && status < 500 ? status : 503).send({ error: {
      code: status >= 400 && status < 500 ? "VALIDATION_ERROR" : "SIMULATOR_UNAVAILABLE",
      message: "No se pudo procesar el control del simulador", requestId: request.id,
    } });
  });
  app.addHook("preHandler", async (request, reply) => {
    const header = request.headers["x-api-key"];
    const actual = Array.isArray(header) ? header.join(",") : header;
    const hash = createHash("sha256").update(actual ?? "").digest();
    if (!timingSafeEqual(hash, expectedHash) || !actual) return reply.code(401).send({ error: {
      code: "UNAUTHORIZED", message: "Autenticación requerida", requestId: request.id,
    } });
  });
  app.post("/simulador/iniciar", async (request, reply) => reply.code(202).send(options.runtime.start(parseStartCommand(request.body))));
  app.post("/simulador/pausar", async (request, reply) => reply.code(202).send(options.runtime.pause(parsePauseCommand(request.body).reason)));
  app.post("/simulador/bloquear-arista", async (request, reply) => reply.code(202).send(options.runtime.scheduleEdge(parseEdgeCommand(request.body))));
  app.addHook("onClose", async () => { await options.runtime.close(); });
};
