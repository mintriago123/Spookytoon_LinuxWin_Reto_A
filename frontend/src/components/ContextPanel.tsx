import { useWorldStore } from "../state/world-store";
import { survivorDisplacement } from "../lib/command-center";
import type { SegmentOption } from "../hooks/useSegments";

export function ContextPanel({ segments }: { segments: SegmentOption[] }) {
  const { selection, currentSnapshot: world, previousSnapshot: previous, graph, selectEntity } = useWorldStore();
  if (!selection) return <div className="selection-empty"><span aria-hidden>⌖</span><h3>Explora el escenario</h3><p>Selecciona una persona, un refugio o una calle en el mapa para ver su estado.</p></div>;
  const survivor = selection.kind === "survivor" ? world?.survivors.find(s => s.id === selection.id) : undefined;
  const shelter = selection.kind === "shelter" ? graph?.refugios.find(s => s.id === selection.id) : undefined;
  const liveShelter = world?.shelters.find(s => s.id === shelter?.id);
  const segment = selection.kind === "segment" ? segments.find(s => s.segmentoId === selection.id) : undefined;
  const closure = world?.blockedEdges.find(s => s.segmentoId === selection.id && s.desbloqueadaEnTurno === null);
  const movement = survivorDisplacement(world, previous, selection.id);
  return <section className="selected-detail" aria-label="Detalle de selección">
    <div className="section-heading"><h2>{survivor ? "Sobreviviente" : shelter ? "Refugio" : "Segmento"}</h2><button type="button" className="text-button" onClick={() => selectEntity(null)}>Limpiar</button></div>
    <h3>{segment?.label ?? selection.id}</h3>
    {survivor && <dl>
      <div><dt>Estado</dt><dd>{survivor.estado}</dd></div>
      <div><dt>Refugio objetivo</dt><dd>{survivor.targetShelterId ?? "Sin objetivo publicado"}</dd></div>
      <div><dt>Posición lógica</dt><dd><code>{survivor.nodeId}</code></dd></div>
      <div><dt>Último intervalo</dt><dd>{movement ? movement.from === movement.to ? "Mismo nodo entre turnos consecutivos; sin motivo publicado." : <>{movement.from} → {movement.to}</> : "Sin dos turnos consecutivos para describir el desplazamiento."}</dd></div>
    </dl>}
    {shelter && <dl>
      <div><dt>Ocupantes</dt><dd>{liveShelter?.ocupantes.length ?? "Sin dato"}</dd></div>
      <div><dt>Capacidad</dt><dd>{liveShelter?.capacidad ?? shelter.capacidad}</dd></div>
      <div><dt>Reservas</dt><dd>{liveShelter?.reservados.length ?? "Sin dato"}</dd></div>
      <div><dt>Cupos sin reservar</dt><dd>{liveShelter ? liveShelter.capacidad - liveShelter.ocupantes.length - liveShelter.reservados.length : "Sin dato"}</dd></div>
    </dl>}
    {segment && <dl>
      <div><dt>Estado observado</dt><dd>{world ? closure ? "Cerrado" : "Sin cierre activo" : "Sin partida"}</dd></div>
      <div><dt>Motivo</dt><dd>{closure?.motivo ?? "Sin cierre activo"}</dd></div>
      {closure && <div><dt>Desde turno</dt><dd>{closure.bloqueadaDesdeTurno}</dd></div>}
      <div><dt>Aristas del segmento</dt><dd>{graph?.aristas.filter(e => e.segmentoId === segment.segmentoId).length}</dd></div>
      <div><dt>ID técnico</dt><dd><code>{segment.segmentoId}</code></dd></div>
    </dl>}
  </section>;
}
