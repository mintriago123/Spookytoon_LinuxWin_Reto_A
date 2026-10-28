import { Fragment, useEffect, useMemo } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { Control, DomEvent, DomUtil, point, type LatLngTuple } from "leaflet";
import { buildGraphBounds, expandGraphBounds, fitScenarioToViewport, viewportFitPadding, type GraphBounds } from "../lib/map-bounds";
import { useWorldStore, hasGraphVersionMismatch } from "../state/world-store";
import { useInterpolatedWorld, lerpLatLng } from "../hooks/useInterpolatedWorld";
import { ZOMBIE_COLOR, cameraIcon, invisibleIcon, shelterIcon, survivorIcon, zombieIcon } from "./entity-icons";
import type { GraphEdge, GraphNode, RoadType, Zone } from "../types/contracts";

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

/** Mide cada viewport real y mantiene el escenario completo como zoom mínimo. */
function ScenarioViewportConstraints({ graphBounds, navigationBounds }: {
  graphBounds: GraphBounds;
  navigationBounds: GraphBounds;
}) {
  const map = useMap();

  useEffect(() => {
    let frame: number | null = null;
    const applyViewport = () => {
      frame = null;
      map.invalidateSize({ pan: false, debounceMoveend: true });
      const size = map.getSize();
      if (size.x <= 0 || size.y <= 0) return;

      const [horizontalPadding, verticalPadding] = viewportFitPadding(size.x, size.y);
      const minimumZoom = map.getBoundsZoom(
        graphBounds,
        false,
        point(horizontalPadding, verticalPadding),
      );
      if (!Number.isFinite(minimumZoom)) return;

      map.setMaxBounds(navigationBounds);
      map.setMinZoom(minimumZoom);
      // Si el viewport se estrecha/orienta y el zoom actual ya no contiene
      // el grafo, se acerca lo necesario conservando el centro actual.
      if (map.getZoom() < minimumZoom) map.setZoom(minimumZoom, { animate: false });
    };
    const scheduleViewport = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(applyViewport);
    };

    map.setMaxBounds(navigationBounds);
    applyViewport();
    const observer = new ResizeObserver(scheduleViewport);
    observer.observe(map.getContainer());
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [map, graphBounds, navigationBounds]);

  return null;
}

/** Control explícito de recuperación; los snapshots nunca ejecutan fitBounds. */
function ScenarioMapControl({ graphBounds }: { graphBounds: GraphBounds }) {
  const map = useMap();

  useEffect(() => {
    const control = new Control({ position: "bottomright" });
    let button: HTMLButtonElement | null = null;
    const fitScenario = () => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
      fitScenarioToViewport(graphBounds, map.getSize(), (bounds, padding) => {
        map.fitBounds(bounds, {
          padding: point(padding[0], padding[1]),
          animate: true,
        });
      });
    };

    control.onAdd = () => {
      const container = DomUtil.create("div", "scenario-map-control");
      button = DomUtil.create("button", "scenario-map-control__button", container) as HTMLButtonElement;
      button.type = "button";
      button.textContent = "Ver escenario";
      button.title = "Encuadrar todo el escenario de simulación de Manta";
      button.setAttribute("aria-label", button.title);
      DomEvent.disableClickPropagation(container);
      DomEvent.disableScrollPropagation(container);
      DomEvent.on(button, "click", fitScenario);
      return container;
    };
    control.addTo(map);

    return () => {
      if (button) DomEvent.off(button, "click", fitScenario);
      control.remove();
    };
  }, [map, graphBounds]);

  return null;
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
  const bounds = useMemo(
    () => (graph ? buildGraphBounds(graph.nodos) : null),
    [graph],
  );
  const navigationBounds = useMemo(
    () => (bounds ? expandGraphBounds(bounds) : null),
    [bounds],
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

  if (!bounds || !navigationBounds) {
    return (
      <div role="alert" className="flex h-full w-full items-center justify-center bg-night-900 text-sm text-rose-200">
        El grafo no contiene nodos para encuadrar el escenario de simulación de Manta.
      </div>
    );
  }

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [24, 24] }}
      maxBounds={navigationBounds}
      maxBoundsViscosity={1}
      className="h-full w-full bg-night-900"
    >
      <ScenarioViewportConstraints graphBounds={bounds} navigationBounds={navigationBounds} />
      <ScenarioMapControl graphBounds={bounds} />
      {/* CartoDB Dark Matter dejó de servirse gratis sin cuenta (devuelve
          tiles con marca "API KEY REQUIRED"). En vez de depender de una key
          de un servicio pago, se usa el tile OSM estándar (gratis, sin key,
          ya verificado) y se invierte a oscuro por CSS en .leaflet-tile-pane
          — una técnica estándar, no afecta a las capas de entidades. */}
      <TileLayer
        attribution={graph.metadata.osmAttribution}
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        noWrap
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
          <Circle key={`${observation.cameraId}-${observation.zombieId}`} center={position} radius={55}
            pathOptions={{ color: "#ff5a5a", fillColor: "#ff5a5a", fillOpacity: 0.16, weight: 2 }}>
            <Popup>
              Detección simulada · {observation.zombieId}<br />
              Turno {observation.detectedTurnId} · riesgo hasta el turno {observation.expiresAfterTurnId - 1}
            </Popup>
          </Circle>
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
