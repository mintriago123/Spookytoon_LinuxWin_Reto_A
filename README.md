# SpookyThon 2026 — Escape de Manta Zombie

Proyecto Track A con backend de baja latencia, simulación por turnos y mapa en vivo.

## Estado (rama `design`)

| Área | Estado |
|---|---|
| Grafo de Manta | Publicado y validado: 300 nodos, 736 aristas, un SCC, cuatro refugios alcanzables desde todo nodo. Mismo `graphVersion`/SHA-256 en `backend/data/` y `frontend/public/data/`. |
| Motor de rutas (graph/routing) | Implementado: Dijkstra inverso por `worldVersion`, `bestMoveByNode` O(1), `x-api-key`, fallback al nodo actual. |
| Simulador (game loop) | Integrado de punta a punta: `city-events → zombie-move → sync → routing → survivor-move → resolve → publish`, 150 turnos serializados, pausa/reanudación, cierres de segmento. |
| Realtime | `GET /estado` y `WSS /ws` publican el mismo snapshot tras cada commit. |
| Rondas reales (R1/R2/R3) y telemetría (p95, disponibilidad) | Implementadas y verificadas (12/12 tests backend propios), pero viven en la rama `feat/backend-rounds-metrics`, **todavía no mergeada a `design`**. Sin esa rama, `POST /simulador/iniciar` responde 503 porque no hay `RoundConfig` cableado. |
| Persistencia (DynamoDB) | Sin implementar en ninguna rama: `backend/src/modules/persistence/` solo tiene `.gitkeep`. |
| Frontend | Scaffold completo Vite + React + TypeScript + Tailwind + Leaflet: mapa en vivo, métricas, ocupación de refugios, controles de operador, leyenda colapsable, reconexión WS con backoff. 11/11 tests. |
| AWS (ECS/ALB/Budget) | Sin desplegar. Hay una captura real de AWS Budget (`docs/Budget.png`, zero-spend $1) pero `docs/costos.md` sigue sin conciliar (región, horas, configuración). |

No se deben presentar estimaciones ni capturas ficticias como evidencia.

## Arquitectura (objetivo; ver tabla de arriba para qué está desplegado hoy)

Un único proceso Backend por partida mantiene grafo y estado en memoria. Los módulos graph/routing de Michael y simulator/realtime de Maykel se ensamblan en el mismo proceso; el Simulador usa el endpoint interno POST /paso. Routing precalcula el mejor siguiente nodo una vez por worldVersion. DynamoDB recibe snapshots asíncronos (pendiente de implementar). El Frontend estático usa Leaflet, GET /estado y WebSocket.

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

## Ejecutar en local

Requiere Node.js 24.12+ de la serie 24. Si se clona en Windows, `core.autocrlf=true`
(default de Git) corrompe el checksum del grafo sin el `.gitattributes` del repo
— ya está commiteado, no hace falta ninguna acción extra, pero si un checkout
previo a ese fix sigue dando "El grafo no coincide con el manifiesto de build",
forzar un re-checkout de `backend/data/` y `frontend/public/data/`.

### Backend

```bash
npm ci
npm test
npm run typecheck
ROUTE_API_KEY='use-a-secret-of-at-least-16-characters' npm run backend:start
npm run benchmark:routing
```

`/health/ready` permanece no listo hasta la primera sincronización del motor.
Con `design` solo (sin la rama `feat/backend-rounds-metrics`), `POST
/simulador/iniciar` responde 503 `ROUND_NOT_CONFIGURED`: no hay rondas reales
cableadas todavía en este checkout.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env   # ajustar el puerto si el backend no usa 3001
npm run dev             # http://localhost:5173
npm test
npm run typecheck
npm run lint
npm run build
```

El Frontend carga el grafo estático desde `frontend/public/data/grafo_manta.json`
y funciona (mapa, leyenda, refugios) aunque el Backend no esté corriendo; sin
Backend, `ConnectionStatus` queda en "Reconectando…" y el panel de métricas
muestra "Sin datos del backend todavía".
