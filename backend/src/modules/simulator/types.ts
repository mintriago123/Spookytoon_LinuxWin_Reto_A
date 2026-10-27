import type { MantaGraph } from "../../contracts/types.ts";
import type {
  PasoRequest, PasoResponse, RouteBlockedEdge, RouteShelter, RouteSurvivor,
  RouteZombie, RouteZombieTraversal, SyncResponse, WorldSyncRequest, ZombieType,
} from "../../contracts/routing.ts";

/** Solo lectura profunda en TypeScript; no sustituye copia ni freeze en runtime. */
export type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;

export type RoundId = 1 | 2 | 3;
export type GameStatus = "idle" | "running" | "paused" | "completed";
export type TurnPhase =
  | "idle" | "city-events" | "zombie-move" | "sync" | "routing"
  | "survivor-move" | "resolve" | "publish";

/** SPEC §5.1. Los datos del escenario requieren validación antes del inicio. */
export interface RoundConfig {
  roundId: RoundId;
  durationMs: 300_000;
  turnIntervalMs: 2_000;
  turnCount: 150;
  survivorCount: 20 | 80 | 200;
  survivorSpawns: Array<{ id: string; nodeId: string }>;
  zombieSpawns: Array<{ id: string; tipo: ZombieType; nodeId: string }>;
  eventPlan: Array<{
    eventId: string;
    edgeId: string;
    effectiveTurnId: number;
    reason: "colapso-puente" | "bloqueo-calle";
  }>;
}

export interface CityEvent {
  eventId: string;
  tipo: "bloquear-segmento" | "desbloquear-segmento";
  edgeId: string;
  motivo: string;
  effectiveTurnId: number;
  aplicado: boolean;
}

export interface ScheduledCityEvent extends CityEvent {
  origen: RouteBlockedEdge["origen"];
}

export type PauseCause = "operator" | "deadline-miss" | "routing-unauthorized";
export type PauseState =
  | { status: "none" }
  | {
      status: "requested" | "effective";
      cause: PauseCause;
      reason: string;
      afterTurnId: number;
    };

/** Algoritmo acordado en Etapa 4: sha256-counter v1, validado antes de usarlo. */
export interface RandomState {
  seed: string;
  algorithm: string;
  algorithmVersion: string;
  strategy: "per-zombie-turn-draw";
}

export interface RandomCursor {
  zombieId: string;
  turnId: number;
  drawIndex: number;
}

/** El contrato compartido conserva cada paso ordenado, incluidos los dos del corredor. */
export interface ZombieTraversal extends RouteZombieTraversal {}

export interface InstalledRoutingVersion {
  gameId: string;
  turnId: SyncResponse["turnId"];
  worldVersion: SyncResponse["worldVersion"];
  graphVersion: SyncResponse["graphVersion"];
}

/** Un intento incierto no autoriza usar la última versión confirmada. */
export interface RoutingInstallationState {
  confirmed: Immutable<InstalledRoutingVersion> | null;
  uncertain: boolean;
  attemptedRequest: Immutable<WorldSyncRequest> | null;
}

export interface TurnContext {
  turnId: number;
  phase: TurnPhase;
  /** Tiempo monotónico local al proceso; no se persiste en el checkpoint. */
  deadlineMonotonicMs: number;
  randomCursors: RandomCursor[];
}

/** Forma del SPEC §2.3, sin implementación de telemetría ni cambio semántico.
 * Sustituir por import del contrato público cuando Michael lo exponga.
 */
export interface TelemetryMetrics {
  routeSamples: number;
  routeLatencyP50Ms: number;
  routeLatencyP95Ms: number;
  routeLatencyP99Ms: number;
  routeTimeouts: number;
  invalidRouteResponses: number;
  deadlineMisses: number;
  activeSurvivors: number;
  bittenSurvivors: number;
  evacuatedSurvivors: number;
  activeZombies: number;
  wsClients: number;
  snapshotQueueDepth: number;
  lastSnapshotTurnId: number | null;
}

/** Único escritor: simulator. No serializar este objeto como DTO público. */
export interface WorldState {
  gameId: string;
  roundId: RoundId;
  status: GameStatus;
  phase: TurnPhase;
  /** Último turno y versión comprometidos, independientes del motor. */
  turnId: number;
  worldVersion: number;
  activeTurnId: number | null;
  activeTurn: TurnContext | null;
  graph: Immutable<MantaGraph>;
  roundConfig: Immutable<RoundConfig>;
  zombies: RouteZombie[];
  survivors: RouteSurvivor[];
  shelters: RouteShelter[];
  blockedEdges: RouteBlockedEdge[];
  pendingCityEvents: ScheduledCityEvent[];
  lastZombieTraversals: ZombieTraversal[];
  metrics: TelemetryMetrics;
  rngSeed: string;
  randomState: RandomState;
  pause: PauseState;
  routing: RoutingInstallationState;
  updatedAt: string;
}

/** Lista explícita de campos públicos del SPEC; no extender WorldState. */
export interface WorldSnapshot {
  schemaVersion: "1.0.0";
  gameId: string;
  roundId: RoundId;
  status: GameStatus;
  turnId: number;
  worldVersion: number;
  graphVersion: string;
  updatedAt: string;
  zombies: RouteZombie[];
  survivors: RouteSurvivor[];
  shelters: RouteShelter[];
  blockedEdges: RouteBlockedEdge[];
  metrics: TelemetryMetrics;
}

/** Se construye únicamente después del commit; el tipo no hace el commit. */
export type CommittedWorldSnapshot = Immutable<WorldSnapshot>;

export interface TurnUpdate {
  event: "TURN_UPDATE";
  emittedAt: string;
  world: CommittedWorldSnapshot;
}

/** Captura entre turnos. Restaurar pausado; persistencia y recuperación pendientes.
 * No incluye reloj monotónico ni muestras privadas de telemetría.
 */
export interface SimulatorCheckpoint {
  world: CommittedWorldSnapshot;
  roundConfig: Immutable<RoundConfig>;
  randomState: Immutable<RandomState>;
  pendingCityEvents: Immutable<ScheduledCityEvent[]>;
  lastZombieTraversals: Immutable<ZombieTraversal[]>;
  pause: Immutable<PauseState>;
  routing: Immutable<RoutingInstallationState>;
}

/** Vista post-zombie para resolución pura; worldVersion es la del turno a resolver. */
export interface SurvivorResolutionContext {
  gameId: string;
  turnId: number;
  worldVersion: number;
  graph: Immutable<MantaGraph>;
  survivors: RouteSurvivor[];
  visibleZombies: RouteZombie[];
  shelters: RouteShelter[];
  blockedEdges: RouteBlockedEdge[];
  hordeDangerNodeIds: string[];
  zombieTraversals: ZombieTraversal[];
}

/** El coordinador proporciona tiempos transcurridos; el resolver no lee reloj.
 * Una respuesta recibida sigue siendo unknown hasta validarla en runtime.
 */
export type RouteAttempt = {
  request: Immutable<PasoRequest>;
  elapsedMs: number;
} & (
  | { kind: "response"; body: unknown }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown; status?: number }
);

export type WaitCause =
  | "routing-wait" | "sync-failed" | "timeout" | "error"
  | "late-response" | "invalid-response" | "missing-response" | "authorization-failed";

/** Solo las respuestas ya validadas pueden habilitar movimiento. */
export type SurvivorDecision =
  | {
      survivorId: string;
      decision: "mover";
      response: Immutable<PasoResponse & {
        decision: "mover"; edgeId: string; targetShelterId: string; routeCost: number;
      }>;
    }
  | {
      survivorId: string;
      decision: "esperar";
      nodeId: string;
      targetShelterId: string | null;
      cause: WaitCause;
    };

export interface DecisionBatch {
  gameId: string;
  turnId: number;
  worldVersion: number;
  decisions: SurvivorDecision[];
  pauseCause: PauseCause | null;
  alertCode: "ROUTING_UNAUTHORIZED" | null;
}

export interface SurvivorTraversal {
  survivorId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeId: string;
}

export interface SurvivorMovementResult {
  survivors: RouteSurvivor[];
  traversals: SurvivorTraversal[];
}

export type BiteEvidence =
  | { kind: "same-node"; zombieId: string; nodeId: string }
  | { kind: "horde-zone"; nodeId: string }
  | {
      kind: "front-crossing";
      survivorTraversal: SurvivorTraversal;
      zombieTraversal: ZombieTraversal;
    };

export interface Bite {
  survivorId: string;
  evidence: BiteEvidence[];
}

/** No establece política de reservas; conservar cupos físicos al resolver. */
export interface ShelterAdmissionResult {
  survivors: RouteSurvivor[];
  shelters: RouteShelter[];
  admissions: Array<{ survivorId: string; shelterId: string }>;
}
