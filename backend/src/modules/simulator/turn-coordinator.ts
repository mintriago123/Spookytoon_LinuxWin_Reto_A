import { performance } from "node:perf_hooks";
import { validatePasoRequest } from "../../contracts/routing-validation.ts";
import type { DecisionBatch, Immutable, RouteAttempt, ScheduledCityEvent, WorldState } from "./types.ts";
import { SimulatorControlError, type EdgeCommand } from "./controls.ts";
import type { RoutingClient, RoutingHttpResponse } from "./routing-client.ts";
import { parseRoutingStatus, parseSyncResponse } from "./routing-responses.ts";
import { buildWorldSyncRequest, hordeDangerNodes } from "./routing-world.ts";
import { confirmRoutingSync, markRoutingSyncAttempt, reconcileRoutingStatus } from "./routing-sync.ts";
import { applyRoutingFailureSignal, type RoutingAlert } from "./routing-failure.ts";
import { applyCityEvents } from "./city-events.ts";
import { awakenDormantZombies, moveZombies } from "./zombies.ts";
import { applyBites, applySimultaneousSurvivorMoves, detectBites,
  resolveShelterAdmissions, resolveSurvivorDecisions } from "./survivor-resolution.ts";
import { updateTurnMetrics, type RouteLatencySample } from "../telemetry/turn-metrics.ts";

function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

type HttpAttempt = { kind: "response"; response: RoutingHttpResponse; elapsedMs: number }
  | { kind: "timeout"; elapsedMs: number } | { kind: "error"; elapsedMs: number };

interface CoordinatorOptions {
  client: RoutingClient;
  syncTimeoutMs: number;
  isoNow: () => string;
  /** Emisor síncrono y sin I/O bloqueante; nunca recibe payloads ni secretos HTTP. */
  emitAlert: (alert: RoutingAlert) => void;
  /** Notificación síncrona tras el commit; el consumidor no debe realizar I/O bloqueante. */
  onCommitted?: (world: Immutable<WorldState>) => void;
  now?: () => number;
  getWsClientCount?: () => number;
}

export interface TurnResult {
  /** Estado INTERNO comprometido. No enviarlo como snapshot HTTP o WebSocket. */
  world: Immutable<WorldState>;
  decisions: DecisionBatch;
  attempts: RouteAttempt[];
  alerts: RoutingAlert[];
  alertDeliveryFailed: boolean;
}

/** Único escritor: los controles en vuelo quedan pendientes hasta el commit del turno. */
export class TurnCoordinator {
  private committed: Immutable<WorldState>;
  private busy = false;
  private readonly now: () => number;
  private readonly options: CoordinatorOptions;
  private pauseRequested: string | null = null;
  private queuedEvents: ScheduledCityEvent[] = [];
  private routeSamples: RouteLatencySample[] = [];

  constructor(initial: WorldState, options: CoordinatorOptions) {
    if (!Number.isSafeInteger(options.syncTimeoutMs) || options.syncTimeoutMs < 1 || options.syncTimeoutMs > 2_000) {
      throw new Error("Se requiere timeout explícito de sync entre 1 y 2.000 ms");
    }
    this.options = options;
    this.committed = freeze(structuredClone(initial));
    this.now = options.now ?? (() => performance.now());
  }

  getCommittedWorld(): Immutable<WorldState> { return this.committed; }

  resume(): void {
    if (this.busy || !["idle", "paused"].includes(this.committed.status) || this.committed.turnId >= 150) {
      throw new SimulatorControlError(409, "GAME_STATE_CONFLICT", "La partida no se puede iniciar o reanudar");
    }
    const work = structuredClone(this.committed) as WorldState;
    work.status = "running"; work.pause = { status: "none" }; work.updatedAt = this.options.isoNow();
    work.metrics.wsClients = this.options.getWsClientCount?.() ?? work.metrics.wsClients;
    this.pauseRequested = null; this.committed = freeze(work);
    this.options.onCommitted?.(this.committed);
  }

  requestPause(reason: string): { status: "pausing" | "paused"; afterTurnId: number } {
    if (this.committed.status === "completed") throw new SimulatorControlError(409, "GAME_STATE_CONFLICT", "La partida ya terminó");
    if (this.busy) {
      this.pauseRequested ??= reason;
      return { status: "pausing", afterTurnId: this.committed.turnId + 1 };
    }
    if (this.committed.status !== "paused") {
      const work = structuredClone(this.committed) as WorldState;
      work.status = "paused"; work.pause = { status: "effective", cause: "operator", reason, afterTurnId: work.turnId };
      work.updatedAt = this.options.isoNow(); this.committed = freeze(work);
      this.options.onCommitted?.(this.committed);
    }
    this.pauseRequested = null;
    return { status: "paused", afterTurnId: this.committed.turnId };
  }

  scheduleEdge(command: EdgeCommand): { eventId: string; segmentoId: string; effectiveTurnId: number; status: "programado" } {
    const edge = this.committed.graph.aristas.find(edge => edge.id === command.edgeId);
    if (!edge) throw new SimulatorControlError(404, "EDGE_NOT_FOUND", "La arista no existe");
    const events = [...this.committed.pendingCityEvents, ...this.queuedEvents];
    const previous = events.find(event => event.eventId === command.eventId);
    const tipo = command.bloqueada ? "bloquear-segmento" : "desbloquear-segmento";
    if (previous) {
      if (previous.origen !== "control" || previous.edgeId !== command.edgeId || previous.tipo !== tipo ||
          previous.motivo !== command.motivo || (command.effectiveTurnId !== undefined && command.effectiveTurnId !== previous.effectiveTurnId)) {
        throw new SimulatorControlError(409, "EVENT_CONFLICT", "eventId ya existe con otro contenido");
      }
      return { eventId: previous.eventId, segmentoId: edge.segmentoId, effectiveTurnId: previous.effectiveTurnId, status: "programado" };
    }
    if (this.committed.status === "completed") throw new SimulatorControlError(409, "GAME_STATE_CONFLICT", "La partida ya terminó");
    if (command.effectiveTurnId === undefined && this.committed.status !== "running") {
      throw new SimulatorControlError(400, "VALIDATION_ERROR", "Indica effectiveTurnId cuando la partida está pausada");
    }
    const earliest = this.committed.turnId + (this.busy ? 2 : 1);
    const effectiveTurnId = command.effectiveTurnId ?? earliest;
    if (effectiveTurnId < earliest || effectiveTurnId > 150) throw new SimulatorControlError(400, "INVALID_EVENT_TURN", "El turno del evento ya empezó o excede la ronda");
    if (events.some(event => event.effectiveTurnId === effectiveTurnId &&
        this.committed.graph.aristas.find(edge => edge.id === event.edgeId)?.segmentoId === edge.segmentoId)) {
      throw new SimulatorControlError(409, "EVENT_CONFLICT", "Otro evento ya afecta ese segmento en el mismo turno");
    }
    const event: ScheduledCityEvent = { eventId: command.eventId, edgeId: command.edgeId, tipo,
      motivo: command.motivo, effectiveTurnId, aplicado: false, origen: "control" };
    if (this.busy) this.queuedEvents.push(event);
    else {
      const work = structuredClone(this.committed) as WorldState;
      work.pendingCityEvents.push(event); this.committed = freeze(work);
    }
    return { eventId: event.eventId, segmentoId: edge.segmentoId, effectiveTurnId, status: "programado" };
  }

  private async http(operation: (signal: AbortSignal) => Promise<RoutingHttpResponse>, timeoutMs: number): Promise<HttpAttempt> {
    const controller = new AbortController();
    const start = this.now();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<HttpAttempt>(resolve => {
      timer = setTimeout(() => { resolve({ kind: "timeout", elapsedMs: timeoutMs }); controller.abort(); }, timeoutMs);
    });
    const response = Promise.resolve().then(() => operation(controller.signal)).then((response): HttpAttempt => {
      const elapsedMs = Math.max(0, this.now() - start);
      return elapsedMs > timeoutMs ? { kind: "timeout", elapsedMs: timeoutMs } : { kind: "response", response, elapsedMs };
    }, (): HttpAttempt => ({ kind: "error", elapsedMs: Math.max(0, this.now() - start) }));
    try { return await Promise.race([timeout, response]); }
    finally { clearTimeout(timer!); }
  }

  async runTurn(deadlineMonotonicMs = this.now() + 2_000, waitForPublication?: () => Promise<void>): Promise<TurnResult> {
    if (this.busy) throw new Error("Ya existe un turno en curso");
    if (this.committed.status !== "running" || this.committed.turnId >= 150) throw new Error("La partida no admite otro turno");
    if (this.committed.survivors.filter(s => s.estado === "vivo").length > 200) throw new Error("Máximo 200 consultas de ruta por turno");
    if (!Number.isFinite(deadlineMonotonicMs)) throw new Error("Deadline de turno inválido");
    const startedAt = this.now();
    this.busy = true;
    try {
      const work = structuredClone(this.committed) as WorldState;
      work.graph = this.committed.graph;
      const turnId = work.turnId + 1;
      work.activeTurnId = turnId;
      work.activeTurn = { turnId, phase: "city-events", deadlineMonotonicMs, randomCursors: [] };
      const phase = (value: WorldState["phase"]) => { work.phase = value; work.activeTurn!.phase = value; };
      phase("city-events");
      const events = applyCityEvents({ turnId, graph: work.graph, events: work.pendingCityEvents, blockedEdges: work.blockedEdges });
      work.pendingCityEvents = events.events; work.blockedEdges = events.blockedEdges;
      phase("zombie-move");
      const movedZombies = moveZombies({ ...work, turnId });
      work.zombies = movedZombies.zombies; work.lastZombieTraversals = movedZombies.traversals;
      work.activeTurn.randomCursors = movedZombies.randomCursors;
      phase("sync");
      let unauthorized = false;
      let syncUnresolved = false;
      const reconcile = async () => {
        const result = await this.http(signal => this.options.client.status(work.gameId, signal), this.options.syncTimeoutMs);
        if (result.kind === "response" && result.response.status === 401) unauthorized = true;
        if (result.kind !== "response" || result.response.status !== 200) { syncUnresolved = true; return; }
        try {
          const reconciliation = reconcileRoutingStatus(work.routing, parseRoutingStatus(result.response.body), work.graph.metadata.graphVersion);
          work.routing = reconciliation.state;
          syncUnresolved = reconciliation.action === "pause";
        } catch { syncUnresolved = true; }
      };
      // Un intento de un turno previo se resuelve antes de instalar un payload nuevo.
      if (work.routing.uncertain) await reconcile();
      if (!syncUnresolved && !unauthorized) {
        const request = buildWorldSyncRequest(work, turnId);
        work.routing = markRoutingSyncAttempt(work.routing, request);
        const result = await this.http(signal => this.options.client.sync(request, signal), this.options.syncTimeoutMs);
        if (result.kind === "response" && result.response.status === 401) unauthorized = true;
        else {
          let confirmed = false;
          if (result.kind === "response" && result.response.status === 200) {
            try {
              work.routing = confirmRoutingSync(work.routing, parseSyncResponse(result.response.body), work.graph.metadata.graphVersion);
              confirmed = true;
            } catch { /* Una respuesta inválida no confirma instalación. */ }
          }
          if (!confirmed) await reconcile();
        }
      }
      phase("routing");
      const installed = work.routing.confirmed;
      const currentPlan = !unauthorized && !syncUnresolved && !work.routing.uncertain && installed !== null &&
        installed.gameId === work.gameId && installed.turnId === turnId && installed.graphVersion === work.graph.metadata.graphVersion;
      const attempts: RouteAttempt[] = [];
      if (currentPlan) {
        const requests = work.survivors.filter(s => s.estado === "vivo").map(s => validatePasoRequest({
          gameId: work.gameId, turnId, worldVersion: installed.worldVersion,
          survivorId: s.id, currentNodeId: s.nodeId, targetShelterId: s.targetShelterId,
        }));
        const results = await Promise.allSettled(requests.map(async (request): Promise<RouteAttempt> => {
          const result = await this.http(signal => this.options.client.step(request, signal), 500);
          if (result.kind === "timeout") return { request, kind: "timeout", elapsedMs: 500 };
          if (result.kind === "error") return { request, kind: "error", error: "NETWORK_ERROR", elapsedMs: result.elapsedMs };
          if (result.response.status !== 200) return { request, kind: "error", status: result.response.status,
            error: "HTTP_ERROR", elapsedMs: result.elapsedMs };
          return { request, kind: "response", body: result.response.body, elapsedMs: result.elapsedMs };
        }));
        results.forEach((result, index) => attempts.push(result.status === "fulfilled" ? result.value : {
          request: requests[index], kind: "error", error: "REQUEST_ERROR", elapsedMs: 0,
        }));
      }
      const danger = hordeDangerNodes(work.graph, work.zombies);
      const context = { gameId: work.gameId, turnId, worldVersion: installed?.worldVersion ?? 0,
        graph: work.graph, survivors: work.survivors, visibleZombies: work.zombies.filter(z => z.estado === "activo"),
        shelters: work.shelters, blockedEdges: work.blockedEdges, hordeDangerNodeIds: danger, zombieTraversals: work.lastZombieTraversals };
      const decisions = resolveSurvivorDecisions(context, currentPlan ? { kind: "confirmed", installed, attempts }
        : { kind: "sync-failed", ...(unauthorized ? { status: 401 } : {}) });
      const alert = applyRoutingFailureSignal(work, decisions);
      if (syncUnresolved && !alert) work.pause = { status: "requested", cause: "routing-sync-uncertain",
        reason: "No se pudo reconciliar la instalación del motor", afterTurnId: turnId };
      phase("survivor-move");
      const moved = applySimultaneousSurvivorMoves(work.survivors, decisions.decisions);
      phase("resolve");
      const bites = detectBites({ ...context, survivors: moved.survivors, survivorTraversals: moved.traversals });
      const admitted = resolveShelterAdmissions({ turnId, survivorsAfterBites: applyBites(turnId, moved.survivors, bites), shelters: work.shelters });
      work.survivors = admitted.survivors; work.shelters = admitted.shelters;
      work.zombies = awakenDormantZombies({ ...work, turnId, phase: "after-survivor-move" });
      phase("publish");
      // El resultado sigue privado y el turno activo durante la espera nominal.
      // Descontar solo la espera; los controles recibidos en ella se incorporan al cierre.
      const workFinishedAt = this.now();
      let publicationWaitMs = 0;
      if (waitForPublication && workFinishedAt < deadlineMonotonicMs) {
        const waitStartedAt = this.now();
        await waitForPublication();
        publicationWaitMs = Math.max(0, this.now() - waitStartedAt);
      }
      for (const event of this.queuedEvents) if (!work.pendingCityEvents.some(existing => existing.eventId === event.eventId)) {
        work.pendingCityEvents.push({ ...event });
      }
      if (this.pauseRequested !== null && work.pause.status === "none") work.pause = {
        status: "requested", cause: "operator", reason: this.pauseRequested, afterTurnId: turnId,
      };
      const closingAt = this.now();
      const turnDurationMs = Math.max(0, closingAt - startedAt - publicationWaitMs);
      if (workFinishedAt >= deadlineMonotonicMs || closingAt > deadlineMonotonicMs) {
        work.metrics.deadlineMisses++;
        if (work.pause.status === "none") work.pause = { status: "requested", cause: "deadline-miss",
          reason: "El turno no cerró antes del siguiente tick", afterTurnId: turnId };
      }
      const telemetry = updateTurnMetrics(work, this.routeSamples, attempts, decisions, turnDurationMs);
      work.metrics = telemetry.metrics;
      work.metrics.wsClients = this.options.getWsClientCount?.() ?? work.metrics.wsClients;
      if (work.pause.status === "requested") {
        work.pause = { ...work.pause, status: "effective" }; work.status = "paused";
      }
      if (turnId === 150) work.status = "completed";
      work.turnId = turnId; work.worldVersion++;
      work.activeTurn = null; work.activeTurnId = null; work.phase = "idle";
      work.updatedAt = this.options.isoNow();
      this.committed = freeze(work); // Único intercambio de la versión completa.
      this.routeSamples = telemetry.samples;
      this.pauseRequested = null; this.queuedEvents = [];
      this.options.onCommitted?.(this.committed);
      let alertDeliveryFailed = false;
      if (alert) { try { this.options.emitAlert(alert); } catch { alertDeliveryFailed = true; } }
      return { world: this.committed, attempts, decisions, alerts: alert ? [alert] : [], alertDeliveryFailed };
    } finally { this.busy = false; }
  }
}
