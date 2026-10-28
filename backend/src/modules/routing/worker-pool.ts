import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { RoutingError, type RoutingSnapshot } from "../../contracts/routing.ts";
import type { MantaGraph } from "../../contracts/types.ts";

interface PoolOptions {
    size?: number; queueLimit?: number; timeoutMs?: number;
}

interface Slot { worker: Worker; ready: boolean }
interface Job { request: unknown; resolve: (value: RoutingSnapshot) => void; reject: (error: Error) => void }

/** IPC por sincronización, nunca por /paso. Un lote se instala en todos los workers. */
export class RoutingWorkerPool {
  readonly size: number;
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private busy = false;
  private closed = false;
  private failed = false;
  private sequence = 0;
  private readonly graph: MantaGraph;
  private readonly options: PoolOptions;
  constructor(graph: MantaGraph, options: PoolOptions = {}) {
    this.graph = graph; this.options = options;
    this.size = options.size ?? Math.min(8, Math.max(1, availableParallelism() - 1));
    if (!Number.isInteger(this.size) || this.size < 1 || this.size > 8) throw new Error("Workers debe estar entre 1 y 8");
    if (!Number.isInteger(options.queueLimit ?? 200) || (options.queueLimit ?? 200) < 1) throw new Error("Cola inválida");
  }
  async initialize(): Promise<void> {
    if (this.slots.length || this.closed) throw new Error("Pool ya inicializado o cerrado");
    try {
      await Promise.all(Array.from({ length: this.size }, async () => {
        const worker = new Worker(new URL("./route-worker.ts", import.meta.url), {
          workerData: { graph: this.graph, workerCount: this.size },
          // Node 24 ejecuta TS nativo; no heredar flags de PM2, test runner o --input-type.
          execArgv: [],
          resourceLimits: { maxOldGenerationSizeMb: 64 },
        });
        const slot = { worker, ready: false }; this.slots.push(slot);
        worker.on("error", () => { slot.ready = false; this.failed = true; });
        worker.on("exit", () => { slot.ready = false; if (!this.closed) this.failed = true; });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("WORKER_START_TIMEOUT")), this.options.timeoutMs ?? 10_000);
          const message = (value: { ready?: boolean }) => {
            if (!value.ready) return;
            clearTimeout(timer); worker.off("error", error); slot.ready = true; resolve();
          };
          const error = (err: Error) => { clearTimeout(timer); worker.off("message", message); reject(err); };
          worker.once("message", message); worker.once("error", error);
        });
      }));
    } catch (error) { await this.close(); throw error; }
  }
  isReady(): boolean { return !this.closed && !this.failed && this.slots.length === this.size && this.slots.every(s => s.ready); }
  get queueDepth(): number { return this.queue.length + Number(this.busy); }
  compute(request: unknown): Promise<RoutingSnapshot> {
    if (!this.isReady()) return Promise.reject(new RoutingError(503, "ROUTE_UNAVAILABLE", "Workers no disponibles"));
    if (this.queueDepth >= (this.options.queueLimit ?? 200)) return Promise.reject(new RoutingError(429, "ROUTE_CAPACITY", "Cola de rutas llena"));
    return new Promise((resolve, reject) => { this.queue.push({ request, resolve, reject }); this.drain(); });
  }
  private drain(): void {
    if (this.busy || !this.queue.length) return;
    if (!this.isReady()) { for (const job of this.queue.splice(0)) job.reject(new RoutingError(503, "ROUTE_UNAVAILABLE", "Workers no disponibles")); return; }
    this.busy = true;
    const job = this.queue.shift()!;
    const id = ++this.sequence;
    const calls = this.slots.map(({ worker }) => new Promise<RoutingSnapshot>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); worker.off("message", message); worker.off("error", error); worker.off("exit", exited); };
      const error = () => { cleanup(); reject(new RoutingError(503, "ROUTE_UNAVAILABLE", "Falló un worker")); };
      const exited = () => error();
      const message = (value: { id: number; snapshot?: RoutingSnapshot; error?: string }) => {
        if (value.id !== id) return;
        cleanup();
        if (value.snapshot) resolve(value.snapshot); else reject(new RoutingError(503, "ROUTE_UNAVAILABLE", "Falló el cálculo aislado"));
      };
      const timer = setTimeout(() => { this.failed = true; error(); }, this.options.timeoutMs ?? 2_000);
      worker.on("message", message); worker.once("error", error); worker.once("exit", exited);
      worker.postMessage({ id, request: job.request });
    }));
    void Promise.all(calls).then(snapshots => job.resolve(snapshots[0]), error => job.reject(error))
      .finally(() => { this.busy = false; this.drain(); });
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new RoutingError(503, "ROUTE_UNAVAILABLE", "Pool cerrado"));
    await Promise.all(this.slots.map(slot => slot.worker.terminate()));
  }
}
