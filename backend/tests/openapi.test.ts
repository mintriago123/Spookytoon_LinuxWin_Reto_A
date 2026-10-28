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
    "/simulador/iniciar", "/simulador/configuracion/{gameId}", "/simulador/prevalidar", "/simulador/pausar", "/simulador/reanudar", "/simulador/reiniciar",
    "/simulador/bloquear-arista", "/simulador/rondas", "/estado", "/ws", "/operador/sesion", "/operador/salir"]) assert(document.paths[route], route);
  const { app, simulator } = await createBackendApp({ apiKey: "openapi-validation-test", logger: false });
  try {
    // /operador/sesion (login) y /operador/salir (logout) son el único POST
    // público: sin ellos el operador nunca podría obtener la cookie de
    // sesión. GET /operador/sesion sí exige credencial (confirma la sesión).
    const PUBLIC_POST_PATHS = new Set(["/operador/sesion", "/operador/salir"]);
    for (const [path, operations] of Object.entries(document.paths) as [string, any][]) {
      for (const method of Object.keys(operations)) {
        const isProtected = (method === "post" && !PUBLIC_POST_PATHS.has(path)) || path.startsWith("/motor/") ||
          (method === "get" && (["/operador/sesion", "/simulador/rondas"].includes(path) || path.startsWith("/simulador/configuracion/")));
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
    const catalogCheck = ajv.compile(resolved.components.schemas.RoundCatalog);
    const catalog = await app.inject({ method: "GET", url: "/simulador/rondas",
      headers: { "x-api-key": "openapi-validation-test" } });
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalogCheck(catalog.json()), true, JSON.stringify(catalogCheck.errors));
    const prepared = await app.inject({ method: "POST", url: "/simulador/prevalidar",
      headers: { "x-api-key": "openapi-validation-test" }, payload: {
        gameId: "openapi-game", roundId: 1, seed: "api-contract", graphVersion: catalog.json().graphVersion,
      } });
    assert.equal(prepared.statusCode, 200);
    const preparationCheck = ajv.compile(resolved.components.schemas.PreparationResponse);
    assert.equal(preparationCheck(prepared.json()), true, JSON.stringify(preparationCheck.errors));
    assert.equal(preparationCheck({ ...prepared.json(), unexpected: true }), false);
    const check = ajv.compile(resolved.components.schemas.WorldSnapshot);
    const started = await app.inject({ method: "POST", url: "/simulador/iniciar",
      headers: { "x-api-key": "openapi-validation-test" }, payload: { gameId: "openapi-game", roundId: 1, seed: "api-contract",
        preparationRevision: prepared.json().preparationRevision } });
    assert.equal(started.statusCode, 202);
    const configuration = await app.inject({ url: "/simulador/configuracion/openapi-game",
      headers: { "x-api-key": "openapi-validation-test" } });
    assert.equal(configuration.statusCode, 200);
    const configurationCheck = ajv.compile(resolved.components.schemas.GameConfiguration);
    assert.equal(configurationCheck(configuration.json()), true, JSON.stringify(configurationCheck.errors));
    const current = (await app.inject("/estado")).json();
    assert.equal(check(current), true, JSON.stringify(check.errors));
    assert.equal(check({ ...current, injected: true }), false);
    // Un DTO incompleto y campos extra nunca satisfacen el contrato público.
    assert.equal(check({ schemaVersion: "1.0.0", injected: true }), false);
    const errorCheck = ajv.compile(resolved.components.schemas.Error);
    assert(errorCheck((await app.inject({ method: "POST", url: "/simulador/pausar", payload: {} })).json()));
    const headers = { "x-api-key": "openapi-validation-test" };
    await app.inject({ method: "POST", url: "/simulador/pausar", headers, payload: { reason: "test" } });
    await simulator.whenStopped();
    const repeat = { gameId: "openapi-repeat", roundId: 1, seed: "api-contract", graphVersion: catalog.json().graphVersion,
      restart: { sourceGameId: "openapi-game", sourceConfigurationRevision: configuration.json().configurationIdentity.revision, reuseSavedConfig: true } };
    const preview = await app.inject({ method: "POST", url: "/simulador/prevalidar", headers, payload: repeat });
    assert.equal(preview.statusCode, 200);
    assert.equal(preparationCheck(preview.json()), true, JSON.stringify(preparationCheck.errors));
    const restartBody = { gameId: repeat.gameId, roundId: 1, seed: repeat.seed, restart: repeat.restart,
      preparationRevision: preview.json().preparationRevision };
    const restartCheck = ajv.compile(resolved.components.schemas.RestartRequest);
    assert.equal(restartCheck(restartBody), true, JSON.stringify(restartCheck.errors));
    assert.equal((await app.inject({ method: "POST", url: "/simulador/reiniciar", headers, payload: restartBody })).statusCode, 202);
  } finally { await app.close(); }
});
