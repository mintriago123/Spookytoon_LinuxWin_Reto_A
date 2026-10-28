# Backend modular

El backend es un monolito modular: un proceso Fastify integra módulos con límites y responsables claros; no son servicios desplegados por separado. El composition root `backend/src/server.ts` carga el grafo y los presets, inicializa routing, workers y persistencia, y registra simulator y realtime.

## Módulos y ownership

| Módulo | Responsable principal | Responsabilidad | Estado integrado |
|---|---|---|---|
| graph | Michael | Carga y validación del grafo inmutable y su adyacencia | Implementado; grafo publicado |
| routing | Michael | Contratos del motor, sincronización del mundo, cálculo de planes y respuesta a `/paso` | Implementado con pool de workers |
| simulator | Maykel | Único escritor de `WorldState`; reloj, eventos, zombies, sobrevivientes, colisiones y admisiones | Rondas R1/R2/R3 integradas |
| telemetry | Michael | Métricas del motor y del turno | Integrado |
| persistence | Michael | Cola asíncrona, snapshots comprometidos en DynamoDB y recuperación pausada | Implementado localmente; falta validar esta versión en AWS |
| realtime | Maykel | Proyección y publicación de snapshots comprometidos por `GET /estado` y WebSocket | Integrado |
| frontend | Kristhian | Cliente React, mapa, controles y representación de snapshots; vive fuera de `backend/src/modules/` | Integrado en `frontend/` |

Los presets están en `backend/src/config/round-presets.ts` y se validan contra el grafo de Manta. La integración local no acredita por sí misma el estado desplegado ni las escrituras en AWS.

## Límites de dependencia

1. `backend/src/server.ts` verifica el grafo, crea presets, workers, motor, persistencia y runtime, y registra los plugins en el servidor Fastify común.
2. `backend/src/contracts/` contiene los DTOs y validadores compartidos. Las reglas normativas están en `SPEC.md`.
3. `graph` expone datos inmutables; `routing` mantiene su snapshot de lectura y nunca muta `WorldState`.
4. `routing` calcula planes generales y por refugio durante la sincronización. Los workers realizan el precompute; los planes instalados quedan disponibles para consultas locales de `/paso`.
5. `simulator` es el único dueño de las mutaciones del mundo. Invoca routing mediante los contratos HTTP, valida sus respuestas y compromete el estado al cerrar cada turno. Una respuesta 401 provoca la pausa y alerta de routing no autorizado.
6. `persistence` y `realtime` reciben snapshots comprometidos. La cola de persistencia y la publicación no escriben de vuelta al simulador ni bloquean el ciclo de turnos por I/O.
7. No importar archivos internos de otro módulo. Integrar mediante interfaces públicas, contratos o snapshots tipados.

## Flujo de integración

`city-events → zombie-move → routing sync → survivor-move → resolve → commit → persistence/realtime`

El sincronizador comparte con routing una vista validada del mundo. Si la instalación del turno actual no se confirma, el simulador no usa planes anteriores. Si el resultado de una sincronización queda incierto, `simulator/routing-sync.ts` consulta `GET /motor/estado/:gameId` y reconcilia el payload antes de volver a rutear. El endpoint de estado permite resolver el resultado de una solicitud perdida; repetir un mismo payload es idempotente y `baseWorldVersion` mantiene su validación estricta. Tras el commit, la misma proyección pública alimenta HTTP y WebSocket; la persistencia asíncrona guarda checkpoints.

Las reglas compartidas deben actualizarse en este orden: `SPEC.md`, contratos/OpenAPI, módulos consumidores y pruebas. Cada etapa debe conservar los límites de ownership y tener su propio commit.

## Operación y verificación

Configurar `ROUTE_API_KEY` (mínimo 16 caracteres) según `backend/.env.example`. Para EC2 o ECS, definir `HOST=0.0.0.0`; en local se escucha en `127.0.0.1`. `/health/ready` comprueba grafo, workers y persistencia inicializados; no requiere partida activa. `POST /simulador/iniciar` dispone de presets R1/R2/R3.

El servidor ejecutable, los endpoints y los checks están documentados en [README raíz](../../../README.md), [SPEC](../../../SPEC.md) y [guía operativa](../../../docs/operacion-rollback.md). La aceptación de AWS requiere ejecutar el procedimiento desplegado y conservar evidencia.
