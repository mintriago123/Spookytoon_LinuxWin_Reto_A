import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import { loadGraph } from "./modules/graph/load-graph.ts";
import { RouteEngine } from "./modules/routing/route-engine.ts";
import { RoutingWorkerPool } from "./modules/routing/worker-pool.ts";
import { validateWorldSyncRequest } from "./contracts/routing-validation.ts";
import { createPersistenceAdapter, type PersistenceAdapter } from "./modules/persistence/index.ts";
import { SnapshotQueue } from "./modules/persistence/snapshot-queue.ts";
import { recoverWorld } from "./modules/persistence/recovery.ts";
import type { RoutingClient } from "./modules/simulator/routing-client.ts";
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
  logger?: FastifyServerOptions["logger"];
  requestLogging?: boolean;
  persistence?: PersistenceAdapter;
  workerCount?: number;
  snapshotQueueLimit?: number;
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
  if (apiKey.length < 16) throw new Error("ROUTE_API_KEY requiere al menos 16 caracteres");
  const workers = new RoutingWorkerPool(graph, { size: options.workerCount ?? Number(process.env.ROUTING_WORKERS ?? 1) });
  const persistence = options.persistence ?? createPersistenceAdapter();
  const engine = new RouteEngine(graph, { workerCount: workers.size });
  const detailedRequests = options.requestLogging ?? process.env.LOG_HTTP_REQUESTS === "true";
  const app = Fastify({ bodyLimit: 1_048_576, logger: options.logger ?? true, logController: new LogController({ disableRequestLogging: !detailedRequests }) });
  // En producción se conservan controles, errores y lentitud; los agregados se
  // publican periódicamente sin dos escrituras de log por cada /paso exitoso.
  if (!detailedRequests) app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 400 && reply.elapsedTime < 150 && !request.url.startsWith("/simulador/")) return;
    const body = request.body && typeof request.body === "object" ? request.body as Record<string, unknown> : {};
    app.log.info({ event: "http-response", requestId: request.id, path: request.routeOptions.url,
      gameId: typeof body.gameId === "string" ? body.gameId : undefined,
      turnId: typeof body.turnId === "number" ? body.turnId : undefined,
      worldVersion: typeof body.worldVersion === "number" ? body.worldVersion : undefined,
      statusCode: reply.statusCode, durationMs: reply.elapsedTime });
  });
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
  let saturationRecovery = false;
  const queue = new SnapshotQueue(persistence, { limit: options.snapshotQueueLimit,
    onAlarm: event => {
      app.log.error({ event: "persistence-alarm", ...event });
      if (event.code === "SNAPSHOT_QUEUE_FULL" && saturationRecovery) return;
      if (event.code === "SNAPSHOT_QUEUE_FULL") saturationRecovery = true;
      // El callback de commit puede estar activo: solicitar pausa en el siguiente microtask.
      queueMicrotask(() => {
        if (simulator.getCommittedWorld()?.status === "running") simulator.pause(event.code);
        if (event.code === "SNAPSHOT_QUEUE_FULL") void queue.flush().then(() => {
          const paused = simulator.getCommittedWorld();
          if (paused?.status === "paused") queue.enqueue(paused);
        }).catch(() => { /* El fallo persistente ya emite alarma y deja readiness en 503. */ })
          .finally(() => { saturationRecovery = false; });
      });
    } });
  let initialized = false, closing = false;
  app.register(routingPlugin, { engine, apiKey,
    readiness: () => initialized && !closing && engine.isInitialized() && workers.isReady() && persistence.isReady() && queue.isHealthy(),
    synchronize: async value => {
      const request = validateWorldSyncRequest(value, graph);
      // Idempotencia y conflictos se comprueban en el escritor antes de publicar el plan.
      const installed = engine.getStatus(request.gameId).installed;
      if (installed && request.turnId <= installed.turnId) return engine.sync(request);
      const computed = await workers.compute(request);
      return engine.sync(request, computed);
    } });
  const rounds = { ...createRoundPresets(graph), ...options.simulator?.rounds };
  const simulator = new SimulationRuntime({ ...options.simulator, rounds,
    initialMetrics: options.simulator?.initialMetrics ?? (roundId =>
      createInitialTelemetryMetrics(validateRoundConfig(rounds[roundId], graph))),
    graph, syncTimeoutMs: 500,
    getPersistenceProgress: () => { const stats = queue.stats(); return {
      snapshotQueueDepth: stats.depth, lastSnapshotTurnId: stats.lastSnapshotTurnId,
    }; },
    clientFactory: () => {
      let client: RoutingClient | undefined;
      const get = () => {
        if (client) return client;
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("El servidor HTTP todavía no escucha");
        return client = createRoutingClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey, maxSockets: 16 });
      };
      return { sync: (r, signal) => get().sync(r, signal), status: (id, signal) => get().status(id, signal),
        step: (r, signal) => get().step(r, signal), close: () => client?.close?.(), getTimings: () => client?.getTimings?.() ?? [] };
    }, emitAlert: alert => app.log.error(alert), onFailure: event => app.log.error(event) });
  app.register(simulatorPlugin, { runtime: simulator, apiKey });
  app.register(realtimePlugin, { runtime: simulator, allowedOrigins: origins });
  const unsubscribe = simulator.subscribeCommitted(() => {
    const world = simulator.getCommittedWorld();
    if (world) queue.enqueue(world);
  });
  app.addHook("onReady", async () => {
    try {
      await workers.initialize();
      await persistence.initialize();
      const restored = await persistence.loadLatestPausedGame();
      if (restored) simulator.restorePaused(recoverWorld(restored, graph));
      initialized = true;
      app.log.info({ event: "dependencies-ready", region: process.env.AWS_REGION ?? "us-east-2", workers: workers.size,
        persistence: persistence.constructor.name, recovered: !!restored });
    } catch (error) { await workers.close(); await persistence.close(); throw error; }
  });
  app.addHook("preClose", async () => { closing = true; await simulator.close(); });
  app.addHook("onClose", async () => {
    unsubscribe();
    try { await queue.close(); } catch { app.log.error({ event: "snapshot-flush-failed" }); }
    await workers.close();
  });
  const telemetry = setInterval(() => {
    const world = simulator.getCommittedWorld();
    app.log.info({ event: "backend-metrics", gameId: world?.gameId, turnId: world?.turnId, worldVersion: world?.worldVersion,
      routeP95Ms: world?.metrics.routeLatencyP95Ms ?? 0, routeTimeouts: world?.metrics.routeTimeouts ?? 0,
      wsClients: world?.metrics.wsClients ?? 0, snapshotQueue: queue.stats(), workersReady: workers.isReady(), rssBytes: process.memoryUsage().rss });
  }, 30_000);
  telemetry.unref(); app.addHook("onClose", async () => clearInterval(telemetry));
  return { app, engine, graph, simulator, workers, persistence, queue };
}

export async function startBackendServer(options: BackendOptions & { port?: number; host?: string } = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 3001);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < (options.port === 0 ? 0 : 1) || port > 65535) throw new Error("PORT inválido");
  const backend = await createBackendApp(options);
  const { app, graph, workers } = backend;
  try { await app.listen({ port, host }); }
  catch (error) { await app.close(); throw error; }
  app.log.info({ event: "backend-ready", host, port, graphVersion: graph.metadata.graphVersion,
    nodes: graph.nodos.length, edges: graph.aristas.length, workerCount: workers.size });
  return backend;
}

function isMain() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

/** Entrada explícita para supervisores que importan el módulo (p. ej. PM2). */
export async function runBackendServer(): Promise<void> {
  const { app } = await startBackendServer();
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
    if (stopping) return; stopping = true;
    void app.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  });
}
if (isMain()) runBackendServer().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
