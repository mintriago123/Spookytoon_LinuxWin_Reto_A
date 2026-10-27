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
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
      const wait = () => {
        if (signal.aborted || now() >= deadlineMs) { finish(); return; }
        timer = setTimeout(wait, Math.min(0x7fff_ffff, Math.max(1, deadlineMs - now())));
      };
      signal.addEventListener("abort", finish, { once: true }); wait();
    });
  } };
}
