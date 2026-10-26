# Backend modular

El Backend es un solo monolito modular: un proceso Fastify, un estado autoritativo en RAM y una tarea ECS por partida. Los módulos separan responsabilidades y ownership; no son servicios ni despliegues independientes.

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

1. **app.ts** es el composition root: instancia y conecta módulos; ningún módulo crea otro servidor Fastify.
2. **contracts/** contiene DTOs y validadores compartidos. Todos los módulos dependen de estos tipos públicos y de SPEC.md.
3. **graph** expone datos inmutables. **routing** mantiene su snapshot de lectura y nunca muta WorldState.
4. **simulator** es el único dueño de la escritura de WorldState. Invoca POST /motor/sincronizar y POST /paso por loopback con los contratos HTTP definidos; valida el resultado antes de aplicar un movimiento.
5. **persistence** y **realtime** reciben snapshots ya comprometidos. No escriben de vuelta al simulador ni retrasan el loop por I/O.
6. No importar archivos internos de otro módulo. Las integraciones pasan por su interfaz pública, contrato HTTP o snapshot tipado.

## Secuencia de integración

- Michael entrega graph, contracts y el módulo routing con sync de versión.
- Maykel conecta game-loop a los endpoints internos, mantiene WorldState y publica el snapshot al cierre.
- Michael habilita persistencia y métricas; Maykel conecta realtime al commit.
- Kristhian consume GET /estado y WSS /ws sin depender de imports del Backend.

Si una regla cambia, actualizar primero SPEC.md, luego contratos y finalmente módulos consumidores. Mantener el despliegue único y el escritor único por partida.
