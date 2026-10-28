import { useWorldStore } from "../state/world-store";
import { metricValue } from "../lib/command-center";

export function MetricsPanel({ technical = false }: { technical?: boolean }) {
  const snapshot = useWorldStore(s => s.currentSnapshot);
  const graphVersion = useWorldStore(s => s.graphVersion);
  const m = snapshot?.metrics;
  const items = technical ? [
    ["Latencia de ruta p95", metricValue(m?.routeLatencyP95Ms, " ms", 1)],
    ["Disponibilidad de routing", metricValue(m?.routeAvailabilityPercent, "%", 1)],
    ["Timeouts", metricValue(m?.routeTimeouts)],
    ["Rutas inválidas", metricValue(m?.invalidRouteResponses)],
    ["Zombies activos", metricValue(m?.activeZombies)],
    ["Duración de turno", metricValue(m?.turnDurationMs, " ms", 1)],
    ["Deadlines incumplidos", metricValue(m?.deadlineMisses)],
  ] : [
    ["Vivos", metricValue(m?.activeSurvivors)],
    ["Evacuados", metricValue(m?.evacuatedSurvivors)],
    ["Mordidos", metricValue(m?.bittenSurvivors)],
  ];
  return <div>
    <dl className={technical ? "technical-metrics" : "population-metrics"}>
      {items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    {technical && <div className="technical-identity">
      <p>Disponibilidad: respuestas válidas de routing dentro de su plazo; dato publicado por el backend.</p>
      <p>Grafo cargado <code>{graphVersion ?? "Sin dato"}</code></p>
      <p>Grafo de partida <code>{snapshot?.graphVersion ?? "Sin partida"}</code></p>
      <p>Partida <code>{snapshot?.gameId ?? "Sin iniciar"}</code> · versión {snapshot?.worldVersion ?? "Sin dato"}</p>
    </div>}
  </div>;
}
