import { setTimeout as delay } from "node:timers/promises";
import type { Immutable, WorldState } from "../simulator/types.ts";
import type { PersistenceAdapter } from "./adapter.ts";

interface QueueOptions {
    limit?: number; retryBaseMs?: number; sleep?: (ms: number) => Promise<void>; random?: () => number;
    onAlarm?: (event: { code: "SNAPSHOT_QUEUE_FULL" | "SNAPSHOT_WRITE_FAILED"; gameId: string; turnId: number }) => void;
}

export interface QueueStats { depth: number; oldestAgeMs: number; lastSnapshotTurnId: number | null; failures: number; saturated: boolean }
/** Guarda referencias inmutables; serialización y red se difieren fuera del callback de commit. */
export class SnapshotQueue {
  private jobs: { world: Immutable<WorldState>; at: number }[] = [];
  private processing = false;
  private scheduled = false;
  private closed = false;
  private failed = false;
  private lastSnapshotTurnId: number | null = null;
  private failures = 0;
  private waiters: (() => void)[] = [];
  private readonly adapter: PersistenceAdapter;
  private readonly options: QueueOptions;
  constructor(adapter: PersistenceAdapter, options: QueueOptions = {}) {
    this.adapter = adapter; this.options = options;
    if (!Number.isSafeInteger(options.limit ?? 32) || (options.limit ?? 32) < 1) throw new Error("Límite de cola inválido");
  }
  enqueue(world: Immutable<WorldState>): boolean {
    if (this.closed || this.failed) return false;
    if (this.jobs.length >= (this.options.limit ?? 32)) {
      this.alarm("SNAPSHOT_QUEUE_FULL", world); return false;
    }
    this.jobs.push({ world, at: Date.now() });
    if (!this.processing && !this.scheduled) {
      this.scheduled = true;
      setImmediate(() => { this.scheduled = false; void this.drain(); });
    }
    return true;
  }
  stats(): QueueStats { return { depth: this.jobs.length, oldestAgeMs: this.jobs.length ? Date.now() - this.jobs[0].at : 0,
    lastSnapshotTurnId: this.lastSnapshotTurnId, failures: this.failures, saturated: this.failed || this.jobs.length >= (this.options.limit ?? 32) }; }
  isHealthy(): boolean { return !this.closed && !this.failed; }
  private alarm(code: "SNAPSHOT_QUEUE_FULL" | "SNAPSHOT_WRITE_FAILED", world: Immutable<WorldState>) {
    try { this.options.onAlarm?.({ code, gameId: world.gameId, turnId: world.turnId }); } catch { /* No lanzar al escritor. */ }
  }
  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.jobs.length && !this.failed) {
        const { world } = this.jobs[0]; let saved = false;
        for (let attempt = 0; attempt <= 3; attempt++) {
          try { await this.adapter.save(world); saved = true; break; }
          catch {
            if (attempt < 3) await (this.options.sleep ?? delay)((this.options.retryBaseMs ?? 100) * 2 ** attempt * (0.5 + (this.options.random ?? Math.random)()));
          }
        }
        if (!saved) { this.failures++; this.failed = true; this.alarm("SNAPSHOT_WRITE_FAILED", world); break; }
        this.lastSnapshotTurnId = world.turnId; this.jobs.shift();
      }
    } finally { this.processing = false; for (const done of this.waiters.splice(0)) done(); }
  }
  async flush(): Promise<void> {
    if (this.scheduled || this.processing) await new Promise<void>(resolve => this.waiters.push(resolve));
    if (this.failed || this.jobs.length) throw new Error("La cola conserva snapshots sin persistir");
  }
  async close(): Promise<void> {
    this.closed = true;
    try { await this.flush(); } finally { await this.adapter.close(); }
  }
}
