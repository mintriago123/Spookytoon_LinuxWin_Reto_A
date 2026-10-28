import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { buildAdjacency } from "../graph/adjacency.ts";
import type { MantaGraph, GraphEdge } from "../../contracts/types.ts";
import { RoutingError, type PasoRequest, type PasoResponse, type RoutePlanEntry,
  type RoutePlanSnapshot, type RoutingEngineOptions, type RoutingSnapshot,
  type RoutingStatusResponse, type SyncResponse, type WorldSyncRequest } from "../../contracts/routing.ts";
import { validatePasoRequest, validateWorldSyncRequest } from "../../contracts/routing-validation.ts";

interface HeapEntry { node: number; cost: number; shelterId: string }

class MinHeap {
  private readonly values: HeapEntry[] = [];
  get size() { return this.values.length; }
  push(value: HeapEntry) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.values[parent], value) <= 0) break;
      this.values[index] = this.values[parent]; index = parent;
    }
    this.values[index] = value;
  }
  pop(): HeapEntry | undefined {
    const first = this.values[0]; const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1; const right = left + 1;
      if (left >= this.values.length) break;
      let child = left;
      if (right < this.values.length && this.compare(this.values[right], this.values[left]) < 0) child = right;
      if (this.compare(last, this.values[child]) <= 0) break;
      this.values[index] = this.values[child]; index = child;
    }
    this.values[index] = last;
    return first;
  }
  private compare(a: HeapEntry, b: HeapEntry) {
    return a.cost - b.cost || a.shelterId.localeCompare(b.shelterId, "en") || a.node - b.node;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${stableJson(item[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function waitEntry(nodeId: string, reason: RoutePlanEntry["reason"]): RoutePlanEntry {
  return { fromNodeId: nodeId, toNodeId: nodeId, edgeId: null, targetShelterId: null,
    routeCost: null, decision: "esperar", reason };
}

export class RouteEngine {
  readonly graph: MantaGraph;
  private readonly adjacency: ReturnType<typeof buildAdjacency>;
  private readonly nodeIds: string[];
  private readonly snapshots = new Map<string, RoutingSnapshot>();
  private readonly workerCount: number;
  private readonly now: () => number;
  private readonly isoNow: () => string;

  constructor(graph: MantaGraph, options: RoutingEngineOptions = {}) {
    this.graph = graph;
    this.adjacency = buildAdjacency(graph);
    this.nodeIds = graph.nodos.map(node => node.id);
    this.workerCount = options.workerCount ?? 1;
    this.now = options.now ?? (() => performance.now());
    this.isoNow = options.isoNow ?? (() => new Date().toISOString());
    if (!Number.isSafeInteger(this.workerCount) || this.workerCount < 1) throw new Error("workerCount debe ser positivo");
  }

  sync(value: unknown): SyncResponse {
    const request = validateWorldSyncRequest(value, this.graph);
    const requestDigest = createHash("sha256").update(stableJson(request)).digest("hex");
    const previous = this.snapshots.get(request.gameId);
    if (previous && request.turnId === previous.request.turnId) {
      if (requestDigest === previous.requestDigest) return previous.response;
      throw new RoutingError(409, "STALE_WORLD", "Ya existe una sincronización distinta para ese turno");
    }
    if (previous && request.turnId < previous.request.turnId) {
      throw new RoutingError(409, "STALE_WORLD", "turnId debe ser posterior al último turno instalado");
    }
    if (previous && request.baseWorldVersion !== previous.worldVersion) {
      throw new RoutingError(409, "STALE_WORLD", "baseWorldVersion no coincide con la última sincronización");
    }
    if (!previous && request.baseWorldVersion !== 0) {
      throw new RoutingError(409, "STALE_WORLD", "La primera sincronización debe partir de worldVersion 0");
    }
    const worldVersion = request.baseWorldVersion + 1;
    const start = this.now();
    const bestMoveByNode = this.buildPlan(request);
    const reservedPlans = new Map<string, Readonly<Record<string, RoutePlanEntry>>>();
    const reservationBySurvivor = new Map<string, string>();
    for (const shelter of request.shelters) if (shelter.reservados.length) {
      const entries = this.buildPlan(request, shelter.id);
      reservedPlans.set(shelter.id, Object.freeze(Object.fromEntries(Object.entries(entries)
        .map(([nodeId, entry]) => [nodeId, Object.freeze(entry)]))));
      for (const id of shelter.reservados) reservationBySurvivor.set(id, shelter.id);
    }
    const buildLatencyMs = Math.max(0, this.now() - start);
    const immutableMoves = Object.freeze(Object.fromEntries(Object.entries(bestMoveByNode)
      .map(([nodeId, entry]) => [nodeId, Object.freeze(entry)])));
    const plan: RoutePlanSnapshot = Object.freeze({
      gameId: request.gameId, turnId: request.turnId, worldVersion,
      graphVersion: this.graph.metadata.graphVersion, builtAt: this.isoNow(), buildLatencyMs,
      bestMoveByNode: immutableMoves,
    });
    const response: SyncResponse = Object.freeze({
      turnId: request.turnId, worldVersion, graphVersion: this.graph.metadata.graphVersion,
      workerCount: this.workerCount, buildLatencyMs, ready: true,
    });
    const blockedEdgeIds = new Set<string>();
    for (const block of request.blockedEdges) {
      if (block.bloqueadaDesdeTurno <= request.turnId &&
          (block.desbloqueadaEnTurno === null || request.turnId < block.desbloqueadaEnTurno)) {
        for (const edgeId of block.edgeIds) blockedEdgeIds.add(edgeId);
      }
    }
    const snapshot: RoutingSnapshot = {
      request, worldVersion, requestDigest, plan, response, reservedPlans, reservationBySurvivor,
      survivorById: new Map(request.survivors.map(survivor => [survivor.id, survivor])),
      shelterById: new Map(request.shelters.map(shelter => [shelter.id, shelter])),
      blockedEdgeIds,
      zombieNodeIds: new Set(request.zombies.filter(zombie => zombie.estado === "activo").map(zombie => zombie.nodeId)),
      hordeNodeIds: this.hordeNeighborhood(request),
      zombieTraversalPairs: new Set(request.zombieTraversals.map(traversal => `${traversal.fromNodeId}\0${traversal.toNodeId}`)),
    };
    // La referencia completa cambia al final: ninguna lectura ve un snapshot parcial.
    this.snapshots.set(request.gameId, snapshot);
    return response;
  }

  step(value: unknown): PasoResponse {
    const request = validatePasoRequest(value) as PasoRequest;
    const snapshot = this.snapshots.get(request.gameId);
    if (!snapshot) throw new RoutingError(503, "ROUTE_UNAVAILABLE", "No existe un plan de ruta sincronizado");
    if (request.turnId !== snapshot.request.turnId || request.worldVersion !== snapshot.worldVersion) {
      throw new RoutingError(409, "STALE_WORLD", "La petición no coincide con el plan del turno vigente");
    }
    const survivor = snapshot.survivorById.get(request.survivorId);
    if (!survivor) throw new RoutingError(404, "SURVIVOR_NOT_FOUND", "Sobreviviente no encontrado en el snapshot");
    if (survivor.estado !== "vivo" || survivor.nodeId !== request.currentNodeId) {
      throw new RoutingError(409, "SURVIVOR_STATE_MISMATCH", "El sobreviviente ya no está vivo en ese nodo");
    }
    if (!this.adjacency.nodeIndex.has(request.currentNodeId)) {
      throw new RoutingError(404, "NODE_NOT_FOUND", "Nodo actual no existe en el grafo");
    }
    if (request.targetShelterId && !snapshot.shelterById.has(request.targetShelterId)) {
      throw new RoutingError(400, "VALIDATION_ERROR", "targetShelterId no existe");
    }
    const start = this.now();
    try {
      const reservedShelterId = snapshot.reservationBySurvivor.get(request.survivorId);
      const entry = (reservedShelterId ? snapshot.reservedPlans.get(reservedShelterId)
        : snapshot.plan.bestMoveByNode)?.[request.currentNodeId];
      const safe = !!entry && this.isSafeEntry(entry, snapshot, reservedShelterId);
      const latencyMs = Math.max(0, this.now() - start);
      if (!entry || !safe) {
        return {
          gameId: request.gameId, turnId: request.turnId, worldVersion: request.worldVersion,
          survivorId: request.survivorId, ...waitEntry(request.currentNodeId, "fallback-interno"), latencyMs,
        };
      }
      return {
        gameId: request.gameId, turnId: request.turnId, worldVersion: request.worldVersion,
        survivorId: request.survivorId, ...entry, latencyMs,
      };
    } catch {
      return {
        gameId: request.gameId, turnId: request.turnId, worldVersion: request.worldVersion,
        survivorId: request.survivorId, ...waitEntry(request.currentNodeId, "fallback-interno"), latencyMs: 0,
      };
    }
  }

  getPlan(gameId: string) { return this.snapshots.get(gameId)?.plan; }
  getStatus(gameId: string): RoutingStatusResponse {
    return { gameId, installed: this.snapshots.get(gameId)?.response ?? null };
  }
  isReady(gameId?: string) { return gameId ? this.snapshots.has(gameId) : this.snapshots.size > 0; }

  private buildPlan(request: WorldSyncRequest, reservedShelterId?: string): Record<string, RoutePlanEntry> {
    const count = this.nodeIds.length;
    const blocked = new Set<string>();
    for (const block of request.blockedEdges) {
      if (block.bloqueadaDesdeTurno <= request.turnId &&
          (block.desbloqueadaEnTurno === null || request.turnId < block.desbloqueadaEnTurno)) {
        for (const edgeId of block.edgeIds) blocked.add(edgeId);
      }
    }
    const zombieNodes = new Set(request.zombies.filter(zombie => zombie.estado === "activo").map(zombie => zombie.nodeId));
    const hordeNodes = this.hordeNeighborhood(request);
    const hazards = new Set([...zombieNodes, ...hordeNodes]);
    const availableShelters = request.shelters.filter(shelter => reservedShelterId
      ? shelter.id === reservedShelterId && shelter.ocupantes.length < shelter.capacidad
      : shelter.ocupantes.length + shelter.reservados.length < shelter.capacidad);
    const baseCost = new Map<string, number>();
    const openEdges: GraphEdge[] = [];
    for (const edge of this.graph.aristas) if (!blocked.has(edge.id)) {
      openEdges.push(edge); baseCost.set(edge.id, edge.distancia_m / edge.factor_velocidad);
    }
    const baselineValues = openEdges.length ? openEdges.map(edge => baseCost.get(edge.id)!) : this.graph.aristas.map(edge => edge.distancia_m / edge.factor_velocidad);
    const L = median(baselineValues);
    const corridorDistance = this.corridorDistances(request, blocked);
    const uncertain = new Set(request.dormantUncertaintyNodeIds);
    const penalty = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const nodeId = this.nodeIds[i]; const distance = corridorDistance.get(nodeId);
      penalty[i] = (distance === undefined ? 0 : 4 * L * (3 - distance)) + (uncertain.has(nodeId) ? 0.25 * L : 0);
    }
    const distance = new Float64Array(count); distance.fill(Number.POSITIVE_INFINITY);
    const target = Array<string | null>(count).fill(null);
    const heap = new MinHeap();
    for (const shelter of availableShelters) {
      const node = this.adjacency.nodeIndex.get(shelter.nodoId)!;
      if (hazards.has(shelter.nodoId)) continue;
      const incumbent = target[node];
      if (distance[node] > 0 || incumbent === null || shelter.id.localeCompare(incumbent, "en") < 0) {
        distance[node] = 0; target[node] = shelter.id; heap.push({ node, cost: 0, shelterId: shelter.id });
      }
    }
    while (heap.size) {
      const item = heap.pop()!;
      if (item.cost > distance[item.node] + 1e-9 || target[item.node] !== item.shelterId) continue;
      for (const edge of this.adjacency.inEdges[item.node]) {
        if (blocked.has(edge.id)) continue;
        const predecessor = this.adjacency.nodeIndex.get(edge.origen)!;
        if (hazards.has(edge.origen)) continue;
        const candidate = item.cost + baseCost.get(edge.id)! + penalty[item.node];
        const old = distance[predecessor]; const oldTarget = target[predecessor];
        if (candidate < old - 1e-9 || (Math.abs(candidate - old) <= 1e-9 &&
            (oldTarget === null || item.shelterId.localeCompare(oldTarget, "en") < 0))) {
          distance[predecessor] = candidate; target[predecessor] = item.shelterId;
          heap.push({ node: predecessor, cost: candidate, shelterId: item.shelterId });
        }
      }
    }

    const frontCrossings = new Set(request.zombieTraversals.map(traversal => `${traversal.toNodeId}\0${traversal.fromNodeId}`));
    const availableByNode = new Map<string, RouteShelterLike[]>();
    for (const shelter of availableShelters) {
      const list = availableByNode.get(shelter.nodoId) ?? [];
      list.push(shelter); availableByNode.set(shelter.nodoId, list);
    }
    const bestMoveByNode: Record<string, RoutePlanEntry> = {};
    for (let fromIndex = 0; fromIndex < count; fromIndex++) {
      const fromNodeId = this.nodeIds[fromIndex];
      const atAvailableShelter = availableByNode.get(fromNodeId)?.sort((a, b) => a.id.localeCompare(b.id, "en"))[0];
      if (atAvailableShelter && !hazards.has(fromNodeId)) {
        bestMoveByNode[fromNodeId] = { ...waitEntry(fromNodeId, "ruta-segura"), targetShelterId: atAvailableShelter.id };
        continue;
      }
      let chosen: { edge: GraphEdge; cost: number; shelterId: string } | undefined;
      for (const edge of this.adjacency.outEdges[fromIndex]) {
        if (blocked.has(edge.id) || hazards.has(edge.destino) || frontCrossings.has(`${edge.origen}\0${edge.destino}`)) continue;
        const toIndex = this.adjacency.nodeIndex.get(edge.destino)!;
        const shelterId = target[toIndex];
        if (shelterId === null || !Number.isFinite(distance[toIndex])) continue;
        const candidate = baseCost.get(edge.id)! + penalty[toIndex] + distance[toIndex];
        if (!chosen || candidate < chosen.cost - 1e-9 || (Math.abs(candidate - chosen.cost) <= 1e-9 &&
            (shelterId.localeCompare(chosen.shelterId, "en") < 0 ||
             (shelterId === chosen.shelterId && edge.id.localeCompare(chosen.edge.id, "en") < 0)))) {
          chosen = { edge, cost: candidate, shelterId };
        }
      }
      if (chosen) {
        bestMoveByNode[fromNodeId] = {
          fromNodeId, toNodeId: chosen.edge.destino, edgeId: chosen.edge.id, targetShelterId: chosen.shelterId,
          routeCost: chosen.cost, decision: "mover", reason: "ruta-segura",
        };
      } else {
        const reason = availableShelters.length === 0 ? "no-hay-refugio-disponible" :
          hazards.has(fromNodeId) ? "nodo-bloqueado" : "sin-ruta-segura";
        bestMoveByNode[fromNodeId] = waitEntry(fromNodeId, reason);
      }
    }
    return bestMoveByNode;
  }

  private hordeNeighborhood(request: WorldSyncRequest) {
    const blocked = new Set<string>();
    for (const zombie of request.zombies) if (zombie.tipo === "horda" && zombie.estado === "activo") {
      blocked.add(zombie.nodeId);
      const index = this.adjacency.nodeIndex.get(zombie.nodeId)!;
      for (const edge of this.adjacency.outEdges[index]) blocked.add(edge.destino);
      for (const edge of this.adjacency.inEdges[index]) blocked.add(edge.origen);
    }
    return blocked;
  }

  private corridorDistances(request: WorldSyncRequest, blocked: Set<string>) {
    const distance = new Int8Array(this.nodeIds.length); distance.fill(-1);
    const queue: number[] = [];
    for (const zombie of request.zombies) {
      if (zombie.tipo !== "corredor" || zombie.estado !== "activo") continue;
      const start = this.adjacency.nodeIndex.get(zombie.nodeId)!;
      if (distance[start] === -1) { distance[start] = 0; queue.push(start); }
    }
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]; const depth = distance[current];
      if (depth === 2) continue;
      for (const edge of this.adjacency.outEdges[current]) {
        if (blocked.has(edge.id)) continue;
        const next = this.adjacency.nodeIndex.get(edge.destino)!;
        if (distance[next] === -1) { distance[next] = depth + 1; queue.push(next); }
      }
    }
    const result = new Map<string, number>();
    for (let index = 0; index < distance.length; index++) if (distance[index] !== -1) {
      result.set(this.nodeIds[index], distance[index]);
    }
    return result;
  }

  private isSafeEntry(entry: RoutePlanEntry, snapshot: RoutingSnapshot, reservedShelterId?: string) {
    if (!this.adjacency.nodeIndex.has(entry.fromNodeId)) return false;
    if (entry.toNodeId === entry.fromNodeId) {
      if (entry.decision !== "esperar" || entry.edgeId !== null || entry.routeCost !== null) return false;
      if (entry.targetShelterId === null) return true;
      const shelter = snapshot.shelterById.get(entry.targetShelterId);
      return !!shelter && shelter.nodoId === entry.fromNodeId &&
        shelter.ocupantes.length + (reservedShelterId === shelter.id ? 0 : shelter.reservados.length) < shelter.capacidad;
    }
    if (!this.adjacency.nodeIndex.has(entry.toNodeId) || entry.decision !== "mover" || entry.routeCost === null ||
        entry.targetShelterId === null) return false;
    if (entry.toNodeId !== entry.fromNodeId) {
      const edgeIndex = entry.edgeId ? this.adjacency.edgeIndex.get(entry.edgeId) : undefined;
      const edge = edgeIndex === undefined ? undefined : this.graph.aristas[edgeIndex];
      if (!edge || edge.origen !== entry.fromNodeId || edge.destino !== entry.toNodeId ||
          snapshot.blockedEdgeIds.has(edge.id) || snapshot.zombieNodeIds.has(entry.toNodeId) ||
          snapshot.hordeNodeIds.has(entry.toNodeId) ||
          snapshot.zombieTraversalPairs.has(`${entry.toNodeId}\0${entry.fromNodeId}`)) return false;
      const targetShelter = snapshot.shelterById.get(entry.targetShelterId);
      if (!targetShelter || targetShelter.ocupantes.length +
          (reservedShelterId === targetShelter.id ? 0 : targetShelter.reservados.length) >= targetShelter.capacidad) return false;
    }
    return true;
  }
}

type RouteShelterLike = WorldSyncRequest["shelters"][number];
