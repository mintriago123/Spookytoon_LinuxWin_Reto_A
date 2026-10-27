import { useEffect } from "react";
import { LiveMap } from "../components/LiveMap";
import { RoundControls } from "../components/RoundControls";
import { MetricsPanel } from "../components/MetricsPanel";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { EntityLegend } from "../components/EntityLegend";
import { useTurnSocket } from "../hooks/useTurnSocket";
import { useWorldStore } from "../state/world-store";
import type { MantaGraph } from "../types/contracts";

/**
 * Composición de la app de Kristhian (docs/team/kristhian/README.md):
 * carga el grafo estático, conecta WS/estado y monta mapa + controles +
 * métricas. El Frontend nunca decide rutas, mordidas ni evacuaciones.
 */
export function App() {
  const setGraph = useWorldStore((s) => s.setGraph);
  const setLastError = useWorldStore((s) => s.setLastError);
  useTurnSocket();

  useEffect(() => {
    let cancelled = false;
    fetch("/data/grafo_manta.json")
      .then((res) => {
        if (!res.ok) throw new Error(`No se pudo cargar el grafo (${res.status})`);
        return res.json() as Promise<MantaGraph>;
      })
      .then((graph) => {
        if (!cancelled) setGraph(graph);
      })
      .catch((err) => {
        if (!cancelled) {
          setLastError(
            err instanceof Error ? err.message : "Fallo al cargar el grafo",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [setGraph, setLastError]);

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-950 md:flex-row">
      <main className="relative flex-1">
        <LiveMap />
        <div className="absolute left-3 top-3 flex flex-col gap-2">
          <ConnectionStatus />
          <EntityLegend />
        </div>
      </main>
      <aside className="flex w-full flex-col gap-3 overflow-y-auto border-t border-slate-200 bg-slate-100 p-3 dark:border-slate-800 dark:bg-slate-900 md:w-80 md:border-l md:border-t-0">
        <MetricsPanel />
        <RoundControls />
      </aside>
    </div>
  );
}
