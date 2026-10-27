# SPEC.md — SpookyThon 2026 · Track A: Escape de Manta Zombie

- Estado: especificación normativa v1.0.
- Región AWS: configurable. Valor inicial sugerido: us-east-1; no es requisito. Confirmar la región de despliegue antes de provisionar recursos y calcular costos.
- Fuente de verdad: este archivo. OpenAPI, tipos, validadores y diagramas de implementación son proyecciones de esta especificación.
- Unidades: WGS84, metros, milisegundos y turnos numerados desde 1 (estado inicial en turno 0).
- DEBE indica requisito obligatorio.

## 1. Arquitectura y monorepo

### 1.1 Arquitectura

Un Backend Node.js + TypeScript con Fastify y ws hospeda el game loop, el motor de rutas, HTTP y WebSocket. El grafo es inmutable y reside en RAM. El Simulador ejecuta cada fase en serie e invoca POST /paso por cada sobreviviente vivo, en paralelo. Una piscina acotada de worker_threads ejecuta las rutas sin bloquear el event loop. Todos los workers reciben la misma versión inmutable del mundo mediante POST /motor/sincronizar antes de aceptar decisiones del turno.

El Backend es un monolito modular, no dos backends: Michael lidera graph y routing; Maykel lidera simulator y realtime. Ambos módulos corren en el mismo proceso/tarea, pero mantienen límites de ownership y contratos explícitos. El composition root app.ts los conecta; simulator consume routing por los endpoints internos definidos y no importa su implementación privada. contracts/ es el DTO compartido y simulator es el único escritor de WorldState.

Se ejecuta una sola tarea Backend activa por partida. No escalar horizontalmente el escritor: memoria, reloj y estado tienen un solo dueño. Una futura escala requiere líder con fencing y partición explícita por partida. El proceso no usa Lambda ni cold starts en la ruta crítica. En el arranque carga el grafo, verifica invariantes y workers; solo entonces reporta readiness.

```text
Frontend (S3 + CloudFront)
  ├── HTTPS GET /estado
  └── WSS /ws
          │
          ▼
ALB (HTTPS/WSS) → ECS Fargate, AWS_REGION seleccionada (un escritor por partida)
                    ├── Fastify: API de ruta, estado y controles
                    ├── Game Loop: turnos seriales de 2.000 ms
                    ├── Route Workers: grafo y snapshot inmutables en RAM
                    ├── ws: evento TURN_UPDATE
                    └── cola asíncrona → DynamoDB On-Demand
```

AWS: imagen en ECR; Backend en ECS Fargate detrás de ALB; TLS en ALB; API key en Secrets Manager; snapshots en DynamoDB On-Demand; logs/métricas/alertas en CloudWatch; frontend estático en S3 y CloudFront. El artefacto del grafo se incorpora versionado a la imagen y al build web, no se descarga durante el turno. GET /estado y WSS son de solo lectura; CORS se limita al dominio configurado. La API key nunca se incluye en el bundle del navegador.

Después de cada turno comprometido, se encola un snapshot dinámico para DynamoDB sin esperar su escritura. Claves: PK=GAME#<gameId>, SK=TURN#<turnId con 6 dígitos>. Validar el tamaño serializado: hasta 350 KiB se escribe como un ítem; encima, dividir en fragmentos con manifiesto. Cola limitada, reintentos con backoff exponencial y jitter. Cola llena dispara alarma y pausa tras cerrar el turno activo. Tras reinicio, restaurar el último snapshot completo y dejar la partida pausada.

### 1.2 Árbol exacto

```text
.
├── README.md                       # entrada del proyecto y diagrama
├── SPEC.md                         # único contrato canónico
├── package.json                    # npm workspaces: backend y frontend
├── package-lock.json
├── backend/
│   ├── data/grafo_manta.json
│   ├── openapi/openapi.yaml         # generado/revisado desde SPEC.md
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config/
│   │   │   ├── env.ts
│   │   │   └── rounds.ts
│   │   ├── contracts/
│   │   │   ├── schemas.ts
│   │   │   └── types.ts
│   │   └── modules/
│   │       ├── README.md
│   │       ├── graph/
│   │       │   ├── load-graph.ts
│   │       │   ├── validate-graph.ts
│   │       │   └── adjacency.ts
│   │       ├── routing/
│   │       │   ├── route-service.ts
│   │       │   ├── route-worker.ts
│   │       │   ├── worker-pool.ts
│   │       │   └── danger-map.ts
│   │       ├── simulator/
│   │       │   ├── game-loop.ts
│   │       │   ├── zombie-machine.ts
│   │       │   ├── survivor-machine.ts
│   │       │   ├── city-events.ts
│   │       │   └── world-store.ts
│   │       ├── telemetry/
│   │       │   ├── rolling-latency.ts
│   │       │   └── metrics.ts
│   │       ├── persistence/
│   │       │   ├── snapshot-queue.ts
│   │       │   └── dynamodb-store.ts
│   │       └── realtime/
│   │           └── broadcaster.ts
│   ├── infra/
│   │   ├── ecs-task.json
│   │   └── cloudwatch-alarms.json
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── public/data/grafo_manta.json
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── LiveMap.tsx
│   │   │   ├── RoundControls.tsx
│   │   │   ├── MetricsPanel.tsx
│   │   │   ├── ConnectionStatus.tsx
│   │   │   └── EntityLegend.tsx
│   │   ├── hooks/
│   │   │   ├── useTurnSocket.ts
│   │   │   └── useInterpolatedWorld.ts
│   │   ├── state/world-store.ts
│   │   ├── types/contracts.ts
│   │   ├── styles/
│   │   └── main.tsx
│   ├── package.json
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── vite.config.ts
├── scripts/
│   ├── extract-manta-osm.ts
│   ├── normalize-graph.ts
│   ├── validate-graph.ts
│   ├── publish-graph.ts
│   └── README.md
└── docs/
    ├── adr/
    │   ├── 0001-single-writer.md
    │   └── 0002-graph-artifact.md
    ├── costos.md
    ├── launch-checklist.md
    ├── evidence/
    │   └── README.md
    ├── team/
    │   ├── michael/README.md
    │   ├── maykel/README.md
    │   └── kristhian/README.md
    └── operations.md
```

La extracción debe conservar atribución OpenStreetMap/ODbL y registrar fuente, fecha y versión. SPEC.md es la fuente técnica canónica; los README personales son guías de trabajo y no duplican los contratos. Los dos artefactos del grafo deben tener el mismo graphVersion y hash SHA-256; el hash se calcula externamente en el build manifest y no se incluye en el JSON.

### 1.3 Operación y costo

Las llamadas del Simulador a POST /paso y /motor/sincronizar se hacen por loopback/intra-tarea, sin pasar por el ALB. Configuración inicial del Backend: mínimo 2 vCPU y 2 GiB RAM, ajustar con carga medida; workers = max(1, vCPU asignadas − 1), máximo 8, cola de hasta 200 solicitudes. No aceptar configuración que incumpla p95. Health endpoints: /health/live y /health/ready. Readiness requiere grafo, estado y todos los workers listos.

CloudWatch registra JSON con requestId, gameId, turnId y worldVersion. Métricas: p50/p95/p99 de rutas, timeouts, rutas inválidas, profundidad/edad de cola de snapshots, conexiones WS, CPU, memoria y salud de tarea. Alertas para p95 >150 ms, timeout, cola creciente o tarea no saludable. No incluir API keys ni snapshots completos en logs. Etiquetar recursos Project, Environment, Owner y Round. Fargate de escritor sin autoescalado horizontal; DynamoDB On-Demand; CloudFront cachea estáticos, nunca estado/control. Estimar gasto con configuración medida en AWS Pricing Calculator antes del evento; On-Demand no tiene costo fijo.

## 2. Modelos y JSON Schemas

### 2.1 grafo_manta.json

Grafo serializado como dirigido: cada sentido transitable es una arista y `segmentoId` agrupa los dos arcos opuestos del mismo tramo. En este dominio, sobrevivientes y zombies se desplazan a pie; por ello, cada tramo incluido en el artefacto genera `A→B` y `B→A`, ignorando restricciones vehiculares `oneway` de OSM. Nodos: aproximadamente 300; aceptación entre 250 y 350. Exactamente cuatro refugios. Coordenadas y capacidades se suministran en el artefacto revisado; esta especificación no inventa ubicaciones ni cupos.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spookython.example/schemas/grafo-manta-1.0.0.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "metadata", "nodos", "aristas", "refugios"],
  "properties": {
    "schemaVersion": { "const": "1.0.0" },
    "metadata": {
      "type": "object", "additionalProperties": false,
      "required": ["ciudad", "graphVersion", "generatedAt", "source", "osmAttribution"],
      "properties": {
        "ciudad": { "const": "Manta" },
        "graphVersion": { "type": "string", "minLength": 1 },
        "generatedAt": { "type": "string", "format": "date-time" },
        "source": { "const": "OpenStreetMap" },
        "osmAttribution": { "type": "string", "minLength": 1 }
      }
    },
    "nodos": {
      "type": "array", "minItems": 250, "maxItems": 350,
      "items": { "$ref": "#/$defs/Nodo" }
    },
    "aristas": { "type": "array", "minItems": 1, "items": { "$ref": "#/$defs/Arista" } },
    "refugios": {
      "type": "array", "minItems": 4, "maxItems": 4,
      "items": { "$ref": "#/$defs/Refugio" }
    }
  },
  "$defs": {
    "Nodo": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "lat", "lng", "zona"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "lat": { "type": "number", "minimum": -90, "maximum": 90 },
        "lng": { "type": "number", "minimum": -180, "maximum": 180 },
        "zona": { "enum": ["Tarqui", "Los Esteros", "Barbasquillo", "Jocay"] }
      }
    },
    "Arista": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "segmentoId", "origen", "destino", "distancia_m", "tipo", "factor_velocidad"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "segmentoId": { "type": "string", "minLength": 1 },
        "origen": { "type": "string", "minLength": 1 },
        "destino": { "type": "string", "minLength": 1 },
        "distancia_m": { "type": "number", "exclusiveMinimum": 0 },
        "tipo": { "enum": ["avenida", "calle", "callejon", "puente"] },
        "factor_velocidad": { "type": "number", "exclusiveMinimum": 0, "maximum": 1 }
      }
    },
    "Refugio": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "nodoId", "capacidad"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "nodoId": { "type": "string", "minLength": 1 },
        "capacidad": { "type": "integer", "minimum": 1 }
      }
    }
  }
}
```

Factores iniciales: avenida 1.00, calle 0.80, callejon 0.55, puente 0.90. Validador semántico: IDs únicos; referencias origen/destino/refugio existentes; arista sin auto-bucle; cuatro refugios en nodos distintos; factor coherente con tipo; cada componente alcanzable tiene camino a refugio. Artefacto inválido impide readiness.

### 2.2 Interfaces TypeScript

```typescript
export type Zone = "Tarqui" | "Los Esteros" | "Barbasquillo" | "Jocay";
export type RoadType = "avenida" | "calle" | "callejon" | "puente";
export type ZombieType = "caminante" | "corredor" | "horda" | "dormido";
export type EntityStatus = "vivo" | "mordido" | "evacuado";
export type GameStatus = "idle" | "running" | "paused" | "completed";
export type TurnPhase =
  | "idle" | "city-events" | "zombie-move" | "sync" | "routing"
  | "survivor-move" | "resolve" | "publish";

export interface GraphNode { id: string; lat: number; lng: number; zona: Zone }
export interface GraphEdge {
  id: string; segmentoId: string; origen: string; destino: string;
  distancia_m: number; tipo: RoadType; factor_velocidad: number;
}
export interface GraphShelter { id: string; nodoId: string; capacidad: number }
export interface MantaGraph {
  schemaVersion: "1.0.0";
  metadata: {
    ciudad: "Manta"; graphVersion: string; generatedAt: string;
    source: "OpenStreetMap"; osmAttribution: string;
  };
  nodos: GraphNode[]; aristas: GraphEdge[]; refugios: GraphShelter[];
}
export interface Zombie {
  id: string; tipo: ZombieType; estado: "activo" | "dormido"; nodeId: string;
  despertadoEnTurno: number | null;
  siguienteMovimientoTurno: number | null;
}
export interface Survivor {
  id: string; nodeId: string; estado: EntityStatus; targetShelterId: string | null;
  eliminadoEnTurno: number | null; evacuadoEnTurno: number | null;
}
export interface Shelter {
  id: string; nodoId: string; capacidad: number;
  ocupantes: string[]; reservados: string[];
}
export interface BlockedEdge {
  segmentoId: string; edgeIds: string[]; motivo: string;
  origen: "evento-ciudad" | "control";
  bloqueadaDesdeTurno: number; desbloqueadaEnTurno: number | null;
}
export interface ZombieTraversal {
  zombieId: string; stepIndex: 1 | 2; edgeId: string;
  fromNodeId: string; toNodeId: string;
}
export interface CityEvent {
  eventId: string; tipo: "bloquear-segmento" | "desbloquear-segmento";
  edgeId: string; motivo: string; effectiveTurnId: number; aplicado: boolean;
}
export interface TelemetryMetrics {
  routeSamples: number; routeLatencyP50Ms: number; routeLatencyP95Ms: number;
  routeLatencyP99Ms: number; routeTimeouts: number; invalidRouteResponses: number;
  deadlineMisses: number;
  activeSurvivors: number; bittenSurvivors: number; evacuatedSurvivors: number;
  activeZombies: number; wsClients: number; snapshotQueueDepth: number;
  lastSnapshotTurnId: number | null;
}
export interface WorldState {
  gameId: string; roundId: 1 | 2 | 3; status: GameStatus; phase: TurnPhase;
  turnId: number; activeTurnId: number | null; worldVersion: number;
  graph: MantaGraph; zombies: Zombie[]; survivors: Survivor[]; shelters: Shelter[];
  blockedEdges: BlockedEdge[]; pendingCityEvents: CityEvent[];
  lastZombieTraversals: ZombieTraversal[]; metrics: TelemetryMetrics;
  rngSeed: string; updatedAt: string;
}
export interface WorldSnapshot {
  schemaVersion: "1.0.0"; gameId: string; roundId: 1 | 2 | 3;
  status: GameStatus; turnId: number; worldVersion: number;
  graphVersion: string; updatedAt: string;
  zombies: Zombie[]; survivors: Survivor[]; shelters: Shelter[];
  blockedEdges: BlockedEdge[]; metrics: TelemetryMetrics;
}
export interface TurnUpdate {
  event: "TURN_UPDATE"; emittedAt: string; world: WorldSnapshot;
}
export interface PasoRequest {
  gameId: string; turnId: number; worldVersion: number; survivorId: string;
  currentNodeId: string; targetShelterId?: string | null;
}
export interface PasoResponse {
  gameId: string; turnId: number; worldVersion: number; survivorId: string;
  fromNodeId: string; toNodeId: string; edgeId: string | null;
  decision: "mover" | "esperar"; targetShelterId: string | null;
  reason: "ruta-segura" | "sin-ruta-segura" | "nodo-bloqueado" | "no-hay-refugio-disponible" | "fallback-interno";
  routeCost: number | null; latencyMs: number;
}
export interface WorldSyncRequest {
  gameId: string; turnId: number; baseWorldVersion: number;
  survivors: Survivor[]; zombies: Zombie[]; // solo entidades visibles a routing
  shelters: Shelter[];
  blockedEdges: BlockedEdge[]; zombieTraversals: ZombieTraversal[];
  dormantUncertaintyNodeIds: string[];
}
export interface RoutePlanEntry {
  fromNodeId: string; toNodeId: string; edgeId: string | null;
  targetShelterId: string | null; routeCost: number | null;
  decision: "mover" | "esperar";
  reason: "ruta-segura" | "sin-ruta-segura" | "nodo-bloqueado" |
    "no-hay-refugio-disponible" | "fallback-interno";
}
export interface RoutePlanSnapshot {
  gameId: string; turnId: number; worldVersion: number; graphVersion: string;
  builtAt: string; buildLatencyMs: number;
  bestMoveByNode: Readonly<Record<string, RoutePlanEntry>>;
}
export interface SyncResponse {
  turnId: number; worldVersion: number; graphVersion: string;
  workerCount: number; buildLatencyMs: number; ready: true;
}
export interface RoutingStatusResponse {
  gameId: string; installed: SyncResponse | null;
}
```

Invariantes: IDs únicos; estado mordido/evacuado terminal; evacuados figuran una vez en ocupantes y nunca exceden capacidad; reservados solo contiene vivos y no ocupantes; cada nodeId existe; dormido solo aplica a zombies tipo dormido; al despertar conserva tipo dormido pero se comporta como caminante. Horda no se mueve. Cada edgeId bloqueado pertenece a segmentoId. Cambios de estado se preparan y comprometen atómicamente.

## 3. OpenAPI y eventos

### 3.1 Convenciones

JSON UTF-8, timestamps ISO-8601 UTC. x-api-key obligatorio para POST /paso, /motor/sincronizar y controles. Comparación en tiempo constante. Error: { error: { code, message, requestId } }; nunca revelar secretos. POST /paso es idempotente por gameId+turnId+survivorId+worldVersion y no cambia el mundo. El Simulador valida cada respuesta y es autoridad final.

### 3.2 POST /paso

Timeout estricto del cliente: 500 ms desde despacho, sin reintento en el mismo turno. SLA p95 ≤150 ms con hasta 200 sobrevivientes simultáneos. Request:

```json
{
  "gameId": "game-2026-001",
  "turnId": 12,
  "worldVersion": 31,
  "survivorId": "S-0042",
  "currentNodeId": "MNT-0184",
  "targetShelterId": "REF-TARQUI"
}
```

targetShelterId puede ser null u omitirse. Turno/versión deben coincidir con la última sincronización; sobreviviente debe estar vivo y currentNodeId debe coincidir con el snapshot.

Para una petición autenticada, bien formada y con sobreviviente/nodo reconocidos, POST /paso siempre devuelve HTTP 200 con un toNodeId válido del grafo. Si no existe movimiento seguro, o falla el cálculo/worker, devuelve espera en currentNodeId; el error interno se registra, pero no se convierte en un destino inválido. Errores de autenticación, esquema, identidad o versión conservan su status HTTP. Si el cliente vence a 500 ms sin respuesta, el Simulador usa currentNodeId.

Respuesta 200:

```json
{
  "gameId": "game-2026-001",
  "turnId": 12,
  "worldVersion": 31,
  "survivorId": "S-0042",
  "fromNodeId": "MNT-0184",
  "toNodeId": "MNT-0185",
  "edgeId": "E-0711-F",
  "decision": "mover",
  "targetShelterId": "REF-TARQUI",
  "reason": "ruta-segura",
  "routeCost": 428.75,
  "latencyMs": 4.7
}
```

Decision mover|esperar. Para esperar: toNodeId=fromNodeId, edgeId=null, routeCost=null. Reason: ruta-segura|sin-ruta-segura|nodo-bloqueado|no-hay-refugio-disponible|fallback-interno. Validar turno, versión, identidad, nodo destino existente, edge adyacente, edge abierto, destino fuera de nodos horda/ocupados por zombies visibles y no cruce frontal.

| HTTP | Código | Respuesta del Simulador |
|---|---|---|
| 400 | VALIDATION_ERROR | Espera y registra fallo de contrato |
| 401 | UNAUTHORIZED | Pausa y alerta |
| 404 | SURVIVOR_NOT_FOUND / NODE_NOT_FOUND | Espera y registra |
| 409 | STALE_WORLD / SURVIVOR_STATE_MISMATCH | Espera; fallo de sincronización |
| 429 | ROUTE_CAPACITY | Espera; registra saturación |
| 500/503 | ROUTE_UNAVAILABLE | Espera |
| 504 o timeout cliente | ROUTE_TIMEOUT | Espera; muestra de latencia = 500 ms |

### 3.3 Otros endpoints

POST /paso, sincronización y controles requieren x-api-key; GET /estado y health endpoints no la requieren. Los health endpoints solo son accesibles desde el health check interno del ALB.

- GET /estado: 200 WorldSnapshot del último estado completo comprometido, Cache-Control no-store. Antes de crear la primera partida responde 503 con error.code=GAME_NOT_STARTED; no inventa gameId, roundId ni entidades. Una partida creada tiene snapshot inicial en turno 0. En un turno en curso aún devuelve el snapshot anterior, nunca mezcla fases. Los controles comprometidos de inicio, pausa entre ticks y reanudación actualizan status sin avanzar turnId/worldVersion.
- POST /simulador/iniciar: request {gameId, roundId: 1|2|3, seed}; respuesta 202 {gameId, roundId, status:"running", nextTurnId}. Desde idle crea partida en turno 1; desde paused solo reanuda el mismo gameId/roundId/seed desde el siguiente turno; desde completed permite una partida nueva con gameId distinto y turno 1. Un gameId/roundId/seed incompatible o un inicio mientras running da 409. Ronda de 150 turnos, 2 s cada uno.
- POST /simulador/pausar: request {reason}; 202 {status:"pausing", afterTurnId}. Cierra el turno activo antes de pausar. Sin turno activo responde paused.
- POST /simulador/bloquear-arista: request {eventId, edgeId, bloqueada, motivo, effectiveTurnId?}; programa bloqueo/desbloqueo del segmento completo identificado por edgeId. Default: siguiente turno si está running. Mismo eventId y contenido es idempotente; contenido distinto da 409. Acepta 202 con {eventId, segmentoId, effectiveTurnId, status:"programado"}. ID inexistente da 404; turno pasado 400.
- POST /motor/sincronizar: request {gameId, turnId, baseWorldVersion, survivors, zombies, shelters, blockedEdges, zombieTraversals, dormantUncertaintyNodeIds}; snapshot post-movimiento zombie para el turno activo. `zombieTraversals` contiene los pasos efectivamente recorridos, ordenados por `zombieId` y `stepIndex`, con `edgeId`; el último paso coincide con `zombies[].nodeId`. Un corredor puede aportar hasta dos pasos contiguos. `baseWorldVersion` debe coincidir con la última versión instalada; `turnId` debe ser mayor que el último instalado, pero puede saltar turnos que cerraron sin un plan confirmado. Repetición idéntica (mismo turno y digest) idempotente; distinta para el mismo turno, versión base incorrecta o turno menor devuelve 409. Responde 200 {turnId, worldVersion, graphVersion, workerCount, buildLatencyMs, ready:true}. No publica estado parcial.
- GET /motor/estado/{gameId}: requiere `x-api-key` y devuelve `{gameId, installed}` con la última respuesta de sincronización confirmada, o `installed:null` si no hay snapshot. El simulador usa este estado o reintenta exactamente el mismo payload para resolver un timeout de sincronización; nunca usa una tabla de un turno anterior.
- GET /health/live y /health/ready: liveness/readiness interna para ALB.

Proyección OpenAPI 3.1: debe cubrir todos los endpoints previos y usar esquemas cerrados (additionalProperties=false) derivados de las interfaces anteriores.

```yaml
openapi: 3.1.0
info:
  title: SpookyThon Manta Zombie API
  version: 1.0.0
paths:
  /paso:
    post:
      operationId: calcularPaso
      security: [{ ApiKey: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PasoRequest" }
      responses:
        "200":
          description: Decisión de movimiento o espera
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PasoResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "401": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
        "429": { $ref: "#/components/responses/Error" }
        "503": { $ref: "#/components/responses/Error" }
        "504": { $ref: "#/components/responses/Error" }
  /estado:
    get:
      operationId: obtenerEstado
      responses:
        "200":
          description: Último snapshot completo
          content:
            application/json:
              schema: { $ref: "#/components/schemas/WorldSnapshot" }
        "503": { $ref: "#/components/responses/Error" }
  /simulador/iniciar:
    post:
      operationId: iniciarSimulador
      security: [{ ApiKey: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/IniciarRequest" }
      responses:
        "202":
          description: Ronda aceptada
          content:
            application/json:
              schema: { $ref: "#/components/schemas/IniciarResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "401": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
  /simulador/pausar:
    post:
      operationId: pausarSimulador
      security: [{ ApiKey: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PausarRequest" }
      responses:
        "202":
          description: Pausa solicitada al cerrar turno
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PausarResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "401": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
  /simulador/bloquear-arista:
    post:
      operationId: bloquearArista
      security: [{ ApiKey: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BloquearAristaRequest" }
      responses:
        "202":
          description: Evento programado
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BloquearAristaResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
  /motor/sincronizar:
    post:
      operationId: sincronizarMotor
      security: [{ ApiKey: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/WorldSyncRequest" }
      responses:
        "200":
          description: Snapshot instalado y plan precalculado
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SyncResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "401": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
  /motor/estado/{gameId}:
    get:
      operationId: estadoMotor
      security: [{ ApiKey: [] }]
      parameters:
        - in: path
          name: gameId
          required: true
          schema: { type: string, minLength: 1 }
      responses:
        "200":
          description: Última versión instalada para conciliar una sincronización incierta
          content:
            application/json:
              schema: { $ref: "#/components/schemas/RoutingStatusResponse" }
        "401": { $ref: "#/components/responses/Error" }
  /health/live:
    get:
      operationId: healthLive
      responses:
        "200": { description: Proceso vivo }
  /health/ready:
    get:
      operationId: healthReady
      responses:
        "200": { description: Backend listo }
        "503": { description: Grafo o workers no listos }
components:
  securitySchemes:
    ApiKey:
      type: apiKey
      in: header
      name: x-api-key
  responses:
    Error:
      description: Error de contrato
      content:
        application/json:
          schema:
            type: object
            additionalProperties: false
            required: [error]
            properties:
              error:
                type: object
                additionalProperties: false
                required: [code, message, requestId]
                properties:
                  code: { type: string }
                  message: { type: string }
                  requestId: { type: string }
  schemas:
    PasoRequest:
      type: object
      additionalProperties: false
      required: [gameId, turnId, worldVersion, survivorId, currentNodeId]
      properties:
        gameId: { type: string, minLength: 1 }
        turnId: { type: integer, minimum: 1 }
        worldVersion: { type: integer, minimum: 1 }
        survivorId: { type: string, minLength: 1 }
        currentNodeId: { type: string, minLength: 1 }
        targetShelterId: { type: [string, "null"] }
    PasoResponse:
      type: object
      additionalProperties: false
      required: [gameId, turnId, worldVersion, survivorId, fromNodeId, toNodeId, edgeId, decision, targetShelterId, reason, routeCost, latencyMs]
      properties:
        gameId: { type: string }
        turnId: { type: integer }
        worldVersion: { type: integer }
        survivorId: { type: string }
        fromNodeId: { type: string }
        toNodeId: { type: string }
        edgeId: { type: [string, "null"] }
        decision: { enum: [mover, esperar] }
        targetShelterId: { type: [string, "null"] }
        reason: { enum: [ruta-segura, sin-ruta-segura, nodo-bloqueado, no-hay-refugio-disponible, fallback-interno] }
        routeCost: { type: [number, "null"], minimum: 0 }
        latencyMs: { type: number, minimum: 0 }
    IniciarRequest:
      type: object
      additionalProperties: false
      required: [gameId, roundId, seed]
      properties:
        gameId: { type: string }
        roundId: { enum: [1, 2, 3] }
        seed: { type: string }
    IniciarResponse:
      type: object
      additionalProperties: false
      required: [gameId, roundId, status, nextTurnId]
      properties:
        gameId: { type: string }
        roundId: { enum: [1, 2, 3] }
        status: { const: running }
        nextTurnId: { type: integer, minimum: 1 }
    PausarRequest:
      type: object
      additionalProperties: false
      required: [reason]
      properties:
        reason: { type: string, minLength: 1 }
    PausarResponse:
      type: object
      additionalProperties: false
      required: [status]
      properties:
        status: { enum: [pausing, paused] }
        afterTurnId: { type: integer, minimum: 0 }
    BloquearAristaRequest:
      type: object
      additionalProperties: false
      required: [eventId, edgeId, bloqueada, motivo]
      properties:
        eventId: { type: string }
        edgeId: { type: string }
        bloqueada: { type: boolean }
        motivo: { type: string }
        effectiveTurnId: { type: integer, minimum: 1 }
    BloquearAristaResponse:
      type: object
      additionalProperties: false
      required: [eventId, segmentoId, effectiveTurnId, status]
      properties:
        eventId: { type: string }
        segmentoId: { type: string }
        effectiveTurnId: { type: integer, minimum: 1 }
        status: { const: programado }
    SyncResponse:
      type: object
      additionalProperties: false
      required: [turnId, worldVersion, graphVersion, workerCount, buildLatencyMs, ready]
      properties:
        turnId: { type: integer, minimum: 1 }
        worldVersion: { type: integer, minimum: 1 }
        graphVersion: { type: string, minLength: 1 }
        workerCount: { type: integer, minimum: 1 }
        buildLatencyMs: { type: number, minimum: 0 }
        ready: { const: true }
    RoutingStatusResponse:
      type: object
      additionalProperties: false
      required: [gameId, installed]
      properties:
        gameId: { type: string, minLength: 1 }
        installed:
          oneOf:
            - $ref: "#/components/schemas/SyncResponse"
            - type: "null"
    WorldSyncRequest:
      type: object
      additionalProperties: false
      required: [gameId, turnId, baseWorldVersion, survivors, zombies, shelters, blockedEdges, zombieTraversals, dormantUncertaintyNodeIds]
      properties:
        gameId: { type: string }
        turnId: { type: integer, minimum: 1 }
        baseWorldVersion: { type: integer, minimum: 0 }
        survivors: { type: array, items: { $ref: "#/components/schemas/Survivor" } }
        zombies:
          type: array
          description: Solo zombies visibles; excluir dormidos no despiertos.
          items: { $ref: "#/components/schemas/Zombie" }
        shelters: { type: array, items: { $ref: "#/components/schemas/Shelter" } }
        blockedEdges: { type: array, items: { $ref: "#/components/schemas/BlockedEdge" } }
        zombieTraversals:
          type: array
          description: Recorridos reales ordenados por zombieId y stepIndex; los pasos de cada zombie son contiguos.
          items: { $ref: "#/components/schemas/ZombieTraversal" }
        dormantUncertaintyNodeIds: { type: array, uniqueItems: true, items: { type: string } }
    Zombie:
      type: object
      additionalProperties: false
      required: [id, tipo, estado, nodeId, despertadoEnTurno, siguienteMovimientoTurno]
      properties:
        id: { type: string }
        tipo: { enum: [caminante, corredor, horda, dormido] }
        estado: { enum: [activo, dormido] }
        nodeId: { type: string }
        despertadoEnTurno: { type: [integer, "null"] }
        siguienteMovimientoTurno: { type: [integer, "null"] }
    Survivor:
      type: object
      additionalProperties: false
      required: [id, nodeId, estado, targetShelterId, eliminadoEnTurno, evacuadoEnTurno]
      properties:
        id: { type: string }
        nodeId: { type: string }
        estado: { enum: [vivo, mordido, evacuado] }
        targetShelterId: { type: [string, "null"] }
        eliminadoEnTurno: { type: [integer, "null"] }
        evacuadoEnTurno: { type: [integer, "null"] }
    Shelter:
      type: object
      additionalProperties: false
      required: [id, nodoId, capacidad, ocupantes, reservados]
      properties:
        id: { type: string }
        nodoId: { type: string }
        capacidad: { type: integer, minimum: 1 }
        ocupantes: { type: array, items: { type: string } }
        reservados: { type: array, items: { type: string } }
    BlockedEdge:
      type: object
      additionalProperties: false
      required: [segmentoId, edgeIds, motivo, origen, bloqueadaDesdeTurno, desbloqueadaEnTurno]
      properties:
        segmentoId: { type: string }
        edgeIds: { type: array, items: { type: string } }
        motivo: { type: string }
        origen: { enum: [evento-ciudad, control] }
        bloqueadaDesdeTurno: { type: integer, minimum: 1 }
        desbloqueadaEnTurno: { type: [integer, "null"] }
    ZombieTraversal:
      type: object
      additionalProperties: false
      required: [zombieId, stepIndex, edgeId, fromNodeId, toNodeId]
      properties:
        zombieId: { type: string }
        stepIndex: { enum: [1, 2] }
        edgeId: { type: string }
        fromNodeId: { type: string }
        toNodeId: { type: string }
    WorldSnapshot:
      type: object
      additionalProperties: false
      required: [schemaVersion, gameId, roundId, status, turnId, worldVersion, graphVersion, updatedAt, zombies, survivors, shelters, blockedEdges, metrics]
      properties:
        schemaVersion: { const: "1.0.0" }
        gameId: { type: string }
        roundId: { enum: [1, 2, 3] }
        status: { enum: [idle, running, paused, completed] }
        turnId: { type: integer, minimum: 0 }
        worldVersion: { type: integer, minimum: 0 }
        graphVersion: { type: string }
        updatedAt: { type: string, format: date-time }
        zombies: { type: array, items: { $ref: "#/components/schemas/Zombie" } }
        survivors: { type: array, items: { $ref: "#/components/schemas/Survivor" } }
        shelters: { type: array, items: { $ref: "#/components/schemas/Shelter" } }
        blockedEdges: { type: array, items: { $ref: "#/components/schemas/BlockedEdge" } }
        metrics:
          type: object
          additionalProperties: false
          required: [routeSamples, routeLatencyP50Ms, routeLatencyP95Ms, routeLatencyP99Ms, routeTimeouts, invalidRouteResponses, deadlineMisses, activeSurvivors, bittenSurvivors, evacuatedSurvivors, activeZombies, wsClients, snapshotQueueDepth, lastSnapshotTurnId]
          properties:
            routeSamples: { type: integer, minimum: 0 }
            routeLatencyP50Ms: { type: number, minimum: 0 }
            routeLatencyP95Ms: { type: number, minimum: 0 }
            routeLatencyP99Ms: { type: number, minimum: 0 }
            routeTimeouts: { type: integer, minimum: 0 }
            invalidRouteResponses: { type: integer, minimum: 0 }
            deadlineMisses: { type: integer, minimum: 0 }
            activeSurvivors: { type: integer, minimum: 0 }
            bittenSurvivors: { type: integer, minimum: 0 }
            evacuatedSurvivors: { type: integer, minimum: 0 }
            activeZombies: { type: integer, minimum: 0 }
            wsClients: { type: integer, minimum: 0 }
            snapshotQueueDepth: { type: integer, minimum: 0 }
            lastSnapshotTurnId: { type: [integer, "null"] }
    TurnUpdate:
      type: object
      additionalProperties: false
      required: [event, emittedAt, world]
      properties:
        event: { const: TURN_UPDATE }
        emittedAt: { type: string, format: date-time }
        world: { $ref: "#/components/schemas/WorldSnapshot" }
```

Los validadores runtime de contracts/schemas.ts deben implementar las mismas restricciones y reglas semánticas del OpenAPI; no se permiten objetos libres ni campos extra.

### 3.4 WebSocket TURN_UPDATE

Conectar a WSS /ws. Cada mensaje completo es TurnUpdate; se emite tras comprometer estado y actualizar GET /estado. El grafo estático se descarga una sola vez. turnId nunca retrocede dentro de un mismo gameId. Antes de crear una partida WS puede conectar, pero no envía un mundo inventado. Al conectar o reconectar se envía el snapshot completo vigente si existe, además de permitir recuperarlo por GET /estado.

Los controles comprometidos de inicio, pausa entre ticks y reanudación también emiten TurnUpdate completo. Pueden cambiar status conservando turnId/worldVersion: el consumidor debe aceptar ese cambio de status sin volver a aplicar movimientos. Descartar versiones/turnos anteriores y duplicados sin cambios. Un gameId nuevo reinicia turno y versión; no compararlo como si fuera la partida anterior.
El ejemplo reduce las listas de entidades a arreglos vacíos para mostrar la envoltura sin duplicar datos; en producción cada arreglo contiene todas las entidades dinámicas del snapshot.

```json
{
  "event": "TURN_UPDATE",
  "emittedAt": "2026-10-26T18:00:24.000Z",
  "world": {
    "schemaVersion": "1.0.0",
    "gameId": "game-2026-001",
    "roundId": 1,
    "status": "running",
    "turnId": 12,
    "worldVersion": 32,
    "graphVersion": "manta-osm-2026-10-26-a1b2c3",
    "updatedAt": "2026-10-26T18:00:24.000Z",
    "zombies": [],
    "survivors": [],
    "shelters": [],
    "blockedEdges": [],
    "metrics": {
      "routeSamples": 1000,
      "routeLatencyP50Ms": 3.2,
      "routeLatencyP95Ms": 21.6,
      "routeLatencyP99Ms": 48.1,
      "routeTimeouts": 0,
      "invalidRouteResponses": 0,
      "deadlineMisses": 0,
      "activeSurvivors": 20,
      "bittenSurvivors": 0,
      "evacuatedSurvivors": 0,
      "activeZombies": 12,
      "wsClients": 1,
      "snapshotQueueDepth": 0,
      "lastSnapshotTurnId": 11
    }
  }
}
```

Máximo de mensaje: 1 MiB. Ping/pong cada 30 s; cerrar conexión sin heartbeat. Cola limitada por cliente: cliente lento se desconecta y recupera por GET /estado. Broadcast no bloquea el game loop.

## 4. Algoritmo de rutas

### 4.1 Snapshot y precomputación por turno

Usar índices enteros, outEdges e inEdges. El grafo es inmutable. Después de mover zombies y aplicar eventos, el Simulador sincroniza un snapshot; routing calcula una sola vez el plan para ese worldVersion y lo publica a todos sus workers. Una llamada /paso no ejecuta Dijkstra: valida identidad/versión y consulta bestMoveByNode[currentNodeId], una búsqueda O(1).

El snapshot de rutas incluye aristas abiertas, H (nodos horda y vecinos), nodos ocupados por zombies visibles, posiciones de corredores despiertos, transiciones observadas, refugios con ocupación y un mapa agregado de incertidumbre de dormidos. El Simulador genera dormantUncertaintyNodeIds como unión de nodos alcanzables en ≤2 saltos dirigidos desde cada dormido no despierto. No incluye objetos, IDs ni posiciones de dormidos no despiertos. El mapa agregado solo modifica el coste; no permite perseguir, bloquear ni despertar un dormido. Se invalida en cada worldVersion.

RoutePlanSnapshot tiene exactamente una entrada bestMoveByNode por nodo de grafo y está asociado a gameId, turnId, worldVersion y graphVersion. Los workers rechazan plan con versión distinta. buildLatencyMs mide solo el precompute del plan, no se suma a la latencia de cada /paso.

En cada sync materializar matrices dispersas por edgeId:

```text
B(e) = distancia_m(e) / factor_velocidad(e)
P_t(u,v) = +∞ si edge está cerrada o v ∈ H ∪ Z_t
           Pcor(v) + Pincertidumbre(v), en otro caso
M_t(u,v) = B(e) + P_t(u,v)
F_t(u,v) = true si zombie v→u ocurrió en este turno
```

H incluye vecinos directos entrantes y salientes de cada horda activa. Z_t son nodos ocupados por zombies visibles, incluyendo su nodo actual. No se permite entrar en H∪Z_t. Para un sobreviviente cuyo origen ya está en H∪Z_t, el plan de ese nodo permite únicamente una salida abierta hacia un nodo fuera de H∪Z_t. F_t impide ese edge solo como primer movimiento. El cruce frontal se basa en la transición real del turno; no se adivina movimiento aleatorio futuro.

### 4.2 Nivel Base (obligatorio)

Coste de calle: B(e)=distancia_m/factor_velocidad. L es la mediana de B sobre aristas abiertas; si no hay ninguna, usar todas las aristas del grafo. Hacer una búsqueda Dijkstra inversa multi-source, con los refugios no llenos como fuentes de costo 0. Se ejecuta una vez después de cada sincronización, no por sobreviviente. Guardar distToShelter[nodeId] y targetShelter[nodeId].

Penalización corredor Base: para cada corredor despierto, d(c,v) es distancia mínima en saltos dirigidos, hasta 2. Sea dmin(v) el mínimo sobre corredores. Wc=4*L:

```text
Pcor(v) = Wc * (3 - dmin(v)), si dmin(v) ∈ {0,1,2}
          0, de lo contrario
```

Penalización de incertidumbre Base: el Simulador produce una lista de nodos próximos a dormidos no despiertos, sin incluir sus IDs ni coordenadas. Si v aparece, Pincertidumbre(v)=0.25*L; en otro caso es 0. Es un costo blando: nunca bloquea una calle ni identifica/despierta zombies. Dormidos siguen estáticos e invisibles como entidades del motor. Si no se puede formar este agregado, usar lista vacía.

Con distToShelter calculado, crear una entrada bestMoveByNode por cada nodo. Para cada salida abierta u→v, sumar B(e)+Pcor(v)+Pincertidumbre(v)+distToShelter(v), excluir F_t(u,v), y elegir costo mínimo; desempatar por shelterId y edgeId lexicográficos. Si u∈H∪Z_t, solo considerar v∉H∪Z_t. La tabla guarda edgeId, toNodeId, targetShelterId y routeCost. Si u ya es nodo de refugio disponible, guardar espera en u con reason=ruta-segura y targetShelterId del refugio, para que el Simulador resuelva admisión. Refugios llenos no son fuentes; disponibilidad se evalúa con la ocupación del snapshot. Llegadas simultáneas se arbitran en el Simulador y nunca exceden capacidad.

El plan cuesta O((V+E) log V) para el Dijkstra inverso más O(E) para la tabla de siguientes pasos, una vez por worldVersion. Cada /paso hace lookup O(1), sin recorrer el grafo. Si no hay refugio alcanzable o salida segura, guardar espera en el nodo actual. targetShelterId en request es compatible con Pro; Base elige el refugio disponible de menor costo.

El cruce frontal excluye u→v cuando F_t(u,v) es true. H, aristas cerradas y nodos inexistentes son restricciones duras. Corredor e incertidumbre son penalizaciones blandas. El Simulador valida la respuesta contra el mismo snapshot antes de mover; un sobreviviente avanza máximo una arista por turno.

### 4.3 Nivel Pro (posponer hasta estabilizar Base)

- Predicción de corredor: simular sus siguientes movimientos de hasta dos aristas y expandir el riesgo a radio 2–3 saltos; versionar radio y peso por turno. Mantener la transición frontal observada como bloqueo duro.
- Balanceo de refugios: añadir costo Q(s) por ocupación/reservas y evitar cambios innecesarios de destino. El límite físico de capacidad y admisión determinista siguen siendo obligatorios en Base.
- A*: solo como optimización equivalente al plan precomputado de Dijkstra; no sustituye el lookup O(1) de Base sin mediciones.
- Flota de rescate: fuera del alcance hasta que exista requisito de dominio.

Pro requiere comparación de rutas contra Base, prueba de carga y evidencia de que no empeora p95 ni seguridad. Parámetros fijos durante la ronda; no hay aprendizaje online.

## 5. Máquina de estados y game loop

### 5.1 Rondas

| Ronda | Duración | Turnos | Sobrevivientes | Contenido |
|---|---:|---:|---:|---|
| 1 Anochecer | 5 min | 150×2 s | 20 | Caminantes |
| 2 Medianoche | 5 min | 150×2 s | 80 | Caminantes, corredores, hordas; colapsa 1 puente |
| 3 Apocalipsis | 5 min | 150×2 s | 200 | Todos los tipos, incluidos dormidos; bloquea 2 calles |

La solicitud no fija población zombie ni capacidades numéricas de refugio. No inventar esos valores: son entradas obligatorias versionadas en rounds.ts y grafo_manta.json, respectivamente. La partida no inicia con configuración incompleta. R1 requiere caminantes >0 y 0 de los otros tipos; R2 requiere caminantes/corredores/hordas >0 y dormidos=0; R3 requiere los cuatro tipos >0. R2 exige exactamente un evento en un segmento de tipo puente; R3 exactamente dos eventos en segmentos de tipo calle; R1 no permite esos eventos de colapso.

```typescript
export interface RoundConfig {
  roundId: 1 | 2 | 3;
  durationMs: 300_000;
  turnIntervalMs: 2_000;
  turnCount: 150;
  survivorCount: 20 | 80 | 200;
  survivorSpawns: Array<{ id: string; nodeId: string }>;
  zombieSpawns: Array<{ id: string; tipo: ZombieType; nodeId: string }>;
  eventPlan: Array<{
    eventId: string;
    edgeId: string;
    effectiveTurnId: number; // 1..150, configurado antes de iniciar
    reason: "colapso-puente" | "bloqueo-calle";
  }>;
}
```

La lista de spawns DEBE tener IDs únicos y nodeIds del grafo; su longitud de sobrevivientes debe coincidir con survivorCount y la composición de zombieSpawns con las reglas de la ronda. Ningún sobreviviente inicia en nodo zombie, zona de horda o nodo de refugio. Estas posiciones son datos del escenario, no valores inferidos por el motor.

Turnos seriales con reloj monotónico y ticks absolutos cada 2.000 ms. No solapar ni saltar fases. Cada turno debe cerrar antes de su siguiente tick; si termina antes, esperar. Si no cierra antes del tick, terminar y comprometer ese turno, incrementar deadlineMisses y pausar antes de iniciar otro. La ronda con cualquier deadline miss no cumple aceptación temporal. Sin overruns se completan exactamente 150 turnos en 5 minutos. Eventos programados se aplican antes de movimiento zombie en su effectiveTurnId.

### 5.2 Zombies

Todos calculan intención desde la misma vista pre-movimiento y aplican movimiento simultáneamente. Caminante avanza una arista cada dos turnos, siguienteMovimientoTurno inicial 2; salida abierta uniforme con PRNG determinista por semilla de partida, zombie y turno. Corredor avanza hasta 2 aristas: si está a ≤3 saltos dirigidos de vivos, persigue el vivo más cercano por camino mínimo en saltos, empate survivorId; recalcula tras su primer paso. Sin objetivo, movimiento aleatorio. Horda inmóvil. Dormido estático e invisible hasta que un vivo queda a ≤2 saltos; despierta permanentemente y usa reglas caminante. Comprobar al inicio de fase zombie y después de movimiento sobreviviente; si despierta en la segunda comprobación, se mueve desde la siguiente fase. Zombie sin salida se queda. Zombies pueden compartir nodo.

### 5.3 Orden exacto

```text
loop mientras status == running:
  t0 = monotonicNow()
  k = turnId + 1

  phase = city-events
  aplicar eventos con effectiveTurnId == k

  phase = zombie-move
  despertar dormidos a <=2 saltos de vivos
  calcular intenciones contra snapshot común
  aplicar movimientos zombie; guardar transiciones from/to

  phase = sync
  POST /motor/sincronizar(snapshot post-zombie, k, baseWorldVersion)
  esperar instalación en todos los workers
  si falla: no usar snapshot anterior; todos esperan este turno

  phase = routing
  vivos = sobrevivientes estado vivo
  lanzar POST /paso para cada vivo en paralelo, máximo 200
  deadline por request = despacho + 500 ms
  timeout/error = esperar; no reintentar
  validar versión, turno, vivo, origen, adyacencia, edge abierto,
    destino fuera de H y Z_t y ausencia de cruce frontal
  respuesta inválida o tardía = esperar y contabilizar

  phase = survivor-move
  preparar y aplicar movimientos simultáneamente

  phase = resolve
  morder si al final:
    (1) comparte nodo con zombie, o
    (2) está en nodo horda o vecino directo de horda, o
    (3) survivor A→B y zombie B→A en el turno
  primero resolver mordidas; después refugios
  por refugio ordenar llegadas survivorId; admitir solo cupos libres
  no admitidos quedan vivos en el nodo del refugio
  despertar dormidos por posiciones nuevas; recalcular reservas/métricas

  phase = publish
  deadlineMiss = monotonicNow() >= t0 + 2.000 ms
  si deadlineMiss: incrementar deadlineMisses
  si k == 150: status=completed
  si no, si pausa solicitada o deadlineMiss: status=paused
  activeTurnId = null
  comprometer snapshot atómicamente; turnId=k; worldVersion++
  actualizar GET /estado y emitir TURN_UPDATE
  encolar snapshot DynamoDB sin esperar
  si status == running: esperar hasta t0 + 2.000 ms
```

Una persona mordida no se evacúa aunque termine en refugio. La capacidad nunca se excede; admisión simultánea desempata por survivorId. Sincronización fallida obliga a quedarse quieto, no ejecutar con versión anterior. Cualquier respuesta de ruta que llegue después de 500 ms se descarta.

### 5.4 Concurrencia y latencia

Usar Promise.allSettled para hasta 200 solicitudes con límite de 200 en vuelo. Todas comparten turnId/worldVersion; no sincronizar nueva versión hasta cerrar lote. Requests idempotentes. Pool rechaza exceso con 429. Workers no comparten datos mutables; sync publica snapshot completo de forma atómica.

Medir una muestra por request incluyendo error; timeout cuenta como 500 ms. Ring buffer deslizante de últimas 1.000 solicitudes. Percentiles nearest-rank: ordenar muestra, índice ceil(p*n)-1; reportar una decimal. p95 de extremo a extremo de POST /paso. routeTimeouts, invalidRouteResponses y deadlineMisses son acumulados por partida; controles fuera de la ventana. Un timeout no detiene el loop ni mueve al sobreviviente.

## 6. Frontend

React + Vite + TypeScript + Tailwind + Leaflet/React-Leaflet. El Frontend no decide movimientos ni muertes. Carga grafo estático y TURN_UPDATE; ante reconexión pide GET /estado.

Componentes: LiveMap, RoundControls, MetricsPanel, ConnectionStatus y EntityLegend. RoundControls solo para operador autenticado; API key nunca en el bundle. Métricas: vivos, mordidos, evacuados, zombies, turno n/150, reloj, p95, timeouts y rutas inválidas.

Capas Leaflet: vías por tipo; cierres rojos discontinuos; nodos por zona; refugio con ocupación/capacidad; sobrevivientes por estado; zombies por tipo; hordas con nodo+vecinos bloqueados; corredores con radio de dos saltos; dormidos atenuados. No dibujar geometrías ausentes del grafo.

Interpolar visualmente entre los dos snapshots consecutivos durante 1.800 ms con requestAnimationFrame; dejar 200 ms de pausa. No alterar estado lógico. Horda/dormido inmóviles; aplicar mordidas y evacuación al recibir snapshot. Ignorar turnId menor o duplicados sin cambios dentro de la misma partida; aceptar cambios de status por controles con igual turno/versión según §3.4, sin repetir interpolación de movimientos. Si se salta un turno, interpolar desde último visible al más reciente. Store mínimo: graphVersion, currentSnapshot, previousSnapshot, receivedAt, socketStatus, pendingControl, lastError. Si graphVersion difiere, no renderizar entidades y mostrar error de versión.

Reconexión WS con backoff 1,2,4,8,16, máximo 30 s; al reconectar GET /estado, reconciliar worldVersion y abrir WSS. Accesibilidad: texto además de color, diseño usable en escritorio y móvil.

## 7. Plan por desarrollador y aceptación

### Dev 1 — Michael · Fullstack/Infra/Core

1. **Extracción y grafo:** 250–350 nodos, cuatro zonas, cuatro refugios con capacidad positiva, IDs únicos, arcos dirigidos/factores/referencias válidos, atribución, graphVersion y hash compartido.
2. **Estado/sincronización:** carga y validación antes de readiness; instalar versión atómica en workers; sync idéntico idempotente, versión obsoleta/conflicto 409; estado parcial nunca público.
3. **POST /paso y plan Base:** una búsqueda Dijkstra inversa por worldVersion, tabla bestMoveByNode y lookup O(1); auth, validación e idempotencia. Aceptación: jamás devuelve edge no adyacente/cerrado, destino horda o cruce frontal; fallo de cálculo retorna el mismo nodo; p95 ≤150 ms con 200 requests; cliente cancela a 500 ms.
4. **API/OpenAPI/controles:** rutas y contratos alineados; x-api-key exigida en motor/controles; dos inicios concurrentes no aceptados; pausar cierra turno; cierre afecta ambos sentidos del segmento.
5. **AWS/persistencia/telemetría:** ECS/ALB, DynamoDB On-Demand, Secrets Manager y CloudWatch en la región seleccionada mediante AWS_REGION. Aceptación: región confirmada antes del despliegue; una tarea autoritativa; snapshot por turno asíncrono; reinicio restaura pausado; alertas p95/timeout/cola/health; secretos fuera del frontend/logs.
6. **Costos/operación:** documentar sizing medido, retención, alarmas y rollback; estimación vía AWS Pricing Calculator antes del evento.

### Dev 2 — Maykel · Backend Simulador

1. **Reloj/rondas:** configurar población zombie y eventos según RoundConfig; rechazar configuración incompleta o tipos/eventos incompatibles. 150 turnos monotónicos de 2 s; no solapamiento; pausar al cerrar turno; completar en turno 150.
2. **Zombies:** reglas/cadencias/radios exactos; caminante cada dos turnos; corredor hasta dos aristas y persecución a ≤3 saltos; horda fija; dormido despierta a ≤2 y permanece activo; semilla reproducible.
3. **Eventos/sync:** cierres se aplican en effectiveTurnId; transición zombie v→u llega al motor; fallo sync implica espera y no uso de snapshot viejo.
4. **Lote de rutas:** 200 en paralelo, timeout 500 ms, validación de todas las decisiones; fallo/tardanza deja quieto; medir p95 del lote.
5. **Resolución/publicación:** mordida por nodo, horda y cruce; capacidad y desempate estables; GET /estado y WS con mismo turnId/worldVersion; snapshot encolado por turno.

### Dev 3 — Kristhian · Frontend/UI

1. **Contratos/grafo:** tipos compartidos y versión validada; mismatch impide dibujar entidades y muestra recuperación.
2. **Mapa:** vías, zonas, cierres, refugios, sobrevivientes, zombies, hordas y corredor; leyenda para todo tipo/estado.
3. **WS/store:** TURN_UPDATE, reconciliación GET /estado, descartar duplicados/obsoletos; reconexión recupera turno actual.
4. **Interpolación/telemetría:** 1.800 ms visual, sin cambiar estado lógico; métricas coinciden con snapshot.
5. **Controles/responsive:** iniciar/pausar sin secretos en bundle; errores visibles; interfaz usable en móvil y escritorio.

### Aceptación integrada

- Mismo graphVersion/hash en Backend y Frontend; readiness antes de iniciar.
- R1: 20 sobrevivientes/caminantes; R2: 80, caminantes/corredores/hordas y colapso en vivo de un puente; R3: 200, todos los tipos y dos calles bloqueadas en vivo.
- 150 turnos por ronda; orden exacto; carga medida a 20, 80 y 200 sobrevivientes; p95 ≤150 ms a 200 llamadas; timeout 500 ms; respuesta inválida nunca causa movimiento.
- Un mismo turno/worldVersion en GET y WS; no se excede capacidad; mordidas reproducibles con semilla.
- DynamoDB fuera de ruta crítica; falla de persistencia genera alarma y comportamiento de cola definido.

## Decisiones fijadas

- Grafo dirigido, segmentoId compartido para cierres bidireccionales.
- Sobreviviente avanza como máximo una arista por turno; caminante zombie cada dos; horda inmóvil.
- Un escritor ECS por partida; snapshots asíncronos.
- Simulador valida movimientos y resuelve mordidas/capacidad.
- Clientes reciben solo snapshots completos comprometidos.

