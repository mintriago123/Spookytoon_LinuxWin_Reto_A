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
| AWS y alarmas | **backend/infra/** |
| OpenAPI generado | **backend/openapi/** |

## Entregables

1. Extraer y revisar el grafo peatonal con IDs estables, aristas en ambos sentidos y segmentos que agrupen el par.
2. Validar zonas, coordenadas, factores, conexiones y los cuatro refugios con capacidades configuradas.
3. Implementar el precompute Dijkstra inverso en cada sync, penalizaciones Base, tabla bestMoveByNode O(1), autenticación x-api-key y fallback seguro al nodo actual.
4. Implementar POST /motor/sincronizar para instalar atómicamente el snapshot y plan precomputado en los workers.
5. Desplegar un escritor de partida en ECS Fargate en la región seleccionada por AWS_REGION, persistir snapshots de forma asíncrona y publicar métricas/alertas.

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
- La región se confirma antes del despliegue y se usa también en el cálculo de costos; us-east-1 es solo el valor inicial sugerido.

## Datos pendientes

Las capacidades y coordenadas de refugios deben venir del grafo revisado. Las cantidades y posiciones iniciales de zombies/sobrevivientes deben venir de la configuración de ronda; no inventarlas en el motor.

## Motor Base local

El módulo `backend/src/modules/routing/` ya implementa el plan de rutas por
snapshot, la API `POST /motor/sincronizar` y `POST /paso`, autenticación
`x-api-key`, bloqueos, amenazas y control de cupos disponibles. `npm test` cubre
contratos y decisiones; `npm run benchmark:routing` mide 200 llamadas
concurrentes. Falta conectar estos endpoints al game loop del simulador.
