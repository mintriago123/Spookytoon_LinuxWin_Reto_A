import { readFile } from "node:fs/promises";
import { request as httpRequest, Agent } from "node:http";
import { performance } from "node:perf_hooks";
import { createRoutingApp } from "../backend/src/modules/routing/http-server.ts";
import { RouteEngine } from "../backend/src/modules/routing/route-engine.ts";
import { loadGraph } from "../backend/src/modules/graph/load-graph.ts";
import type { WorldSyncRequest } from "../backend/src/contracts/routing.ts";

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function ms(value: number) { return Math.round(value * 1000) / 1000; }

function postJson<T>(url: string, apiKey: string, body: unknown, agent: Agent) {
  const started = performance.now();
  const payload = Buffer.from(JSON.stringify(body));
  return new Promise<{ status: number; body: T; elapsedMs: number }>((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", agent, headers: {
      "content-type": "application/json", "content-length": payload.length, "x-api-key": apiKey,
    } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as T,
            elapsedMs: performance.now() - started });
        } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(payload);
  });
}

function warmConnection(url: string, agent: Agent) {
  return new Promise<void>((resolve, reject) => {
    const request = httpRequest(url, { method: "GET", agent }, response => {
      response.resume(); response.on("end", () => response.statusCode === 200 ? resolve() : reject(new Error("warmup HTTP falló")));
    });
    request.on("error", reject); request.end();
  });
}

async function main() {
  const manifest = JSON.parse(await readFile(new URL("../backend/data/graph-manifest.json", import.meta.url), "utf8")) as {
    graphVersion: string; sha256: string;
  };
  const { graph } = await loadGraph(new URL("../backend/data/grafo_manta.json", import.meta.url), manifest);
  const refugeNodes = new Set(graph.refugios.map(shelter => shelter.nodoId));
  const spawnNodes = graph.nodos.filter(node => !refugeNodes.has(node.id));
  const survivors = Array.from({ length: 200 }, (_, index) => ({
    id: `R3-S${String(index + 1).padStart(3, "0")}`,
    nodeId: spawnNodes[index % spawnNodes.length].id,
    estado: "vivo" as const,
    targetShelterId: null,
    eliminadoEnTurno: null,
    evacuadoEnTurno: null,
  }));
  const sync: WorldSyncRequest = {
    gameId: "routing-benchmark-r3", turnId: 1, baseWorldVersion: 0,
    survivors, zombies: [],
    shelters: graph.refugios.map(shelter => ({ ...shelter, ocupantes: [], reservados: [] })),
    blockedEdges: [], zombieTraversals: [], dormantUncertaintyNodeIds: [],
  };
  const apiKey = "local-routing-benchmark-secret";
  const engine = new RouteEngine(graph);
  const app = await createRoutingApp({ engine, apiKey });
  const agent = new Agent({ keepAlive: true, maxSockets: 200, maxTotalSockets: 200 });
  await app.listen({ port: 0, host: "127.0.0.1" });
  try {
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No se pudo abrir el puerto local");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const syncResponse = await postJson<{ worldVersion: number; buildLatencyMs: number }>(`${baseUrl}/motor/sincronizar`, apiKey, sync, agent);
    if (syncResponse.status !== 200) throw new Error(`sync falló: HTTP ${syncResponse.status}`);
    const syncResult = syncResponse.body;
    await Promise.all(Array.from({ length: 200 }, () => warmConnection(`${baseUrl}/health/live`, agent)));
    const roundTripMs: number[] = []; const engineMs: number[] = [];
    const edgeById = new Map(graph.aristas.map(edge => [edge.id, edge]));
    const replies = await Promise.all(survivors.map(async survivor => {
      const result = await postJson<{ fromNodeId: string; toNodeId: string; edgeId: string | null; latencyMs: number }>(
        `${baseUrl}/paso`, apiKey, { gameId: sync.gameId, turnId: sync.turnId, worldVersion: syncResult.worldVersion,
          survivorId: survivor.id, currentNodeId: survivor.nodeId }, agent);
      const body = result.body;
      if (result.status !== 200) throw new Error(`/paso falló: HTTP ${result.status}`);
      const edge = body.edgeId ? edgeById.get(body.edgeId) : undefined;
      const adjacent = body.fromNodeId === body.toNodeId || (edge?.origen === body.fromNodeId && edge.destino === body.toNodeId);
      if (!adjacent) throw new Error(`Respuesta no adyacente: ${body.fromNodeId} -> ${body.toNodeId}`);
      roundTripMs.push(result.elapsedMs); engineMs.push(body.latencyMs);
      return result.status;
    }));
    const report = {
      graphVersion: graph.metadata.graphVersion,
      simultaneousRequests: survivors.length,
      successfulResponses: replies.filter(status => status === 200).length,
      keepAliveWarmupConnections: 200,
      buildLatencyMs: ms(syncResult.buildLatencyMs),
      httpRoundTripMs: { p50: ms(percentile(roundTripMs, 0.50)), p95: ms(percentile(roundTripMs, 0.95)), p99: ms(percentile(roundTripMs, 0.99)), max: ms(Math.max(...roundTripMs)) },
      routeLookupLatencyMs: { p50: ms(percentile(engineMs, 0.50)), p95: ms(percentile(engineMs, 0.95)), p99: ms(percentile(engineMs, 0.99)), max: ms(Math.max(...engineMs)) },
      p95TargetMs: 150,
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.successfulResponses !== survivors.length || report.httpRoundTripMs.p95 >= report.p95TargetMs) {
      throw new Error("El benchmark no cumplió respuestas válidas o el umbral p95 de 150 ms");
    }
  } finally {
    agent.destroy();
    await app.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
