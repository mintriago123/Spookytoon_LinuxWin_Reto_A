import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { useWorldStore } from "../state/world-store";
import type { MantaGraph } from "../types/contracts";

/** Center once per selection, never on turn updates or entity movements. */
export function MapSelectionFocus({ graph }: { graph: MantaGraph }) {
  const map = useMap();
  const selection = useWorldStore(s => s.selection);
  useEffect(() => {
    if (!selection || selection.kind === "segment") return;
    const snapshot = useWorldStore.getState().currentSnapshot;
    const nodeId = selection.kind === "survivor"
      ? snapshot?.survivors.find(s => s.id === selection.id)?.nodeId
      : graph.refugios.find(s => s.id === selection.id)?.nodoId;
    const node = graph.nodos.find(n => n.id === nodeId);
    if (node) map.setView([node.lat, node.lng], Math.max(map.getZoom(), 16), { animate: false });
  }, [map, selection, graph]);
  return null;
}
