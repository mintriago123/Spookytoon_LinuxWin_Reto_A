import type { MantaGraph } from "../../contracts/types.ts";
import type { CameraObservation } from "../../contracts/routing.ts";
import type { SurveillanceCamera, WorldState } from "./types.ts";

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} inválido`);
  return value as Record<string, unknown>;
}

/** Reduce el fixture de investigación a los campos necesarios para simulación y mapa. */
export function parseCameraFixture(value: unknown, graph: MantaGraph): SurveillanceCamera[] {
  const root = record(value, "camera fixture");
  if (root.schemaVersion !== "1.0.0" || !Array.isArray(root.cameras)) throw new Error("camera fixture incompatible");
  const nodeIds = new Set(graph.nodos.map(node => node.id));
  const seen = new Set<string>();
  return root.cameras.map((raw, index) => {
    const camera = record(raw, `cameras[${index}]`);
    const location = record(camera.location, `cameras[${index}].location`);
    const binding = record(camera.graphBinding, `cameras[${index}].graphBinding`);
    const simulation = record(camera.simulation, `cameras[${index}].simulation`);
    const id = camera.id;
    const nodeId = binding.nodeId;
    if (typeof id !== "string" || !id || seen.has(id) || typeof camera.name !== "string" ||
        typeof camera.reportedLocation !== "string" || typeof camera.networkAffiliation !== "string" ||
        typeof location.lat !== "number" || !Number.isFinite(location.lat) ||
        typeof location.lng !== "number" || !Number.isFinite(location.lng) ||
        typeof location.accuracyMeters !== "number" || !Number.isFinite(location.accuracyMeters) ||
        typeof simulation.coverageRadiusMeters !== "number" || !Number.isFinite(simulation.coverageRadiusMeters) ||
        typeof simulation.alertTtlTurns !== "number" || !Number.isSafeInteger(simulation.alertTtlTurns) || simulation.alertTtlTurns < 1 ||
        typeof simulation.enabled !== "boolean" || (nodeId !== null && (typeof nodeId !== "string" || !nodeIds.has(nodeId)))) {
      throw new Error(`cameras[${index}] tiene campos incompatibles`);
    }
    seen.add(id);
    return {
      id, name: camera.name, lat: location.lat, lng: location.lng, accuracyMeters: location.accuracyMeters,
      nodeId: nodeId as string | null,
      snapDistanceMeters: typeof binding.snapDistanceMeters === "number" ? binding.snapDistanceMeters : null,
      coverageRadiusMeters: simulation.coverageRadiusMeters, alertTtlTurns: simulation.alertTtlTurns,
      enabled: simulation.enabled,
      status: simulation.enabled ? "simulated" : "reference-only-outside-current-graph",
      reportedLocation: camera.reportedLocation, networkAffiliation: camera.networkAffiliation,
    };
  });
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat); const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

/** Actualiza observaciones simuladas después del movimiento zombie del turno. */
export function detectCameraObservations(world: Pick<WorldState, "graph" | "cameras" | "cameraObservations" | "zombies">, turnId: number): CameraObservation[] {
  const nodeById = new Map(world.graph.nodos.map(node => [node.id, node]));
  const active = new Map<string, CameraObservation>();
  for (const observation of world.cameraObservations) {
    if (observation.expiresAfterTurnId > turnId) active.set(`${observation.cameraId}\0${observation.zombieId}`, observation);
  }
  for (const camera of world.cameras) {
    if (!camera.enabled || !camera.nodeId) continue;
    const center = nodeById.get(camera.nodeId);
    if (!center) continue;
    for (const zombie of world.zombies) {
      if (zombie.estado !== "activo") continue;
      const position = nodeById.get(zombie.nodeId);
      if (!position || haversineMeters(center, position) > camera.coverageRadiusMeters) continue;
      active.set(`${camera.id}\0${zombie.id}`, {
        cameraId: camera.id, zombieId: zombie.id, nodeId: zombie.nodeId,
        detectedTurnId: turnId, expiresAfterTurnId: turnId + camera.alertTtlTurns,
      });
    }
  }
  return [...active.values()].sort((a, b) => a.cameraId.localeCompare(b.cameraId) || a.zombieId.localeCompare(b.zombieId));
}
