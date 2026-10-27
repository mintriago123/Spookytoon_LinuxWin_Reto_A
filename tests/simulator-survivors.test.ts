import assert from "node:assert/strict";
import { test } from "node:test";
import type { PasoResponse, RouteSurvivor, RouteZombie } from "../backend/src/contracts/routing.ts";
import type {
  Immutable, InstalledRoutingVersion, RouteAttempt, SurvivorResolutionContext, ZombieTraversal,
} from "../backend/src/modules/simulator/types.ts";
import {
  applyBites, applySimultaneousSurvivorMoves, detectBites,
  resolveShelterAdmissions, resolveSurvivorDecisions,
} from "../backend/src/modules/simulator/survivor-resolution.ts";

// Grafo mínimo de prueba unitaria; no es configuración de una ronda.
function survivor(id = "S", nodeId = "A", estado: RouteSurvivor["estado"] = "vivo"): RouteSurvivor {
  return { id, nodeId, estado, targetShelterId: null,
    eliminadoEnTurno: estado === "mordido" ? 1 : null, evacuadoEnTurno: estado === "evacuado" ? 1 : null };
}
function zombie(nodeId: string, estado: RouteZombie["estado"] = "activo"): RouteZombie {
  return { id: "Z", nodeId, tipo: "caminante", estado,
    despertadoEnTurno: null, siguienteMovimientoTurno: 2 };
}
function context(): SurvivorResolutionContext {
  return {
    gameId: "game", turnId: 2, worldVersion: 7,
    graph: {
      schemaVersion: "1.0.0", metadata: { ciudad: "Manta", graphVersion: "unit-test",
        generatedAt: "2026-10-27T00:00:00Z", source: "OpenStreetMap", osmAttribution: "test" },
      nodos: ["A", "B", "C", "R"].map(id => ({ id, lat: 0, lng: 0, zona: "Tarqui" })),
      aristas: [["AB", "A", "B"], ["BA", "B", "A"], ["BR", "B", "R"]].map(([id, origen, destino]) => ({
        id, origen, destino, segmentoId: id === "BR" ? "BR" : "AB",
        distancia_m: 1, tipo: "calle", factor_velocidad: 0.8,
      })),
      refugios: [{ id: "REF", nodoId: "R", capacidad: 2 }],
    },
    survivors: [survivor()], visibleZombies: [],
    shelters: [{ id: "REF", nodoId: "R", capacidad: 2, ocupantes: [], reservados: [] }],
    blockedEdges: [], hordeDangerNodeIds: [], zombieTraversals: [],
  };
}
function response(changes: Partial<PasoResponse> = {}): PasoResponse {
  return { gameId: "game", turnId: 2, worldVersion: 7, survivorId: "S",
    fromNodeId: "A", toNodeId: "B", edgeId: "AB", decision: "mover",
    targetShelterId: "REF", reason: "ruta-segura", routeCost: 2, latencyMs: 1, ...changes };
}
function attempt(body: unknown = response(), elapsedMs = 1): RouteAttempt {
  return { kind: "response", body, elapsedMs, request: {
    gameId: "game", turnId: 2, worldVersion: 7, survivorId: "S", currentNodeId: "A",
  } };
}
function installed(): InstalledRoutingVersion {
  return { gameId: "game", turnId: 2, worldVersion: 7, graphVersion: "unit-test" };
}
function resolve(ctx: Immutable<SurvivorResolutionContext> = context(), attempts = [attempt()], version = installed()) {
  return resolveSurvivorDecisions(ctx, { kind: "confirmed", installed: version, attempts });
}
function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}
function expectWait(ctx: SurvivorResolutionContext, attempts: RouteAttempt[], cause = "invalid-response") {
  const decision = resolve(freeze(ctx), attempts).decisions[0];
  assert.equal(decision.decision, "esperar");
  if (decision.decision === "esperar") {
    assert.equal(decision.nodeId, "A");
    assert.equal(decision.cause, cause);
  }
}

test("acepta una arista segura y conserva inmutables contexto e intentos", () => {
  const ctx = context(); const before = structuredClone(ctx);
  const tries = [attempt()]; freeze(tries);
  const batch = resolve(freeze(ctx), tries);
  assert.equal(batch.decisions[0].decision, "mover");
  assert.deepEqual(ctx, before);
  assert.deepEqual([batch.gameId, batch.turnId, batch.worldVersion], ["game", 2, 7]);
});

test("sin sync vigente nadie usa un plan viejo", () => {
  const ctx = context(); ctx.survivors.push(survivor("dead", "B", "mordido"));
  for (const version of [
    { ...installed(), gameId: "other" }, { ...installed(), turnId: 1 },
    { ...installed(), worldVersion: 6 }, { ...installed(), graphVersion: "other" },
  ]) {
    const decisions = resolve(ctx, [attempt()], version).decisions;
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision === "esperar" && decisions[0].cause, "sync-failed");
  }
  assert.equal(resolveSurvivorDecisions(ctx, { kind: "sync-failed" }).decisions[0].decision, "esperar");
});

test("rechaza esquema incompleto, campos extra, números inválidos e identidades incorrectas", () => {
  const missing: Partial<PasoResponse> = response(); delete missing.edgeId;
  for (const body of [null, [], "response", {}, missing, { ...response(), extra: true },
    response({ gameId: "other" }), response({ survivorId: "other" }), response({ turnId: 1 }),
    response({ worldVersion: 6 }), response({ fromNodeId: "B" }), response({ toNodeId: "missing" }),
    response({ latencyMs: NaN }), response({ latencyMs: -1 }), response({ routeCost: Infinity }),
    response({ routeCost: -1 }), response({ reason: "unknown" as PasoResponse["reason"] }),
    response({ decision: "unknown" as PasoResponse["decision"] }),
    response({ targetShelterId: "unknown" }), response({ targetShelterId: null }),
    response({ edgeId: null }), response({ routeCost: null }), response({ edgeId: "BA" }),
    response({ edgeId: "unknown" }), response({ toNodeId: "R" }),
  ]) expectWait(context(), [attempt(body)]);
});

test("valida también el request y rechaza duplicados sin elegir una respuesta arbitraria", () => {
  for (const changes of [{ gameId: "other" }, { turnId: 1 }, { worldVersion: 6 },
    { currentNodeId: "B" }, { targetShelterId: "unknown" }]) {
    const item = attempt(); item.request = { ...item.request, ...changes };
    expectWait(context(), [item]);
  }
  expectWait(context(), [attempt(), attempt()]);
  expectWait(context(), [], "missing-response");
});

test("timeout, error y respuesta tardía producen espera usando tiempo explícito", () => {
  const item = attempt();
  expectWait(context(), [{ request: item.request, elapsedMs: 500, kind: "timeout" }], "timeout");
  expectWait(context(), [{ request: item.request, elapsedMs: 10, kind: "error", error: "HTTP 503" }], "error");
  expectWait(context(), [attempt(response(), 500.01)], "late-response");
  expectWait(context(), [attempt(response(), NaN)]);
  expectWait(context(), [attempt(response(), -1)]);
  assert.equal(resolve(context(), [attempt(response(), 500)]).decisions[0].decision, "mover");
});

test("bloqueos respetan intervalo y cada dirección; zombie, horda y ambos pasos impiden movimiento", () => {
  const ctx = context();
  ctx.blockedEdges = [{ segmentoId: "AB", edgeIds: ["AB", "BA"], motivo: "test",
    origen: "evento-ciudad", bloqueadaDesdeTurno: 2, desbloqueadaEnTurno: 3 }];
  expectWait(ctx, [attempt()]);
  const reopened = structuredClone(ctx);
  reopened.blockedEdges[0].bloqueadaDesdeTurno = 1;
  reopened.blockedEdges[0].desbloqueadaEnTurno = 2;
  assert.equal(resolve(reopened).decisions[0].decision, "mover");
  const future = structuredClone(ctx);
  future.blockedEdges[0].bloqueadaDesdeTurno = 3;
  future.blockedEdges[0].desbloqueadaEnTurno = null;
  assert.equal(resolve(future).decisions[0].decision, "mover");
  for (const stepIndex of [1, 2] as const) {
    const ctx = context();
    ctx.zombieTraversals = [{ zombieId: "Z", fromNodeId: "B", toNodeId: "A", edgeId: "BA", stepIndex }];
    expectWait(ctx, [attempt()]);
  }
  const occupied = context(); occupied.visibleZombies = [zombie("B")]; expectWait(occupied, [attempt()]);
  const horde = context(); horde.hordeDangerNodeIds = ["B"]; expectWait(horde, [attempt()]);
  const full = context(); full.shelters[0].ocupantes = ["old1", "old2"]; expectWait(full, [attempt()]);
});

test("una espera válida en nodo letal conserva routing-wait y después termina en mordida", () => {
  const ctx = context(); ctx.visibleZombies = [zombie("A")];
  const batch = resolve(ctx, [attempt(response({ decision: "esperar", toNodeId: "A",
    edgeId: null, routeCost: null, targetShelterId: null, reason: "nodo-bloqueado" }))]);
  assert.equal(batch.decisions[0].decision === "esperar" && batch.decisions[0].cause, "routing-wait");
  const moved = applySimultaneousSurvivorMoves(freeze(ctx.survivors), freeze(batch.decisions));
  const bites = detectBites({ ...ctx, ...moved, survivorTraversals: moved.traversals });
  assert.equal(applyBites(2, moved.survivors, bites)[0].estado, "mordido");
  for (const changes of [{ toNodeId: "B" }, { edgeId: "AB" }, { routeCost: 0 }, { targetShelterId: "REF" }]) {
    expectWait(context(), [attempt(response({ decision: "esperar", toNodeId: "A", edgeId: null,
      routeCost: null, targetShelterId: null, ...changes }))]);
  }
});

test("movimientos simultáneos permiten compartir destino y mantienen terminales", () => {
  const ctx = context(); ctx.survivors.push(survivor("S2"), survivor("dead", "A", "mordido"));
  const second = attempt(response({ survivorId: "S2" })); second.request = { ...second.request, survivorId: "S2" };
  const batch = resolve(ctx, [attempt(), second]);
  const moved = applySimultaneousSurvivorMoves(freeze(ctx.survivors), freeze(batch.decisions));
  assert.deepEqual(moved.survivors.map(s => s.nodeId), ["B", "B", "A"]);
  assert.equal(moved.traversals.length, 2);
  const repeated = applySimultaneousSurvivorMoves(ctx.survivors, [...batch.decisions, batch.decisions[0]]);
  assert.equal(repeated.survivors[0].nodeId, "A");
  const changedOrigin = applySimultaneousSurvivorMoves([survivor("S", "C")], batch.decisions);
  assert.equal(changedOrigin.traversals.length, 0);
});

test("detecta las tres causas de mordida, incluidos pasos intermedios del corredor", () => {
  const survivors = [survivor("node", "C"), survivor("horde", "R"), survivor("cross", "B"),
    survivor("safe", "A"), survivor("dead", "C", "mordido"), survivor("out", "C", "evacuado")];
  const steps: ZombieTraversal[] = [
    { zombieId: "runner", fromNodeId: "B", toNodeId: "A", edgeId: "BA", stepIndex: 1 },
    { zombieId: "runner", fromNodeId: "A", toNodeId: "C", edgeId: "AC", stepIndex: 2 },
  ];
  const bites = detectBites(freeze({ survivors, visibleZombies: [zombie("C")], hordeDangerNodeIds: ["R"],
    survivorTraversals: [{ survivorId: "cross", fromNodeId: "A", toNodeId: "B", edgeId: "AB" }],
    zombieTraversals: steps }));
  assert.deepEqual(bites.map(b => b.survivorId), ["node", "horde", "cross"]);
  assert.deepEqual(bites.map(b => b.evidence[0].kind), ["same-node", "horde-zone", "front-crossing"]);
  const after = applyBites(2, freeze(survivors), freeze(bites));
  assert.deepEqual(after.map(s => s.estado), ["mordido", "mordido", "mordido", "vivo", "mordido", "evacuado"]);
  assert.equal(after[0].eliminadoEnTurno, 2);
  assert.equal(after[4].eliminadoEnTurno, 1);
  assert.equal(after[5].evacuadoEnTurno, 1);
});

test("sync fallido no evita resolver mordidas y las mordidas preceden refugios", () => {
  const ctx = context(); ctx.survivors = [survivor("S", "R")]; ctx.visibleZombies = [zombie("R")];
  const batch = resolveSurvivorDecisions(ctx, { kind: "sync-failed" });
  const moved = applySimultaneousSurvivorMoves(ctx.survivors, batch.decisions);
  const bites = detectBites({ ...ctx, survivors: moved.survivors, survivorTraversals: moved.traversals });
  const result = resolveShelterAdmissions({ turnId: 2, shelters: ctx.shelters,
    survivorsAfterBites: applyBites(2, moved.survivors, bites) });
  assert.equal(result.survivors[0].estado, "mordido");
  assert.deepEqual(result.admissions, []);
});

test("admisión incluye quienes esperan, desempata por código de ID y respeta cupos", () => {
  const ctx = context(); ctx.shelters[0].ocupantes = ["old"];
  const people = [survivor("a", "R"), survivor("Z", "R"), survivor("A", "R", "mordido"),
    survivor("old", "R", "evacuado")];
  const input = { turnId: 2, survivorsAfterBites: people, shelters: ctx.shelters };
  const before = structuredClone(input);
  const result = resolveShelterAdmissions(freeze(input));
  assert.deepEqual(result.admissions, [{ survivorId: "Z", shelterId: "REF" }]);
  assert.equal(result.survivors[0].estado, "vivo");
  assert.deepEqual(result.shelters[0].ocupantes, ["old", "Z"]);
  assert.deepEqual(input, before);
  const reversed = resolveShelterAdmissions({ ...input, survivorsAfterBites: [...people].reverse() });
  assert.deepEqual(reversed.admissions, result.admissions);
  assert.deepEqual(resolveShelterAdmissions({ turnId: 3, survivorsAfterBites: result.survivors,
    shelters: result.shelters }).admissions, []);
});

test("no interpreta reservas mientras su política siga pendiente", () => {
  const ctx = context(); ctx.shelters[0].reservados = ["S"];
  assert.throws(() => resolveShelterAdmissions(freeze({ turnId: 2,
    survivorsAfterBites: ctx.survivors, shelters: ctx.shelters })), /reservas pendiente/);
});

test("un lote de 200 decisiones no depende del orden de respuestas ni del orden de sobrevivientes", () => {
  const ctx = context(); ctx.survivors = Array.from({ length: 200 }, (_, i) => survivor(`S-${i}`));
  const attempts = ctx.survivors.map(s => {
    const item = attempt(response({ survivorId: s.id }));
    item.request = { ...item.request, survivorId: s.id }; return item;
  });
  const result = resolve(freeze(ctx), attempts);
  const reversed = resolve({ ...ctx, survivors: [...ctx.survivors].reverse() }, [...attempts].reverse());
  assert.deepEqual([...reversed.decisions].reverse(), result.decisions);
  assert.equal(applySimultaneousSurvivorMoves(ctx.survivors, result.decisions).traversals.length, 200);
});

test("dos sobrevivientes intercambian nodos desde la misma vista y no se muerden entre sí", () => {
  const ctx = context(); ctx.survivors = [survivor("S"), survivor("S2", "B")];
  const other = attempt(response({ survivorId: "S2", fromNodeId: "B", toNodeId: "A", edgeId: "BA" }));
  other.request = { ...other.request, survivorId: "S2", currentNodeId: "B" };
  const batch = resolve(freeze(ctx), [other, attempt()]);
  const moved = applySimultaneousSurvivorMoves(ctx.survivors, batch.decisions);
  assert.deepEqual(moved.survivors.map(s => s.nodeId), ["B", "A"]);
  assert.deepEqual(detectBites({ ...ctx, survivors: moved.survivors, survivorTraversals: moved.traversals }), []);
});

test("dormidos no activos no son peligro visible; despertar sigue siendo responsabilidad de otra fase", () => {
  const ctx = context(); ctx.visibleZombies = [{ ...zombie("B", "dormido"), tipo: "dormido" }];
  const batch = resolve(ctx);
  assert.equal(batch.decisions[0].decision, "mover");
  const moved = applySimultaneousSurvivorMoves(ctx.survivors, batch.decisions);
  assert.deepEqual(detectBites({ ...ctx, survivors: moved.survivors, survivorTraversals: moved.traversals }), []);
});
