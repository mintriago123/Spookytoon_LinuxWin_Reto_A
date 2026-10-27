import { Fragment, useMemo } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import { useWorldStore, hasGraphVersionMismatch } from "../state/world-store";
import { useInterpolatedWorld, lerpLatLng } from "../hooks/useInterpolatedWorld";
import { ZOMBIE_COLOR, invisibleIcon, shelterIcon, survivorIcon, zombieIcon } from "./entity-icons";
import type { GraphEdge, GraphNode, RoadType, Zone } from "../types/contracts";

// Centro aproximado de Manta; solo se usa si todavía no hay grafo cargado.
const FALLBACK_CENTER: LatLngTuple = [-0.9677, -80.7089];

const ROAD_COLOR: Record<RoadType, string> = {
  avenida: "#9aa8c0",
  calle: "#6b7683",
  callejon: "#4c5668",
  puente: "#fbbf24",
};

function buildNodeIndex(
  nodos: { id: string; lat: number; lng: number }[],
): Map<string, LatLngTuple> {
  const index = new Map<string, LatLngTuple>();
  for (const n of nodos) index.set(n.id, [n.lat, n.lng]);
  return index;
}

/** Centroide aproximado por zona, solo para rotular el mapa (no es dato del juego). */
function buildZoneLabels(nodos: GraphNode[]): Array<{ zona: Zone; center: LatLngTuple }> {
  const sums = new Map<Zone, { lat: number; lng: number; count: number }>();
  for (const node of nodos) {
    const entry = sums.get(node.zona) ?? { lat: 0, lng: 0, count: 0 };
    entry.lat += node.lat;
    entry.lng += node.lng;
    entry.count += 1;
    sums.set(node.zona, entry);
  }
  return Array.from(sums.entries()).map(([zona, { lat, lng, count }]) => ({
    zona,
    center: [lat / count, lng / count] as LatLngTuple,
  }));
}

/** Vecinos directos (ambos sentidos) de un nodo, usados para resaltar H. */
function buildAdjacency(aristas: GraphEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const e of aristas) {
    link(e.origen, e.destino);
    link(e.destino, e.origen);
  }
  return adjacency;
}

function resolveEntityPosition(
  nodeIndex: Map<string, LatLngTuple>,
  currentNodeId: string,
  previousNodeId: string | undefined,
  progress: number,
  immobile: boolean,
): LatLngTuple | null {
  const to = nodeIndex.get(currentNodeId);
  if (!to) return null;
  if (immobile || !previousNodeId || previousNodeId === currentNodeId) {
    return to;
  }
  const from = nodeIndex.get(previousNodeId);
  if (!from) return to;
  return lerpLatLng(from, to, progress);
}

function findPreviousNodeId(
  list: Array<{ id: string; nodeId: string }> | undefined,
  id: string,
): string | undefined {
  return list?.find((e) => e.id === id)?.nodeId;
}

/**
 * Mapa en vivo (SPEC.md §6 / docs/team/kristhian).
 * Capas: vías por tipo, cierres, nodos por zona (vía refugios/entidades),
 * refugios con ocupación, sobrevivientes, zombies, hordas, radio de
 * corredor y dormidos atenuados. No decide nada: solo pinta el snapshot.
 */
export function LiveMap() {
  const graph = useWorldStore((s) => s.graph);
  const snapshot = useWorldStore((s) => s.currentSnapshot);
  const previousSnapshot = useWorldStore((s) => s.previousSnapshot);
  const mismatch = useWorldStore(hasGraphVersionMismatch);
  const { progress } = useInterpolatedWorld();

  const nodeIndex = useMemo(
    () => (graph ? buildNodeIndex(graph.nodos) : new Map<string, LatLngTuple>()),
    [graph],
  );
  const adjacency = useMemo(
    () => (graph ? buildAdjacency(graph.aristas) : new Map<string, Set<string>>()),
    [graph],
  );
  const edgeById = useMemo(() => {
    const map = new Map<string, GraphEdge>();
    graph?.aristas.forEach((e) => map.set(e.id, e));
    return map;
  }, [graph]);
  const zoneLabels = useMemo(() => (graph ? buildZoneLabels(graph.nodos) : []), [graph]);

  const center = graph?.nodos[0]
    ? ([graph.nodos[0].lat, graph.nodos[0].lng] as LatLngTuple)
    : FALLBACK_CENTER;

  if (!graph) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-night-900 text-sm text-slate-400">
        Cargando grafo de Manta…
      </div>
    );
  }

  // SPEC.md §6 / docs/team/kristhian: graphVersion distinto → no dibujar
  // entidades, mostrar error de recuperación.
  if (mismatch) {
    return (
      <div
        role="alert"
        className="flex h-full w-full items-center justify-center bg-rose-950 p-6 text-center text-sm text-rose-200"
      >
        El grafo cargado ({graph.metadata.graphVersion}) no coincide con el
        snapshot del backend ({snapshot?.graphVersion ?? "desconocido"}).
        Recarga la página para obtener el grafo correcto.
      </div>
    );
  }

  return (
    <MapContainer center={center} zoom={14} className="h-full w-full bg-night-900">
      <TileLayer
        attribution={`${graph.metadata.osmAttribution} · © CARTO`}
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {/* Rótulos de zona, solo orientación visual */}
      {zoneLabels.map(({ zona, center: zoneCenter }) => (
        <Marker key={zona} position={zoneCenter} icon={invisibleIcon()} interactive={false}>
          <Tooltip permanent direction="center" className="zone-label-tooltip">
            {zona}
          </Tooltip>
        </Marker>
      ))}

      {/* Vías por tipo */}
      {graph.aristas.map((edge) => {
        const from = nodeIndex.get(edge.origen);
        const to = nodeIndex.get(edge.destino);
        if (!from || !to) return null;
        return (
          <Polyline
            key={edge.id}
            positions={[from, to]}
            pathOptions={{ color: ROAD_COLOR[edge.tipo], weight: 2, opacity: 0.55 }}
          />
        );
      })}

      {/* Cierres: segmento completo en rojo discontinuo */}
      {snapshot?.blockedEdges
        .filter((blocked) => blocked.desbloqueadaEnTurno === null)
        .map((blocked) =>
          blocked.edgeIds.map((edgeId) => {
            const edge = edgeById.get(edgeId);
            if (!edge) return null;
            const from = nodeIndex.get(edge.origen);
            const to = nodeIndex.get(edge.destino);
            if (!from || !to) return null;
            return (
              <Polyline
                key={`blocked-${edgeId}`}
                positions={[from, to]}
                pathOptions={{
                  color: "#ff5a5a",
                  weight: 4,
                  dashArray: "6 6",
                }}
              >
                <Popup>{blocked.motivo}</Popup>
              </Polyline>
            );
          }),
        )}

      {/* Refugios con ocupación/capacidad */}
      {graph.refugios.map((refugio) => {
        const pos = nodeIndex.get(refugio.nodoId);
        if (!pos) return null;
        const live = snapshot?.shelters.find((s) => s.id === refugio.id);
        const ocupacion = live?.ocupantes.length ?? 0;
        return (
          <Marker key={refugio.id} position={pos} icon={shelterIcon()}>
            <Popup>
              Refugio {refugio.id}: {ocupacion}/{refugio.capacidad}
            </Popup>
          </Marker>
        );
      })}

      {/* Sobrevivientes */}
      {snapshot?.survivors.map((survivor) => {
        const prevNodeId = findPreviousNodeId(previousSnapshot?.survivors, survivor.id);
        const pos = resolveEntityPosition(
          nodeIndex,
          survivor.nodeId,
          prevNodeId,
          progress,
          survivor.estado === "evacuado",
        );
        if (!pos) return null;
        return (
          <Marker key={survivor.id} position={pos} icon={survivorIcon(survivor.estado)}>
            <Popup>
              {survivor.id} — {survivor.estado}
            </Popup>
          </Marker>
        );
      })}

      {/* Zombies: caminante/corredor interpolan, horda/dormido son inmóviles */}
      {snapshot?.zombies.map((zombie) => {
        const immobile = zombie.tipo === "horda" || zombie.estado === "dormido";
        const prevNodeId = findPreviousNodeId(previousSnapshot?.zombies, zombie.id);
        const pos = resolveEntityPosition(
          nodeIndex,
          zombie.nodeId,
          prevNodeId,
          progress,
          immobile,
        );
        if (!pos) return null;

        return (
          <Fragment key={zombie.id}>
            <Marker position={pos} icon={zombieIcon(zombie.tipo, zombie.estado)}>
              <Popup>
                {zombie.id} — {zombie.tipo} ({zombie.estado})
              </Popup>
            </Marker>

            {/* Horda: resalta sus vecinos directos (H), zona vedada para rutas */}
            {zombie.tipo === "horda" &&
              Array.from(adjacency.get(zombie.nodeId) ?? []).map((neighborId) => {
                const neighborPos = nodeIndex.get(neighborId);
                if (!neighborPos) return null;
                return (
                  <Circle
                    key={`${zombie.id}-neighbor-${neighborId}`}
                    center={neighborPos}
                    radius={15}
                    pathOptions={{
                      color: ZOMBIE_COLOR.horda,
                      fillColor: ZOMBIE_COLOR.horda,
                      fillOpacity: 0.25,
                      weight: 1,
                    }}
                  />
                );
              })}

            {/* Corredor: radio visual aproximado de persecución a 2-3 saltos.
                Placeholder de 120 m hasta medir distancia real de arista
                promedio sobre el grafo final (SPEC.md §4.3). */}
            {zombie.tipo === "corredor" && (
              <Circle
                center={pos}
                radius={120}
                pathOptions={{
                  color: ZOMBIE_COLOR.corredor,
                  fillOpacity: 0.05,
                  weight: 1,
                  dashArray: "4 4",
                }}
              />
            )}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
