import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildGraphBounds, expandGraphBounds, fitScenarioToViewport, viewportFitPadding } from "./map-bounds";
import type { MantaGraph } from "../types/contracts";

const graph = JSON.parse(readFileSync(new URL("../../public/data/grafo_manta.json", import.meta.url), "utf8")) as MantaGraph;

describe("bounds del escenario del mapa", () => {
  it("deriva sus extremos exclusivamente de los nodos del grafo", () => {
    expect(buildGraphBounds([
      { lat: -0.95, lng: -80.72 },
      { lat: -0.96, lng: -80.70 },
      { lat: -0.94, lng: -80.74 },
    ])).toEqual([
      [-0.96, -80.74],
      [-0.94, -80.70],
    ]);
    expect(buildGraphBounds([])).toBeNull();
  });

  it("mantiene nodos, refugios y extremos de segmentos dentro de bounds del grafo real", () => {
    const bounds = buildGraphBounds(graph.nodos);
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    const [[south, west], [north, east]] = bounds;
    const includes = (position: { lat: number; lng: number }) =>
      position.lat >= south && position.lat <= north && position.lng >= west && position.lng <= east;
    const nodeIds = new Set(graph.nodos.map((node) => node.id));

    expect(graph.nodos.every(includes)).toBe(true);
    expect(graph.refugios.every((shelter) => nodeIds.has(shelter.nodoId))).toBe(true);
    expect(graph.aristas.every((edge) => nodeIds.has(edge.origen) && nodeIds.has(edge.destino))).toBe(true);
  });

  it("amplía los bounds solo con un margen relativo a la extensión del grafo", () => {
    const graphBounds = [[-1, -81], [1, -79]] as [[number, number], [number, number]];
    expect(expandGraphBounds(graphBounds)).toEqual([
      [-1.16, -81.16],
      [1.16, -78.84],
    ]);
  });

  it("ajusta el padding al viewport medido en móvil y escritorio", () => {
    expect(viewportFitPadding(390, 422)).toEqual([16, 17]);
    expect(viewportFitPadding(1120, 852)).toEqual([24, 24]);
    expect(viewportFitPadding(0, 852)).toEqual([0, 0]);
  });

  it("encuadra el mismo escenario con el viewport actual solo cuando se solicita", () => {
    const graphBounds = [[-1, -81], [1, -79]] as [[number, number], [number, number]];
    const fit = vi.fn();
    expect(fitScenarioToViewport(graphBounds, { x: 390, y: 422 }, fit)).toBe(true);
    expect(fit).toHaveBeenCalledWith(graphBounds, [16, 17]);
    expect(fitScenarioToViewport(graphBounds, { x: 0, y: 0 }, fit)).toBe(false);
    expect(fit).toHaveBeenCalledTimes(1);
  });
});
