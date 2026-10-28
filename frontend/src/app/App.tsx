import { useEffect, useState } from "react";
import { LiveMap } from "../components/LiveMap";
import { RoundControls } from "../components/RoundControls";
import { MetricsPanel } from "../components/MetricsPanel";
import { EntityLegend } from "../components/EntityLegend";
import { ShelterOccupancy } from "../components/ShelterOccupancy";
import { CommandBar } from "../components/CommandBar";
import { ContextPanel } from "../components/ContextPanel";
import { EventTray } from "../components/EventTray";
import { useTurnSocket } from "../hooks/useTurnSocket";
import { useOperatorControls } from "../hooks/useOperatorControls";
import { useSegments } from "../hooks/useSegments";
import { useWorldStore } from "../state/world-store";
import type { MantaGraph } from "../types/contracts";
import type { Selection } from "../lib/command-center";

export function App() {
  const setGraph = useWorldStore(s => s.setGraph);
  const setLastError = useWorldStore(s => s.setLastError);
  const lastError = useWorldStore(s => s.lastError);
  const selection = useWorldStore(s => s.selection);
  const selectEntity = useWorldStore(s => s.selectEntity);
  const graph = useWorldStore(s => s.graph);
  const snapshot = useWorldStore(s => s.currentSnapshot);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const operator = useOperatorControls();
  const segments = useSegments();
  const selectedSegment = selection?.kind === "segment" ? segments.find(s => s.segmentoId === selection.id) : undefined;
  useTurnSocket();

  useEffect(() => useWorldStore.subscribe((state, previous) => {
    if (state.selection && state.selection !== previous.selection) setPanelOpen(true);
  }), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/grafo_manta.json", { signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error(`No se pudo cargar el grafo (${res.status})`);
        return res.json() as Promise<MantaGraph>;
      }).then(setGraph).catch(error => {
        if (!controller.signal.aborted) setLastError(error instanceof Error ? error.message : "Fallo al cargar el grafo");
      });
    return () => controller.abort();
  }, [setGraph, setLastError]);

  return <div className="command-center">
    <CommandBar operator={operator} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen(open => !open)} />
    <div className="overview-strip"><span className="overview-title">Personas · último estado recibido</span><MetricsPanel /></div>
    {lastError && <div className="global-error" role="alert">{lastError}<button type="button" onClick={() => setLastError(null)} aria-label="Ocultar mensaje de error">×</button></div>}
    <div className="command-workspace">
      <main className="map-stage" aria-label="Mapa del escenario de simulación de Manta">
        <LiveMap selection={selectedSegment ? { segmentoId: selectedSegment.segmentoId, label: selectedSegment.label } : null} />
        <div className="map-caption">Escenario de simulación de Manta</div>
        <div className="map-legend"><EntityLegend /></div>
      </main>
      <aside id="context-panel" className="context-panel" hidden={!panelOpen} aria-label="Panel contextual">
        <div className="section-heading"><h2>En el mapa</h2><button type="button" className="text-button" onClick={() => setPanelOpen(false)}>Ocultar panel</button></div>
        <label className="entity-browser">Explorar en el mapa
          <select aria-label="Explorar en el mapa" value={selection ? JSON.stringify(selection) : ""} onChange={e => selectEntity(e.target.value ? JSON.parse(e.target.value) as Selection : null)}>
            <option value="">Selecciona una entidad…</option>
            <optgroup label="Sobrevivientes">{snapshot?.survivors.map(s => <option key={s.id} value={JSON.stringify({ kind: "survivor", id: s.id })}>{s.id} · {s.estado}</option>)}</optgroup>
            <optgroup label="Refugios">{graph?.refugios.map(s => <option key={s.id} value={JSON.stringify({ kind: "shelter", id: s.id })}>{s.id}</option>)}</optgroup>
            <optgroup label="Segmentos">{segments.map(s => <option key={s.segmentoId} value={JSON.stringify({ kind: "segment", id: s.segmentoId })}>{s.label}</option>)}</optgroup>
          </select>
        </label>
        <ContextPanel segments={segments} />
        <RoundControls operator={operator} segments={segments} />
        <details className="secondary-panel"><summary>Refugios · ocupación y cupos</summary><ShelterOccupancy /></details>
        <details className="secondary-panel"><summary>Métricas técnicas y versiones</summary><MetricsPanel technical /></details>
      </aside>
    </div>
    <EventTray segments={segments} />
  </div>;
}
