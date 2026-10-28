/**
 * Tipos HTTP/WS consumidos por el Frontend.
 *
 * Copiados textualmente desde SPEC.md §2.2 y §3 (fuente canónica). Solo se
 * incluyen los tipos que el cliente necesita: snapshot de mundo, evento
 * TURN_UPDATE y los contratos de los controles de operador. El Frontend NO
 * debe redefinir ni relajar estas formas — cualquier cambio empieza en
 * SPEC.md, no aquí.
 */

export type Zone = "Tarqui" | "Los Esteros" | "Barbasquillo" | "Jocay";
export type RoadType = "avenida" | "calle" | "callejon" | "puente";
export type ZombieType = "caminante" | "corredor" | "horda" | "dormido";
export type EntityStatus = "vivo" | "mordido" | "evacuado";
export type GameStatus = "idle" | "running" | "paused" | "completed";

export interface GraphNode {
  id: string;
  lat: number;
  lng: number;
  zona: Zone;
}

export interface GraphEdge {
  id: string;
  segmentoId: string;
  origen: string;
  destino: string;
  distancia_m: number;
  tipo: RoadType;
  factor_velocidad: number;
}

export interface GraphShelter {
  id: string;
  nodoId: string;
  capacidad: number;
}

export interface MantaGraph {
  schemaVersion: "1.0.0";
  metadata: {
    ciudad: "Manta";
    graphVersion: string;
    generatedAt: string;
    source: "OpenStreetMap";
    osmAttribution: string;
  };
  nodos: GraphNode[];
  aristas: GraphEdge[];
  refugios: GraphShelter[];
}

export interface Zombie {
  id: string;
  tipo: ZombieType;
  estado: "activo" | "dormido";
  nodeId: string;
  despertadoEnTurno: number | null;
  siguienteMovimientoTurno: number | null;
}

export interface Survivor {
  id: string;
  nodeId: string;
  estado: EntityStatus;
  targetShelterId: string | null;
  eliminadoEnTurno: number | null;
  evacuadoEnTurno: number | null;
}

export interface Shelter {
  id: string;
  nodoId: string;
  capacidad: number;
  ocupantes: string[];
  reservados: string[];
}

export interface BlockedEdge {
  segmentoId: string;
  edgeIds: string[];
  motivo: string;
  origen: "evento-ciudad" | "control";
  bloqueadaDesdeTurno: number;
  desbloqueadaEnTurno: number | null;
}

export interface SurveillanceCamera {
  id: string;
  name: string;
  lat: number;
  lng: number;
  accuracyMeters: number;
  nodeId: string | null;
  snapDistanceMeters: number | null;
  coverageRadiusMeters: number;
  alertTtlTurns: number;
  enabled: boolean;
  status: "simulated" | "reference-only-outside-current-graph";
  reportedLocation: string;
  networkAffiliation: string;
}

export interface CameraObservation {
  cameraId: string;
  zombieId: string;
  nodeId: string;
  detectedTurnId: number;
  expiresAfterTurnId: number;
}

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
  /**
   * Disponibilidad de rutas (%) sobre la ventana de últimas 1.000 llamadas,
   * calculada por el Backend (backend/src/modules/telemetry/turn-metrics.ts,
   * rama feat/backend-rounds-metrics — aún no mergeada a design/SPEC.md).
   * Opcional a propósito: el backend hoy en design no la envía todavía: ver
   * MetricsPanel.tsx, que calcula localmente cuando falta.
   */
  routeAvailabilityPercent?: number;
}

export interface WorldSnapshot {
  schemaVersion: "1.0.0";
  gameId: string;
  roundId: 1 | 2 | 3;
  status: GameStatus;
  turnId: number;
  worldVersion: number;
  graphVersion: string;
  updatedAt: string;
  zombies: Zombie[];
  survivors: Survivor[];
  shelters: Shelter[];
  blockedEdges: BlockedEdge[];
  cameras: SurveillanceCamera[];
  cameraObservations: CameraObservation[];
  metrics: TelemetryMetrics;
}

export interface TurnUpdate {
  event: "TURN_UPDATE";
  emittedAt: string;
  world: WorldSnapshot;
}

// Controles de operador (RoundControls). El Backend exige x-api-key en estas
// rutas; el Frontend nunca guarda la key — pasa por el mecanismo
// operador/proxy que defina el Backend (SPEC.md §6).

export interface IniciarRequest {
  gameId: string;
  roundId: 1 | 2 | 3;
  seed: string;
}

export interface IniciarResponse {
  gameId: string;
  roundId: 1 | 2 | 3;
  status: "running";
  nextTurnId: number;
}

export interface PausarRequest {
  reason: string;
}

export interface PausarResponse {
  status: "pausing" | "paused";
  afterTurnId?: number;
}

export interface BloquearAristaRequest {
  eventId: string;
  edgeId: string;
  bloqueada: boolean;
  motivo: string;
  effectiveTurnId?: number;
}

export interface BloquearAristaResponse {
  eventId: string;
  segmentoId: string;
  effectiveTurnId: number;
  status: "programado";
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
