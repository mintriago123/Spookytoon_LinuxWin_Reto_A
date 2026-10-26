# SpookyThon 2026 — Escape de Manta Zombie

Proyecto Track A con backend de baja latencia, simulación por turnos y mapa en vivo.

## Estado

El contrato técnico y el scaffold modular están preparados. La implementación, pruebas de carga, despliegue AWS, captura de Budget y URL pública aún deben completarse. No se deben presentar estimaciones ni capturas ficticias como evidencia.

## Arquitectura

Un único Backend Fastify por partida mantiene grafo y estado en memoria. Los módulos graph/routing de Michael y simulator/realtime de Maykel se ensamblan en el mismo proceso; el Simulador usa el endpoint interno POST /paso. Routing precalcula el mejor siguiente nodo una vez por worldVersion. DynamoDB recibe snapshots asíncronos. El Frontend estático usa Leaflet, GET /estado y WebSocket.

```mermaid
flowchart LR
  UI[React + Leaflet<br/>S3 + CloudFront] -->|HTTPS GET /estado<br/>WSS /ws| ALB[ALB HTTPS/WSS]
  ALB --> API[Fastify<br/>una tarea ECS por partida]
  API --> SIM[Simulator<br/>estado autoritativo]
  SIM -->|POST /motor/sincronizar<br/>POST /paso por loopback| ROUTE[Routing<br/>plan O(1) por worldVersion]
  GRAPH[Graph inmutable<br/>RAM] --> ROUTE
  ROUTE --> WORKERS[Route workers]
  SIM -->|snapshot comprometido| WS[WebSocket TURN_UPDATE]
  WS --> ALB
  SIM -. escritura asíncrona .-> DDB[(DynamoDB On-Demand)]
```

## Documentación

- [SPEC.md](SPEC.md): fuente técnica canónica.
- [Checklist de lanzamiento](docs/launch-checklist.md): prioridades, aceptación y evidencias pendientes.
- [Costos AWS](docs/costos.md): plantilla para estimar región y configuración reales.
- [Módulos Backend](backend/src/modules/README.md): límites y ownership.
- [Michael](docs/team/michael/README.md), [Maykel](docs/team/maykel/README.md), [Kristhian](docs/team/kristhian/README.md): guías por persona.
- [Extracción del grafo](scripts/README.md).

No hay aún comandos de ejecución local: se agregarán con los manifests del Backend y Frontend para no documentar scripts inexistentes.
