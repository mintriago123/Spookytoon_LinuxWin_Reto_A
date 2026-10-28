import type { EntityStatus, MantaGraph, WorldSnapshot } from "../types/contracts";
import type { SegmentOption } from "../hooks/useSegments";

export type ExplorerCategory = "survivor" | "shelter" | "segment";
export interface ExplorerState {
  category: ExplorerCategory;
  queries: Record<ExplorerCategory, string>;
  survivorFilter: "all" | EntityStatus;
  segmentFilter: "all" | "closed";
}
export type ExplorerAction =
  | { type: "category"; category: ExplorerCategory }
  | { type: "query"; value: string }
  | { type: "survivor-filter"; value: ExplorerState["survivorFilter"] }
  | { type: "segment-filter"; value: ExplorerState["segmentFilter"] }
  | { type: "reveal"; category: ExplorerCategory; id: string }
  | { type: "reset" };

export function initialExplorerState(): ExplorerState {
  return { category: "survivor", queries: { survivor: "", shelter: "", segment: "" }, survivorFilter: "all", segmentFilter: "all" };
}

/** Search/filter state never selects an entity or issues a command. */
export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  switch (action.type) {
    case "category": return { ...state, category: action.category };
    case "query": return { ...state, queries: { ...state.queries, [state.category]: action.value } };
    case "survivor-filter": return { ...state, survivorFilter: action.value };
    case "segment-filter": return { ...state, segmentFilter: action.value };
    case "reveal": return { ...state, category: action.category, survivorFilter: "all", segmentFilter: "all",
      queries: { ...state.queries, [action.category]: action.id } };
    case "reset": return initialExplorerState();
  }
}

export const SURVIVOR_STATES: Record<EntityStatus, string> = { vivo: "Vivo", evacuado: "Evacuado", mordido: "Mordido" };
export interface ExplorerItem {
  id: string;
  title: string;
  secondary: string[];
  badge: string;
  tone: "neutral" | "good" | "info" | "danger";
  search: string;
}

export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

/** Keep both directed edges in the graph but present one result per physical segment. */
export function uniqueSegments(segments: SegmentOption[]): SegmentOption[] {
  return [...new Map(segments.map(segment => [segment.segmentoId, segment])).values()];
}

export function explorerResults(state: ExplorerState, graph: MantaGraph, world: WorldSnapshot | null, segments: SegmentOption[]) {
  const closedIds = new Set(world?.blockedEdges.filter(edge => edge.desbloqueadaEnTurno === null).map(edge => edge.segmentoId));
  let items: ExplorerItem[];
  if (state.category === "survivor") {
    items = (world?.survivors ?? []).map(person => ({
      id: person.id, title: person.id, secondary: person.targetShelterId ? [`Objetivo: ${person.targetShelterId}`] : [],
      badge: SURVIVOR_STATES[person.estado], tone: person.estado === "vivo" ? "good" : person.estado === "evacuado" ? "info" : "danger", search: person.id,
    }));
  } else if (state.category === "shelter") {
    items = graph.refugios.map(shelter => {
      const live = world?.shelters.find(item => item.id === shelter.id);
      return { id: shelter.id, title: shelter.id, search: shelter.id, badge: "Refugio", tone: "info", secondary: live
        ? [`${live.ocupantes.length} ocupantes · capacidad ${live.capacidad}`, `${live.reservados.length} ${live.reservados.length === 1 ? "reserva" : "reservas"}`]
        : [`Capacidad: ${shelter.capacidad}`, "Ocupación y reservas: sin dato"],
      };
    });
  } else {
    items = uniqueSegments(segments).map(segment => {
      const [name, ...reference] = segment.label.split(" · ");
      return { id: segment.segmentoId, title: name, search: `${segment.label} ${segment.segmentoId}`,
        secondary: reference.length ? [reference.join(" · ")] : [],
        badge: !world ? "Sin partida" : closedIds.has(segment.segmentoId) ? "Cerrado" : "Sin cierre activo",
        tone: world && closedIds.has(segment.segmentoId) ? "danger" : "neutral",
      };
    });
  }
  const total = items.length;
  const query = normalizeSearch(state.queries[state.category]);
  const survivorIds = state.category === "survivor" && state.survivorFilter !== "all"
    ? new Set(world?.survivors.filter(person => person.estado === state.survivorFilter).map(person => person.id)) : null;
  items = items.filter(item => (!survivorIds || survivorIds.has(item.id)) &&
    (state.category !== "segment" || state.segmentFilter !== "closed" || closedIds.has(item.id)) && normalizeSearch(item.search).includes(query));
  items.sort((a, b) => a.search.localeCompare(b.search, "es", { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id));
  return { items, total };
}
