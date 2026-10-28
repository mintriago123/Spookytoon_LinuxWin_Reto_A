import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import SwaggerParser from "@apidevtools/swagger-parser";
import { parse } from "yaml";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createBackendApp } from "../src/server.ts";

test("OpenAPI 3.1 válido, referencias resueltas y endpoints reales con seguridad correcta", async () => {
  const document = parse(await readFile(new URL("../openapi/openapi.yaml", import.meta.url), "utf8"));
  await SwaggerParser.validate(structuredClone(document));
  assert.equal(document.openapi, "3.1.0");
  for (const route of ["/health/live", "/health/ready", "/motor/sincronizar", "/motor/estado/{gameId}", "/paso",
    "/simulador/iniciar", "/simulador/pausar", "/simulador/reanudar", "/simulador/reiniciar",
    "/simulador/bloquear-arista", "/estado", "/ws", "/operador/sesion", "/operador/salir"]) assert(document.paths[route], route);
  const { app } = await createBackendApp({ apiKey: "openapi-validation-test", logger: false });
  try {
    // /operador/sesion (login) y /operador/salir (logout) son el único POST
    // público: sin ellos el operador nunca podría obtener la cookie de
    // sesión. GET /operador/sesion sí exige credencial (confirma la sesión).
    const PUBLIC_POST_PATHS = new Set(["/operador/sesion", "/operador/salir"]);
    for (const [path, operations] of Object.entries(document.paths) as [string, any][]) {
      for (const method of Object.keys(operations)) {
        const isProtected = (method === "post" && !PUBLIC_POST_PATHS.has(path)) || path.startsWith("/motor/") ||
          (method === "get" && path === "/operador/sesion");
        const route = path.replace("{gameId}", "unknown");
        const response = await app.inject({ method: method.toUpperCase() as "GET" | "POST", url: route });
        assert.notEqual(response.statusCode, 404, `${method} ${path}`);
        if (isProtected) { assert.equal(response.statusCode, 401); assert.deepEqual(operations[method].security, [{ ApiKey: [] }]); }
        else assert.deepEqual(operations[method].security, []);
      }
    }
    const resolved: any = await SwaggerParser.dereference(structuredClone(document));
    const ajv = new Ajv2020({ strict: false });
    (addFormats as unknown as (ajv: Ajv2020) => void)(ajv);
    const check = ajv.compile(resolved.components.schemas.WorldSnapshot);
    const started = await app.inject({ method: "POST", url: "/simulador/iniciar",
      headers: { "x-api-key": "openapi-validation-test" }, payload: { gameId: "openapi-game", roundId: 1, seed: "api-contract" } });
    assert.equal(started.statusCode, 202);
    const current = (await app.inject("/estado")).json();
    assert.equal(check(current), true, JSON.stringify(check.errors));
    assert.equal(check({ ...current, injected: true }), false);
    // Un DTO incompleto y campos extra nunca satisfacen el contrato público.
    assert.equal(check({ schemaVersion: "1.0.0", injected: true }), false);
    const errorCheck = ajv.compile(resolved.components.schemas.Error);
    assert(errorCheck((await app.inject({ method: "POST", url: "/simulador/pausar", payload: {} })).json()));
  } finally { await app.close(); }
});
