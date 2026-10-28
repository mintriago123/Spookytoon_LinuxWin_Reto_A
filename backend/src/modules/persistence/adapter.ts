import type { Immutable, WorldState } from "../simulator/types.ts";

export const DEFAULT_AWS_REGION = "us-east-2";
export const DEFAULT_DYNAMODB_TABLE = "spookython-manta-state";
export type StoredGame = Omit<WorldState, "graph" | "activeTurn" | "activeTurnId"> & { graphVersion: string };
export interface PersistenceAdapter {
  initialize(): Promise<void>;
  isReady(): boolean;
  save(world: Immutable<WorldState>): Promise<void>;
  loadLatestPausedGame(): Promise<StoredGame | null>;
  close(): Promise<void>;
}
export function toStoredGame(world: Immutable<WorldState>): StoredGame {
  const { graph, activeTurn: _activeTurn, activeTurnId: _activeTurnId, ...dynamic } = world;
  return structuredClone({ ...dynamic, graphVersion: graph.metadata.graphVersion }) as StoredGame;
}
export function pausedGame(game: StoredGame): StoredGame | null {
  if (game.status === "completed") return null;
  return { ...structuredClone(game), status: "paused", phase: "idle",
    pause: { status: "effective", cause: "operator", reason: "Recuperación tras reinicio", afterTurnId: game.turnId },
    // El proceso nuevo no conserva las versiones privadas del motor anterior.
    routing: { confirmed: null, uncertain: false, attemptedRequest: null } };
}
export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  private ready = false;
  private latest: StoredGame | null = null;
  async initialize() { this.ready = true; }
  isReady() { return this.ready; }
  async save(world: Immutable<WorldState>) {
    if (!this.ready) throw new Error("Persistencia no inicializada");
    this.latest = toStoredGame(world);
  }
  async loadLatestPausedGame() { return this.latest ? pausedGame(this.latest) : null; }
  async close() { this.ready = false; }
}
