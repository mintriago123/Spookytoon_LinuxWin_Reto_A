# Backend modular

El Backend es un solo monolito modular: un proceso Fastify, un estado autoritativo en RAM y una tarea ECS por partida. Los módulos separan responsabilidades y ownership; no son servicios ni despliegues independientes. `routingPlugin` registra `/motor/sincronizar`, `/motor/estado/:gameId`, `/paso` y health en el composition root compartido.

## Módulos y ownership

| Módulo | Responsable principal | Responsabilidad | Estado integrado |
|---|---|---|---|
| graph | Michael | Carga del artefacto inmutable, validación y adyacencia | Implementado; grafo real publicado |
| routing | Michael | POST /paso, sincronización de snapshot y pool de workers | Implementado |
| simulator | Maykel | Único escritor de WorldState, reloj, zombies, sobrevivientes y mordidas | Rondas R1/R2/R3 cableadas |
| telemetry | Michael | Ventana p95, métricas del motor y del turno | Implementado |
| persistence | Michael | Cola asíncrona, snapshots DynamoDB y recuperación pausada | Implementado localmente; AWS requiere despliegue para verificar |
| realtime | Maykel | Publicar TURN_UPDATE después del commit del simulador | Implementado |

Los presets están en `backend/src/config/round-presets.ts` y se validan contra
el grafo de Manta. La integración local no acredita por sí misma el estado del
backend desplegado ni escrituras en AWS.

## Límites de dependencia

1. **backend/src/server.ts** verifica el manifiesto, carga el grafo y los tres presets de ronda, crea RouteEngine y SimulationRuntime y registra routing, simulador y realtime en el servidor Fastify común.
2. **contracts/** contiene DTOs y validadores compartidos. Todos los módulos dependen de estos tipos públicos y de SPEC.md.
3. **graph** expone datos inmutables. **routing** mantiene su snapshot de lectura y nunca muta WorldState.
4. **routing** calcula el plan Base por worldVersion y planes por refugio cuando hay reservas, siempre durante sync. Un pool de `worker_threads` precomputa y publica tablas inmutables en RAM; cada POST /paso consulta su tabla en O(1).
5. **simulator** es el único dueño de la escritura de WorldState. Invoca POST /motor/sincronizar y POST /paso por loopback con los contratos HTTP definidos; valida el resultado antes de aplicar un movimiento. Una respuesta 401 activa `pauseCause=routing-unauthorized` y `alertCode=ROUTING_UNAUTHORIZED`; `applyRoutingFailureSignal` programa la pausa y devuelve el evento crítico que el coordinador debe publicar.
6. **persistence** y **realtime** reciben snapshots ya comprometidos. No escriben de vuelta al simulador ni retrasan el loop por I/O.
7. No importar archivos internos de otro módulo. Las integraciones pasan por su interfaz pública, contrato HTTP o snapshot tipado.

## Integración actual

- Graph/contracts/routing, simulador y realtime están ensamblados en `server.ts`; los presets se validan contra el grafo de Manta.
- Telemetría actualiza contadores y porcentajes de entidades, ventana de 1.000 solicitudes, disponibilidad y eficiencia al cerrar cada turno. El DTO público conserva compatibilidad con los campos existentes.
- Persistencia DynamoDB escribe snapshots de forma asíncrona y permite recuperar partidas pausadas; la cola no bloquea el loop.
- Los consumidores reciben GET /estado y WS /ws; CORS y orígenes WS comparten configuración. La guía operativa y los indicadores están en [backend/README.md](../../README.md).

Si una regla cambia, actualizar primero SPEC.md, luego contratos y finalmente módulos consumidores. Mantener el despliegue único y el escritor único por partida.

## Motor Base ejecutable

Configurar `ROUTE_API_KEY` (mínimo 16 caracteres) y ejecutar `npm run backend:start`.
Para EC2 o ECS, definir `HOST=0.0.0.0`; en local escucha `127.0.0.1`. `/health/ready`
verifica grafo, workers y persistencia; no requiere una partida activa. `GET /motor/estado/:gameId`
permite reconciliar una sincronización incierta; repetir el mismo payload es
idempotente, `baseWorldVersion` sigue siendo estricta y los `turnId` pueden
avanzar con saltos después de turnos sin plan confirmado. `simulator/routing-sync.ts`
conserva el payload incierto y reconcilia el estado antes de volver a rutear. Las
llegadas y la mutación de WorldState siguen perteneciendo al simulador.

`POST /simulador/iniciar` dispone de presets R1/R2/R3 en la configuración integrada.
