import { useEffect, useReducer, useRef, useState } from "react";
import { hasGraphVersionMismatch, useWorldStore } from "../state/world-store";
import { explorerReducer, explorerResults, initialExplorerState, type ExplorerAction, type ExplorerCategory } from "../lib/entity-explorer";
import type { MantaGraph, WorldSnapshot } from "../types/contracts";
import type { SegmentOption } from "../hooks/useSegments";

const CATEGORIES: { id: ExplorerCategory; label: string; placeholder: string }[] = [
  { id: "survivor", label: "Sobrevivientes", placeholder: "Buscar por identificador…" },
  { id: "shelter", label: "Refugios", placeholder: "Buscar refugio…" },
  { id: "segment", label: "Segmentos", placeholder: "Buscar calle, zona o segmento…" },
];

export function EntityExplorer({ segments }: { segments: SegmentOption[] }) {
  const graph = useWorldStore(s => s.graph);
  const world = useWorldStore(s => s.currentSnapshot);
  const mismatch = useWorldStore(hasGraphVersionMismatch);
  if (!graph) return <section className="entity-explorer" aria-label="Explorar"><h2>Explorar</h2><p role="status">Cargando el grafo del escenario…</p></section>;
  if (mismatch) return <section className="entity-explorer" aria-label="Explorar"><h2>Explorar</h2><p role="alert">El grafo no coincide con la partida. Recarga el grafo antes de explorar.</p></section>;
  // A new game/graph starts a new exploration scope; turn updates preserve local state.
  return <ExplorerContent key={`${graph.metadata.graphVersion}:${world?.gameId ?? "no-game"}`} graph={graph} world={world} segments={segments} />;
}

function ExplorerContent({ graph, world, segments }: { graph: MantaGraph; world: WorldSnapshot | null; segments: SegmentOption[] }) {
  const [state, dispatch] = useReducer(explorerReducer, undefined, initialExplorerState);
  const [notice, setNotice] = useState<string | null>(null);
  const selection = useWorldStore(s => s.selection);
  const selectEntity = useWorldStore(s => s.selectEntity);
  const list = useRef<HTMLUListElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const { items, total } = explorerResults(state, graph, world, segments);
  const active = CATEGORIES.find(category => category.id === state.category)!;
  const query = state.queries[state.category];
  const selectionOutside = selection && (selection.kind !== state.category || !items.some(item => item.id === selection.id));

  useEffect(() => useWorldStore.subscribe((next, previous) => {
    if (next.selection) setNotice(null);
    else if (previous.selection && next.currentSnapshot !== previous.currentSnapshot &&
      next.currentSnapshot?.gameId === previous.currentSnapshot?.gameId && next.graphVersion === previous.graphVersion) {
      setNotice("El elemento seleccionado ya no está disponible. Puedes seleccionar otro resultado.");
    }
  }), []);

  const change = (action: ExplorerAction) => {
    dispatch(action);
    if (list.current) list.current.scrollTop = 0;
  };

  return <section className="entity-explorer" aria-labelledby="explorer-title">
    <h2 id="explorer-title">Explorar</h2>
    <fieldset className="explorer-categories">
      <legend className="sr-only">Categoría de exploración</legend>
      {CATEGORIES.map(category => <label className={`explorer-category ${state.category === category.id ? "is-active" : ""}`} key={category.id}>
        <input type="radio" className="sr-only" name="explorer-category" value={category.id} checked={state.category === category.id}
          onChange={() => change({ type: "category", category: category.id })} />
        <span>{category.label}</span>
      </label>)}
    </fieldset>
    <div className="explorer-search">
      <label htmlFor="explorer-search">Buscar {active.label.toLocaleLowerCase("es")}</label>
      <div className="explorer-search-field">
        <input id="explorer-search" ref={searchInput} type="search" placeholder={active.placeholder} value={query}
          onChange={event => change({ type: "query", value: event.target.value })} aria-controls="explorer-results" />
        {query && <button type="button" className="explorer-clear" aria-label="Limpiar búsqueda" onClick={() => {
          change({ type: "query", value: "" }); searchInput.current?.focus();
        }}>×</button>}
      </div>
    </div>
    {state.category === "survivor" && <label className="explorer-filter">Estado
      <select aria-label="Filtrar sobrevivientes por estado" value={state.survivorFilter}
        onChange={event => change({ type: "survivor-filter", value: event.target.value as typeof state.survivorFilter })}>
        <option value="all">Todos los estados</option><option value="vivo">Vivos</option><option value="evacuado">Evacuados</option><option value="mordido">Mordidos</option>
      </select>
    </label>}
    {state.category === "segment" && <label className="explorer-filter">Estado
      <select aria-label="Filtrar segmentos por estado" value={state.segmentFilter}
        onChange={event => change({ type: "segment-filter", value: event.target.value as typeof state.segmentFilter })}>
        <option value="all">Todos los segmentos</option><option value="closed">Solo cerrados</option>
      </select>
    </label>}
    <p className="explorer-count" role="status">{items.length} de {total} resultados
      {state.category === "survivor" && state.survivorFilter !== "all" ? ` · filtro: ${state.survivorFilter === "vivo" ? "Vivos" : state.survivorFilter === "evacuado" ? "Evacuados" : "Mordidos"}` : ""}
      {state.category === "segment" && state.segmentFilter === "closed" ? " · filtro: Cerrados" : ""}
    </p>
    {notice && <p className="explorer-notice" role="status">{notice}</p>}
    {selectionOutside && <p className="explorer-notice">La selección actual se conserva en el detalle: {selection.kind === "survivor" ? "Sobreviviente" : selection.kind === "shelter" ? "Refugio" : "Segmento"} · {segments.find(s => selection.kind === "segment" && s.segmentoId === selection.id)?.label ?? selection.id}.</p>}
    {items.length ? <ul id="explorer-results" className="explorer-results" ref={list} aria-label={`Resultados de ${active.label.toLocaleLowerCase("es")}`}>
      {items.map(item => {
        const selected = selection?.kind === state.category && selection.id === item.id;
        return <li key={item.id}>
          <button type="button" className={`explorer-result ${selected ? "is-selected" : ""}`} aria-pressed={selected}
            onClick={() => selectEntity({ kind: state.category, id: item.id })}>
            <span className="explorer-result-heading"><strong>{item.title}</strong><span className={`explorer-badge tone-${item.tone}`}>{item.badge}</span></span>
            {item.secondary.map(text => <span className="explorer-result-secondary" key={text}>{text}</span>)}
            <span className="explorer-result-action">{selected ? "Seleccionado · Ver en mapa" : "Ver en mapa"} <span aria-hidden>↗</span></span>
          </button>
        </li>;
      })}
    </ul> : <div id="explorer-results" className="explorer-empty">
      {!world && state.category === "survivor" ? "No hay partida iniciada. Los sobrevivientes aparecerán al comenzar una ronda."
        : query.trim() ? "No hay coincidencias. Prueba otra búsqueda o revisa el filtro."
          : total ? "No hay resultados con el filtro seleccionado."
            : `No hay ${active.label.toLocaleLowerCase("es")} publicados${world ? " en esta partida" : " en el grafo"}.`}
    </div>}
    <p className="explorer-footnote">Las búsquedas se conservan por categoría y se reinician al cambiar de partida o grafo.</p>
  </section>;
}
