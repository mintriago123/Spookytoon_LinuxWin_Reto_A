import assert from "node:assert/strict";
import { test } from "node:test";
import { GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { loadGraph } from "../src/modules/graph/load-graph.ts";
import { createRoundPresets } from "../src/config/round-presets.ts";
import { createWorldState, createInitialTelemetryMetrics } from "../src/modules/simulator/world-state.ts";
import { createPersistenceAdapter, DynamoDbPersistenceAdapter, InMemoryPersistenceAdapter } from "../src/modules/persistence/index.ts";
import { SnapshotQueue } from "../src/modules/persistence/snapshot-queue.ts";
import { recoverWorld } from "../src/modules/persistence/recovery.ts";
import { createBackendApp } from "../src/server.ts";
import { setTimeout as delay } from "node:timers/promises";

async function fixture() {
  const { graph } = await loadGraph(); const config = createRoundPresets(graph)[1];
  return createWorldState({ graph, gameId: "recover-fixture", roundConfig: config,
    randomState: { seed: "recovery-seed", algorithm: "sha256-counter", algorithmVersion: "1", strategy: "per-zombie-turn-draw" },
    initialMetrics: createInitialTelemetryMetrics(config), updatedAt: "2026-10-28T00:00:00.000Z" });
}

function fakeDynamo(legacy = false) {
  const items = new Map<string, any>();
  const key = (item: any) => legacy ? `${item.gameId}|${item.turnId}` : `${item.PK}|${item.SK}`;
  let failParts = false;
  return { items, set failParts(value: boolean) { failParts = value; },
    async send(command: GetCommand | PutCommand | TransactWriteCommand) {
      if (command instanceof GetCommand) return { Item: structuredClone(items.get(key(command.input.Key))) };
      if (command instanceof PutCommand) {
        if (failParts) throw new Error("simulated failure");
        items.set(key(command.input.Item), structuredClone(command.input.Item)); return {};
      }
      const writes = command.input.TransactItems!;
      for (const write of writes) items.set(key(write.Put!.Item), structuredClone(write.Put!.Item));
      return {};
    } };
}

test("factory sin tabla o sin red de tests usa memoria; DynamoDB conserva defaults Ohio", async () => {
  assert(createPersistenceAdapter({}) instanceof InMemoryPersistenceAdapter);
  assert(createPersistenceAdapter({ NODE_ENV: "test", DYNAMODB_TABLE_NAME: "configured" }) instanceof InMemoryPersistenceAdapter);
  const adapter = new DynamoDbPersistenceAdapter();
  assert.equal(adapter.region, process.env.AWS_REGION ?? "us-east-2");
  assert.equal(adapter.tableName, process.env.DYNAMODB_TABLE_NAME ?? "spookython-manta-state");
  await adapter.close();
});

for (const chunkBytes of [256 * 1024, 100]) test(`DynamoDB roundtrip y recuperación pausada; fragmento ${chunkBytes}`, async () => {
  const transport = fakeDynamo();
  const adapter = new DynamoDbPersistenceAdapter({ document: transport, describe: async () => {}, chunkBytes });
  const world = await fixture(); world.status = "running"; world.turnId = 3; world.worldVersion = 3;
  try {
    await adapter.initialize(); await adapter.save(world);
    const recovered = (await adapter.loadLatestPausedGame())!;
    assert.equal(recovered.status, "paused"); assert.equal(recovered.turnId, 3);
    assert.equal(recovered.routing.confirmed, null);
    assert(!Object.hasOwn(recovered, "graph"));
    const restored = recoverWorld(recovered, world.graph as any);
    assert.deepEqual(restored.survivors, world.survivors);
    assert.equal(restored.randomState.seed, world.randomState.seed);
    assert.throws(() => recoverWorld({ ...recovered, graphVersion: "wrong" }, world.graph as any));
    const manifest = transport.items.get("GAME#recover-fixture|TURN#000003");
    if (chunkBytes === 100) {
      assert(manifest.parts.length > 1);
      transport.items.delete(`GAME#recover-fixture|${manifest.parts[0]}`);
    } else manifest.checksum = "bad";
    await assert.rejects(adapter.loadLatestPausedGame(), /fragmento|Checksum/);
  } finally { await adapter.close(); }
});

test("fragmentación incompleta nunca mueve el puntero al nuevo turno", async () => {
  const transport = fakeDynamo();
  const adapter = new DynamoDbPersistenceAdapter({ document: transport, describe: async () => {}, chunkBytes: 100 });
  try {
    await adapter.initialize(); const world = await fixture(); await adapter.save(world);
    world.turnId = 1; world.worldVersion = 1; transport.failParts = true;
    await assert.rejects(adapter.save(world));
    assert.equal((await adapter.loadLatestPausedGame())!.turnId, 0);
  } finally { await adapter.close(); }
});

test("cola no bloquea, respeta límite, hace 3 reintentos y alarma sin rechazos huérfanos", async () => {
  const adapter = new InMemoryPersistenceAdapter(); await adapter.initialize();
  const world = await fixture(); const alarms: string[] = [], waits: number[] = [];
  let attempts = 0;
  adapter.save = async () => { attempts++; throw new Error("offline"); };
  const queue = new SnapshotQueue(adapter, { limit: 1, random: () => 0.5,
    sleep: async ms => { waits.push(ms); }, onAlarm: e => alarms.push(e.code) });
  assert.equal(queue.enqueue(world), true); assert.equal(attempts, 0);
  assert.equal(queue.enqueue(world), false);
  await assert.rejects(queue.flush());
  assert.equal(attempts, 4); assert.deepEqual(waits, [100, 200, 400]);
  assert.deepEqual(alarms, ["SNAPSHOT_QUEUE_FULL", "SNAPSHOT_WRITE_FAILED"]);
  assert.equal(queue.isHealthy(), false); assert.equal(queue.stats().depth, 1);
  await assert.rejects(queue.close());
});

test("cola conserva orden de commits y drena al cerrar", async () => {
  const adapter = new InMemoryPersistenceAdapter(); await adapter.initialize();
  const world = await fixture(); const order: number[] = [];
  const save = adapter.save.bind(adapter);
  adapter.save = async w => { order.push(w.turnId); await save(w); };
  const queue = new SnapshotQueue(adapter);
  queue.enqueue({ ...world, turnId: 1 }); queue.enqueue({ ...world, turnId: 2 });
  await queue.flush(); assert.deepEqual(order, [1, 2]); assert.equal(queue.stats().lastSnapshotTurnId, 2);
  await queue.close(); assert.equal(adapter.isReady(), false);
});

test("agotamiento de persistencia pausa la partida y readiness responde 503", async () => {
  const persistence = new InMemoryPersistenceAdapter();
  persistence.save = async () => { throw new Error("storage unavailable"); };
  const { app, simulator, queue } = await createBackendApp({ apiKey: "persistence-failure-test", logger: false, persistence });
  try {
    assert.equal((await app.inject("/health/ready")).statusCode, 200);
    const response = await app.inject({ method: "POST", url: "/simulador/iniciar",
      headers: { "x-api-key": "persistence-failure-test" }, payload: { gameId: "queue-failure", roundId: 1, seed: "queue" } });
    assert.equal(response.statusCode, 202);
    for (let i = 0; i < 100 && simulator.getCommittedWorld()?.status !== "paused"; i++) await delay(20);
    assert.equal(simulator.getCommittedWorld()!.status, "paused");
    assert.equal(queue.stats().failures, 1);
    assert.equal((await app.inject("/health/ready")).statusCode, 503);
  } finally { await app.close(); }
});

test("servidor restaura checkpoint pausado antes de GET y admite reanudar/reiniciar sin tocar el reloj", async () => {
  const persistence = new InMemoryPersistenceAdapter(); await persistence.initialize();
  const world = await fixture(); world.status = "running"; world.turnId = 4; world.worldVersion = 4;
  await persistence.save(world);
  const { app, simulator, engine, queue } = await createBackendApp({ apiKey: "persistence-recovery-test", logger: false, persistence });
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const state = await app.inject("/estado"); assert.equal(state.statusCode, 200);
    assert.equal(state.json().status, "paused"); assert.equal(state.json().turnId, 4);
    const payload = { gameId: world.gameId, roundId: 1, seed: world.rngSeed };
    const headers = { "x-api-key": "persistence-recovery-test" };
    const committed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error("La partida recuperada no avanzó")); }, 5_000);
      const off = simulator.subscribeCommitted(state => {
        if (state.turnId === 5) { clearTimeout(timer); off(); resolve(); }
      });
    });
    assert.equal((await app.inject({ method: "POST", url: "/simulador/reanudar", headers,
      payload: { gameId: world.gameId, roundId: 1 } })).statusCode, 202);
    assert.equal((await app.inject({ method: "POST", url: "/simulador/reiniciar", headers,
      payload: { ...payload, gameId: "next" } })).statusCode, 409);
    await committed;
    assert.equal(simulator.getCommittedWorld()!.worldVersion, 5);
    assert.equal(engine.getStatus(world.gameId).installed!.worldVersion, 1, "Motor nuevo instala desde base 0");
    assert(simulator.getCommittedWorld()!.survivors.some((s, i) => s.nodeId !== world.survivors[i].nodeId));
    simulator.pause("test"); await simulator.whenStopped(); await queue.flush();
    assert.equal((await persistence.loadLatestPausedGame())!.turnId, 5);
    assert.equal((await app.inject({ method: "POST", url: "/simulador/reiniciar", headers,
      payload: { ...payload, gameId: "next" } })).statusCode, 202);
    assert.equal(simulator.getCommittedSnapshot()!.turnId, 0);
    assert.equal(simulator.getCommittedSnapshot()!.gameId, "next");
  } finally { await app.close(); }
});


for (const chunkBytes of [262144, 100]) test(`tabla EC2 gameId/turnId conserva checkpoints y fragmentos (${chunkBytes})`, async () => {
  const transport = fakeDynamo(true);
  const adapter = new DynamoDbPersistenceAdapter({ document: transport, chunkBytes, describe: async () => ({
    $metadata: {}, Table: { TableStatus: "ACTIVE", KeySchema: [{ AttributeName: "gameId", KeyType: "HASH" }, { AttributeName: "turnId", KeyType: "RANGE" }],
      AttributeDefinitions: [{ AttributeName: "gameId", AttributeType: "S" }, { AttributeName: "turnId", AttributeType: "N" }] },
  }) });
  try {
    await adapter.initialize(); const world = await fixture(); world.turnId = 7; world.worldVersion = 7;
    await adapter.save(world);
    assert(transport.items.has("GAME#recover-fixture|7")); assert(transport.items.has("META#LATEST|-1"));
    assert.equal((await adapter.loadLatestPausedGame())!.turnId, 7);
    assert.equal((await adapter.loadLatestPausedGame())!.status, "paused");
  } finally { await adapter.close(); }
});
