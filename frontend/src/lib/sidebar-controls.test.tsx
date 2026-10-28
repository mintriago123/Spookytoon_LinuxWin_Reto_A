import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundControls } from "../components/RoundControls";
import { ContextPanel } from "../components/ContextPanel";
import { MetricsPanel } from "../components/MetricsPanel";
import { ShelterOccupancy } from "../components/ShelterOccupancy";
import { useWorldStore } from "../state/world-store";
import { makeGraph, makeSnapshot } from "../test/fixtures";
import type { OperatorControls } from "../hooks/useOperatorControls";

vi.mock("../state/world-store", async importOriginal => {
  const original = await importOriginal<typeof import("../state/world-store")>();
  return { ...original, useWorldStore: Object.assign(
    (selector?: (state: ReturnType<typeof original.useWorldStore.getState>) => unknown) =>
      selector ? selector(original.useWorldStore.getState()) : original.useWorldStore.getState(), original.useWorldStore,
  ) };
});

const segments = [{ segmentoId: "street1", edgeId: "edge1", label: "Calle de prueba · Tarqui · tramo 1" }];
const operator = { authState: "in", busy: false, loggingIn: false, login: vi.fn(), logout: vi.fn() } as unknown as OperatorControls;
beforeEach(() => {
  const graph = { ...makeGraph("graph-v1"), refugios: [{ id: "R-TARQUI", nodoId: "n1", capacidad: 60 }], aristas: [
    { id: "edge1", segmentoId: "street1", origen: "n1", destino: "n2", tipo: "calle" as const, distancia_m: 100, factor_velocidad: 1 },
  ] };
  useWorldStore.setState({ graph, graphVersion: "graph-v1", currentSnapshot: makeSnapshot({ status: "paused" }),
    selection: { kind: "segment", id: "street1" }, receipts: [], lastError: null, pendingControl: null });
});

it("manages the selected street without a second picker or duplicated operation card", () => {
  const markup = renderToStaticMarkup(<>
    <RoundControls operator={operator} segments={segments} mode="session" />
    <ContextPanel segments={segments} actions={<RoundControls operator={operator} segments={segments} mode="segment" />} />
  </>);
  expect(markup).not.toContain("<select");
  expect(markup).not.toContain("Segmento a gestionar");
  expect(markup.match(/>Cerrar calle</g)).toHaveLength(1);
  expect(markup).toContain("Motivo de cierre");
  expect(markup).toContain("Controles habilitados");
  expect(markup).toContain("ID técnico");
  expect(markup).not.toContain("<dt>Motivo</dt>");
});

it("offers opening for an observed closure, using the same selected segment", () => {
  useWorldStore.setState({ currentSnapshot: makeSnapshot({ status: "paused", blockedEdges: [
    { segmentoId: "street1", edgeIds: ["edge1"], motivo: "Puente", origen: "control", bloqueadaDesdeTurno: 1, desbloqueadaEnTurno: null },
  ] }) });
  const markup = renderToStaticMarkup(<RoundControls operator={operator} segments={segments} mode="segment" />);
  expect(markup).toContain("Motivo de apertura");
  expect(markup).toContain("Abrir calle");
  expect(markup).not.toContain("Cerrar calle");
});

it("does not present a closure action without authorization or without an active game", () => {
  let markup = renderToStaticMarkup(<RoundControls operator={{ ...operator, authState: "out" }} segments={segments} mode="segment" />);
  expect(markup).toContain("Accede como operador");
  expect(markup).not.toContain("<button");
  useWorldStore.setState({ currentSnapshot: makeSnapshot({ status: "completed" }) });
  markup = renderToStaticMarkup(<RoundControls operator={operator} segments={segments} mode="segment" />);
  expect(markup).toContain("La partida finalizó");
  expect(markup).not.toContain("<button");
});

it("uses one compact access action instead of a read-only password field", () => {
  const markup = renderToStaticMarkup(<RoundControls operator={{ ...operator, authState: "out" }} segments={segments} mode="session" />);
  expect(markup).toContain("Modo consulta");
  expect(markup).toContain(">Acceder<");
  expect(markup).not.toContain("<input");
});

it("offers round selection and a single start action even before operator login", () => {
  useWorldStore.setState({ currentSnapshot: null });
  const markup = renderToStaticMarkup(<RoundControls operator={{ ...operator, authState: "out", roundId: 1 }} segments={segments} mode="session" />);
  expect(markup).toContain('aria-label="Ronda"');
  expect(markup).toContain(">Iniciar ronda<");
  expect(markup).not.toContain(">Acceder<");
});

it("shows a full shelter as a red occupancy bar with an explicit full label", () => {
  useWorldStore.setState({ currentSnapshot: makeSnapshot({ shelters: [{ id: "R-TARQUI", nodoId: "n1", capacidad: 60,
    ocupantes: Array.from({ length: 60 }, (_, i) => `person-${i}`), reservados: [] }] }) });
  const markup = renderToStaticMarkup(<ShelterOccupancy />);
  expect(markup).toContain('class="shelter-full"');
  expect(markup).toContain('role="progressbar"');
  expect(markup).toContain('aria-valuenow="60"');
  expect(markup).toContain("60/60 · Lleno");
  expect(markup).toContain("width:100%");
});

it("shows the scheduled turn beside the action and prevents a second request while waiting", () => {
  useWorldStore.setState({ receipts: [{ eventId: "request1", gameId: "game-test-001", segmentoId: "street1", label: "Calle",
    blocked: true, reason: "Prueba", phase: "scheduled", effectiveTurnId: 2 }] });
  const markup = renderToStaticMarkup(<RoundControls operator={operator} segments={segments} mode="segment" />);
  expect(markup).toContain("Cierre programado para el turno 2");
  expect(markup).toContain("Reanuda la partida para aplicarlo");
  expect(markup).toContain(">Programado<");
  expect(markup).toContain("disabled");
});

it("shows request errors directly in the selected street card", () => {
  useWorldStore.setState({ receipts: [{ eventId: "request1", gameId: "game-test-001", segmentoId: "street1", label: "Calle",
    blocked: false, reason: "Prueba", phase: "error", error: "Conflicto de turno" }] });
  const markup = renderToStaticMarkup(<RoundControls operator={operator} segments={segments} mode="segment" />);
  expect(markup).toContain('role="alert"');
  expect(markup).toContain("Conflicto de turno");
});

it("renders routing details and shelter occupancy from published values", () => {
  useWorldStore.setState({ currentSnapshot: makeSnapshot({ metrics: { ...makeSnapshot().metrics, routeLatencyP95Ms: 42, routeAvailabilityPercent: 100 },
    shelters: [{ id: "R-TARQUI", nodoId: "n1", capacidad: 60, ocupantes: ["one"], reservados: ["two", "three"] }] }) });
  const markup = renderToStaticMarkup(<><MetricsPanel technical /><ShelterOccupancy /></>);
  expect(markup).toContain("42.0 ms");
  expect(markup).toContain("100.0%");
  expect(markup).toContain("1/60");
  expect(markup).toContain("2 reservas");
  expect(markup).not.toContain("<details");
});

it("does not invent occupancy or routing metrics before a game exists", () => {
  useWorldStore.setState({ currentSnapshot: null });
  const markup = renderToStaticMarkup(<><MetricsPanel technical /><ShelterOccupancy /></>);
  expect(markup).toContain("Sin dato");
  expect(markup).not.toContain("0/60");
});
