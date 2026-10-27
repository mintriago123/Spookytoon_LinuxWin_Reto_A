# SpookyThon 2026 — Escape de Manta Zombie

Proyecto Track A con backend de baja latencia, simulación por turnos y mapa en vivo.

## Estado

El grafo peatonal y el módulo Base de rutas están implementados. El módulo expone `POST /motor/sincronizar`, `POST /paso` y health checks HTTP; las rutas usan snapshots en RAM y autenticación `x-api-key`. La integración con el game loop, persistencia, despliegue AWS, captura de Budget y URL pública siguen pendientes. No se deben presentar estimaciones ni capturas ficticias como evidencia.

## Arquitectura

Un único proceso Backend por partida mantiene grafo y estado en memoria. Los módulos graph/routing de Michael y simulator/realtime de Maykel se ensamblan en el mismo proceso; el Simulador usa el endpoint interno POST /paso. Routing precalcula el mejor siguiente nodo una vez por worldVersion. DynamoDB recibe snapshots asíncronos. El Frontend estático usa Leaflet, GET /estado y WebSocket.

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
- [Refugios provisionales](docs/refugios-provisionales.md): sitios del escenario aceptados y alternativas con mejor potencial de defensa.
- [Módulos Backend](backend/src/modules/README.md): límites y ownership.
- [Michael](docs/team/michael/README.md), [Maykel](docs/team/maykel/README.md), [Kristhian](docs/team/kristhian/README.md): guías por persona.
- [Extracción del grafo](scripts/README.md).

Requiere Node.js 24.12+ de la serie 24. Ejecutar `npm ci`, `npm test` y
`npm run typecheck` para verificar. Los comandos del motor son:

```bash
ROUTE_API_KEY='use-a-secret-of-at-least-16-characters' npm run backend:start
npm run benchmark:routing
```

`/health/ready` permanece no listo hasta la primera sincronización del motor.
