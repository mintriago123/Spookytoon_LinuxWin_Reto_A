# SpookyThon 2026 — Escape de Manta Zombie

Proyecto Track A con backend de baja latencia, simulación por turnos y mapa en vivo.

## Estado (rama `design`)

| Área | Estado |
|---|---|
| Grafo de Manta | Publicado y validado: 300 nodos, 736 aristas, un SCC, cuatro refugios alcanzables desde todo nodo. Mismo `graphVersion`/SHA-256 en `backend/data/` y `frontend/public/data/`. |
| Motor de rutas (graph/routing) | Implementado: Dijkstra inverso por `worldVersion`, `bestMoveByNode` O(1), `x-api-key`, fallback al nodo actual. |
| Simulador (game loop) | Integrado de punta a punta: `city-events → zombie-move → sync → routing → survivor-move → resolve → publish`, 150 turnos serializados, pausa/reanudación, cierres de segmento. |
| Realtime | `GET /estado` y `WSS /ws` publican el mismo snapshot tras cada commit. |
| Ojos de Águila | Rebanada simulada implementada: detecciones temporales de zombies activos modifican rutas y se muestran en el mapa. Ubicaciones y coberturas son aproximadas; sin video ni conexión real. No desplegada. |
| Rondas reales (R1/R2/R3) y telemetría | Integradas desde `feat/backend-rounds-metrics`; las pruebas de backend se ejecutan en esta rama combinada. |
| Persistencia (DynamoDB) | Adaptador, cola asíncrona y recuperación pausada implementados. La release `a09f235` fue verificada con persistencia real en EC2; consultar la evidencia para distinguir esa versión de los cambios posteriores de esta rama. |
| Frontend | Scaffold completo Vite + React + TypeScript + Tailwind + Leaflet: mapa en vivo, métricas, ocupación de refugios, controles de operador, leyenda colapsable, reconexión WS con backoff. 11/11 tests. |
| AWS | El equipo reporta EC2 en Ohio, DynamoDB y CloudWatch/SNS operativos. La release backend `a09f235` tiene evidencia de despliegue; los cambios posteriores de `design`, incluido Ojos de Águila, no se han desplegado. La integración final reporta p95 máximos de 26,4 / 50,1 / 89,3 ms; R2 registró un deadline miss, por lo que el criterio conjunto de cero misses no se cumple. [Evidencia de integración](docs/evidence/integracion-2026-10-28/README.md) y [CloudWatch](docs/evidence/cloudwatch-2026-10-28/README.md). |

## Despliegue confirmado en EC2

Configuración comunicada por el equipo el 28 de octubre de 2026. La SCP de la organización permite operar en Ohio.

| Parámetro | Valor |
|---|---|
| Región AWS (`AWS_REGION`) | `us-east-2` — Ohio |
| Zona de disponibilidad de EC2 (`AWS_AVAILABILITY_ZONE`) | `us-east-2a` |
| Tabla DynamoDB (`DYNAMODB_TABLE_NAME`) | `spookython-manta-state` |
| Base pública HTTPS | `https://3-128-78-190.sslip.io` |
| Estado público | `https://3-128-78-190.sslip.io/estado` |
| Base pública WSS | `wss://3-128-78-190.sslip.io` |
| Canal WebSocket del backend | `wss://3-128-78-190.sslip.io/ws` |

DynamoDB es regional: usar `us-east-2` en el cliente AWS. `us-east-2a` corresponde a la instancia EC2 y no se debe utilizar como `AWS_REGION`. Estos datos describen el despliegue comunicado por el equipo; no verifican la versión integrada localmente.
Los ejemplos están en [backend/.env.example](backend/.env.example) e [infra/.env.example](infra/.env.example). La configuración de la entrada HTTPS/WSS debe conservar el backend HTTP interno en `127.0.0.1:3001` y reenviar `/ws` con upgrade de WebSocket.

No se deben presentar estimaciones ni capturas ficticias como evidencia.

## Arquitectura

Un único proceso Backend por partida mantiene grafo y estado en memoria en EC2. Los módulos graph/routing de Michael y simulator/realtime de Maykel se ensamblan en el mismo proceso; el Simulador usa el endpoint interno POST /paso. Routing precalcula el siguiente movimiento por worldVersion. Los workers calculan el plan durante sync; `/paso` lo consulta en RAM sin IPC. La cola asíncrona persiste checkpoints completos en DynamoDB y recupera partidas pausadas. El Frontend usa Leaflet, GET /estado y WebSocket.

```mermaid
flowchart LR
  UI[React + Leaflet] -->|HTTPS GET /estado<br/>WSS /ws| PUBLIC[3-128-78-190.sslip.io<br/>entrada HTTPS/WSS en EC2]
  PUBLIC --> API[Fastify HTTP interno :3001<br/>EC2 us-east-2a]
  API --> SIM[Simulator<br/>estado autoritativo]
  SIM -->|POST /motor/sincronizar<br/>POST /paso por loopback| ROUTE[Routing<br/>plan O(1) por worldVersion]
  GRAPH[Graph inmutable<br/>RAM] --> ROUTE
  SIM -->|snapshot comprometido| WS[WebSocket TURN_UPDATE]
  WS --> PUBLIC
  SIM -->|cola asíncrona + checkpoints| DDB[(spookython-manta-state<br/>DynamoDB us-east-2)]
```

## Documentación

- [SPEC.md](SPEC.md): fuente técnica canónica.
- [Checklist de lanzamiento](docs/launch-checklist.md): prioridades, aceptación y evidencias pendientes.
- [Costos AWS](docs/costos.md): tarifas de Ohio, fórmulas y evidencia del Budget.
- [Arquitectura Draw.io](docs/arquitectura.drawio): despliegue EC2 en Ohio y dependencias del backend.
- [Operación y rollback](docs/operacion-rollback.md): despliegue, IAM, monitoreo y recuperación.
- [OpenAPI 3.1](backend/openapi/openapi.yaml): contratos HTTP y canal WS.
- [Configuración de infraestructura](infra/README.md): región, tabla y endpoints públicos.
- [Refugios provisionales](docs/refugios-provisionales.md): sitios del escenario aceptados y alternativas con mejor potencial de defensa.
- [Complemento «Ojos de Águila»](docs/complemento-ojos-de-aguila.md): contexto de videovigilancia en Manta y fixture JSON de sensores simulados.
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
### Backend

Requiere Node.js 24.12+ de la serie 24. Ejecuta `npm --prefix backend ci`, `npm --prefix backend test` y `npm --prefix backend run typecheck`. La suite de raíz es independiente.

```bash
npm ci
npm test
npm run typecheck
ROUTE_API_KEY='use-a-secret-of-at-least-16-characters' npm run backend:start
npm run benchmark:routing
```

`/health/ready` queda listo después de inicializar grafo/checksum, workers y persistencia; no requiere una partida activa. Sin partida, `/estado` conserva su 503 `GAME_NOT_STARTED`.

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
