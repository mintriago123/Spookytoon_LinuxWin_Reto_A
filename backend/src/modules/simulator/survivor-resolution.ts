import type { PasoResponse, RouteShelter, RouteSurvivor, RouteZombie } from "../../contracts/routing.ts";
import type {
  Bite, BiteEvidence, DecisionBatch, Immutable, InstalledRoutingVersion,
  RouteAttempt, ShelterAdmissionResult, SurvivorDecision, SurvivorMovementResult,
  SurvivorResolutionContext, SurvivorTraversal, WaitCause, ZombieTraversal,
} from "./types.ts";

const responseKeys = [
  "gameId", "turnId", "worldVersion", "survivorId", "fromNodeId", "toNodeId",
  "edgeId", "decision", "targetShelterId", "reason", "routeCost", "latencyMs",
];
const reasons = ["ruta-segura", "sin-ruta-segura", "nodo-bloqueado",
  "no-hay-refugio-disponible", "fallback-interno"];

function isResponse(value: unknown): value is PasoResponse {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== responseKeys.length ||
      !responseKeys.every(key => Object.hasOwn(item, key))) return false;
  const text = (key: string) => typeof item[key] === "string" && item[key].length > 0;
  return ["gameId", "survivorId", "fromNodeId", "toNodeId"].every(text) &&
    Number.isSafeInteger(item.turnId) && (item.turnId as number) >= 1 &&
    Number.isSafeInteger(item.worldVersion) && (item.worldVersion as number) >= 0 &&
    (item.edgeId === null || text("edgeId")) &&
    (item.targetShelterId === null || text("targetShelterId")) &&
    (item.decision === "mover" || item.decision === "esperar") &&
    reasons.includes(item.reason as string) &&
    (item.routeCost === null || (typeof item.routeCost === "number" &&
      Number.isFinite(item.routeCost) && item.routeCost >= 0)) &&
    typeof item.latencyMs === "number" && Number.isFinite(item.latencyMs) && item.latencyMs >= 0;
}

export function resolveSurvivorDecisions(
  context: Immutable<SurvivorResolutionContext>,
  routing:
    | { kind: "confirmed"; installed: Immutable<InstalledRoutingVersion>; attempts: readonly RouteAttempt[] }
    | { kind: "sync-failed"; status?: number; error?: unknown },
): DecisionBatch {
  const installed = routing.kind === "confirmed" ? routing.installed : null;
  const confirmed = installed !== null && installed.gameId === context.gameId &&
    installed.turnId === context.turnId && installed.worldVersion === context.worldVersion &&
    installed.graphVersion === context.graph.metadata.graphVersion;
  const attempts = new Map<string, RouteAttempt[]>();
  if (routing.kind === "confirmed") for (const attempt of routing.attempts) {
    const list = attempts.get(attempt.request.survivorId) ?? [];
    list.push(attempt);
    attempts.set(attempt.request.survivorId, list);
  }
  const unauthorized = (routing.kind === "sync-failed" && routing.status === 401) ||
    [...attempts.values()].some(list => list.some(attempt => attempt.kind === "error" && attempt.status === 401));
  const edges = new Map(context.graph.aristas.map(edge => [edge.id, edge]));
  const nodes = new Set(context.graph.nodos.map(node => node.id));
  const shelters = new Map(context.shelters.map(shelter => [shelter.id, shelter]));
  const blocked = new Set(context.blockedEdges.filter(block =>
    block.bloqueadaDesdeTurno <= context.turnId &&
    (block.desbloqueadaEnTurno === null || context.turnId < block.desbloqueadaEnTurno))
    .flatMap(block => [...block.edgeIds]));
  const hazards = new Set([
    ...context.hordeDangerNodeIds,
    ...context.visibleZombies.filter(zombie => zombie.estado === "activo").map(zombie => zombie.nodeId),
    ...context.cameraObservations.filter(observation => observation.expiresAfterTurnId > context.turnId)
      .map(observation => observation.nodeId),
  ]);
  const decisions: SurvivorDecision[] = context.survivors.filter(s => s.estado === "vivo").map(survivor => {
    const wait = (cause: WaitCause, targetShelterId = survivor.targetShelterId): SurvivorDecision => ({
      survivorId: survivor.id, decision: "esperar", nodeId: survivor.nodeId, targetShelterId, cause,
    });
    if (!confirmed) return wait("sync-failed");
    const list = attempts.get(survivor.id);
    if (!list?.length) return wait("missing-response");
    if (list.length !== 1) return wait("invalid-response");
    const attempt = list[0];
    const request = attempt.request;
    if (request.gameId !== context.gameId || request.turnId !== context.turnId ||
        request.worldVersion !== context.worldVersion || request.currentNodeId !== survivor.nodeId ||
        (request.targetShelterId != null && !shelters.has(request.targetShelterId))) return wait("invalid-response");
    if (attempt.kind === "timeout") return wait("timeout");
    if (!Number.isFinite(attempt.elapsedMs) || attempt.elapsedMs < 0) return wait("invalid-response");
    if (attempt.elapsedMs > 500) return wait("late-response");
    if (attempt.kind === "error") return wait("error");
    const response = attempt.body;
    if (!isResponse(response) || response.gameId !== context.gameId ||
        response.turnId !== context.turnId || response.worldVersion !== context.worldVersion ||
        response.survivorId !== survivor.id || response.fromNodeId !== survivor.nodeId ||
        !nodes.has(response.fromNodeId) || !nodes.has(response.toNodeId)) return wait("invalid-response");
    const shelter = response.targetShelterId === null ? null : shelters.get(response.targetShelterId);
    if (response.targetShelterId !== null && (!shelter ||
        shelter.ocupantes.length + shelter.reservados.length >= shelter.capacidad &&
        !shelter.reservados.includes(survivor.id))) return wait("invalid-response");
    if (response.decision === "esperar") {
      if (response.toNodeId !== survivor.nodeId || response.edgeId !== null || response.routeCost !== null ||
          (shelter && shelter.nodoId !== survivor.nodeId)) return wait("invalid-response");
      // Esperar puede ser válido incluso si el nodo es letal; las mordidas se resuelven después.
      return wait("routing-wait", response.targetShelterId);
    }
    const edge = response.edgeId === null ? undefined : edges.get(response.edgeId);
    if (!edge || edge.origen !== survivor.nodeId || edge.destino !== response.toNodeId ||
        response.toNodeId === survivor.nodeId || response.routeCost === null || !shelter ||
        response.reason !== "ruta-segura" || blocked.has(edge.id) || hazards.has(response.toNodeId) ||
        context.zombieTraversals.some(step => step.fromNodeId === response.toNodeId &&
          step.toNodeId === survivor.nodeId)) return wait("invalid-response");
    return { survivorId: survivor.id, decision: "mover", response: {
      ...response, decision: "mover", edgeId: edge.id,
      targetShelterId: shelter.id, routeCost: response.routeCost,
    } };
  });
  const validResponseSurvivorIds = decisions.filter(decision => decision.decision === "mover" ||
    decision.cause === "routing-wait").map(decision => decision.survivorId);
  const survivorsById = new Map(context.survivors.map(survivor => [survivor.id, survivor]));
  const applied: SurvivorDecision[] = unauthorized ? decisions.map(decision => ({
    survivorId: decision.survivorId, decision: "esperar", nodeId: survivorsById.get(decision.survivorId)!.nodeId,
    targetShelterId: survivorsById.get(decision.survivorId)!.targetShelterId, cause: "authorization-failed",
  })) : decisions;
  return {
    gameId: context.gameId, turnId: context.turnId, worldVersion: context.worldVersion,
    decisions: applied, validResponseSurvivorIds,
    pauseCause: unauthorized ? "routing-unauthorized" : null,
    alertCode: unauthorized ? "ROUTING_UNAUTHORIZED" : null,
  };
}

/** Recibe decisiones validadas contra una única vista; nunca encadena movimientos. */
export function applySimultaneousSurvivorMoves(
  survivors: Immutable<RouteSurvivor[]>,
  decisions: Immutable<SurvivorDecision[]>,
): SurvivorMovementResult {
  const byId = new Map<string, Immutable<SurvivorDecision>[]>();
  for (const decision of decisions) {
    const list = byId.get(decision.survivorId) ?? [];
    list.push(decision); byId.set(decision.survivorId, list);
  }
  const traversals: SurvivorTraversal[] = [];
  const moved = survivors.map(survivor => {
    const list = byId.get(survivor.id);
    const decision = list?.length === 1 ? list[0] : undefined;
    if (survivor.estado !== "vivo" || !decision) return { ...survivor };
    if (decision.decision === "esperar") return { ...survivor, targetShelterId: decision.targetShelterId };
    const response = decision.response;
    if (response.survivorId !== survivor.id || response.fromNodeId !== survivor.nodeId) return { ...survivor };
    traversals.push({ survivorId: survivor.id, fromNodeId: survivor.nodeId,
      toNodeId: response.toNodeId, edgeId: response.edgeId });
    return { ...survivor, nodeId: response.toNodeId, targetShelterId: response.targetShelterId };
  });
  return { survivors: moved, traversals };
}

export function detectBites(input: {
  survivors: Immutable<RouteSurvivor[]>;
  visibleZombies: Immutable<RouteZombie[]>;
  hordeDangerNodeIds: readonly string[];
  survivorTraversals: Immutable<SurvivorTraversal[]>;
  zombieTraversals: Immutable<ZombieTraversal[]>;
}): Bite[] {
  const danger = new Set(input.hordeDangerNodeIds);
  const bites: Bite[] = [];
  for (const survivor of input.survivors) {
    if (survivor.estado !== "vivo") continue;
    const evidence: BiteEvidence[] = [];
    for (const zombie of input.visibleZombies) if (zombie.estado === "activo" && zombie.nodeId === survivor.nodeId) {
      evidence.push({ kind: "same-node", zombieId: zombie.id, nodeId: survivor.nodeId });
    }
    if (danger.has(survivor.nodeId)) evidence.push({ kind: "horde-zone", nodeId: survivor.nodeId });
    for (const traversal of input.survivorTraversals) if (traversal.survivorId === survivor.id) {
      for (const step of input.zombieTraversals) if (step.fromNodeId === traversal.toNodeId &&
          step.toNodeId === traversal.fromNodeId) {
        evidence.push({ kind: "front-crossing", survivorTraversal: { ...traversal }, zombieTraversal: { ...step } });
      }
    }
    if (evidence.length) bites.push({ survivorId: survivor.id, evidence });
  }
  return bites;
}

export function applyBites(
  turnId: number,
  survivors: Immutable<RouteSurvivor[]>,
  bites: Immutable<Bite[]>,
): RouteSurvivor[] {
  const bitten = new Set(bites.filter(bite => bite.evidence.length > 0).map(bite => bite.survivorId));
  return survivors.map(survivor => survivor.estado === "vivo" && bitten.has(survivor.id)
    ? { ...survivor, estado: "mordido", eliminadoEnTurno: turnId, targetShelterId: null }
    : { ...survivor });
}

export function resolveShelterAdmissions(input: {
  turnId: number;
  survivorsAfterBites: Immutable<RouteSurvivor[]>;
  shelters: Immutable<RouteShelter[]>;
}): ShelterAdmissionResult {
  const survivors = input.survivorsAfterBites.map(survivor => ({ ...survivor }));
  const byId = new Map(survivors.map(survivor => [survivor.id, survivor]));
  const claimedReservations = new Set<string>();
  const shelters = input.shelters.map(shelter => ({ ...shelter,
    ocupantes: [...new Set(shelter.ocupantes)], reservados: [...new Set(shelter.reservados)].filter(id => {
      const survivor = byId.get(id);
      if (!survivor || survivor.estado !== "vivo" || claimedReservations.has(id) ||
          (survivor.targetShelterId !== null && survivor.targetShelterId !== shelter.id)) return false;
      claimedReservations.add(id); return true;
    }) }));
  const admissions: ShelterAdmissionResult["admissions"] = [];
  for (const shelter of shelters) {
    if (shelter.ocupantes.length + shelter.reservados.length > shelter.capacidad) {
      throw new Error(`El refugio ${shelter.id} excede su capacidad`);
    }
    const reserved = new Set(shelter.reservados);
    const candidates = survivors.filter(survivor => survivor.estado === "vivo" && survivor.nodeId === shelter.nodoId)
      .sort((a, b) => Number(reserved.has(b.id)) - Number(reserved.has(a.id)) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const survivor of candidates) {
      const holdsReservation = shelter.reservados.includes(survivor.id);
      const free = shelter.capacidad - shelter.ocupantes.length - shelter.reservados.length;
      if (!holdsReservation && free <= 0) continue;
      if (shelter.ocupantes.length >= shelter.capacidad) continue;
      shelter.reservados = shelter.reservados.filter(id => id !== survivor.id);
      survivor.estado = "evacuado";
      survivor.evacuadoEnTurno = input.turnId;
      survivor.targetShelterId = shelter.id;
      shelter.ocupantes.push(survivor.id);
      admissions.push({ survivorId: survivor.id, shelterId: shelter.id });
    }
  }
  // Una llegada a otro refugio libera la reserva anterior en el mismo commit.
  for (const shelter of shelters) shelter.reservados = shelter.reservados.filter(id => byId.get(id)?.estado === "vivo");
  return { survivors, shelters, admissions };
}
