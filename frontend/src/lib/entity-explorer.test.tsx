import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EntityExplorer } from "../components/EntityExplorer";
import { explorerReducer, explorerResults, initialExplorerState, normalizeSearch, uniqueSegments } from "./entity-explorer";
import { makeGraph, makeSnapshot } from "../test/fixtures";
import { useWorldStore } from "../state/world-store";
import type { SegmentOption } from "../hooks/useSegments";

vi.mock("../state/world-store", async importOriginal => {
  const original = await importOriginal<typeof import("../state/world-store")>();
  return { ...original, useWorldStore: Object.assign(
    (selector?: (state: ReturnType<typeof original.useWorldStore.getState>) => unknown) =>
      selector ? selector(original.useWorldStore.getState()) : original.useWorldStore.getState(), original.useWorldStore,
  ) };
});

const graph = { ...makeGraph("graph-v1"), refugios: [
  { id: "R-ÁREA", nodoId: "n1", capacidad: 60 }, { id: "R-ESTEROS", nodoId: "n2", capacidad: 60 },
], aristas: [
  { id: "ea", segmentoId: "segment-a", origen: "n1", destino: "n2", tipo: "calle" as const, distancia_m: 100, factor_velocidad: 1 },
  { id: "er", segmentoId: "segment-a", origen: "n2", destino: "n1", tipo: "calle" as const, distancia_m: 100, factor_velocidad: 1 },
] };
const segments: SegmentOption[] = [
  { edgeId: "ea", segmentoId: "segment-a", label: "Avenida José María · Tarqui / Los Esteros · tramo 1" },
  { edgeId: "er", segmentoId: "segment-a", label: "Avenida José María · Tarqui / Los Esteros · tramo 1" },
  { edgeId: "eb", segmentoId: "segment-b", label: "Calle sin nombre · Barbasquillo · tramo 2" },
];
const person = { nodeId: "n1", eliminadoEnTurno: null, evacuadoEnTurno: null, targetShelterId: null };
const world = makeSnapshot({ survivors: [
  { ...person, id: "R-S-10", estado: "vivo", targetShelterId: "R-ÁREA" },
  { ...person, id: "R-S-2", estado: "evacuado" },
  { ...person, id: "R-S-1", estado: "mordido" },
], shelters: [{ id: "R-ÁREA", nodoId: "n1", capacidad: 60, ocupantes: ["one", "two"], reservados: ["three"] }],
blockedEdges: [{ segmentoId: "segment-a", edgeIds: ["ea", "er"], motivo: "Prueba", origen: "control", bloqueadaDesdeTurno: 1, desbloqueadaEnTurno: null }] });

beforeEach(() => useWorldStore.setState({ graph, graphVersion: "graph-v1", currentSnapshot: world, previousSnapshot: null,
  selection: null, receipts: [], lastError: null, pendingControl: null }));

describe("explorer categories and search", () => {
  it("changes category without writing a selection and preserves independent queries", () => {
    useWorldStore.getState().selectEntity({ kind: "survivor", id: "R-S-10" });
    const selected = useWorldStore.getState().selection;
    let state = explorerReducer(initialExplorerState(), { type: "query", value: "R-S-10" });
    state = explorerReducer(state, { type: "category", category: "segment" });
    expect(state.queries.segment).toBe("");
    state = explorerReducer(state, { type: "query", value: "José" });
    state = explorerReducer(state, { type: "category", category: "survivor" });
    expect(state.queries.survivor).toBe("R-S-10");
    expect(state.queries.segment).toBe("José");
    expect(useWorldStore.getState().selection).toBe(selected);
  });
  it("ignores case and accents while preserving original identifiers", () => {
    expect(normalizeSearch(" JOSÉ María ")).toBe("jose maria");
    let state = { ...initialExplorerState(), category: "segment" as const };
    state = explorerReducer(state, { type: "query", value: "JOSE MARIA" }) as typeof state;
    const result = explorerResults(state, graph, world, segments);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe("segment-a");
    expect(result.items[0].title).toBe("Avenida José María");
    expect(explorerResults({ ...state, queries: { ...state.queries, segment: "LOS ESTEROS" } }, graph, world, segments).items).toHaveLength(1);
    expect(explorerResults({ ...state, queries: { ...state.queries, segment: "SEGMENT-A" } }, graph, world, segments).items).toHaveLength(1);
  });
  it("clears only the active query and produces an explicit empty result", () => {
    const state = explorerReducer(initialExplorerState(), { type: "query", value: "does-not-exist" });
    expect(explorerResults(state, graph, world, segments)).toMatchObject({ total: 3, items: [] });
    expect(explorerResults(explorerReducer(state, { type: "query", value: "" }), graph, world, segments).items).toHaveLength(3);
  });
});

describe("authoritative category results", () => {
  it("includes every survivor status by default in stable identifier order", () => {
    const result = explorerResults(initialExplorerState(), graph, world, segments);
    expect(result.items.map(item => item.id)).toEqual(["R-S-1", "R-S-2", "R-S-10"]);
    expect(result.items.map(item => item.badge)).toEqual(["Mordido", "Evacuado", "Vivo"]);
    expect(result.items[0].secondary).toEqual([]);
    expect(result.items[2].secondary).toEqual(["Objetivo: R-ÁREA"]);
  });
  it.each(["vivo", "evacuado", "mordido"] as const)("filters survivors by %s", value => {
    const state = explorerReducer(initialExplorerState(), { type: "survivor-filter", value });
    expect(explorerResults(state, graph, world, segments).items.map(item => item.id))
      .toEqual(world.survivors.filter(item => item.estado === value).map(item => item.id));
  });
  it("does not invent shelter occupancy before receiving a snapshot", () => {
    const state = { ...initialExplorerState(), category: "shelter" as const };
    const missing = explorerResults(state, graph, null, segments).items[0];
    expect(missing.secondary).toEqual(["Capacidad: 60", "Ocupación y reservas: sin dato"]);
    const received = explorerResults(state, graph, world, segments).items[0];
    expect(received.secondary).toEqual(["2 ocupantes · capacidad 60", "1 reserva"]);
    expect(received.badge).toBe("Refugio");
    expect(received.secondary.join(" ")).not.toContain("libres");
  });
  it("groups opposite directions and filters only active closures", () => {
    expect(uniqueSegments(segments)).toHaveLength(2);
    const state = { ...initialExplorerState(), category: "segment" as const, segmentFilter: "closed" as const };
    expect(explorerResults(state, graph, world, segments)).toMatchObject({ total: 2, items: [{ id: "segment-a", badge: "Cerrado" }] });
    const opened = { ...world, blockedEdges: world.blockedEdges.map(item => ({ ...item, desbloqueadaEnTurno: 2 })) };
    expect(explorerResults(state, graph, opened, segments).items).toEqual([]);
    expect(explorerResults({ ...state, segmentFilter: "all" }, graph, null, segments).items.every(item => item.badge === "Sin partida")).toBe(true);
  });
});

describe("shared selection and game scope", () => {
  it("updates a selected person's state without selecting another when the filter excludes it", () => {
    const store = useWorldStore.getState();
    store.selectEntity({ kind: "survivor", id: "R-S-10" });
    const selected = useWorldStore.getState().selection;
    const next = { ...world, turnId: 2, worldVersion: 2,
      survivors: world.survivors.map(item => item.id === "R-S-10" ? { ...item, estado: "mordido" as const } : item) };
    store.applySnapshot(next);
    expect(useWorldStore.getState().selection).toBe(selected);
    const all = explorerResults(initialExplorerState(), graph, next, segments);
    expect(all.items.find(item => item.id === selected?.id)?.badge).toBe("Mordido");
    const filtered = explorerResults({ ...initialExplorerState(), survivorFilter: "vivo" }, graph, next, segments);
    expect(filtered.items).toEqual([]);
    expect(useWorldStore.getState().selection).toBe(selected);
  });
  it("uses the same segment identifier as map selection and clears it for a new game", () => {
    const result = explorerResults({ ...initialExplorerState(), category: "segment" }, graph, world, segments).items[0];
    useWorldStore.getState().selectEntity({ kind: "segment", id: result.id });
    expect(useWorldStore.getState().selection).toEqual({ kind: "segment", id: "segment-a" });
    useWorldStore.getState().applySnapshot({ ...world, gameId: "another-game" });
    expect(useWorldStore.getState().selection).toBeNull();
    const queried = explorerReducer(initialExplorerState(), { type: "query", value: "old-search" });
    expect(explorerReducer(queried, { type: "reset" })).toEqual(initialExplorerState());
  });
});

describe("explorer presentation states", () => {
  it("renders real radio categories and buttons instead of a mixed dropdown", () => {
    const markup = renderToStaticMarkup(<EntityExplorer segments={segments} />);
    expect(markup).toContain("Categoría de exploración");
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    expect(markup).not.toContain("<optgroup");
    expect(markup).toContain("3 de 3 resultados");
    expect(markup).toContain("Ver en mapa");
  });
  it("shows loading and graph incompatibility before allowing exploration", () => {
    useWorldStore.setState({ graph: null, graphVersion: null });
    expect(renderToStaticMarkup(<EntityExplorer segments={[]} />)).toContain("Cargando el grafo");
    useWorldStore.setState({ graph, graphVersion: "graph-v1", currentSnapshot: { ...world, graphVersion: "other" } });
    const markup = renderToStaticMarkup(<EntityExplorer segments={segments} />);
    expect(markup).toContain("El grafo no coincide");
    expect(markup).not.toContain("type=\"search\"");
  });
  it("distinguishes no game from an empty published population", () => {
    useWorldStore.setState({ currentSnapshot: null });
    expect(renderToStaticMarkup(<EntityExplorer segments={segments} />)).toContain("No hay partida iniciada");
    useWorldStore.setState({ currentSnapshot: { ...world, survivors: [] } });
    expect(renderToStaticMarkup(<EntityExplorer segments={segments} />)).toContain("No hay sobrevivientes publicados en esta partida");
  });
});
