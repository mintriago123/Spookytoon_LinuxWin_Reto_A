/** Experimento manual de transporte; no acredita ventanas de publicación del runtime.
 * node backend/tests/fixtures/routing-pool-experiment.ts [8,16,32,64,128,200] > pool.jsonl
 * Mismo motor, grafo y presets simulados que el smoke; cada caso usa conexiones frías.
 */
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { startBackendServer } from "../../src/server.ts";
import { createRoundPresets } from "../../src/config/round-presets.ts";
import { createRoutingClient } from "../../src/modules/simulator/routing-client.ts";
import { createWorldState, createInitialTelemetryMetrics } from "../../src/modules/simulator/world-state.ts";
import { TurnCoordinator } from "../../src/modules/simulator/turn-coordinator.ts";

const apiKey = "routing-pool-experiment-key";
const pools = (process.argv[2] ?? "8,16,32,64,128,200").split(",").map(Number);
if (!pools.length || pools.some(pool => !Number.isSafeInteger(pool) || pool < 1 || pool > 200)) throw new Error("Pool inválido");
function percentile(values: number[], rank = 0.95) {
  values.sort((a, b) => a - b);
  return values.length ? Math.round(values[Math.ceil(values.length * rank) - 1] * 1_000) / 1_000 : null;
}

for (const repetition of [1, 2, 3]) {
  for (const maxSockets of repetition % 2 ? pools : [...pools].reverse()) {
    for (const roundId of [1, 2, 3] as const) {
      const { app, graph } = await startBackendServer({ apiKey, port: 0, logger: false });
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("Sin dirección de loopback");
      const client = createRoutingClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey, maxSockets });
      const roundConfig = createRoundPresets(graph)[roundId];
      const world = createWorldState({ gameId: `pool-${repetition}-${maxSockets}-${roundId}`, graph, roundConfig,
        initialMetrics: createInitialTelemetryMetrics(roundConfig), updatedAt: new Date().toISOString(),
        randomState: { seed: "manta-smoke", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" } });
      const coordinator = new TurnCoordinator(world, { client, syncTimeoutMs: 500, now: () => performance.now(),
        isoNow: () => new Date().toISOString(), emitAlert: () => {} });
      coordinator.resume();
      for (const [index, event] of roundConfig.eventPlan.entries()) coordinator.scheduleEdge({
        eventId: `pool-event-${index}`, edgeId: event.edgeId, bloqueada: true, motivo: "Experimento de transporte", effectiveTurnId: 2 });
      const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
      let previousTimeouts = 0;
      try {
        for (let turnId = 1; turnId <= 3; turnId++) {
          const cpu = process.cpuUsage(); const started = performance.now();
          await coordinator.runTurn(started + 2_000);
          const wallMs = performance.now() - started;
          const usedCpu = process.cpuUsage(cpu);
          const current = coordinator.getCommittedWorld();
          const samples = client.getTimings!().filter(sample => sample.turnId === turnId);
          const steps = samples.filter(sample => sample.operation === "step");
          console.log(JSON.stringify({ repetition, maxSockets, roundId, turnId, wallMs,
            cpuMs: (usedCpu.user + usedCpu.system) / 1_000, eventLoopMaxMs: loop.max / 1e6,
            metrics: current.metrics, timing: coordinator.getLastTurnTiming(),
            turnTimeouts: current.metrics.routeTimeouts - previousTimeouts,
            transport: { samples: steps.length, p50Ms: percentile(steps.map(s => s.totalMs), 0.5),
              p95Ms: percentile(steps.map(s => s.totalMs)), beforeSocketMs: percentile(steps.map(s => s.beforeSocketMs)),
              queuedForSocket: steps.filter(s => s.queuedForSocket).length,
              socketQueueMs: percentile(steps.map(s => s.socketQueueMs)),
              connectMs: percentile(steps.map(s => s.connectMs)), responseWaitMs: percentile(steps.map(s => s.responseWaitMs)),
              bodyMs: percentile(steps.map(s => s.bodyMs)), engineMs: percentile(steps.flatMap(s => s.engineMs === null ? [] : [s.engineMs])),
              aborted: steps.filter(s => s.aborted).length }, sync: samples.filter(s => s.operation !== "step") }));
          previousTimeouts = current.metrics.routeTimeouts; loop.reset();
          if (current.status !== "running") break;
        }
      } finally { loop.disable(); client.close?.(); await app.close(); }
    }
  }
}
