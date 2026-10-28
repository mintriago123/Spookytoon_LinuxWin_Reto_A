/** Medición aislada en EC2; no escribe DynamoDB ni cambia la partida productiva. */
import { writeFile } from "node:fs/promises";
import { startBackendServer } from "../../src/server.ts";
import { InMemoryPersistenceAdapter } from "../../src/modules/persistence/index.ts";

const results: object[] = [];
for (const requestLogging of [true, false, false, true]) {
  const { app, simulator } = await startBackendServer({ apiKey: "logging-experiment-key", port: 0, logger: true,
    requestLogging, persistence: new InMemoryPersistenceAdapter() });
  let maxP95Ms = 0, minAvailability = 100;
  const ready = new Promise<void>(resolve => {
    const off = simulator.subscribeCommitted(world => {
      maxP95Ms = Math.max(maxP95Ms, world.metrics.routeLatencyP95Ms);
      if (world.metrics.routeSamples) minAvailability = Math.min(minAvailability, world.metrics.routeAvailabilityPercent!);
      if (world.turnId === 6 || world.status === "paused") { off(); resolve(); }
    });
  });
  try {
    await app.inject({ method: "POST", url: "/simulador/iniciar", headers: { "x-api-key": "logging-experiment-key" },
      payload: { gameId: `logging-experiment-${results.length}`, roundId: 3, seed: "ec2-acceptance-3" } });
    await ready;
    const world = simulator.getCommittedSnapshot()!;
    results.push({ requestLogging, turns: world.turnId, maxP95Ms, minAvailability, deadlineMisses: world.metrics.deadlineMisses });
    if (world.status === "running") simulator.pause("Fin de experimento aislado");
    await simulator.whenStopped();
  } finally { await app.close(); }
  await writeFile(process.env.LOGGING_EXPERIMENT_OUTPUT ?? "/tmp/spookython-logging-experiment.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ event: "logging-experiment", ...results.at(-1) }));
}
