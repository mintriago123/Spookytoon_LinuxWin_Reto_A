import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { createRoutingClient } from "../src/modules/simulator/routing-client.ts";

test("transporte HTTP cancela solicitudes, conserva errores y no sigue redirecciones", async () => {
  const app = Fastify();
  let redirectedRequests = 0;
  app.get("/motor/estado/slow", async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    return { installed: null };
  });
  app.get("/motor/estado/invalid", async (_request, reply) => reply.code(503).type("text/plain").send("invalid json"));
  app.get("/motor/estado/redirect", async (_request, reply) => reply.code(302).header("location", "/destination").send());
  app.get("/destination", async () => { redirectedRequests++; return {}; });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const client = createRoutingClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "transport-test-secret" });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20);
    try { await assert.rejects(client.status("slow", controller.signal), error => error instanceof Error && error.name === "AbortError"); }
    finally { clearTimeout(timer); }
    assert.deepEqual(await client.status("invalid", new AbortController().signal), { status: 503, body: null });
    assert.equal((await client.status("redirect", new AbortController().signal)).status, 302);
    assert.equal(redirectedRequests, 0);
    const timings = client.getTimings!();
    assert(Object.isFrozen(timings)); assert(timings.every(Object.isFrozen));
    assert(timings.some(sample => sample.aborted && sample.errorCode === "ABORT_ERR"));
    assert(timings.some(sample => sample.httpStatus === 503));
    assert(timings.every(sample => sample.totalMs >= 0 && sample.beforeSocketMs >= 0));
    assert(!JSON.stringify(timings).includes("transport-test-secret"));
  } finally { client.close?.(); await app.close(); }
});

test("el diagnóstico distingue una cancelación en cola sin socket de una respuesta HTTP", { timeout: 10_000 }, async () => {
  const app = Fastify(); const received: string[] = [];
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const firstEntered = new Promise<void>(resolve => { entered = resolve; });
  app.get<{ Params: { id: string } }>("/motor/estado/:id", async request => {
    received.push(request.params.id); entered(); await blocked; return { installed: null };
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address(); assert(address && typeof address !== "string");
  const client = createRoutingClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "transport-test-secret", maxSockets: 1 });
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); release(); }, 5_000);
  try {
    const first = client.status("first", controller.signal);
    try {
      await firstEntered;
      const queued = new AbortController();
      const second = client.status("queued", queued.signal);
      setImmediate(() => queued.abort());
      const rejected = assert.rejects(second, error => error instanceof Error && error.name === "AbortError");
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(received, ["first"]);
      // Node libera la entrada cancelada del Agent al quedar disponible el socket.
      release();
      await rejected;
      const sample = client.getTimings!().find(sample => sample.aborted);
      assert(sample); assert.equal(sample.errorCode, "ABORT_ERR"); assert.equal(sample.httpStatus, null);
      assert(sample.queuedForSocket); assert(sample.socketQueueMs >= 0 && sample.socketQueueMs <= sample.beforeSocketMs);
      assert.equal(sample.beforeSocketMs, sample.totalMs);
      assert.equal(sample.connectMs, 0); assert.equal(sample.responseWaitMs, 0);
      assert.deepEqual(received, ["first"]);
    } finally { release(); await first; }
  } finally { clearTimeout(timer); release(); controller.abort(); client.close?.(); await app.close(); }
});

test("el pool predeterminado acota conexiones y registra la cola de un lote de 200", { timeout: 10_000 }, async () => {
  const app = Fastify(); let arrived = 0;
  let release!: () => void, waveReady!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstWave = new Promise<void>(resolve => { waveReady = resolve; });
  app.get("/motor/estado/:id", async () => {
    if (++arrived === 16) waveReady();
    await gate; return { installed: null };
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address(); assert(address && typeof address !== "string");
  const client = createRoutingClient({ baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "transport-test-secret" });
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); release(); waveReady(); }, 5_000);
  const results = Promise.allSettled(Array.from({ length: 200 }, (_, id) => client.status(String(id), controller.signal)));
  try {
    await firstWave;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert(!controller.signal.aborted); assert.equal(arrived, 16);
    release();
    const responses = await results;
    assert(responses.every(result => result.status === "fulfilled" && result.value.status === 200));
    assert.equal(arrived, 200);
    const timings = client.getTimings!();
    assert.equal(timings.filter(sample => sample.queuedForSocket).length, 184);
    assert(timings.filter(sample => sample.queuedForSocket).every(sample => sample.socketQueueMs > 0 && sample.socketQueueMs <= sample.beforeSocketMs));
  } finally { clearTimeout(timer); release(); controller.abort(); await results; client.close?.(); await app.close(); }
});
