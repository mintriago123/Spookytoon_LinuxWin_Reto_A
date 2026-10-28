import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import Fastify from "fastify";
import { loadGraph } from "./modules/graph/load-graph.ts";
import { RouteEngine } from "./modules/routing/route-engine.ts";
import { routingPlugin } from "./modules/routing/http-server.ts";
import { SimulationRuntime, type ScenarioOptions } from "./modules/simulator/simulation-runtime.ts";
import { simulatorPlugin } from "./modules/simulator/http-plugin.ts";
import { createRoutingClient } from "./modules/simulator/routing-client.ts";
import { realtimePlugin } from "./modules/realtime/http-plugin.ts";
import { createRoundPresets } from "./config/round-presets.ts";
import { createInitialTelemetryMetrics } from "./modules/simulator/world-state.ts";
import { validateRoundConfig } from "./modules/simulator/round-validation.ts";

export interface BackendOptions {
  apiKey?: string;
  simulator?: ScenarioOptions;
  frontendOrigin?: string;
  logger?: boolean;
}

function frontendOrigins(config: string | undefined): string[] {
  const origins = [...new Set(["http://localhost:5173", "http://localhost:3000",
    "http://127.0.0.1:5173", "http://127.0.0.1:3000", ...(config?.split(",").map(value => value.trim()).filter(Boolean) ?? [])])];
  for (const origin of origins) {
    if (origin === "*") continue;
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) throw new Error("FRONTEND_ORIGIN inválido");
  }
  return origins;
}

export async function createBackendApp(options: BackendOptions = {}) {
  const manifest = JSON.parse(await readFile(new URL("../data/graph-manifest.json", import.meta.url), "utf8")) as {
    graphVersion: string; sha256: string;
  };
  const { graph } = await loadGraph(new URL("../data/grafo_manta.json", import.meta.url), manifest);
  const apiKey = options.apiKey ?? process.env.ROUTE_API_KEY;
  if (!apiKey) throw new Error("ROUTE_API_KEY es obligatoria");
  const engine = new RouteEngine(graph);
  const app = Fastify({ bodyLimit: 1_048_576, logger: options.logger ?? true });
  const origins = frontendOrigins(options.frontendOrigin ?? process.env.FRONTEND_ORIGIN);
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    reply.header("Vary", "Origin");
    if (!origins.includes("*") && !origins.includes(origin)) return reply.code(403).send({ error: {
      code: "ORIGIN_NOT_ALLOWED", message: "Origen no permitido", requestId: request.id,
    } });
    reply.header("Access-Control-Allow-Origin", origin)
      .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      .header("Access-Control-Allow-Headers", "Content-Type, x-api-key")
      .header("Access-Control-Max-Age", "600");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });
  app.options("/*", async (_request, reply) => reply.code(204).send());
  app.decorate("routeEngine", engine);
  app.register(routingPlugin, { engine, apiKey });
  const rounds = { ...createRoundPresets(graph), ...options.simulator?.rounds };
  const simulator = new SimulationRuntime({ ...options.simulator, rounds,
    initialMetrics: options.simulator?.initialMetrics ?? (roundId =>
      createInitialTelemetryMetrics(validateRoundConfig(rounds[roundId], graph))),
    graph, syncTimeoutMs: 500,
    clientFactory: () => {
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("El servidor HTTP todavía no escucha");
      return createRoutingClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey });
    }, emitAlert: alert => app.log.error(alert), onFailure: event => app.log.error(event) });
  app.register(simulatorPlugin, { runtime: simulator, apiKey });
  app.register(realtimePlugin, { runtime: simulator, allowedOrigins: origins });
  return { app, engine, graph, simulator };
}

export async function startBackendServer(options: BackendOptions & { port?: number; host?: string } = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 3001);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < (options.port === 0 ? 0 : 1) || port > 65535) throw new Error("PORT inválido");
  const { app, engine, graph, simulator } = await createBackendApp(options);
  await app.listen({ port, host });
  app.log.info({ event: "backend-ready", host, port, graphVersion: graph.metadata.graphVersion,
    nodes: graph.nodos.length, edges: graph.aristas.length, workerCount: 1 });
  return { app, engine, graph, simulator };
}

function isMain() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain()) startBackendServer().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
