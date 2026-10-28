# Michael — Fullstack, Infra y Core

## Responsabilidad

Dueño del grafo de Manta, el contrato del motor de rutas, la infraestructura AWS y la observabilidad. La especificación normativa está en [SPEC.md](../../../SPEC.md), especialmente las secciones 1–4 y los criterios de Dev 1 en la sección 7.

## Directorios a cargo

| Área | Ubicación |
|---|---|
| Extracción y normalización OSM | [scripts/](../../../scripts/README.md) |
| Grafo desplegable | **backend/data/** y **frontend/public/data/** |
| Carga, validación y adyacencia | **backend/src/modules/graph/** |
| Rutas, amenazas y workers | **backend/src/modules/routing/** |
| Contratos y validadores runtime | **backend/src/contracts/** |
| AWS y alarmas | **infra/** |
| OpenAPI generado | **backend/openapi/** |

## Entregables

1. Extraer y revisar el grafo peatonal con IDs estables, aristas en ambos sentidos y segmentos que agrupen el par.
2. Validar zonas, coordenadas, factores, conexiones y los cuatro refugios con capacidades configuradas.
3. Implementar el precompute Dijkstra inverso en cada sync, penalizaciones Base, tabla bestMoveByNode O(1), autenticación x-api-key y fallback seguro al nodo actual.
4. Implementar POST /motor/sincronizar para instalar atómicamente el snapshot y plan precomputado en los workers.
5. Desplegar un escritor de partida en EC2 con Caddy y PM2/Docker en Ohio, persistir snapshots de forma asíncrona y publicar métricas/alertas.

## Integración con el equipo

- A Maykel: documentar y mantener estables los schemas de sincronización y paso. El simulador es la autoridad final y debe validar cada movimiento.
- A Kristhian: compartir el mismo graphVersion y artefacto. Los contratos de frontend se derivan de SPEC.md; no exponer la API key en el navegador.
- Si cambia un payload, una regla de ruta o el esquema del grafo, actualizar SPEC.md antes de cambiar sus proyecciones.

## Aceptación antes de integrar

- El grafo pasa validación semántica y ambas copias tienen el mismo graphVersion y SHA-256.
- El motor precomputa una vez por worldVersion; POST /paso es lookup O(1) y nunca recomienda arista cerrada/no adyacente, zona de horda ni cruce frontal.
- Una solicitud válida con fallo de cálculo responde espera en el mismo nodo; no genera nextNode inválido.
- La carga de 200 llamadas concurrentes cumple p95 ≤150 ms; el cliente cancela cada llamada a los 500 ms.
- Readiness permanece false hasta que grafo y workers estén listos.
- API keys y snapshots completos no aparecen en frontend ni logs.
- La región confirmada para despliegue y costos es `us-east-2` (Ohio), conforme a la SCP; EC2 está en `us-east-2a` y la tabla activa es `spookython-manta-state`.

## Datos pendientes

Las capacidades y coordenadas de refugios deben venir del grafo revisado. Las cantidades y posiciones iniciales de zombies/sobrevivientes deben venir de la configuración de ronda; no inventarlas en el motor. El backend ahora incluye presets generados en `backend/src/config/round-presets.ts`, pero sus valores requieren confirmación del equipo antes de llamarlos escenarios oficiales.

## Motor Base local

El módulo `backend/src/modules/routing/` implementa el plan de rutas por
snapshot, las APIs `POST /motor/sincronizar` y `POST /paso`, autenticación
`x-api-key`, bloqueos, amenazas y planes para cupos reservados. El composition
root en `backend/src/server.ts` conecta routing con el game loop del simulador
por HTTP loopback. Las pruebas cubren el flujo y el despliegue integrado está en EC2. Los
escenarios siguen siendo presets versionados de simulación; no se presentan
como datos censales ni ubicaciones oficiales sin aprobación del equipo.

## Entrega modular de infraestructura y core

Implementados: pool real de precompute en worker_threads (sin IPC por /paso),
readiness previo a una partida, OpenAPI 3.1 completo y probado contra DTO real,
DynamoDB con cola/reintentos/fragmentos y recuperación pausada. Infra reproducible
en `infra/`: Caddy, PM2, deploy/rollback, política IAM y CloudWatch. Dockerfile en
`backend/`. Costos con tarifas Ohio y evidencia Budget en `docs/costos.md`.
La implementación no sustituye desplegarla y medir 150 turnos en EC2. No se
modifican el algoritmo de reloj ni los fixtures temporales de Maykel.

## Cierre integrado

Frontend y backend publicados en https://3-128-78-190.sslip.io.
Despliegue conjunto y rollback reproducibles, artefactos por commit/SHA-256,
CloudWatch Agent y cuatro alarmas SNS operativas. EBS medido: 8 GiB gp3.
Billing y destinatarios del Budget no son legibles por el role EC2; se
documentaron las consultas y permisos de operador, sin ampliar el role.
Resultados y límites de la aceptación en
[la evidencia de cierre](../../evidence/cierre-prueba-2026-10-28/README.md).
