import type { LatLngTuple } from "leaflet";

export type GraphBounds = [LatLngTuple, LatLngTuple];

export function buildGraphBounds(
  nodes: { lat: number; lng: number }[],
): GraphBounds | null {
  if (nodes.length === 0) return null;
  let south = nodes[0].lat;
  let north = nodes[0].lat;
  let west = nodes[0].lng;
  let east = nodes[0].lng;
  for (const node of nodes) {
    if (node.lat < south) south = node.lat;
    if (node.lat > north) north = node.lat;
    if (node.lng < west) west = node.lng;
    if (node.lng > east) east = node.lng;
  }
  return [[south, west], [north, east]];
}

/** Agrega margen visual proporcional al escenario, sin definir otra geografía. */
export function expandGraphBounds(bounds: GraphBounds, fraction = 0.08): GraphBounds {
  const [[south, west], [north, east]] = bounds;
  const latMargin = (north - south) * fraction;
  const lngMargin = (east - west) * fraction;
  return [
    [south - latMargin, west - lngMargin],
    [north + latMargin, east + lngMargin],
  ];
}

/** Padding en píxeles calculado a partir del tamaño real del mapa. */
export function viewportFitPadding(width: number, height: number): [number, number] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [0, 0];
  return [
    Math.min(24, Math.round(width * 0.04)),
    Math.min(24, Math.round(height * 0.04)),
  ];
}

export function fitScenarioToViewport(
  bounds: GraphBounds,
  size: { x: number; y: number },
  fit: (bounds: GraphBounds, padding: [number, number]) => void,
): boolean {
  if (size.x <= 0 || size.y <= 0) return false;
  fit(bounds, viewportFitPadding(size.x, size.y));
  return true;
}
