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
  } finally { client.close?.(); await app.close(); }
});
