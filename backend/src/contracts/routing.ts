import type { GraphEdge, GraphShelter, MantaGraph } from "./types.ts";

export type ZombieType = "caminante" | "corredor" | "horda" | "dormido";
export type EntityStatus = "vivo" | "mordido" | "evacuado";
export type RouteReason = "ruta-segura" | "sin-ruta-segura" | "nodo-bloqueado" |
  "no-hay-refugio-disponible" | "fallback-interno";

export interface RouteZombie {
  id: string;
  tipo: ZombieType;
  estado: "activo" | "dormido";
  nodeId: string;
  despertadoEnTurno: number | null;
  siguienteMovimientoTurno: number | null;
}

export interface RouteSurvivor {
  id: string;
  nodeId: string;
  estado: EntityStatus;
  targetShelterId: string | null;
  eliminadoEnTurno: number | null;
  evacuadoEnTurno: number | null;
}

export interface RouteShelter extends GraphShelter {
  ocupantes: string[];
  reservados: string[];
}

export interface RouteBlockedEdge {
  segmentoId: string;
  edgeIds: string[];
  motivo: string;
  origen: "evento-ciudad" | "control";
  bloqueadaDesdeTurno: number;
  desbloqueadaEnTurno: number | null;
}

export interface RouteZombieTransition {
  zombieId: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface WorldSyncRequest {
  gameId: string;
  turnId: number;
  baseWorldVersion: number;
  survivors: RouteSurvivor[];
  zombies: RouteZombie[];
  shelters: RouteShelter[];
  blockedEdges: RouteBlockedEdge[];
  zombieTransitions: RouteZombieTransition[];
  dormantUncertaintyNodeIds: string[];
}

export interface PasoRequest {
  gameId: string;
  turnId: number;
  worldVersion: number;
  survivorId: string;
  currentNodeId: string;
  targetShelterId?: string | null;
}

export interface RoutePlanEntry {
  fromNodeId: string;
  toNodeId: string;
  edgeId: string | null;
  targetShelterId: string | null;
  routeCost: number | null;
  decision: "mover" | "esperar";
  reason: RouteReason;
}

export interface RoutePlanSnapshot {
  gameId: string;
  turnId: number;
  worldVersion: number;
  graphVersion: string;
  builtAt: string;
  buildLatencyMs: number;
  bestMoveByNode: Readonly<Record<string, RoutePlanEntry>>;
}

export interface PasoResponse extends RoutePlanEntry {
  gameId: string;
  turnId: number;
  worldVersion: number;
  survivorId: string;
  latencyMs: number;
}

export interface SyncResponse {
  turnId: number;
  worldVersion: number;
  graphVersion: string;
  workerCount: number;
  buildLatencyMs: number;
  ready: true;
}

export class RoutingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RoutingError";
    this.status = status;
    this.code = code;
  }
}

export interface RoutingSnapshot {
  request: WorldSyncRequest;
  worldVersion: number;
  requestDigest: string;
  plan: RoutePlanSnapshot;
  response: SyncResponse;
  survivorById: ReadonlyMap<string, RouteSurvivor>;
  shelterById: ReadonlyMap<string, RouteShelter>;
  blockedEdgeIds: ReadonlySet<string>;
  zombieNodeIds: ReadonlySet<string>;
  hordeNodeIds: ReadonlySet<string>;
  zombieTransitions: ReadonlySet<string>;
}

export interface RoutingEngineOptions {
  workerCount?: number;
  now?: () => number;
  isoNow?: () => string;
}

export interface RoutingGraphContext {
  graph: MantaGraph;
  edgesById: ReadonlyMap<string, GraphEdge>;
}
