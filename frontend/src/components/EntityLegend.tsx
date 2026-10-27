const ROAD_LEGEND: Array<{ label: string; colorClass: string }> = [
  { label: "Avenida", colorClass: "bg-slate-300" },
  { label: "Calle", colorClass: "bg-slate-400" },
  { label: "Callejón", colorClass: "bg-slate-500" },
  { label: "Puente", colorClass: "bg-amber-400" },
];

const ENTITY_LEGEND: Array<{ label: string; colorClass: string; shape: string }> = [
  { label: "Sobreviviente vivo", colorClass: "bg-emerald-500", shape: "●" },
  { label: "Sobreviviente mordido", colorClass: "bg-rose-600", shape: "●" },
  { label: "Sobreviviente evacuado", colorClass: "bg-sky-500", shape: "●" },
  { label: "Zombie caminante", colorClass: "bg-lime-700", shape: "▲" },
  { label: "Zombie corredor", colorClass: "bg-orange-600", shape: "▲" },
  { label: "Zombie horda", colorClass: "bg-purple-700", shape: "■" },
  { label: "Zombie dormido", colorClass: "bg-purple-300", shape: "▲" },
  { label: "Refugio", colorClass: "bg-blue-600", shape: "★" },
];

/**
 * SPEC.md §6 / docs/team/kristhian: cada tipo/estado DEBE tener marcador y
 * texto además de color (accesibilidad). Esta leyenda es la referencia
 * textual que acompaña a LiveMap.
 */
export function EntityLegend() {
  return (
    <div className="rounded-lg bg-white/90 p-3 text-xs shadow-md backdrop-blur dark:bg-slate-900/90 dark:text-slate-100">
      <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Vías
      </h3>
      <ul className="mb-3 space-y-1">
        {ROAD_LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span className={`h-2 w-4 rounded ${item.colorClass}`} aria-hidden />
            <span>{item.label}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span
            className="h-0 w-4 border-t-2 border-dashed border-red-600"
            aria-hidden
          />
          <span>Segmento cerrado</span>
        </li>
      </ul>

      <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Entidades
      </h3>
      <ul className="space-y-1">
        {ENTITY_LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white ${item.colorClass}`}
              aria-hidden
            >
              {item.shape}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
