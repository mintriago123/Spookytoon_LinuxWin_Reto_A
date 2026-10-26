# Michael — Fullstack, Infra y Core

## Responsabilidad

Dueño del grafo de Manta, el contrato del motor de rutas, la infraestructura AWS y la observabilidad. La especificación normativa está en [SPEC.md](../../../SPEC.md), especialmente las secciones 1–4 y los criterios de Dev 1 en la sección 7.

## Directorios a cargo

| Área | Ubicación |
|---|---|
| Extracción y normalización OSM | [scripts/](../../../scripts/README.md) |
| Grafo desplegable | **backend/data/** y **frontend/public/data/** |
| Carga, validación y adyacencia | **backend/src/graph/** |
| Rutas, amenazas y workers | **backend/src/routing/** |
| Contratos y validadores runtime | **backend/src/contracts/** |
| AWS y alarmas | **backend/infra/** |
| OpenAPI generado | **backend/openapi/** |

## Entregables

1. Extraer y revisar el grafo con IDs estables, aristas dirigidas y segmentos que agrupen ambos sentidos.
2. Validar zonas, coordenadas, factores, conexiones y los cuatro refugios con capacidades configuradas.
3. Implementar POST /paso, autenticación x-api-key, Dijkstra multi-source, potenciales de peligro y respuesta segura de espera.
4. Implementar POST /motor/sincronizar para instalar el mismo snapshot en todos los workers.
5. Desplegar un escritor de partida en ECS Fargate en us-east-1, persistir snapshots de forma asíncrona y publicar métricas/alertas.

## Integración con el equipo

- A Maykel: documentar y mantener estables los schemas de sincronización y paso. El simulador es la autoridad final y debe validar cada movimiento.
- A Kristhian: compartir el mismo graphVersion y artefacto. Los contratos de frontend se derivan de SPEC.md; no exponer la API key en el navegador.
- Si cambia un payload, una regla de ruta o el esquema del grafo, actualizar SPEC.md antes de cambiar sus proyecciones.

## Aceptación antes de integrar

- El grafo pasa validación semántica y ambas copias tienen el mismo graphVersion y SHA-256.
- El motor nunca recomienda arista cerrada/no adyacente, zona de horda ni cruce frontal.
- La carga de 200 llamadas concurrentes cumple p95 ≤150 ms; el cliente cancela cada llamada a los 500 ms.
- Readiness permanece false hasta que grafo y workers estén listos.
- API keys y snapshots completos no aparecen en frontend ni logs.

## Datos pendientes

Las capacidades y coordenadas de refugios deben venir del grafo revisado. Las cantidades y posiciones iniciales de zombies/sobrevivientes deben venir de la configuración de ronda; no inventarlas en el motor.
