# Backend modular

El Backend es un solo monolito modular: un proceso HTTP, un estado autoritativo en RAM y una tarea ECS por partida. Los módulos separan responsabilidades y ownership; no son servicios ni despliegues independientes. El módulo routing expone handlers HTTP nativos de Node para `/motor/sincronizar`, `/paso` y health; se puede montar detrás del composition root del servidor.

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

1. **server.ts** es el composition root ejecutable del motor actual: verifica manifiesto, carga graph y routing y expone el HTTP de loopback. Al integrar el servidor completo, el composition root compartirá estas instancias sin duplicar el estado.
2. **contracts/** contiene DTOs y validadores compartidos. Todos los módulos dependen de estos tipos públicos y de SPEC.md.
3. **graph** expone datos inmutables. **routing** mantiene su snapshot de lectura y nunca muta WorldState.
4. **routing** calcula Dijkstra inverso una vez por worldVersion y publica un plan inmutable en RAM. La implementación actual corre con un worker lógico; cada POST /paso consulta bestMoveByNode en O(1).
5. **simulator** es el único dueño de la escritura de WorldState. Invoca POST /motor/sincronizar y POST /paso por loopback con los contratos HTTP definidos; valida el resultado antes de aplicar un movimiento.
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
responde 503 hasta instalar el primer snapshot. El módulo valida payloads
cerrados según `SPEC.md`, rechaza versiones stale y mantiene por `gameId` el
último snapshot completo y su plan. Las llegadas y la mutación de WorldState
siguen perteneciendo al simulador.
