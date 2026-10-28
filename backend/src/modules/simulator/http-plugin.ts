import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { parseEdgeCommand, parsePauseCommand, parseResumeCommand, parseStartCommand, SimulatorControlError } from "./controls.ts";
import type { SimulationRuntime } from "./simulation-runtime.ts";
import { createOperatorSessionStore, OPERATOR_SESSION_COOKIE, parseCookies } from "./operator-session.ts";

/** Registra únicamente controles en la aplicación compartida, sin otro servidor. */
export const simulatorPlugin: FastifyPluginAsync<{
  runtime: SimulationRuntime;
  apiKey: string;
  /** Contraseña de operador para /operador/sesion; si no se define usa la
   *  misma apiKey (igual que el fallback ya validado en server.ts), para que
   *  quien registre este plugin directamente sin pasar por createBackendApp
   *  (p. ej. los tests de integración en tests/ de la raíz) siga funcionando
   *  sin tener que conocer esta opción nueva. */
  operatorPassword?: string;
}> = async (app, options) => {
  if (!options.apiKey || options.apiKey.length < 16) throw new Error("Se requiere una clave de controles de al menos 16 caracteres");
  const operatorPassword = options.operatorPassword ?? options.apiKey;
  if (operatorPassword.length < 8) throw new Error("Se requiere una contraseña de operador de al menos 8 caracteres");
  const expectedHash = createHash("sha256").update(options.apiKey).digest();
  const expectedPasswordHash = createHash("sha256").update(operatorPassword).digest();
  const sessions = createOperatorSessionStore();

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

  // request.protocol refleja X-Forwarded-Proto gracias a trustProxy en
  // createBackendApp; Caddy (infra/Caddyfile) solo reenvía desde EC2, así
  // que es seguro confiarlo. En local (http) se degrada a SameSite=Lax sin
  // Secure porque un navegador descarta una cookie Secure fijada por http.
  function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string | null) {
    const secure = request.protocol === "https";
    const attrs = ["Path=/", "HttpOnly", secure ? "Secure; SameSite=None" : "SameSite=Lax"];
    attrs.push(token === null ? "Max-Age=0" : `Max-Age=${Math.floor(8 * 60 * 60)}`);
    reply.header("Set-Cookie", `${OPERATOR_SESSION_COOKIE}=${token ?? ""}; ${attrs.join("; ")}`);
  }

  // Login/logout quedan fuera del contexto protegido de abajo a propósito:
  // sin ellos el operador nunca podría obtener la cookie de sesión.
  app.post("/operador/sesion", async (request, reply) => {
    const body = request.body as { password?: unknown } | undefined;
    // Tope alineado con OperadorSesionRequest.password (maxLength 256 en
    // openapi.yaml): un valor fuera de rango se trata igual que una
    // contraseña incorrecta, sin distinguir el motivo en la respuesta.
    const password = typeof body?.password === "string" && body.password.length <= 256 ? body.password : "";
    const hash = createHash("sha256").update(password).digest();
    if (!password || !timingSafeEqual(hash, expectedPasswordHash)) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Contraseña de operador incorrecta", requestId: request.id } });
    }
    setSessionCookie(request, reply, sessions.create());
    return reply.code(204).send();
  });
  app.post("/operador/salir", async (request, reply) => {
    sessions.revoke(parseCookies(request.headers.cookie)[OPERATOR_SESSION_COOKIE]);
    setSessionCookie(request, reply, null);
    return reply.code(204).send();
  });

  // Contexto hijo: el preHandler de abajo solo aplica a las rutas
  // registradas dentro de este `register`, nunca a /operador/sesion ni
  // /operador/salir de arriba (encapsulación de Fastify).
  await app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", async (request, reply) => {
      const header = request.headers["x-api-key"];
      const actual = Array.isArray(header) ? header.join(",") : header;
      if (actual) {
        const hash = createHash("sha256").update(actual).digest();
        if (timingSafeEqual(hash, expectedHash)) return;
      }
      const cookieToken = parseCookies(request.headers.cookie)[OPERATOR_SESSION_COOKIE];
      if (sessions.isValid(cookieToken)) return;
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "Autenticación requerida", requestId: request.id } });
    });
    // Permite al Frontend confirmar si la cookie de sesión sigue vigente
    // sin disparar un control real (RoundControls la llama al montar).
    protectedApp.get("/operador/sesion", async (_request, reply) => reply.code(204).send());
    protectedApp.post("/simulador/iniciar", async (request, reply) => reply.code(202).send(options.runtime.start(parseStartCommand(request.body))));
    protectedApp.post("/simulador/reanudar", async (request, reply) => {
      const command = parseResumeCommand(request.body);
      const current = options.runtime.getCommittedWorld();
      if (!current || current.status !== "paused") {
        throw new SimulatorControlError(409, "GAME_STATE_CONFLICT", "Solo se reanuda una partida pausada");
      }
      return reply.code(202).send(options.runtime.resume({ ...command, seed: command.seed ?? current.rngSeed }));
    });
    protectedApp.post("/simulador/reiniciar", async (request, reply) => reply.code(202).send(await options.runtime.restart(parseStartCommand(request.body))));
    protectedApp.post("/simulador/pausar", async (request, reply) => reply.code(202).send(options.runtime.pause(parsePauseCommand(request.body).reason)));
    protectedApp.post("/simulador/bloquear-arista", async (request, reply) => reply.code(202).send(options.runtime.scheduleEdge(parseEdgeCommand(request.body))));
  });

  app.addHook("onClose", async () => { await options.runtime.close(); });
};
