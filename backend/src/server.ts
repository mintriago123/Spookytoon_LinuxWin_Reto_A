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

export async function createBackendApp(options: { apiKey?: string; simulator?: ScenarioOptions; frontendOrigin?: string } = {}) {
  const manifest = JSON.parse(await readFile(new URL("../data/graph-manifest.json", import.meta.url), "utf8")) as {
    graphVersion: string; sha256: string;
  };
  const { graph } = await loadGraph(new URL("../data/grafo_manta.json", import.meta.url), manifest);
  const apiKey = options.apiKey ?? process.env.ROUTE_API_KEY;
  if (!apiKey) throw new Error("ROUTE_API_KEY es obligatoria");
  const engine = new RouteEngine(graph);
  const app = Fastify({ bodyLimit: 1_048_576, logger: true });
  app.decorate("routeEngine", engine);
  app.register(routingPlugin, { engine, apiKey });
  const simulator = new SimulationRuntime({ ...options.simulator, graph, syncTimeoutMs: 500,
    clientFactory: () => {
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("El servidor HTTP todavía no escucha");
      return createRoutingClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey });
    }, emitAlert: alert => app.log.error(alert), onFailure: event => app.log.error(event) });
  app.register(simulatorPlugin, { runtime: simulator, apiKey });
  const frontendOrigin = options.frontendOrigin ?? process.env.FRONTEND_ORIGIN;
  app.register(realtimePlugin, { runtime: simulator, allowedOrigins: frontendOrigin ? [frontendOrigin] : [] });
  return { app, engine, graph, simulator };
}

export async function startBackendServer() {
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? "127.0.0.1";
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT inválido");
  const { app, engine, graph } = await createBackendApp();
  await app.listen({ port, host });
  app.log.info({ event: "backend-ready", host, port, graphVersion: graph.metadata.graphVersion,
    nodes: graph.nodos.length, edges: graph.aristas.length, workerCount: 1 });
  return { app, engine, graph };
}

function isMain() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain()) startBackendServer().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
