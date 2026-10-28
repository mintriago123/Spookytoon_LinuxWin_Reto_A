import { useWorldStore } from "../state/world-store";

/** Always-visible summary: occupancy and reservations remain distinct. */
export function ShelterOccupancy() {
  const graph = useWorldStore(s => s.graph);
  const shelters = useWorldStore(s => s.currentSnapshot?.shelters);
  const selectEntity = useWorldStore(s => s.selectEntity);
  if (!graph?.refugios.length) return null;
  const reservations = shelters && graph.refugios.every(refugio => shelters.some(s => s.id === refugio.id))
    ? graph.refugios.reduce((sum, refugio) => sum + shelters.find(s => s.id === refugio.id)!.reservados.length, 0) : null;
  return <section className="shelter-overview" aria-label="Resumen de refugios">
    <h3>Refugios · ocupación {reservations !== null && reservations > 0 && <span>{reservations} reservas</span>}</h3>
    <ul>{graph.refugios.map(refugio => {
      const live = shelters?.find(s => s.id === refugio.id);
      const name = refugio.id.replace(/^R-/, "").toLocaleLowerCase("es").replace(/^./, letter => letter.toLocaleUpperCase("es"));
      const full = live ? live.ocupantes.length >= live.capacidad : false;
      const percent = live ? Math.min(100, live.ocupantes.length / live.capacidad * 100) : 0;
      return <li key={refugio.id} className={full ? "shelter-full" : ""}>
        <button type="button" className="shelter-bar-label" title={refugio.id} onClick={() => selectEntity({ kind: "shelter", id: refugio.id })}>
          <span>{name}</span><strong>{live ? `${live.ocupantes.length}/${live.capacidad}${full ? " · Lleno" : ""}` : "Sin dato"}</strong>
        </button>
        <div className="shelter-bar" role="progressbar" aria-label={`Ocupación de ${name}`} aria-valuemin={0}
          aria-valuemax={live?.capacidad ?? refugio.capacidad} aria-valuenow={live?.ocupantes.length}
          aria-valuetext={live ? `${live.ocupantes.length} ocupantes de ${live.capacidad} plazas` : "Ocupación sin dato"}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </li>;
    })}</ul>
  </section>;
}
