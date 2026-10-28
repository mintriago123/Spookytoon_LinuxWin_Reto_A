import { useWorldStore } from "../state/world-store";

/**
 * Ocupación de refugios como barras, además del popup en LiveMap (boceto
 * de diseño del equipo, "Centro de mando"). Lee directo del snapshot; no
 * decide admisión ni capacidad — eso es responsabilidad del Simulador.
 */
export function ShelterOccupancy() {
  const graph = useWorldStore((s) => s.graph);
  const shelters = useWorldStore((s) => s.currentSnapshot?.shelters);

  if (!graph || graph.refugios.length === 0) return null;

  return (
    <div className="glass flex flex-col gap-2 rounded-lg p-3 text-xs text-slate-100">
      <span className="font-semibold uppercase tracking-wide text-accent-cyan/85">
        Refugios · ocupación
      </span>
      <ul className="flex flex-col gap-2">
        {graph.refugios.map((refugio) => {
          const live = shelters?.find((s) => s.id === refugio.id);
          const ocupacion = live?.ocupantes.length ?? 0;
          const lleno = ocupacion >= refugio.capacidad;
          const pct = Math.min(100, (ocupacion / refugio.capacidad) * 100);
          return (
            <li key={refugio.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span>{refugio.id}</span>
                <span className={lleno ? "text-accent-rose" : "text-slate-300"}>
                  {ocupacion}/{refugio.capacidad} {lleno ? "lleno" : ""}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#14323a]">
                <div
                  className={`h-full rounded-full ${lleno ? "bg-accent-rose" : "bg-accent-cyan"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
