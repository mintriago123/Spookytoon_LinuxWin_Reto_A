import { useEffect, useMemo } from "react";
import { CircleMarker, Pane, Polyline, Tooltip, useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import type { MantaGraph } from "../types/contracts";

export interface SegmentSelection {
  segmentoId: string;
  label: string;
}

/** Visual preview only: selecting a street never sends a closure command. */
export function SelectedSegment({ graph, selection }: {
  graph: MantaGraph;
  selection: SegmentSelection | null;
}) {
  const map = useMap();
  const segmentoId = selection?.segmentoId;
  const geometry = useMemo(() => {
    if (!segmentoId) return null;
    const nodes = new Map(graph.nodos.map(node => [node.id, node]));
    const seen = new Set<string>();
    const lines: [LatLngTuple, LatLngTuple][] = [];
    for (const edge of graph.aristas) {
      if (edge.segmentoId !== segmentoId) continue;
      // Opposite directions share the same visible line.
      const key = [edge.origen, edge.destino].sort().join(":");
      if (seen.has(key)) continue;
      const from = nodes.get(edge.origen);
      const to = nodes.get(edge.destino);
      if (!from || !to) continue;
      seen.add(key);
      lines.push([[from.lat, from.lng], [to.lat, to.lng]]);
    }
    return lines.length ? lines : null;
  }, [graph, segmentoId]);

  useEffect(() => {
    if (!geometry) return;
    map.fitBounds(geometry.flat(), { padding: [64, 64], maxZoom: 16, animate: false });
  }, [map, geometry]);

  if (!geometry || !selection) return null;
  const [from, to] = geometry[0];
  const midpoint: LatLngTuple = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return (
    <Pane name="selected-segment" style={{ zIndex: 625 }}>
      <Polyline positions={geometry} interactive={false}
        pathOptions={{ color: "#06100a", weight: 12, opacity: 1 }} />
      <Polyline positions={geometry} interactive={false}
        pathOptions={{ color: "#22d3ee", weight: 6, opacity: 1, dashArray: "10 5" }} />
      <CircleMarker center={midpoint} radius={8}
        pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#22d3ee", fillOpacity: 1 }}>
        <Tooltip permanent direction="top" offset={[0, -10]} className="segment-selection-tooltip">
          <strong>Segmento seleccionado</strong><br />
          {selection.label}
        </Tooltip>
      </CircleMarker>
    </Pane>
  );
}
