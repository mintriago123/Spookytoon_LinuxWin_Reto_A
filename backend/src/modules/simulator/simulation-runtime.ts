import type { MantaGraph } from "../../contracts/types.ts";
import type { Immutable, RoundConfig, RoundId, TelemetryMetrics, WorldState } from "./types.ts";
import type { RoutingClient } from "./routing-client.ts";
import type { RoutingAlert } from "./routing-failure.ts";
import { SimulatorControlError, type EdgeCommand, type StartCommand } from "./controls.ts";
import { createSimulationClock, type SimulationClock } from "./simulation-clock.ts";
import { createWorldState } from "./world-state.ts";
import { validateRoundConfig } from "./round-validation.ts";
import { RANDOM_ALGORITHM, RANDOM_ALGORITHM_VERSION } from "./random.ts";
import { TurnCoordinator } from "./turn-coordinator.ts";

export interface ScenarioOptions {
  /** Solo configuración aprobada suministrada por el composition root; no hay escenario de respaldo. */
  rounds?: Partial<Record<RoundId, unknown>>;
  initialMetrics?: (roundId: RoundId) => Immutable<TelemetryMetrics>;
}
interface RuntimeOptions extends ScenarioOptions {
  graph: Immutable<MantaGraph>;
  clientFactory: () => RoutingClient;
  syncTimeoutMs: number;
  emitAlert: (alert: RoutingAlert) => void;
  onFailure: (event: { code: "SIMULATOR_TURN_FAILED"; gameId: string; turnId: number }) => void;
  clock?: SimulationClock;
  isoNow?: () => string;
}

/** Programa turnos; la escritura del mundo permanece exclusivamente en TurnCoordinator. */
export class SimulationRuntime {
  private readonly options: RuntimeOptions;
  private readonly clock: SimulationClock;
  private coordinator: TurnCoordinator | null = null;
  private runner: { controller: AbortController; promise: Promise<void> } | null = null;
  private readonly usedGameIds = new Set<string>();
  private closed = false;

  constructor(options: RuntimeOptions) { this.options = options; this.clock = options.clock ?? createSimulationClock(); }

  getCommittedWorld(): Immutable<WorldState> | null { return this.coordinator?.getCommittedWorld() ?? null; }
  whenStopped(): Promise<void> { return this.runner?.promise ?? Promise.resolve(); }

  start(command: StartCommand): { gameId: string; roundId: RoundId; status: "running"; nextTurnId: number } {
    if (this.closed) throw new SimulatorControlError(503, "SIMULATOR_CLOSED", "El simulador está cerrando");
    const current = this.getCommittedWorld();
    if (current?.status === "running") throw new SimulatorControlError(409, "GAME_STATE_CONFLICT", "La partida ya está en ejecución");
    if (current?.status === "paused" || current?.status === "idle") {
      if (current.gameId !== command.gameId || current.roundId !== command.roundId || current.rngSeed !== command.seed) {
        throw new SimulatorControlError(409, "GAME_IDENTITY_CONFLICT", "La reanudación debe conservar gameId, roundId y seed");
      }
      this.coordinator!.resume();
    } else {
      if (this.usedGameIds.has(command.gameId)) throw new SimulatorControlError(409, "GAME_IDENTITY_CONFLICT", "Una partida nueva requiere un gameId no utilizado");
      let config: RoundConfig;
      try {
        config = validateRoundConfig(this.options.rounds?.[command.roundId], this.options.graph);
        if (config.roundId !== command.roundId) throw new Error("La ronda configurada no coincide");
      } catch {
        throw new SimulatorControlError(503, "ROUND_NOT_CONFIGURED", "La ronda no tiene configuración completa y aprobada");
      }
      if (!this.options.initialMetrics) throw new SimulatorControlError(503, "TELEMETRY_NOT_CONFIGURED", "Faltan las métricas iniciales de telemetría");
      const initial = createWorldState({ gameId: command.gameId, graph: this.options.graph, roundConfig: config,
        randomState: { seed: command.seed, algorithm: RANDOM_ALGORITHM, algorithmVersion: RANDOM_ALGORITHM_VERSION,
          strategy: "per-zombie-turn-draw" }, initialMetrics: this.options.initialMetrics(command.roundId),
        updatedAt: this.isoNow() });
      let client: RoutingClient;
      try { client = this.options.clientFactory(); }
      catch { throw new SimulatorControlError(503, "ROUTING_NOT_READY", "El cliente de routing aún no está disponible"); }
      const coordinator = new TurnCoordinator(initial, { client, syncTimeoutMs: this.options.syncTimeoutMs,
        now: () => this.clock.now(), isoNow: () => this.isoNow(), emitAlert: this.options.emitAlert });
      coordinator.resume();
      this.coordinator = coordinator; this.usedGameIds.add(command.gameId);
    }
    const nextTurnId = this.coordinator!.getCommittedWorld().turnId + 1;
    this.launch();
    return { gameId: command.gameId, roundId: command.roundId, status: "running", nextTurnId };
  }

  pause(reason: string): { status: "pausing" | "paused"; afterTurnId: number } {
    if (!this.coordinator) return { status: "paused", afterTurnId: 0 };
    const result = this.coordinator.requestPause(reason);
    if (result.status === "paused") this.runner?.controller.abort();
    return result;
  }

  scheduleEdge(command: EdgeCommand) {
    if (!this.coordinator) throw new SimulatorControlError(409, "GAME_NOT_STARTED", "Primero crea la partida con configuración aprobada");
    return this.coordinator.scheduleEdge(command);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.runner?.controller.abort();
    if (this.getCommittedWorld()?.status === "running") this.coordinator!.requestPause("Cierre del proceso");
    await this.whenStopped();
  }

  private isoNow(): string { return this.options.isoNow?.() ?? new Date().toISOString(); }

  private launch(): void {
    const coordinator = this.coordinator!;
    const runner = { controller: new AbortController(), promise: Promise.resolve() };
    const origin = this.clock.now();
    this.runner = runner;
    runner.promise = Promise.resolve().then(async () => {
      let nextTick = origin; // Acuerdo Etapa 6: turno 1 inmediato; turno 150 en origin + 298.000 ms.
      while (!runner.controller.signal.aborted && coordinator.getCommittedWorld().status === "running") {
        await this.clock.waitUntil(nextTick, runner.controller.signal);
        if (runner.controller.signal.aborted || coordinator.getCommittedWorld().status !== "running") break;
        await coordinator.runTurn(nextTick + 2_000);
        nextTick += 2_000; // Absoluto: el tiempo de cálculo no desplaza los ticks siguientes.
      }
    }).catch(() => {
      const world = coordinator.getCommittedWorld();
      if (world.status !== "completed") coordinator.requestPause("Fallo al coordinar el turno; requiere revisión");
      try { this.options.onFailure({ code: "SIMULATOR_TURN_FAILED", gameId: world.gameId, turnId: world.turnId + 1 }); }
      catch { /* El emisor no puede reactivar el reloj ni modificar el estado. */ }
    }).finally(() => { if (this.runner === runner) this.runner = null; });
  }
}
