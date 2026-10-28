import { Fragment, useMemo } from "react";
import {
  AttributionControl,
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import { useWorldStore, hasGraphVersionMismatch } from "../state/world-store";
import { useInterpolatedWorld, lerpLatLng } from "../hooks/useInterpolatedWorld";
import { ZOMBIE_COLOR, cameraIcon, invisibleIcon, shelterIcon, survivorIcon, zombieIcon } from "./entity-icons";
import type { GraphEdge, GraphNode, RoadType, Zone } from "../types/contracts";
import { SelectedSegment, type SegmentSelection } from "./SelectedSegment";
import { MantaMapArea } from "./MantaMapArea";
import { MapSelectionFocus } from "./MapSelectionFocus";

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

/**
 * Caja que encierra todos los nodos del grafo. Se usa para encuadrar el
 * mapa a su extensión real en vez de centrar en graph.nodos[0] (arbitrario,
 * puede quedar en un borde) con un zoom fijo adivinado.
 */
function buildBounds(
  nodos: { lat: number; lng: number }[],
): [LatLngTuple, LatLngTuple] | null {
  if (nodos.length === 0) return null;
  let south = nodos[0].lat;
  let north = nodos[0].lat;
  let west = nodos[0].lng;
  let east = nodos[0].lng;
  for (const n of nodos) {
    if (n.lat < south) south = n.lat;
    if (n.lat > north) north = n.lat;
    if (n.lng < west) west = n.lng;
    if (n.lng > east) east = n.lng;
  }
  return [
    [south, west],
    [north, east],
  ];
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
export function LiveMap({ selection = null }: { selection?: SegmentSelection | null }) {
  const graph = useWorldStore((s) => s.graph);
  const snapshot = useWorldStore((s) => s.currentSnapshot);
  const previousSnapshot = useWorldStore((s) => s.previousSnapshot);
  const mismatch = useWorldStore(hasGraphVersionMismatch);
  const selectedEntity = useWorldStore(s => s.selection);
  const selectEntity = useWorldStore(s => s.selectEntity);
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
  const bounds = useMemo(
    () => (graph ? buildBounds(graph.nodos) : null),
    [graph],
  );

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
    // bounds: encuadra automáticamente toda la extensión real del grafo en
    // vez de adivinar center/zoom. El esquema de SPEC.md §2.1 exige
    // nodos.minItems=250, así que bounds nunca es null aquí; el "!" solo
    // documenta esa garantía de datos, no una suposición nueva.
    <MapContainer
      attributionControl={false}
      bounds={bounds!}
      boundsOptions={{ padding: [24, 24] }}
      maxBoundsViscosity={1}
      maxZoom={19}
      zoomSnap={0.25}
      className="h-full w-full bg-night-900"
    >
      {/* CartoDB Dark Matter dejó de servirse gratis sin cuenta (devuelve
          tiles con marca "API KEY REQUIRED"). En vez de depender de una key
          de un servicio pago, se usa el tile OSM estándar (gratis, sin key,
          ya verificado) y se invierte a oscuro por CSS en .leaflet-tile-pane
          — una técnica estándar, no afecta a las capas de entidades. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
        noWrap
      />
      <AttributionControl position="bottomright" prefix={false} />
      <MantaMapArea bounds={bounds!} />
      <MapSelectionFocus graph={graph} />
      <SelectedSegment graph={graph} selection={selection} />

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
            eventHandlers={{ click: () => selectEntity({ kind: "segment", id: edge.segmentoId }) }}
            pathOptions={{ color: ROAD_COLOR[edge.tipo], weight: 2, opacity: 0.55 }}
          />
        );
      })}

      {/* Referencias aproximadas; los radios son una convención de simulación, no cobertura oficial. */}
      {snapshot?.cameras.map((camera) => {
        const center = camera.nodeId ? nodeIndex.get(camera.nodeId) : undefined;
        const activeObservations = snapshot.cameraObservations.filter((item) => item.cameraId === camera.id);
        const alerting = activeObservations.length > 0;
        return (
          <Fragment key={camera.id}>
            {camera.enabled && center && (
              <Fragment>
                <Polyline positions={[[camera.lat, camera.lng], center]} pathOptions={{ color: "#fbbf24", weight: 1, opacity: 0.55, dashArray: "2 5" }} />
                <Circle center={center} radius={camera.coverageRadiusMeters} pathOptions={{
                  color: alerting ? "#ff5a5a" : "#fbbf24", fillColor: alerting ? "#ff5a5a" : "#fbbf24",
                  fillOpacity: 0.035, weight: 1, dashArray: "5 5",
                }} />
              </Fragment>
            )}
            <Marker position={[camera.lat, camera.lng]} icon={cameraIcon(alerting)}>
              <Popup autoPanPaddingTopLeft={window.innerWidth >= 1135 ? [440, 24] : [12, 24]}>
                <strong>{camera.name}</strong><br />
                Referencia aproximada · {camera.accuracyMeters} m de precisión estimada<br />
                {camera.enabled ? `Cobertura simulada: ${camera.coverageRadiusMeters} m desde el nodo asociado` : "Solo referencia; fuera del grafo actual"}<br />
                {activeObservations.length > 0 ? `Alertas simuladas activas: ${activeObservations.length}` : "Sin alertas activas"}
              </Popup>
            </Marker>
          </Fragment>
        );
      })}

      {/* Cada observación mantiene temporalmente el nodo detectado como riesgo para routing. */}
      {snapshot?.cameraObservations.map((observation) => {
        const position = nodeIndex.get(observation.nodeId);
        if (!position) return null;
        return (
          <CircleMarker key={`${observation.cameraId}-${observation.zombieId}`} center={position} radius={10}
            pathOptions={{ color: "#ff5a5a", fillColor: "#ff5a5a", fillOpacity: 0.16, weight: 2 }}>
            <Popup>
              Detección simulada · {observation.zombieId}<br />
              Turno {observation.detectedTurnId} · riesgo hasta el turno {observation.expiresAfterTurnId - 1}
            </Popup>
          </CircleMarker>
        );
      })}

      {/* Los cierres quedan sobre vías y círculos de riesgo, debajo de los marcadores. */}
      <Pane name="segment-closures" style={{ zIndex: 450 }}>
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
                <Fragment key={`blocked-${edgeId}`}>
                  <Polyline
                    positions={[from, to]}
                    interactive={false}
                    pathOptions={{ color: "#06100a", weight: 10, opacity: 1 }}
                  />
                  <Polyline
                    positions={[from, to]}
                    pathOptions={{
                      color: "#ff5a5a",
                      weight: 6,
                      opacity: 1,
                      dashArray: "8 6",
                    }}
                    eventHandlers={{ click: () => selectEntity({ kind: "segment", id: blocked.segmentoId }) }}
                  >
                    <Tooltip sticky>Segmento cerrado · {blocked.segmentoId}</Tooltip>
                    <Popup>
                      <strong>Segmento cerrado</strong><br />
                      {blocked.segmentoId}<br />
                      {blocked.motivo}
                    </Popup>
                  </Polyline>
                </Fragment>
              );
            }),
          )}
      </Pane>

      {/* Refugios con ocupación/capacidad */}
      {graph.refugios.map((refugio) => {
        const pos = nodeIndex.get(refugio.nodoId);
        if (!pos) return null;
        const live = snapshot?.shelters.find((s) => s.id === refugio.id);
        const ocupacion = live?.ocupantes.length ?? 0;
        return (
          <Marker key={refugio.id} position={pos} icon={shelterIcon()} title={`Refugio ${refugio.id}`} alt={`Refugio ${refugio.id}`}
            eventHandlers={{ click: () => selectEntity({ kind: "shelter", id: refugio.id }) }}>
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
          <Marker key={survivor.id} position={pos} icon={survivorIcon(survivor.estado)} title={`Sobreviviente ${survivor.id}`} alt={`Sobreviviente ${survivor.id}`}
            eventHandlers={{ click: () => selectEntity({ kind: "survivor", id: survivor.id }) }}>
            <Popup>
              {survivor.id} — {survivor.estado}
            </Popup>
          </Marker>
        );
      })}

      {selectedEntity?.kind !== "segment" && selectedEntity && (() => {
        const nodeId = selectedEntity.kind === "survivor"
          ? snapshot?.survivors.find(s => s.id === selectedEntity.id)?.nodeId
          : graph.refugios.find(s => s.id === selectedEntity.id)?.nodoId;
        const position = nodeId ? nodeIndex.get(nodeId) : undefined;
        return position ? <CircleMarker center={position} radius={17} interactive={false}
          pathOptions={{ color: "#22d3ee", weight: 3, fillOpacity: 0 }} /> : null;
      })()}

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
