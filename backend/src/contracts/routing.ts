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

/** Cada arista recorrida durante el turno; los corredores pueden aportar dos pasos. */
export interface RouteZombieTraversal {
  zombieId: string;
  stepIndex: 1 | 2;
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
}

/** Riesgo observado por una cámara de simulación; nunca proviene de video real. */
export interface CameraObservation {
  cameraId: string;
  zombieId: string;
  nodeId: string;
  detectedTurnId: number;
  expiresAfterTurnId: number;
}

export interface WorldSyncRequest {
  gameId: string;
  turnId: number;
  baseWorldVersion: number;
  survivors: RouteSurvivor[];
  zombies: RouteZombie[];
  shelters: RouteShelter[];
  blockedEdges: RouteBlockedEdge[];
  zombieTraversals: RouteZombieTraversal[];
  dormantUncertaintyNodeIds: string[];
  cameraObservations?: CameraObservation[];
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

/** Consultable tras un timeout para reconciliar la versión instalada en RAM. */
export interface RoutingStatusResponse {
  gameId: string;
  installed: SyncResponse | null;
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
  reservedPlans: ReadonlyMap<string, Readonly<Record<string, RoutePlanEntry>>>;
  reservationBySurvivor: ReadonlyMap<string, string>;
  response: SyncResponse;
  survivorById: ReadonlyMap<string, RouteSurvivor>;
  shelterById: ReadonlyMap<string, RouteShelter>;
  blockedEdgeIds: ReadonlySet<string>;
  zombieNodeIds: ReadonlySet<string>;
  hordeNodeIds: ReadonlySet<string>;
  zombieTraversalPairs: ReadonlySet<string>;
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
