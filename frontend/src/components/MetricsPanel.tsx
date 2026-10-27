import { useWorldStore } from "../state/world-store";

const ROUND_TURN_COUNT = 150;

const ROUND_LABEL: Record<1 | 2 | 3, string> = {
  1: "1 · Anochecer",
  2: "2 · Medianoche",
  3: "3 · Apocalipsis",
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        {value}
      </span>
    </div>
  );
}

/**
 * SPEC.md §6 / docs/team/kristhian: vivos, mordidos, evacuados, zombies,
 * turno n/150, reloj, p95, timeouts y rutas inválidas — exactamente las
 * cifras del último snapshot, sin recalcular nada en el cliente.
 */
export function MetricsPanel() {
  const snapshot = useWorldStore((s) => s.currentSnapshot);

  if (!snapshot) {
    return (
      <div className="rounded-lg bg-white/90 p-3 text-xs text-slate-500 shadow-md dark:bg-slate-900/90 dark:text-slate-400">
        Sin datos del backend todavía.
      </div>
    );
  }

  const { metrics, turnId, roundId } = snapshot;
  const elapsedSeconds = turnId * 2;
  const clock = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(
    elapsedSeconds % 60,
  ).padStart(2, "0")}`;

  // Disponibilidad = solicitudes de ruta contestadas con respuesta válida
  // dentro de 500 ms. Se deriva en el cliente solo para mostrar; el Backend
  // no publica este porcentaje directamente (SPEC.md §5.4 sí publica los
  // conteos crudos que lo componen).
  const invalidSamples = metrics.routeTimeouts + metrics.invalidRouteResponses;
  const availability =
    metrics.routeSamples > 0
      ? `${(((metrics.routeSamples - invalidSamples) / metrics.routeSamples) * 100).toFixed(1)}%`
      : "—";

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg bg-white/90 p-3 shadow-md dark:bg-slate-900/90 sm:grid-cols-4">
      <Metric label="Ronda" value={ROUND_LABEL[roundId]} />
      <Metric label="Vivos" value={String(metrics.activeSurvivors)} />
      <Metric label="Mordidos" value={String(metrics.bittenSurvivors)} />
      <Metric label="Evacuados" value={String(metrics.evacuatedSurvivors)} />
      <Metric label="Zombies" value={String(metrics.activeZombies)} />
      <Metric label="Turno" value={`${turnId}/${ROUND_TURN_COUNT}`} />
      <Metric label="Reloj" value={clock} />
      <Metric label="p95 ruta" value={`${metrics.routeLatencyP95Ms.toFixed(1)} ms`} />
      <Metric label="Timeouts" value={String(metrics.routeTimeouts)} />
      <Metric label="Rutas inválidas" value={String(metrics.invalidRouteResponses)} />
      <Metric label="Disponibilidad" value={availability} />
    </div>
  );
}
