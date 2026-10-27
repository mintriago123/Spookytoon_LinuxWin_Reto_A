# Backend modular

El Backend es un solo monolito modular: un proceso Fastify, un estado autoritativo en RAM y una tarea ECS por partida. Los módulos separan responsabilidades y ownership; no son servicios ni despliegues independientes. `routingPlugin` registra `/motor/sincronizar`, `/motor/estado/:gameId`, `/paso` y health en el composition root compartido.

## Módulos y ownership

| Módulo | Responsable principal | Responsabilidad |
|---|---|---|
| graph | Michael | Carga del artefacto inmutable, validación y adyacencia |
| routing | Michael | POST /paso, sincronización de snapshot y workers de ruta |
| simulator | Maykel | Único escritor de WorldState, reloj, zombies, sobrevivientes y mordidas |
| telemetry | Michael | Ventana p95, métricas del motor y del turno |
| persistence | Michael | Cola asíncrona y snapshots DynamoDB |
| realtime | Maykel | Publicar TURN_UPDATE después del commit del simulador |

## Límites de dependencia

1. **backend/src/server.ts** es el composition root ejecutable: verifica manifiesto, carga el grafo, crea una instancia de RouteEngine y registra el plugin Fastify en el servidor común. El plugin del game loop debe registrarse en este mismo root y recibir las mismas instancias.
2. **contracts/** contiene DTOs y validadores compartidos. Todos los módulos dependen de estos tipos públicos y de SPEC.md.
3. **graph** expone datos inmutables. **routing** mantiene su snapshot de lectura y nunca muta WorldState.
4. **routing** calcula Dijkstra inverso una vez por worldVersion y publica un plan inmutable en RAM. La implementación actual corre con un worker lógico; cada POST /paso consulta bestMoveByNode en O(1).
5. **simulator** es el único dueño de la escritura de WorldState. Invoca POST /motor/sincronizar y POST /paso por loopback con los contratos HTTP definidos; valida el resultado antes de aplicar un movimiento. Una respuesta 401 activa `pauseCause=routing-unauthorized` y `alertCode=ROUTING_UNAUTHORIZED`; `applyRoutingFailureSignal` programa la pausa y devuelve el evento crítico que el coordinador debe publicar.
6. **persistence** y **realtime** reciben snapshots ya comprometidos. No escriben de vuelta al simulador ni retrasan el loop por I/O.
7. No importar archivos internos de otro módulo. Las integraciones pasan por su interfaz pública, contrato HTTP o snapshot tipado.

## Secuencia de integración

- Michael entrega graph, contracts y el módulo routing con sync de versión.
- Maykel conecta game-loop a los endpoints internos, mantiene WorldState y publica el snapshot al cierre.
- Michael habilita persistencia y métricas; Maykel conecta realtime al commit.
- Kristhian consume GET /estado y WSS /ws sin depender de imports del Backend.

Si una regla cambia, actualizar primero SPEC.md, luego contratos y finalmente módulos consumidores. Mantener el despliegue único y el escritor único por partida.

## Motor Base ejecutable

Configurar `ROUTE_API_KEY` (mínimo 16 caracteres) y ejecutar `npm run backend:start`.
Para ECS, definir `HOST=0.0.0.0`; en local escucha `127.0.0.1`. `/health/ready`
responde 503 hasta instalar el primer snapshot. `GET /motor/estado/:gameId`
permite reconciliar una sincronización incierta; repetir el mismo payload es
idempotente, `baseWorldVersion` sigue siendo estricta y los `turnId` pueden
avanzar con saltos después de turnos sin plan confirmado. `simulator/routing-sync.ts`
conserva el payload incierto y reconcilia el estado antes de volver a rutear. Las
llegadas y la mutación de WorldState siguen perteneciendo al simulador.
