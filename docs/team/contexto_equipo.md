# Contexto de integración del equipo — SpookyThon 2026

## 1. Propósito y alcance

Guía de integración para Maykel, Michael y Kristhian en «Escape de Manta Zombie». Describe contratos y comportamiento del repositorio, sin sustituir la fuente normativa [SPEC.md](../../SPEC.md).

**Revisión:** 27 de octubre de 2026. **Commit revisado:** `1c3574810f493a65d7f63ad93ac0908481d4e063`. El árbol de trabajo estaba limpio al comenzar. Este documento se basa en lectura de código y pruebas; no acredita una ejecución nueva de tests ni una medición de aceptación.

La implementación actual ya contiene simulador, cliente HTTP de routing, reloj, controles y publicación HTTP/WS. Las observaciones antiguas sobre ausencia de estos módulos o sobre `zombieTransitions` no describen este commit. Persistencia, telemetría y escenarios oficiales siguen siendo dependencias pendientes.

## 2. Ownership y límites entre módulos

| Área | Responsable | Estado e interfaz que posee | Lectores y límites |
|---|---|---|---|
| Grafo | Michael | `backend/src/contracts/types.ts`; carga e índices en `backend/src/modules/graph/` | Grafo inmutable compartido. El simulador no cambia nodos, aristas ni capacidades del artefacto. |
| Routing | Michael | DTOs y validadores en `backend/src/contracts/`; `RouteEngine` en `backend/src/modules/routing/route-engine.ts` | Instala su propia vista de lectura y plan. No escribe el mundo del simulador. |
| Simulador | Maykel | `WorldState`, `TurnCoordinator`, `SimulationRuntime` en `backend/src/modules/simulator/` | Único dueño de las mutaciones del mundo. Las funciones de resolución producen copias; el coordinador compromete el resultado. |
| Realtime | Maykel | `RealtimeHub`, `realtimePlugin` en `backend/src/modules/realtime/` | Recibe snapshots comprometidos. Mantiene conexiones y colas de entrega; no decide movimientos, mordidas ni evacuaciones. |
| Frontend | Kristhian | Consumo de `GET /estado`, `TURN_UPDATE` y grafo estático | Mantiene una proyección visual. No modifica estado autoritativo ni ejecuta reglas de simulación. |
| Telemetría y persistencia | Michael | Ownership en `backend/src/modules/README.md` | Actualmente ambos directorios contienen solo `.gitkeep`. No asumir ventana de métricas ni escritura DynamoDB operativas. |

El composition root real es [backend/src/server.ts](../../backend/src/server.ts), función `createBackendApp`: carga el grafo con manifiesto, crea una instancia de `RouteEngine`, una de `SimulationRuntime` y registra `routingPlugin`, `simulatorPlugin` y `realtimePlugin` en el mismo Fastify. El cliente del simulador llama por loopback al puerto de ese servidor; no hay que crear un segundo backend.

La frontera simulador–routing es `RoutingClient` (`sync`, `status`, `step`) en `backend/src/modules/simulator/routing-client.ts`. Las respuestas HTTP llegan como `unknown`. No importar el motor privado para resolver movimientos desde el simulador. El composition root sí ensambla las implementaciones.

La frontera de publicación es `SimulationRuntime.getCommittedSnapshot()` y `subscribeCommitted()`. Realtime consume esa interfaz de lectura; `createWorldSnapshot()` hace la proyección explícita en el módulo del simulador. El frontend debe derivar sus DTOs del contrato público, sin importar implementaciones del backend.

## 3. Contratos de integración

### 3.1 Tipos y fuentes

- `backend/src/contracts/types.ts`: `MantaGraph`, `GraphNode`, `GraphEdge`, `GraphShelter`, `Zone`, `RoadType`.
- `backend/src/contracts/routing.ts`: `RouteZombie`, `RouteSurvivor`, `RouteShelter`, `RouteBlockedEdge`, `RouteZombieTraversal`, `WorldSyncRequest`, `SyncResponse`, `RoutingStatusResponse`, `PasoRequest`, `PasoResponse`.
- `backend/src/contracts/routing-validation.ts`: `validateWorldSyncRequest()` y `validatePasoRequest()`; validación cerrada de solicitudes y referencias.
- `backend/src/modules/simulator/types.ts`: `WorldState`, `RoundConfig`, `ScheduledCityEvent`, `PauseState`, `RoutingInstallationState`, `WorldSnapshot`, `CommittedWorldSnapshot`, `TurnUpdate` y tipos de resolución. Reutiliza las entidades de routing. `ZombieTraversal` extiende `RouteZombieTraversal` sin añadir campos.

### 3.2 Sincronización y consulta de instalación

`POST /motor/sincronizar` requiere `x-api-key`. `WorldSyncRequest` incluye:

| Campos | Significado |
|---|---|
| `gameId`, `turnId` | Partida y turno activo que se prepara. No se envía `roundId`. |
| `baseWorldVersion` | Última versión instalada y confirmada del motor; `0` si no existe. No es automáticamente la versión pública del simulador. |
| `survivors`, `zombies`, `shelters`, `blockedEdges` | Vista posterior a eventos y movimiento zombie, anterior al movimiento de sobrevivientes. Se excluyen objetos de dormidos no despiertos; se conservan sobrevivientes terminales necesarios para la coherencia de refugios. |
| `zombieTraversals` | Cada paso real: `zombieId`, `stepIndex`, `edgeId`, `fromNodeId`, `toNodeId`. Orden por zombie y paso; máximo dos pasos contiguos para corredores y último destino igual al nodo visible. |
| `dormantUncertaintyNodeIds` | Agregado de alcance dirigido de hasta dos saltos desde dormidos no despiertos, sin sus identidades. Es una penalización de rutas, no una regla de bloqueo o despertar. |

`buildWorldSyncRequest()` en `routing-world.ts` proyecta estos campos y llama al validador compartido. Los bloqueos incluyen todas las direcciones del segmento. No serializar `WorldState` completo.

`SyncResponse` contiene `turnId`, `worldVersion`, `graphVersion`, `workerCount`, `buildLatencyMs`, `ready: true`. `parseSyncResponse()` valida la forma cerrada; `confirmRoutingSync()` exige turno del intento, versión `baseWorldVersion + 1` y grafo esperado.

`GET /motor/estado/{gameId}` también requiere `x-api-key`. Devuelve `RoutingStatusResponse`: `{gameId, installed}`, donde `installed` es `SyncResponse` o `null`. Sirve para reconciliar una respuesta perdida; no es el estado público de la partida.

### 3.3 Decisiones de ruta

`POST /paso` requiere `x-api-key`. `PasoRequest` contiene `gameId`, `turnId`, `worldVersion`, `survivorId`, `currentNodeId` y `targetShelterId` opcional o nulo. Usa la versión instalada del turno actual.

`PasoResponse` devuelve la misma identidad y versión, `fromNodeId`, `toNodeId`, `edgeId`, `decision`, `targetShelterId`, `reason`, `routeCost` y `latencyMs`. Una espera lleva origen y destino iguales, `edgeId: null` y `routeCost: null`. El simulador valida el payload y su coherencia con la vista post-zombie mediante `resolveSurvivorDecisions()`; un tipo TypeScript no sustituye esta validación runtime.

`RouteEngine.step()` comprueba turno, versión, sobreviviente vivo y nodo actual. Consulta el plan precomputado; no muta el mundo del simulador. SPEC §3.1 define idempotencia por `gameId + turnId + survivorId + worldVersion`.

### 3.4 Estado público y WebSocket

`GET /estado` es de lectura, sin API key, con `Cache-Control: no-store`. Antes de crear una partida devuelve `503 GAME_NOT_STARTED`. Con partida devuelve `WorldSnapshot`:

- Identidad y consistencia: `schemaVersion`, `gameId`, `roundId`, `status`, `turnId`, `worldVersion`, `graphVersion`, `updatedAt`.
- Datos: `zombies`, `survivors`, `shelters`, `blockedEdges`, `metrics`.

No expone semilla, grafo completo, fases activas, intentos HTTP, eventos pendientes ni metadatos internos de reconciliación. La proyección pública sí incluye los zombies dormidos; su exclusión se aplica al DTO enviado a routing.

`/ws` emite `TurnUpdate`: `{event: "TURN_UPDATE", emittedAt, world}`. `world` es el mismo snapshot comprometido que alimenta HTTP. El canal rechaza mensajes de aplicación entrantes. El plugin aplica política de origen; el frontend no debe contener la API key. TLS/WSS en ALB es el requisito de despliegue del SPEC, no una terminación TLS implementada en este plugin local.

## 4. Secuencia de un turno

`TurnPhase` y SPEC §5.3 contienen **siete fases activas**, más `idle`. No hay nueve fases distintas. El compromiso y la publicación son operaciones dentro de `publish`; mordidas y admisión están dentro de `resolve`.

`SimulationRuntime.launch()` espera ticks absolutos y aguarda cada `runTurn()` antes de iniciar otro. `TurnCoordinator` además rechaza ejecución solapada con `busy`. Al comenzar prepara una copia privada del mundo comprometido, conserva el grafo compartido y asigna `activeTurnId = turnId + 1`.

1. **`city-events`.** `applyCityEvents()` aplica eventos no aplicados cuyo `effectiveTurnId` coincide con el turno. Bloquea o desbloquea el segmento completo antes del movimiento zombie; devuelve copias de eventos y bloqueos. Rechaza eventos vencidos sin aplicar y conflictos del mismo segmento/turno.
2. **`zombie-move`.** `moveZombies()` comprueba despertares, calcula movimientos contra la misma vista de sobrevivientes y cierres y devuelve zombies, recorridos y cursores aleatorios. Caminantes usan cadencia de dos turnos; corredores hasta dos pasos y búsqueda de vivos a tres saltos; hordas permanecen inmóviles. Se conserva cada paso para cruces. La implementación usa aristas abiertas para persecución y despertar; un dormido despertado antes del movimiento puede moverse en esa fase, y si despierta después queda habilitado desde la siguiente.
3. **`sync`.** Si quedó un intento incierto, se consulta primero el estado instalado. Después se construye el nuevo payload, se conserva una copia exacta mediante `markRoutingSyncAttempt()` y se envía. Una respuesta válida confirma la instalación; un fallo o respuesta inválida conduce a reconciliación. Solo una instalación confirmada del turno actual habilita rutas.
4. **`routing`.** Se solicitan decisiones para vivos con `Promise.allSettled`, hasta 200 en vuelo, timeout individual de 500 ms, cancelación mediante `AbortController` y sin reintento de `/paso`. El lote conserva turno y versión instalada. Se validan esquema, identidad, origen/destino, arista adyacente abierta, refugio, peligros y cruces. Fallos producen espera. `hordeDangerNodes()` incluye nodo de horda y vecinos entrantes y salientes, sin eliminar ese peligro por cierres.
5. **`survivor-move`.** `applySimultaneousSurvivorMoves()` aplica como máximo una arista por vivo a partir de las decisiones validadas y conserva recorridos de sobrevivientes. No encadena decisiones ni cambia estados terminales.
6. **`resolve`.** `detectBites()` detecta nodo compartido con zombie activo, zona de horda y cruce inverso con cualquier paso zombie. `applyBites()` marca mordidos antes de `resolveShelterAdmissions()`. Esta última admite vivos presentes en cada refugio por orden lexicográfico de `survivorId`, hasta los cupos libres; los restantes permanecen vivos allí. Después se comprueban despertares con las nuevas posiciones. Actualmente se rechazan reservas no vacías; el recálculo de métricas/reservas del SPEC no está completo.
7. **`publish`.** Se incorporan controles pendientes y se evalúan pausa/deadline. Se incrementa `deadlineMisses` si procede; turno 150 queda `completed`, en otro caso una pausa efectiva queda `paused`. Se asigna el nuevo `turnId`, se incrementa la versión comprometida, se limpian `activeTurn`/`activeTurnId` y se vuelve a `idle`. Se congela el mundo y se intercambia la referencia completa. `onCommitted` llama a `publishCommitted()`, que crea el snapshot público, actualiza primero la referencia HTTP y notifica suscriptores. `RealtimeHub` programa la entrega con `setImmediate`. No hay encolado DynamoDB conectado actualmente.

Los cruces se rechazan preventivamente al validar rutas y también se detectan sobre recorridos al resolver mordidas. Una espera no garantiza supervivencia: todavía puede terminar en nodo zombie o zona de horda.

## 5. Identidad, versiones y consistencia de snapshots

| Identificador | Semántica actual |
|---|---|
| `gameId` | Identidad de partida compartida por mundo, routing y publicación. El runtime impide reutilizar IDs ya usados durante su vida en RAM. |
| `roundId` | Configuración 1, 2 o 3; pertenece al mundo y snapshot público, no al DTO de routing. |
| `WorldState.turnId` | Último turno comprometido; inicial `0`. `activeTurnId` solo existe en la copia de trabajo. |
| `WorldState.worldVersion` | Contador comprometido del simulador; aumenta una vez por turno cerrado, incluso si todos esperan por fallo de sync. |
| `world.routing.confirmed` | Última instalación confirmada en routing, con su propio turno y versión. |
| `SyncResponse.worldVersion` | Base instalada más uno por instalación nueva; repetir payload idéntico no vuelve a incrementar. Puede diferir de la versión pública. |

Por ejemplo conceptual, si el turno 2 no se instala y el mundo lo compromete esperando, el simulador puede estar en versión 2 y routing en versión 1. El turno 3 puede sincronizar con base 1 e instalar versión 2; sus `/paso` usan turno 3 y versión 2, mientras el commit público termina en turno 3 y versión 3. No usar la versión pública como base por coincidencia accidental.

Routing permite saltos hacia turnos posteriores con base estricta; mismo turno y mismo digest es idempotente, y un payload diferente para ese turno produce 409. Esto está recogido en SPEC §3.3 y `RouteEngine.sync()`.

El estado de trabajo nunca se publica: el coordinador conserva la referencia anterior hasta el intercambio final; `createWorldSnapshot()` copia campos explícitos y congela profundamente el resultado. `publishCommitted()` actualiza el snapshot de HTTP antes de avisar a WS. Un fallo de un suscriptor no revierte el commit.

### Pausa y reanudación

Una pausa durante un turno se hace efectiva al cerrarlo. Entre ticks cambia `status` inmediatamente sin avanzar turno ni versión. Reanudar exige el mismo `gameId`, `roundId` y semilla y continúa desde `turnId + 1`, sin reiniciar entidades ni recuperar ticks antiguos. Inicio, pausa entre ticks y reanudación también producen snapshots completos con el mismo turno/versión y distinto estado; SPEC §§3.3–3.4 documenta esta excepción.

La aleatoriedad actual es `sha256-counter`, versión `1`, estrategia `per-zombie-turn-draw`, definida en `random.ts`: depende de semilla, zombie, turno y extracción, sin cursor global dependiente del orden de zombies. `SimulatorCheckpoint` existe como tipo; no hay restauración persistente implementada. No equiparar reanudar una instancia viva con recuperar el proceso después de reiniciar.

### Comparación HTTP/WS por el frontend

1. Comparar primero `gameId` y validar `graphVersion`; una partida nueva reinicia sus contadores. No renderizar sobre un grafo incompatible.
2. Dentro de una partida, descartar turnos/versiones anteriores y duplicados sin cambios. Aceptar cambios de `status` con igual turno/versión sin repetir movimientos o interpolación, conforme a SPEC §3.4 y §6.
3. Comparar el cuerpo de `GET /estado` con `TURN_UPDATE.world`, no con la envoltura ni `emittedAt`. Para la misma publicación corresponden identidad, turno, versión y contenido.
4. Tener en cuenta la carrera de red: un GET posterior puede contener un commit más reciente que un evento WS en cola. Igual turno/versión tampoco implica igual `status` si hubo un control entre ambas lecturas.
5. Al reconectar, recuperar por GET; el hub además envía su última publicación al conectar WS. Su contador `revision` evita retrocesos de entrega dentro del hub, pero es interno y no forma parte del DTO público.

## 6. Manejo de fallos y timeouts

### Sincronización incierta

`markRoutingSyncAttempt()` guarda el payload antes del envío. Un timeout no demuestra que routing rechazó el snapshot. `reconcileRoutingStatus()` compara el resultado de `/motor/estado/{gameId}`:

- Instalación con turno del intento, versión base más uno y grafo esperado: confirma y permite usarla si pertenece al turno activo.
- Sin instalación cuando no había una confirmada, o motor todavía en la instalación anterior confirmada: limpia la incertidumbre y devuelve `retry-latest`. Tras el fallo del sync actual, el coordinador no repite ese POST en el mismo turno: todos esperan y se puede instalar el siguiente turno con la base confirmada. Si se está reconciliando un intento anterior al comienzo de fase, sí puede seguir con el nuevo payload actual.
- Identidad/grafo/versión inesperados, consulta fallida o respuesta inválida: no autoriza rutas; se solicita pausa `routing-sync-uncertain` al cerrar el turno.

Una respuesta inicial fallida que luego se reconcilia como instalación correcta del turno permite rutear. Un plan viejo nunca sustituye esa confirmación. El root configura 500 ms para cada operación de sync/status; no es el presupuesto total de la fase, que puede incluir varias operaciones.

### Otros fallos

| Situación | Comportamiento implementado |
|---|---|
| `/paso` tarda más de 500 ms, falla, no responde o devuelve movimiento inválido | El sobreviviente espera. La respuesta tardía no cambia el mundo después del cierre. |
| 401 en routing | Todos esperan; se solicita pausa `routing-unauthorized` y alerta crítica `ROUTING_UNAUTHORIZED`, emitida después del commit. |
| 400, 404, 409, 429 o 5xx en `/paso` | Se convierte en intento de error y espera; no hay reintento en el turno. La contabilización de telemetría sigue pendiente. |
| Deadline alcanzado o excedido | Comprometer el turno, incrementar `deadlineMisses` y pausar antes del siguiente; en turno 150 prevalece `completed`. |
| Excepción no controlada al coordinar | El runtime detiene el ciclo, solicita pausa sobre el último estado comprometido y reporta `SIMULATOR_TURN_FAILED`; no publica la copia parcial. Recuperación de una instalación externa ocurrida antes de esa excepción no está garantizada por una restauración transaccional. |
| Cliente WS lento o envío fallido | Se desconecta para recuperación por GET. Límite de mensaje/buffer de 1 MiB; cola de publicaciones limitada a ocho. Heartbeat cada 30 s. |
| Ronda o métricas iniciales ausentes | Inicio rechazado con `ROUND_NOT_CONFIGURED` o `TELEMETRY_NOT_CONFIGURED`; no se inventa escenario. |

### Brechas y contradicciones que requieren acuerdo o integración

| Tema | Evidencia e impacto |
|---|---|
| Duración exacta | SPEC §5.1 pide exactamente cinco minutos. `SimulationRuntime.launch()` inicia turno 1 inmediatamente y turno 150 a 298.000 ms; finaliza al comprometerlo sin esperar a 300.000 ms. `simulator-runtime.test.ts` fija ese comportamiento. Se debe alinear aceptación temporal y código/SPEC. |
| Telemetría | SPEC §§5.3–5.4 exige recálculo, ventana de 1.000 muestras y contadores. El coordinador solo incrementa `deadlineMisses`; las otras métricas proceden del estado inicial y no se recalculan allí. Igualdad HTTP/WS no demuestra exactitud de esas métricas. `RealtimeHub.clientCount` tampoco se conecta a `metrics.wsClients`. |
| Persistencia | SPEC §1.1 y §5.3 exige cola DynamoDB y recuperación pausada. No hay implementación ni conexión en el root. `SimulatorCheckpoint` es una forma tipada, no evidencia de recuperación funcional. |
| Workers/readiness | SPEC §1 exige workers reales y readiness integral. El motor actual calcula en el proceso con un worker lógico; `/health/ready` consulta `engine.isReady()`, sin acreditar escenarios, telemetría ni persistencia listos. |
| Reservas | El DTO compartido permite `reservados`, pero el coordinador y la admisión rechazan listas no vacías. La integración actual es Base sin reservas; no activar reservas desde otro módulo. |
| Escenarios | `backend/src/config/` solo contiene `.gitkeep`. `ScenarioOptions` permite inyectar rondas y métricas; `startBackendServer()` no aporta escenarios oficiales. Las fixtures no son configuración de producción. |
| Documentación de ownership | El README de Maykel todavía menciona `app.ts` y le atribuye telemetría; el root real es `server.ts` y el README modular atribuye telemetría a Michael. El README de Michael aún dice que falta conectar el game loop, aunque el root ya lo conecta. Usar las fronteras documentadas aquí y coordinar la actualización de esas guías. |
| Proyección OpenAPI | `PasoRequest.worldVersion` tiene mínimo 1 en SPEC, pero `validatePasoRequest()` acepta 0. El flujo normal usa una instalación de versión al menos 1; la discrepancia de validación permanece. |

Los tres problemas anteriores de integración ya tienen solución representada en este commit: `RouteZombieTraversal` conserva ambos pasos del corredor; sync permite saltos y tiene endpoint de reconciliación; `SyncResponse` y el esquema cerrado del SPEC incluyen `graphVersion` y `buildLatencyMs`. No deben registrarse como contratos todavía inexistentes.

## 7. Guía breve para integrar cambios sin romper las fronteras

1. Revisar SPEC y DTOs existentes antes de crear tipos. Cambios compartidos se coordinan con Michael y actualizan especificación, validadores y consumidores conjuntamente; no mantener copias divergentes de entidades.
2. Mantener las reglas y el único escritor dentro de simulator. Consumir routing por `RoutingClient`; montar plugins en `backend/src/server.ts`. El frontend solo representa snapshots y solicita controles por el mecanismo autorizado.
3. Conservar los esquemas cerrados y validar respuestas runtime. No sustituir `zombieTraversals` por transiciones resumidas ni usar versiones públicas en `/paso` cuando difieren de las instaladas.
4. No publicar `WorldState` ni fases activas. Usar `createWorldSnapshot()` y la suscripción de commits; los consumidores no deben realizar I/O bloqueante en el callback.
5. Suministrar escenarios aprobados mediante la integración del root y `ScenarioOptions`. Validar `RoundConfig` con `validateRoundConfig()`. No importar `tests/fixtures/` desde backend ni inferir spawns del grafo.
6. Añadir verificaciones de comportamiento en las suites del área afectada. Para integración, comprobar cruces de ambos pasos, sync perdida/ausente, versiones divergentes, pausa con igual turno/versión, snapshots sin fases parciales y capacidad de refugios.
7. Coordinar métricas y persistencia con sus responsables antes de declarar aceptación completa. Las pruebas aceleradas no prueban cinco minutos de cadencia real ni sustituyen mediciones con escenarios aprobados.

## 8. Referencias y alcance de la comprobación

Las rutas en texto son relativas a la raíz del repositorio. Los enlaces siguientes se resuelven desde este documento.

### Fuentes normativas y ownership consultados

- [SPEC.md](../../SPEC.md): §§1.1–1.3 arquitectura/persistencia; §2.2 modelos; §§3.1–3.4 HTTP/WS; §4.1 peligros y sincronización; §§5.1–5.4 rondas, fases y latencia; §6 frontend; §7 aceptación.
- [Ownership modular](../../backend/src/modules/README.md).
- Guías de [Maykel](maykel/README.md), [Michael](michael/README.md) y [Kristhian](kristhian/README.md).

### Código consultado

- [Composition root](../../backend/src/server.ts).
- [Tipos de grafo](../../backend/src/contracts/types.ts), [DTOs de routing](../../backend/src/contracts/routing.ts), [validadores compartidos](../../backend/src/contracts/routing-validation.ts).
- [Motor](../../backend/src/modules/routing/route-engine.ts) y [plugin HTTP de routing](../../backend/src/modules/routing/http-server.ts).
- Simulador: [types.ts](../../backend/src/modules/simulator/types.ts), [turn-coordinator.ts](../../backend/src/modules/simulator/turn-coordinator.ts), [simulation-runtime.ts](../../backend/src/modules/simulator/simulation-runtime.ts), [world-state.ts](../../backend/src/modules/simulator/world-state.ts), [world-snapshot.ts](../../backend/src/modules/simulator/world-snapshot.ts).
- Integración de rutas: [routing-client.ts](../../backend/src/modules/simulator/routing-client.ts), [routing-world.ts](../../backend/src/modules/simulator/routing-world.ts), [routing-sync.ts](../../backend/src/modules/simulator/routing-sync.ts), [routing-responses.ts](../../backend/src/modules/simulator/routing-responses.ts).
- Reglas y controles: [survivor-resolution.ts](../../backend/src/modules/simulator/survivor-resolution.ts), [city-events.ts](../../backend/src/modules/simulator/city-events.ts), [zombies.ts](../../backend/src/modules/simulator/zombies.ts), [random.ts](../../backend/src/modules/simulator/random.ts), [http-plugin.ts](../../backend/src/modules/simulator/http-plugin.ts).
- Realtime: [realtime-hub.ts](../../backend/src/modules/realtime/realtime-hub.ts), [http-plugin.ts](../../backend/src/modules/realtime/http-plugin.ts).

### Pruebas revisadas como evidencia de comportamiento esperado

| Archivo | Aspectos que documenta |
|---|---|
| [simulator-routing-sync.test.ts](../../tests/simulator-routing-sync.test.ts) | Confirmación exacta, consulta tras timeout, salto de turno, pausa por versión/grafo inesperados y 401. |
| [simulator-runtime.test.ts](../../tests/simulator-runtime.test.ts) | 150 turnos, ticks 0..298000, ausencia de deriva, deadline, pausa y reanudación con identidad conservada. |
| [realtime.test.ts](../../tests/realtime.test.ts) | GET antes de partida, igualdad HTTP/WS, ausencia de fases parciales, controles con igual versión y reconexión. |
| [simulator-integrated.test.ts](../../tests/simulator-integrated.test.ts) | Integración HTTP/WS con escenarios sintéticos y reloj acelerado; no aceptación temporal oficial. |
| [fixtures/integrated-scenario.ts](../../tests/fixtures/integrated-scenario.ts) | Datos explícitamente sintéticos para pruebas, sin aprobación como escenarios oficiales. |

También se inventariaron las suites `routing.test.ts`, `simulator-turn.test.ts`, `simulator-survivors.test.ts`, `simulator-state.test.ts`, `simulator-zombies.test.ts`, `simulator-events.test.ts` y `simulator-http-failures.test.ts`. La comprobación de esta tarea es documental; no se afirma que estas pruebas se hayan ejecutado ni pasado durante esta revisión. Las discrepancias no resueltas se registran en la sección 6.
