import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { metricValue, observeReceipt, survivorDisplacement, type ControlReceipt } from "./command-center";
import { useWorldStore } from "../state/world-store";
import { makeGraph, makeSnapshot } from "../test/fixtures";
import { CommandBar } from "../components/CommandBar";
import { ContextPanel } from "../components/ContextPanel";
import type { OperatorControls } from "../hooks/useOperatorControls";

// Render presentation components with the live test store; no DOM or server hydration.
vi.mock("../state/world-store", async importOriginal => {
  const original = await importOriginal<typeof import("../state/world-store")>();
  return { ...original, useWorldStore: Object.assign(
    (selector?: (state: ReturnType<typeof original.useWorldStore.getState>) => unknown) =>
      selector ? selector(original.useWorldStore.getState()) : original.useWorldStore.getState(),
    original.useWorldStore,
  ) };
});

const graph = { ...makeGraph("graph-v1"), nodos: [{ id: "n1", lat: -0.95, lng: -80.72, zona: "Tarqui" as const }],
  aristas: [{ id: "e1", segmentoId: "segment1", origen: "n1", destino: "n1", distancia_m: 1, tipo: "calle" as const, factor_velocidad: 1 }],
  refugios: [{ id: "shelter1", nodoId: "n1", capacidad: 60 }] };
const person = { id: "person1", nodeId: "n1", estado: "vivo" as const, targetShelterId: null, eliminadoEnTurno: null, evacuadoEnTurno: null };
const world = () => makeSnapshot({ survivors: [person] });
const receipt: ControlReceipt = { eventId: "event1", gameId: "game-test-001", segmentoId: "segment1", label: "Calle", blocked: true, reason: "Prueba", phase: "scheduled", effectiveTurnId: 4 };

beforeEach(() => {
  useWorldStore.setState({ graph, graphVersion: "graph-v1", currentSnapshot: world(), previousSnapshot: null,
    selection: null, receipts: [], lastError: null, pendingControl: null, socketStatus: "open" });
});

describe("selection across updates", () => {
  it("preserves an identifier across consecutive turns and status changes", () => {
    const store = useWorldStore.getState();
    store.selectEntity({ kind: "survivor", id: "person1" });
    const selected = useWorldStore.getState().selection;
    store.applySnapshot({ ...world(), turnId: 2, worldVersion: 2 });
    expect(useWorldStore.getState().selection).toBe(selected);
    store.applySnapshot({ ...world(), turnId: 2, worldVersion: 2, status: "paused" });
    expect(useWorldStore.getState().selection).toBe(selected);
  });
  it("clears on a new game, missing entity or different graph", () => {
    const store = useWorldStore.getState();
    store.selectEntity({ kind: "survivor", id: "person1" });
    store.applySnapshot(makeSnapshot({ turnId: 2 }));
    expect(useWorldStore.getState().selection).toBeNull();
    store.selectEntity({ kind: "segment", id: "segment1" });
    store.addReceipt(receipt);
    store.applySnapshot(makeSnapshot({ gameId: "new-game" }));
    expect(useWorldStore.getState().selection).toBeNull();
    expect(useWorldStore.getState().receipts).toEqual([]);
    store.selectEntity({ kind: "shelter", id: "shelter1" });
    store.setGraph({ ...graph, metadata: { ...graph.metadata, graphVersion: "graph-v2" } });
    expect(useWorldStore.getState().selection).toBeNull();
  });
  it("keeps a segment selected when it becomes closed", () => {
    useWorldStore.getState().selectEntity({ kind: "segment", id: "segment1" });
    useWorldStore.getState().applySnapshot({ ...world(), turnId: 4, blockedEdges: [{ segmentoId: "segment1", edgeIds: ["e1"], motivo: "Prueba", origen: "control", bloqueadaDesdeTurno: 4, desbloqueadaEnTurno: null }] });
    expect(useWorldStore.getState().selection).toEqual({ kind: "segment", id: "segment1" });
  });
});

describe("receipts are evidence of requests, not authoritative commands", () => {
  const closed = makeSnapshot({ turnId: 4, blockedEdges: [{ segmentoId: "segment1", edgeIds: ["e1"], motivo: "Otro evento", origen: "evento-ciudad", bloqueadaDesdeTurno: 4, desbloqueadaEnTurno: null }] });
  it("202 remains scheduled until the expected state is observed at or after the target turn", () => {
    expect(observeReceipt(receipt, makeSnapshot({ turnId: 3 })).phase).toBe("scheduled");
    expect(observeReceipt(receipt, makeSnapshot({ turnId: 4 })).phase).toBe("scheduled");
    expect(observeReceipt(receipt, closed)).toMatchObject({ phase: "observed", observedAtTurnId: 4 });
    expect(observeReceipt(receipt, { ...closed, gameId: "other" }).phase).toBe("scheduled");
  });
  it("can observe an opening and reconciles a response arriving after its snapshot", () => {
    expect(observeReceipt({ ...receipt, blocked: false }, makeSnapshot({ turnId: 4 })).phase).toBe("observed");
    useWorldStore.getState().addReceipt({ ...receipt, phase: "sending" });
    useWorldStore.getState().applySnapshot(closed);
    useWorldStore.getState().updateReceipt("event1", { phase: "scheduled", effectiveTurnId: 4 });
    expect(useWorldStore.getState().receipts[0].phase).toBe("observed");
  });
  it("late responses cannot inject receipts from a previous game", () => {
    useWorldStore.getState().addReceipt(receipt);
    useWorldStore.getState().applySnapshot(makeSnapshot({ gameId: "new-game" }));
    useWorldStore.getState().updateReceipt(receipt.eventId, { phase: "error", error: "late" });
    useWorldStore.getState().addReceipt(receipt);
    expect(useWorldStore.getState().receipts).toEqual([]);
  });
  it("does not convert pending requests or errors into observed commands", () => {
    expect(observeReceipt({ ...receipt, phase: "sending" }, closed).phase).toBe("sending");
    expect(observeReceipt({ ...receipt, phase: "error", error: "Conflicto" }, closed)).toMatchObject({ phase: "error", error: "Conflicto" });
    for (let i = 0; i < 60; i++) useWorldStore.getState().addReceipt({ ...receipt, eventId: `event-${i}` });
    expect(useWorldStore.getState().receipts).toHaveLength(50);
  });
});

it("describes displacement only for consecutive snapshots of the same game", () => {
  const previous = world();
  const next = { ...world(), turnId: 2, survivors: [{ ...person, nodeId: "n2" }] };
  expect(survivorDisplacement(next, previous, person.id)).toEqual({ from: "n1", to: "n2" });
  expect(survivorDisplacement({ ...next, turnId: 3 }, previous, person.id)).toBeNull();
  expect(survivorDisplacement({ ...next, gameId: "other" }, previous, person.id)).toBeNull();
  expect(survivorDisplacement(next, { ...previous, survivors: [] }, person.id)).toBeNull();
});

it("uses an explicit missing-data label and does not approximate backend metrics", () => {
  expect(metricValue(undefined, "%")).toBe("Sin dato");
  expect(metricValue(NaN)).toBe("Sin dato");
  expect(metricValue(0, "%", 1)).toBe("0.0%");
  useWorldStore.getState().selectEntity({ kind: "shelter", id: "shelter1" });
  const markup = renderToStaticMarkup(<ContextPanel segments={[]} />);
  expect(markup).toContain("Sin dato");
  expect(markup).toContain("Cupos sin reservar");
});

it("separates a connected socket from paused/completed game state and offers just the valid action", () => {
  const operator = { authState: "in", busy: false, pausar: vi.fn(), reanudar: vi.fn() } as unknown as OperatorControls;
  useWorldStore.setState({ currentSnapshot: { ...world(), status: "paused" } });
  let markup = renderToStaticMarkup(<CommandBar operator={operator} panelOpen onTogglePanel={vi.fn()} />);
  expect(markup).toContain("Conectado");
  expect(markup).toContain("Pausada");
  expect(markup).toContain("Reanudar");
  expect(markup).not.toContain(">Pausar<");
  useWorldStore.setState({ currentSnapshot: { ...world(), status: "completed" } });
  markup = renderToStaticMarkup(<CommandBar operator={operator} panelOpen onTogglePanel={vi.fn()} />);
  expect(markup).toContain("Finalizada");
  expect(markup).not.toContain(">Reanudar<");
});

it("an open socket does not imply a started game or authorize operator controls", () => {
  const operator = { authState: "out", busy: false } as unknown as OperatorControls;
  useWorldStore.setState({ currentSnapshot: null });
  const markup = renderToStaticMarkup(<CommandBar operator={operator} panelOpen={false} onTogglePanel={vi.fn()} />);
  expect(markup).toContain("Conectado");
  expect(markup).toContain("Sin iniciar");
  expect(markup).not.toContain(">Reanudar<");
  expect(markup).not.toContain(">Pausar<");
});
