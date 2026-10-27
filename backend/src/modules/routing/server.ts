import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { loadGraph } from "../graph/load-graph.ts";
import { RouteEngine } from "./route-engine.ts";
import { createRoutingServer } from "./http-server.ts";

export async function startRoutingServer() {
  const manifest = JSON.parse(await readFile(new URL("../../../data/graph-manifest.json", import.meta.url), "utf8")) as {
    graphVersion: string; sha256: string;
  };
  const { graph } = await loadGraph(new URL("../../../data/grafo_manta.json", import.meta.url), manifest);
  const apiKey = process.env.ROUTE_API_KEY;
  if (!apiKey) throw new Error("ROUTE_API_KEY es obligatoria");
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("PORT inválido");
  const engine = new RouteEngine(graph);
  const server = createRoutingServer({ engine, apiKey });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, process.env.HOST ?? "127.0.0.1", () => {
      server.off("error", reject); resolveListen();
    });
  });
  console.log(JSON.stringify({ event: "routing-ready", port, host: process.env.HOST ?? "127.0.0.1",
    graphVersion: graph.metadata.graphVersion, nodes: graph.nodos.length, edges: graph.aristas.length }));
  return { server, engine };
}

function isMain() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain()) startRoutingServer().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
