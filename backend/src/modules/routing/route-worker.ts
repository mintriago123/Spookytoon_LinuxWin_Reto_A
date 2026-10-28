import { parentPort, workerData } from "node:worker_threads";
import { RouteEngine } from "./route-engine.ts";
import type { MantaGraph } from "../../contracts/types.ts";
import type { RoutingSnapshot } from "../../contracts/routing.ts";

const engine = new RouteEngine(workerData.graph as MantaGraph, { workerCount: workerData.workerCount });
let installed: RoutingSnapshot | null = null;
parentPort!.on("message", ({ id, request }) => {
  try {
    const snapshot = engine.computeSnapshot(request);
    // La versión completa queda instalada en el worker antes de confirmar.
    installed = snapshot;
    parentPort!.postMessage({ id, snapshot: installed });
  } catch {
    parentPort!.postMessage({ id, error: "WORKER_COMPUTE_FAILED" });
  }
});
parentPort!.postMessage({ ready: engine.isInitialized() });
