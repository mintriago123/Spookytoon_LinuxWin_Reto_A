import { Fragment, useMemo } from "react";
import {
  CircleMarker,
  Circle,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import { useWorldStore, hasGraphVersionMismatch } from "../state/world-store";
import { useInterpolatedWorld, lerpLatLng } from "../hooks/useInterpolatedWorld";
import type { GraphEdge, RoadType, Survivor, Zombie } from "../types/contracts";

// Centro aproximado de Manta; solo se usa si todavía no hay grafo cargado.
const FALLBACK_CENTER: LatLngTuple = [-0.9677, -80.7089];

const ROAD_COLOR: Record<RoadType, string> = {
  avenida: "#cbd5e1",
  calle: "#94a3b8",
  callejon: "#64748b",
  puente: "#f59e0b",
};

const SURVIVOR_COLOR: Record<Survivor["estado"], string> = {
  vivo: "#10b981",
  mordido: "#e11d48",
  evacuado: "#0ea5e9",
};

const ZOMBIE_COLOR: Record<Zombie["tipo"], string> = {
  caminante: "#4d7c0f",
  corredor: "#ea580c",
  horda: "#7e22ce",
  dormido: "#c4b5fd",
};

function buildNodeIndex(
  nodos: { id: string; lat: number; lng: number }[],
): Map<string, LatLngTuple> {
  const index = new Map<string, LatLngTuple>();
  for (const n of nodos) index.set(n.id, [n.lat, n.lng]);
  return index;
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

  const center = graph?.nodos[0]
    ? ([graph.nodos[0].lat, graph.nodos[0].lng] as LatLngTuple)
    : FALLBACK_CENTER;

  if (!graph) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
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
        className="flex h-full w-full items-center justify-center bg-rose-50 p-6 text-center text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200"
      >
        El grafo cargado ({graph.metadata.graphVersion}) no coincide con el
        snapshot del backend ({snapshot?.graphVersion ?? "desconocido"}).
        Recarga la página para obtener el grafo correcto.
      </div>
    );
  }

  return (
    <MapContainer center={center} zoom={14} className="h-full w-full">
      <TileLayer
        attribution={graph.metadata.osmAttribution}
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Vías por tipo */}
      {graph.aristas.map((edge) => {
        const from = nodeIndex.get(edge.origen);
        const to = nodeIndex.get(edge.destino);
        if (!from || !to) return null;
        return (
          <Polyline
            key={edge.id}
            positions={[from, to]}
            pathOptions={{ color: ROAD_COLOR[edge.tipo], weight: 2, opacity: 0.6 }}
          />
        );
      })}

      {/* Cierres: segmento completo en rojo discontinuo */}
      {snapshot?.blockedEdges.map((blocked) =>
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
                color: "#dc2626",
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
          <CircleMarker
            key={refugio.id}
            center={pos}
            radius={10}
            pathOptions={{ color: "#1d4ed8", fillColor: "#2563eb", fillOpacity: 0.9 }}
          >
            <Popup>
              Refugio {refugio.id}: {ocupacion}/{refugio.capacidad}
            </Popup>
          </CircleMarker>
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
          <CircleMarker
            key={survivor.id}
            center={pos}
            radius={5}
            pathOptions={{
              color: SURVIVOR_COLOR[survivor.estado],
              fillColor: SURVIVOR_COLOR[survivor.estado],
              fillOpacity: 0.9,
            }}
          >
            <Popup>
              {survivor.id} — {survivor.estado}
            </Popup>
          </CircleMarker>
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

        const dimmed = zombie.estado === "dormido";

        return (
          <Fragment key={zombie.id}>
            <CircleMarker
              center={pos}
              radius={zombie.tipo === "horda" ? 9 : 6}
              pathOptions={{
                color: ZOMBIE_COLOR[zombie.tipo],
                fillColor: ZOMBIE_COLOR[zombie.tipo],
                fillOpacity: dimmed ? 0.35 : 0.9,
              }}
            >
              <Popup>
                {zombie.id} — {zombie.tipo} ({zombie.estado})
              </Popup>
            </CircleMarker>

            {/* Horda: resalta sus vecinos directos (H), zona vedada para rutas */}
            {zombie.tipo === "horda" &&
              Array.from(adjacency.get(zombie.nodeId) ?? []).map((neighborId) => {
                const neighborPos = nodeIndex.get(neighborId);
                if (!neighborPos) return null;
                return (
                  <CircleMarker
                    key={`${zombie.id}-neighbor-${neighborId}`}
                    center={neighborPos}
                    radius={5}
                    pathOptions={{
                      color: ZOMBIE_COLOR.horda,
                      fillColor: ZOMBIE_COLOR.horda,
                      fillOpacity: 0.25,
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
