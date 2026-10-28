# Backend modular

El backend es un monolito modular: un proceso Fastify integra módulos con límites y responsables claros. No son servicios desplegados por separado. El composition root `backend/src/server.ts` carga el grafo y los presets, inicializa routing, workers y persistencia, y registra simulator y realtime.

## Módulos y ownership

| Módulo | Responsable principal | Responsabilidad |
|---|---|---|
| graph | Michael | Carga y validación del grafo inmutable y su adyacencia. |
| routing | Michael | Contratos del motor, sincronización de mundo, cálculo de planes y respuesta a `/paso`. |
| simulator | Maykel | Único escritor de `WorldState`; reloj, eventos, zombies, sobrevivientes, colisiones y admisiones. |
| telemetry | Michael | Métricas de rutas y turnos. El simulador integra las métricas del turno. |
| persistence | Michael | Cola asíncrona, snapshots comprometidos en DynamoDB y recuperación de una partida pausada. |
| realtime | Maykel | Proyección y publicación de snapshots comprometidos por `GET /estado` y WebSocket. |
| frontend | Kristhian | Cliente React, mapa, controles y representación de snapshots; vive fuera de `backend/src/modules/`. |

## Límites de dependencia

1. `backend/src/server.ts` verifica el grafo, crea los presets, workers, motor, persistencia y runtime, y registra los plugins en el servidor Fastify común.
2. `backend/src/contracts/` contiene los DTOs y validadores compartidos. Las reglas normativas están en `SPEC.md`.
3. `graph` expone datos inmutables; `routing` mantiene su snapshot de lectura y nunca muta `WorldState`.
4. `routing` calcula planes generales y por refugio durante la sincronización. Los workers realizan el precompute; el plan instalado queda disponible para consultas locales de `/paso`.
5. `simulator` es el único dueño de las mutaciones del mundo. Valida las respuestas de routing antes de aplicar movimientos y compromete el estado al cerrar cada turno.
6. `persistence` y `realtime` reciben snapshots comprometidos. La cola de persistencia y la publicación no escriben de vuelta al simulador.
7. No importar archivos internos de otro módulo. Integrar mediante interfaces públicas, contratos o snapshots tipados.

## Flujo de integración

`city-events → zombie-move → routing sync → survivor-move → resolve → commit → persistence/realtime`

El sincronizador comparte a routing una vista validada del mundo. Si el turno no obtiene una instalación confirmada, el simulador no usa planes anteriores. Tras el commit, la misma proyección pública alimenta HTTP y WebSocket; la persistencia asíncrona guarda checkpoints para recuperación pausada.

Las reglas compartidas deben actualizarse en este orden: `SPEC.md`, contratos/OpenAPI, módulos consumidores y pruebas. Cada etapa debe conservar los límites de ownership y tener su propio commit.

## Operación y verificación

Configurar `ROUTE_API_KEY` según `backend/.env.example`. El servidor ejecutable, los endpoints y los checks están documentados en [README raíz](../../../README.md), [SPEC](../../../SPEC.md) y [guía operativa](../../../docs/operacion-rollback.md). El backend tiene pruebas para routing, workers, persistencia, integración del simulador y publicación realtime; la aceptación de AWS requiere ejecutar el procedimiento desplegado y conservar su evidencia.
