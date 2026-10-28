import { useEffect, useMemo, useState } from "react";
import { useWorldStore } from "../state/world-store";

export function useSegments() {
  const graph = useWorldStore(s => s.graph);
  const [streetCatalog, setStreetCatalog] = useState<{
    graphVersion: string;
    namesBySegmentId: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/nombres-calles.json")
      .then(async (res) => {
        if (!res.ok) throw new Error("Catálogo de calles no disponible");
        return res.json() as Promise<{
          graphVersion: string;
          namesBySegmentId: Record<string, string>;
        }>;
      })
      .then((catalog) => {
        if (!cancelled && typeof catalog.graphVersion === "string" &&
            catalog.namesBySegmentId && typeof catalog.namesBySegmentId === "object" &&
            !Array.isArray(catalog.namesBySegmentId) &&
            Object.values(catalog.namesBySegmentId).every((name) => typeof name === "string" && name.trim())) {
          setStreetCatalog(catalog);
        }
      })
      .catch(() => { /* Sin catálogo se muestran el tipo de vía, zona y tramo. */ });
    return () => { cancelled = true; };
  }, []);

  const segmentLabels = useMemo(() => {
    const labels = new Map<string, string>();
    if (!graph) return labels;
    const names = streetCatalog?.graphVersion === graph.metadata.graphVersion
      ? streetCatalog.namesBySegmentId : {};
    const zones = new Map(graph.nodos.map((node) => [node.id, node.zona]));
    const roadTypes = { avenida: "Avenida", calle: "Calle", callejon: "Callejón", puente: "Puente" };
    const counts = new Map<string, number>();
    // Numeración estable: cerrar un tramo no renumera los demás.
    const edges = [...graph.aristas].sort((a, b) => a.segmentoId.localeCompare(b.segmentoId, "es", { numeric: true }));
    for (const edge of edges) {
      if (labels.has(edge.segmentoId)) continue;
      const name = names[edge.segmentoId] ?? `${roadTypes[edge.tipo]} sin nombre`;
      const zone = [...new Set([zones.get(edge.origen), zones.get(edge.destino)])].filter(Boolean).join(" / ");
      const group = `${name} · ${zone}`;
      const number = (counts.get(group) ?? 0) + 1;
      counts.set(group, number);
      labels.set(edge.segmentoId, `${group} · tramo ${number}`);
    }
    return labels;
  }, [graph, streetCatalog]);

  return useMemo(() => {
    const segments = new Map<string, { segmentoId: string; edgeId: string; label: string }>();
    for (const edge of graph?.aristas ?? []) {
      if (!segments.has(edge.segmentoId)) segments.set(edge.segmentoId, {
        segmentoId: edge.segmentoId, edgeId: edge.id, label: segmentLabels.get(edge.segmentoId) ?? edge.segmentoId,
      });
    }
    return [...segments.values()].sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }));
  }, [graph, segmentLabels]);
}
export type SegmentOption = { segmentoId: string; edgeId: string; label: string };
