import { useState } from "react";
import {
  SURVIVOR_COLOR,
  ZOMBIE_COLOR,
  shelterBody,
  survivorBody,
  wrapSvg,
  zombieBody,
} from "./entity-icons";

const COLLAPSED_STORAGE_KEY = "spookython:legend-collapsed";

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    // Storage bloqueado (modo privado, política del navegador): no es
    // crítico, la leyenda simplemente no recuerda la preferencia.
    return false;
  }
}

const ROAD_LEGEND: Array<{ label: string; colorClass: string }> = [
  { label: "Avenida", colorClass: "bg-slate-400" },
  { label: "Calle", colorClass: "bg-slate-500" },
  { label: "Callejón", colorClass: "bg-slate-600" },
  { label: "Puente", colorClass: "bg-accent-amber" },
];

const ENTITY_LEGEND: Array<{ label: string; markup: string }> = [
  { label: "Sobreviviente vivo", markup: survivorBody("vivo", SURVIVOR_COLOR.vivo) },
  { label: "Sobreviviente mordido", markup: survivorBody("mordido", SURVIVOR_COLOR.mordido) },
  { label: "Sobreviviente evacuado", markup: survivorBody("evacuado", SURVIVOR_COLOR.evacuado) },
  { label: "Zombie caminante", markup: zombieBody("caminante", ZOMBIE_COLOR.caminante, false) },
  { label: "Zombie corredor · radio 2", markup: zombieBody("corredor", ZOMBIE_COLOR.corredor, false) },
  { label: "Horda · nodo + vecinos", markup: zombieBody("horda", ZOMBIE_COLOR.horda, false) },
  { label: "Dormido", markup: zombieBody("dormido", ZOMBIE_COLOR.dormido, true) },
  { label: "Refugio", markup: shelterBody() },
];

/**
 * SPEC.md §6 / docs/team/kristhian: cada tipo/estado DEBE tener marcador y
 * texto además de color (accesibilidad). Reusa los mismos glifos SVG que
 * LiveMap para que la leyenda sea exactamente lo que se ve en el mapa.
 *
 * Colapsable: la leyenda completa tapa buena parte del mapa en viewports
 * chicos (laptop). El operador puede minimizarla a una sola fila durante
 * una ronda activa; la preferencia se recuerda en localStorage.
 */
export function EntityLegend() {
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Igual que al leer: si el storage falla, solo no se recuerda.
      }
      return next;
    });
  };

  return (
    <div className="glass rounded-lg p-3 text-xs text-slate-100">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-controls="entity-legend-body"
        className="flex w-full items-center justify-between gap-2 text-left font-semibold uppercase tracking-wide text-slate-300 hover:text-slate-100"
      >
        <span>Leyenda</span>
        <span aria-hidden className={`transition-transform duration-150 ${collapsed ? "" : "rotate-180"}`}>
          ▾
        </span>
      </button>

      {!collapsed && (
        <div id="entity-legend-body" className="mt-2">
          <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-400">
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
                className="h-0 w-4 border-t-2 border-dashed border-accent-rose"
                aria-hidden
              />
              <span>Segmento cerrado</span>
            </li>
          </ul>

          <h3 className="mb-2 font-semibold uppercase tracking-wide text-slate-400">
            Entidades
          </h3>
          <ul className="space-y-1">
            {ENTITY_LEGEND.map((item) => (
              <li key={item.label} className="flex items-center gap-2">
                <span
                  className="flex h-4 w-4 items-center justify-center"
                  aria-hidden
                  dangerouslySetInnerHTML={{ __html: wrapSvg(16, item.markup) }}
                />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
