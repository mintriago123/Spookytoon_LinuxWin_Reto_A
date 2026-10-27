import { useEffect } from "react";
import { LiveMap } from "../components/LiveMap";
import { RoundControls } from "../components/RoundControls";
import { MetricsPanel } from "../components/MetricsPanel";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { EntityLegend } from "../components/EntityLegend";
import { ShelterOccupancy } from "../components/ShelterOccupancy";
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
    <div className="flex h-full w-full flex-col bg-night-900 text-slate-100 md:flex-row">
      <div className="flex flex-col md:w-[calc(100%-20rem)]">
        <header className="glass z-10 flex items-center gap-3 px-4 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-cyan/20 text-accent-cyan">
            ☣
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide">Escape de Manta Zombie</div>
            <div className="text-[11px] text-slate-400">
              Centro de mando · motor de rutas en tiempo real
            </div>
          </div>
        </header>
        <main className="relative flex-1">
          <LiveMap />
          <div className="absolute left-3 top-3 flex flex-col gap-2">
            <ConnectionStatus />
            <EntityLegend />
          </div>
        </main>
      </div>
      <aside className="flex w-full flex-col gap-3 overflow-y-auto border-t border-white/10 bg-night-800 p-3 md:w-80 md:border-l md:border-t-0">
        <MetricsPanel />
        <ShelterOccupancy />
        <RoundControls />
      </aside>
    </div>
  );
}
