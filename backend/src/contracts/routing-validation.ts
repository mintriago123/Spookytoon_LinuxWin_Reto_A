import type { MantaGraph } from "./types.ts";
import {
  RoutingError, type RouteBlockedEdge, type RouteShelter, type RouteSurvivor,
  type CameraObservation, type RouteZombie, type RouteZombieTraversal, type WorldSyncRequest,
} from "./routing.ts";

type JsonRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new RoutingError(400, "VALIDATION_ERROR", message);
}

function record(value: unknown, name: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} debe ser un objeto JSON`);
  return value as JsonRecord;
}

function keys(value: JsonRecord, required: string[], optional: string[] = [], name = "objeto") {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) invalid(`${name} requiere ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`${name} contiene campo extra ${key}`);
}

function string(value: unknown, name: string, max = 256): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) invalid(`${name} debe ser texto no vacío`);
  return value;
}

function integer(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(`${name} debe ser entero >= ${minimum}`);
  return value as number;
}

function nullableInteger(value: unknown, name: string, minimum = 0): number | null {
  return value === null ? null : integer(value, name, minimum);
}

function stringArray(value: unknown, name: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) invalid(`${name} debe ser una lista válida`);
  const values = value.map((item, index) => string(item, `${name}[${index}]`));
  if (new Set(values).size !== values.length) invalid(`${name} no puede repetir valores`);
  return values;
}

function validateSurvivor(value: unknown, index: number, nodeIds: Set<string>, shelterIds: Set<string>): RouteSurvivor {
  const name = `survivors[${index}]`; const item = record(value, name);
  keys(item, ["id", "nodeId", "estado", "targetShelterId", "eliminadoEnTurno", "evacuadoEnTurno"], [], name);
  const id = string(item.id, `${name}.id`); const nodeId = string(item.nodeId, `${name}.nodeId`);
  if (!nodeIds.has(nodeId)) invalid(`${name}.nodeId no existe en el grafo`);
  if (!["vivo", "mordido", "evacuado"].includes(item.estado as string)) invalid(`${name}.estado inválido`);
  const targetShelterId = item.targetShelterId === null ? null : string(item.targetShelterId, `${name}.targetShelterId`);
  if (targetShelterId !== null && !shelterIds.has(targetShelterId)) invalid(`${name}.targetShelterId no existe`);
  return {
    id, nodeId, estado: item.estado as RouteSurvivor["estado"], targetShelterId,
    eliminadoEnTurno: nullableInteger(item.eliminadoEnTurno, `${name}.eliminadoEnTurno`, 1),
    evacuadoEnTurno: nullableInteger(item.evacuadoEnTurno, `${name}.evacuadoEnTurno`, 1),
  };
}

function validateZombie(value: unknown, index: number, nodeIds: Set<string>): RouteZombie {
  const name = `zombies[${index}]`; const item = record(value, name);
  keys(item, ["id", "tipo", "estado", "nodeId", "despertadoEnTurno", "siguienteMovimientoTurno"], [], name);
  const id = string(item.id, `${name}.id`); const nodeId = string(item.nodeId, `${name}.nodeId`);
  if (!nodeIds.has(nodeId)) invalid(`${name}.nodeId no existe en el grafo`);
  if (!["caminante", "corredor", "horda", "dormido"].includes(item.tipo as string)) invalid(`${name}.tipo inválido`);
  if (!["activo", "dormido"].includes(item.estado as string)) invalid(`${name}.estado inválido`);
  return {
    id, tipo: item.tipo as RouteZombie["tipo"], estado: item.estado as RouteZombie["estado"], nodeId,
    despertadoEnTurno: nullableInteger(item.despertadoEnTurno, `${name}.despertadoEnTurno`, 1),
    siguienteMovimientoTurno: nullableInteger(item.siguienteMovimientoTurno, `${name}.siguienteMovimientoTurno`, 1),
  };
}

function validateShelter(value: unknown, index: number, graphShelter: MantaGraph["refugios"][number], survivorById: Map<string, RouteSurvivor>): RouteShelter {
  const name = `shelters[${index}]`; const item = record(value, name);
  keys(item, ["id", "nodoId", "capacidad", "ocupantes", "reservados"], [], name);
  if (item.id !== graphShelter.id || item.nodoId !== graphShelter.nodoId || item.capacidad !== graphShelter.capacidad) {
    invalid(`${name} no coincide con el refugio inmutable del grafo`);
  }
  const ocupantes = stringArray(item.ocupantes, `${name}.ocupantes`);
  const reservados = stringArray(item.reservados, `${name}.reservados`);
  if (ocupantes.some(id => reservados.includes(id))) invalid(`${name} repite IDs en ocupantes y reservados`);
  if (ocupantes.length + reservados.length > graphShelter.capacidad) invalid(`${name} excede capacidad`);
  for (const id of ocupantes) {
    const survivor = survivorById.get(id);
    if (!survivor || survivor.estado !== "evacuado") invalid(`${name}.ocupantes solo puede contener sobrevivientes evacuados`);
  }
  for (const id of reservados) {
    const survivor = survivorById.get(id);
    if (!survivor || survivor.estado !== "vivo") invalid(`${name}.reservados solo puede contener sobrevivientes vivos`);
  }
  return { id: graphShelter.id, nodoId: graphShelter.nodoId, capacidad: graphShelter.capacidad, ocupantes, reservados };
}

function validateBlockedEdge(value: unknown, index: number, turnId: number, edgeToSegment: Map<string, string>,
  segmentToEdges: Map<string, Set<string>>): RouteBlockedEdge {
  const name = `blockedEdges[${index}]`; const item = record(value, name);
  keys(item, ["segmentoId", "edgeIds", "motivo", "origen", "bloqueadaDesdeTurno", "desbloqueadaEnTurno"], [], name);
  const segmentoId = string(item.segmentoId, `${name}.segmentoId`);
  const edgeIds = stringArray(item.edgeIds, `${name}.edgeIds`, false);
  for (const edgeId of edgeIds) if (edgeToSegment.get(edgeId) !== segmentoId) invalid(`${name} contiene arista que no pertenece al segmento`);
  const segmentEdges = segmentToEdges.get(segmentoId);
  if (!segmentEdges || edgeIds.length !== segmentEdges.size || edgeIds.some(edgeId => !segmentEdges.has(edgeId))) {
    invalid(`${name}.edgeIds debe incluir todas las direcciones del segmento`);
  }
  if (item.origen !== "evento-ciudad" && item.origen !== "control") invalid(`${name}.origen inválido`);
  const bloqueadaDesdeTurno = integer(item.bloqueadaDesdeTurno, `${name}.bloqueadaDesdeTurno`, 1);
  const desbloqueadaEnTurno = nullableInteger(item.desbloqueadaEnTurno, `${name}.desbloqueadaEnTurno`, 1);
  if (desbloqueadaEnTurno !== null && desbloqueadaEnTurno <= bloqueadaDesdeTurno) invalid(`${name} tiene intervalo de bloqueo inválido`);
  if (bloqueadaDesdeTurno > turnId && desbloqueadaEnTurno === null) invalid(`${name} empieza a bloquear después del turno sincronizado`);
  return { segmentoId, edgeIds, motivo: string(item.motivo, `${name}.motivo`), origen: item.origen,
    bloqueadaDesdeTurno, desbloqueadaEnTurno };
}

function validateTraversal(value: unknown, index: number, nodeIds: Set<string>,
  edges: Map<string, MantaGraph["aristas"][number]>): RouteZombieTraversal {
  const name = `zombieTraversals[${index}]`; const item = record(value, name);
  keys(item, ["zombieId", "stepIndex", "edgeId", "fromNodeId", "toNodeId"], [], name);
  const stepIndex = integer(item.stepIndex, `${name}.stepIndex`, 1);
  if (stepIndex > 2) invalid(`${name}.stepIndex debe ser 1 o 2`);
  const edgeId = string(item.edgeId, `${name}.edgeId`);
  const fromNodeId = string(item.fromNodeId, `${name}.fromNodeId`); const toNodeId = string(item.toNodeId, `${name}.toNodeId`);
  if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId) || fromNodeId === toNodeId) invalid(`${name} requiere nodos distintos del grafo`);
  const edge = edges.get(edgeId);
  if (!edge || edge.origen !== fromNodeId || edge.destino !== toNodeId) invalid(`${name}.edgeId no coincide con el recorrido`);
  return { zombieId: string(item.zombieId, `${name}.zombieId`), stepIndex: stepIndex as 1 | 2,
    edgeId, fromNodeId, toNodeId };
}

export function validateWorldSyncRequest(value: unknown, graph: MantaGraph): WorldSyncRequest {
  const item = record(value, "request");
  keys(item, ["gameId", "turnId", "baseWorldVersion", "survivors", "zombies", "shelters", "blockedEdges", "zombieTraversals", "dormantUncertaintyNodeIds"], ["cameraObservations"], "request");
  const gameId = string(item.gameId, "gameId", 128);
  const turnId = integer(item.turnId, "turnId", 1);
  const baseWorldVersion = integer(item.baseWorldVersion, "baseWorldVersion", 0);
  if (!Array.isArray(item.survivors) || !Array.isArray(item.zombies) || !Array.isArray(item.shelters) ||
      !Array.isArray(item.blockedEdges) || !Array.isArray(item.zombieTraversals)) invalid("Las entidades y bloqueos deben ser listas");
  const nodeIds = new Set(graph.nodos.map(node => node.id));
  const shelterIds = new Set(graph.refugios.map(shelter => shelter.id));
  const survivors = item.survivors.map((survivor, index) => validateSurvivor(survivor, index, nodeIds, shelterIds));
  const survivorById = new Map(survivors.map(survivor => [survivor.id, survivor]));
  if (survivorById.size !== survivors.length) invalid("survivors contiene IDs duplicados");
  const zombies = item.zombies.map((zombie, index) => validateZombie(zombie, index, nodeIds));
  if (new Set(zombies.map(zombie => zombie.id)).size !== zombies.length) invalid("zombies contiene IDs duplicados");
  const graphShelters = new Map(graph.refugios.map(shelter => [shelter.id, shelter]));
  const shelters = item.shelters.map((shelter, index) => {
    const raw = record(shelter, `shelters[${index}]`);
    const id = string(raw.id, `shelters[${index}].id`);
    const graphShelter = graphShelters.get(id);
    if (!graphShelter) invalid(`shelters[${index}] no pertenece al grafo`);
    return validateShelter(raw, index, graphShelter, survivorById);
  });
  if (shelters.length !== graph.refugios.length || new Set(shelters.map(shelter => shelter.id)).size !== graph.refugios.length) {
    invalid("shelters debe incluir cada refugio exactamente una vez");
  }
  const membership = new Map<string, string>();
  for (const shelter of shelters) for (const id of [...shelter.ocupantes, ...shelter.reservados]) {
    if (membership.has(id)) invalid(`Sobreviviente ${id} ocupa o reserva más de un refugio`);
    membership.set(id, shelter.id);
  }
  const edgeToSegment = new Map(graph.aristas.map(edge => [edge.id, edge.segmentoId]));
  const segmentToEdges = new Map<string, Set<string>>();
  for (const edge of graph.aristas) {
    const segmentEdges = segmentToEdges.get(edge.segmentoId) ?? new Set<string>();
    segmentEdges.add(edge.id); segmentToEdges.set(edge.segmentoId, segmentEdges);
  }
  const blockedEdges = item.blockedEdges.map((edge, index) => validateBlockedEdge(edge, index, turnId, edgeToSegment, segmentToEdges));
  if (new Set(blockedEdges.map(edge => edge.segmentoId)).size !== blockedEdges.length) invalid("blockedEdges repite segmentoId");
  const zombiesById = new Map(zombies.map(zombie => [zombie.id, zombie]));
  const graphEdges = new Map(graph.aristas.map(edge => [edge.id, edge]));
  const zombieTraversals = item.zombieTraversals.map((traversal, index) =>
    validateTraversal(traversal, index, nodeIds, graphEdges));
  const traversalsByZombie = new Map<string, RouteZombieTraversal[]>();
  let previousZombieId = "";
  for (const traversal of zombieTraversals) {
    if (traversal.zombieId < previousZombieId) invalid("zombieTraversals debe ordenarse por zombieId y stepIndex");
    previousZombieId = traversal.zombieId;
    const list = traversalsByZombie.get(traversal.zombieId) ?? [];
    list.push(traversal); traversalsByZombie.set(traversal.zombieId, list);
  }
  for (const [zombieId, traversals] of traversalsByZombie) {
    const zombie = zombiesById.get(zombieId);
    if (!zombie || zombie.estado !== "activo") invalid(`El zombie ${zombieId} no está visible y activo`);
    const maxSteps = zombie.tipo === "corredor" ? 2 : zombie.tipo === "horda" ? 0 : 1;
    if (traversals.length > maxSteps) invalid(`El zombie ${zombieId} excede su máximo de recorridos`);
    for (let index = 0; index < traversals.length; index++) {
      const traversal = traversals[index];
      if (traversal.stepIndex !== index + 1) invalid(`Los pasos de ${zombieId} deben ser consecutivos desde 1`);
      if (index > 0 && traversals[index - 1].toNodeId !== traversal.fromNodeId) {
        invalid(`Los recorridos de ${zombieId} no forman una trayectoria continua`);
      }
    }
    if (traversals.at(-1)!.toNodeId !== zombie.nodeId) {
      invalid(`El último recorrido de ${zombieId} no termina en su nodo visible`);
    }
  }
  const dormantUncertaintyNodeIds = stringArray(item.dormantUncertaintyNodeIds, "dormantUncertaintyNodeIds");
  if (dormantUncertaintyNodeIds.some(nodeId => !nodeIds.has(nodeId))) invalid("dormantUncertaintyNodeIds contiene nodos desconocidos");
  let cameraObservations: CameraObservation[] | undefined;
  if (item.cameraObservations !== undefined) {
    if (!Array.isArray(item.cameraObservations)) invalid("cameraObservations debe ser una lista");
    cameraObservations = item.cameraObservations.map((value, index) => {
      const name = `cameraObservations[${index}]`; const observation = record(value, name);
      keys(observation, ["cameraId", "zombieId", "nodeId", "detectedTurnId", "expiresAfterTurnId"], [], name);
      const cameraId = string(observation.cameraId, `${name}.cameraId`);
      const zombieId = string(observation.zombieId, `${name}.zombieId`);
      const nodeId = string(observation.nodeId, `${name}.nodeId`);
      const detectedTurnId = integer(observation.detectedTurnId, `${name}.detectedTurnId`, 1);
      const expiresAfterTurnId = integer(observation.expiresAfterTurnId, `${name}.expiresAfterTurnId`, 2);
      if (!nodeIds.has(nodeId) || detectedTurnId > turnId || expiresAfterTurnId <= turnId || expiresAfterTurnId <= detectedTurnId) {
        invalid(`${name} debe ser una observación vigente de un nodo del grafo`);
      }
      if (!zombiesById.has(zombieId)) invalid(`${name}.zombieId no está en la sincronización`);
      return { cameraId, zombieId, nodeId, detectedTurnId, expiresAfterTurnId };
    });
    const observationKeys = cameraObservations.map(value => `${value.cameraId}\0${value.zombieId}`);
    if (new Set(observationKeys).size !== observationKeys.length) invalid("cameraObservations repite cámara y zombie");
  }
  return { gameId, turnId, baseWorldVersion, survivors, zombies, shelters, blockedEdges, zombieTraversals, dormantUncertaintyNodeIds,
    ...(cameraObservations === undefined ? {} : { cameraObservations }) };
}

export function validatePasoRequest(value: unknown): { gameId: string; turnId: number; worldVersion: number; survivorId: string; currentNodeId: string; targetShelterId?: string | null } {
  const item = record(value, "request");
  keys(item, ["gameId", "turnId", "worldVersion", "survivorId", "currentNodeId"], ["targetShelterId"], "request");
  const targetShelterId = item.targetShelterId === undefined || item.targetShelterId === null
    ? item.targetShelterId as null | undefined : string(item.targetShelterId, "targetShelterId");
  return {
    gameId: string(item.gameId, "gameId", 128), turnId: integer(item.turnId, "turnId", 1),
    worldVersion: integer(item.worldVersion, "worldVersion", 0), survivorId: string(item.survivorId, "survivorId"),
    currentNodeId: string(item.currentNodeId, "currentNodeId"), ...(targetShelterId === undefined ? {} : { targetShelterId }),
  };
}
