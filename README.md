# SpookyThon 2026 — Escape de Manta Zombie

Proyecto Track A con backend de baja latencia, simulación por turnos y mapa en vivo.

## Estado actual

| Área | Estado |
|---|---|
| Grafo de Manta | Publicado y validado: 300 nodos, 736 aristas, un componente fuertemente conexo y cuatro refugios alcanzables. El backend y el frontend distribuyen la misma versión del grafo. |
| Routing | Calcula planes por `worldVersion`; los workers precalculan durante la sincronización y `/paso` consulta la tabla instalada. |
| Simulador | Integra rondas R1/R2/R3, movimientos, cierres de segmentos, pausas y reanudación. El simulador es el único escritor del estado de la partida. |
| Realtime | `GET /estado` y `WSS /ws` publican snapshots comprometidos. |
| Ojos de Águila | Detecciones simuladas temporales afectan rutas y se muestran en el mapa. Referencias y coberturas aproximadas; sin video ni conexión real. Esta integración local requiere despliegue para verificarse. |
| Persistencia | Cola asíncrona y recuperación pausada están implementadas localmente. Las escrituras de esta versión integrada requieren despliegue para validarse en AWS. |
| Frontend | React/Vite/TypeScript/Leaflet: mapa, métricas, refugios, controles de operador y reconexión WebSocket. |

El equipo reportó la configuración desplegada en EC2 el 28 de octubre de 2026. Los cambios locales de esta rama requieren despliegue para verificarse en AWS; las pruebas locales no acreditan por sí mismas escrituras ni aceptación en la cuenta.

| Parámetro | Valor reportado |
|---|---|
| Región AWS (`AWS_REGION`) | `us-east-2` — Ohio |
| Zona de disponibilidad EC2 | `us-east-2a` |
| Tabla DynamoDB | `spookython-manta-state` |
| Base pública HTTPS/WSS | `https://3-128-78-190.sslip.io` |
| Estado público | `https://3-128-78-190.sslip.io/estado` |
| WebSocket | `wss://3-128-78-190.sslip.io/ws` |

DynamoDB es regional: usar `us-east-2` en el cliente AWS; `us-east-2a` identifica la zona de la instancia EC2. Los ejemplos de configuración están en [backend/.env.example](backend/.env.example) e [infra/.env.example](infra/.env.example). La entrada HTTPS/WSS debe reenviar al backend HTTP interno y conservar el upgrade de WebSocket.

## Arquitectura

Un proceso Fastify integra los módulos del backend. El estado de juego vive en RAM y solo el simulador lo muta. Routing instala planes durante la sincronización; los workers realizan el precompute y `/paso` consulta las tablas locales en O(1). La cola persiste snapshots comprometidos fuera del ciclo de turno. El frontend recibe snapshots por HTTP y WebSocket.

```mermaid
flowchart LR
  UI[React + Leaflet] -->|HTTPS GET /estado<br/>WSS /ws| PUBLIC[Entrada pública EC2]
  PUBLIC --> API[Fastify HTTP interno]
  API --> SIM[Simulator<br/>único escritor de estado]
  SIM -->|POST /motor/sincronizar<br/>POST /paso por loopback| ROUTE[Routing]
  GRAPH[Graph inmutable] --> ROUTE
  ROUTE --> WORKERS[Route workers]
  SIM -->|snapshot comprometido| WS[TURN_UPDATE]
  SIM -. persistencia asíncrona .-> DDB[(DynamoDB)]
```

## Documentación

- [SPEC.md](SPEC.md): fuente técnica canónica.
- [Checklist de lanzamiento](docs/launch-checklist.md): prioridades, aceptación y evidencias pendientes.
- [Costos AWS](docs/costos.md): tarifas, fórmulas y evidencia disponible.
- [Arquitectura Draw.io](docs/arquitectura.drawio) y [operación/rollback](docs/operacion-rollback.md).
- [OpenAPI 3.1](backend/openapi/openapi.yaml) y [configuración de infraestructura](infra/README.md).
- [Refugios provisionales](docs/refugios-provisionales.md) y [complemento «Ojos de Águila»](docs/complemento-ojos-de-aguila.md), que documenta el catálogo simulado y sus limitaciones.
- [Módulos Backend](backend/src/modules/README.md) y guías de [Michael](docs/team/michael/README.md), [Maykel](docs/team/maykel/README.md) y [Kristhian](docs/team/kristhian/README.md).
- [Extracción del grafo](scripts/README.md).

## Ejecutar en local

Requiere Node.js 24.12+ de la serie 24.

### Backend

```bash
npm --prefix backend ci
npm --prefix backend test
npm --prefix backend run typecheck
ROUTE_API_KEY='use-a-secret-of-at-least-16-characters' npm run backend:start
npm run benchmark:routing
```

`/health/ready` comprueba que el grafo, routing, workers y persistencia estén listos; no exige una partida activa. Antes de iniciar una partida, `GET /estado` responde `503 GAME_NOT_STARTED`.

### Frontend

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

El frontend carga el grafo estático desde `frontend/public/data/grafo_manta.json` y puede mostrar mapa, leyenda y refugios sin backend. Para conectarlo, configura la URL en `.env` siguiendo `.env.example`. No se debe incluir una API key privilegiada en el bundle del navegador.
