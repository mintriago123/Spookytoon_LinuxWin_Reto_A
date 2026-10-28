import { performance } from "node:perf_hooks";

export interface SimulationClock {
  now(): number;
  waitUntil(deadlineMs: number, signal: AbortSignal): Promise<void>;
}

/** Tiempo transcurrido, independiente del reloj calendario; espera cancelable al pausar. */
export function createSimulationClock(): SimulationClock {
  const now = () => performance.now();
  return { now, waitUntil(deadlineMs, signal) {
    if (!Number.isFinite(deadlineMs)) return Promise.reject(new Error("Tick monotónico inválido"));
    return new Promise<void>(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let immediate: ReturnType<typeof setImmediate> | undefined;
      const finish = () => {
        clearTimeout(timer); if (immediate) clearImmediate(immediate);
        signal.removeEventListener("abort", finish); resolve();
      };
      const wait = () => {
        const remaining = deadlineMs - now();
        if (signal.aborted || remaining <= 0) { finish(); return; }
        // El temporizador grueso puede despertar >10 ms tarde en Windows. Durante
        // los últimos 20 ms cedemos a I/O en cada iteración, sin publicar antes
        // de la frontera ni cambiar el deadline o la tolerancia de cierre.
        if (remaining <= 20) immediate = setImmediate(wait);
        else timer = setTimeout(wait, Math.min(0x7fff_ffff, Math.max(1, remaining - 20)));
      };
      signal.addEventListener("abort", finish, { once: true }); wait();
    });
  } };
}
