import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoutingStatusResponse, SyncResponse, WorldSyncRequest } from "../backend/src/contracts/routing.ts";
import { confirmRoutingSync, markRoutingSyncAttempt, reconcileRoutingStatus } from "../backend/src/modules/simulator/routing-sync.ts";
import type { DecisionBatch, RoutingInstallationState, WorldState } from "../backend/src/modules/simulator/types.ts";
import { applyRoutingFailureSignal } from "../backend/src/modules/simulator/routing-failure.ts";

const graphVersion = "manta-test-v1";

function request(turnId = 1, baseWorldVersion = 0): WorldSyncRequest {
  return { gameId: "sync-test", turnId, baseWorldVersion, survivors: [], zombies: [], shelters: [],
    blockedEdges: [], zombieTraversals: [], dormantUncertaintyNodeIds: [] };
}

function response(turnId: number, worldVersion: number): SyncResponse {
  return { turnId, worldVersion, graphVersion, workerCount: 1, buildLatencyMs: 2, ready: true };
}

const emptyState = (): RoutingInstallationState => ({ confirmed: null, uncertain: false, attemptedRequest: null });

test("registra intento y confirma una respuesta de sincronización exacta", () => {
  const attempted = markRoutingSyncAttempt(emptyState(), request());
  assert.equal(attempted.uncertain, true);
  const confirmed = confirmRoutingSync(attempted, response(1, 1), graphVersion);
  assert.equal(confirmed.uncertain, false);
  assert.deepEqual(confirmed.confirmed, { gameId: "sync-test", turnId: 1, worldVersion: 1, graphVersion });
  assert.equal(confirmed.attemptedRequest, null);
});

test("reconcilia un timeout idempotente y permite reintentar si el motor no instaló el intento", () => {
  const attempted = markRoutingSyncAttempt(emptyState(), request());
  const acceptedStatus: RoutingStatusResponse = { gameId: "sync-test", installed: response(1, 1) };
  assert.equal(reconcileRoutingStatus(attempted, acceptedStatus, graphVersion).action, "confirmed");

  const missingStatus: RoutingStatusResponse = { gameId: "sync-test", installed: null };
  const missing = reconcileRoutingStatus(attempted, missingStatus, graphVersion);
  assert.equal(missing.action, "retry-latest");
  assert.equal(missing.state.uncertain, false);
  assert.equal(missing.state.confirmed, null);
});

test("conserva la última versión confirmada al saltar un turno cuya sync no se instaló", () => {
  const firstAttempt = markRoutingSyncAttempt(emptyState(), request());
  const first = confirmRoutingSync(firstAttempt, response(1, 1), graphVersion);
  const uncertain = markRoutingSyncAttempt(first, request(2, 1));
  const latestStatus: RoutingStatusResponse = { gameId: "sync-test", installed: response(1, 1) };
  const result = reconcileRoutingStatus(uncertain, latestStatus, graphVersion);
  assert.equal(result.action, "retry-latest");
  assert.equal(result.state.confirmed?.worldVersion, 1);
  assert.equal(result.state.uncertain, false);
  const turn3 = markRoutingSyncAttempt(result.state, request(3, 1));
  assert.equal(turn3.attemptedRequest?.turnId, 3);
});

test("pausa si el estado consultado no coincide con el grafo o la versión esperada", () => {
  const attempted = markRoutingSyncAttempt(emptyState(), request());
  const wrongGraph: RoutingStatusResponse = { gameId: "sync-test", installed: { ...response(1, 1), graphVersion: "other" } };
  assert.equal(reconcileRoutingStatus(attempted, wrongGraph, graphVersion).action, "pause");
  assert.throws(() => confirmRoutingSync(attempted, response(1, 2), graphVersion));
});

test("401 programa pausa al cierre del turno y produce una alerta sin incluir secretos", () => {
  const batch: DecisionBatch = { gameId: "sync-test", turnId: 4, worldVersion: 3, decisions: [],
    pauseCause: "routing-unauthorized", alertCode: "ROUTING_UNAUTHORIZED" };
  const state = { gameId: "sync-test", activeTurnId: 4, pause: { status: "none" } } as unknown as WorldState;
  const alert = applyRoutingFailureSignal(state, batch);
  assert.equal(state.pause.status, "requested");
  assert.equal(state.pause.cause, "routing-unauthorized");
  assert.equal(state.pause.afterTurnId, 4);
  assert.deepEqual(alert, { level: "critical", code: "ROUTING_UNAUTHORIZED", gameId: "sync-test", turnId: 4,
    message: "La clave del motor de rutas fue rechazada; partida en pausa" });
  assert(!JSON.stringify(alert).includes("secret"));
});
