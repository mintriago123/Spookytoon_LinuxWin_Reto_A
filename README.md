# SpookyThon 2026 — Escape de Manta Zombie

Proyecto Track A con backend de baja latencia, simulación por turnos y mapa en vivo.

## Estado

El backend incluye grafo peatonal, motor Base de rutas, simulador, telemetría y publicación HTTP/WebSocket. Usa snapshots en RAM y autenticación `x-api-key` en routing y controles. El equipo confirmó en EC2 el despliegue público y la tabla DynamoDB indicados debajo. Esta rama incluye persistencia DynamoDB asíncrona, recuperación pausada, workers reales de precompute y readiness independiente de una partida. La release `a09f235` se desplegó y verificó en EC2 con persistencia real. El ciclo final completó 150 turnos por ronda, con máximos p95 de 26,4 / 50,1 / 89,3 ms y disponibilidad del 100 %. R2 registró un cierre tardío y una pausa/reanudación; el criterio de cero deadline misses sigue pendiente. [Evidencia completa](docs/evidence/integracion-2026-10-28/README.md).

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

DynamoDB es regional: usar `us-east-2` en el cliente AWS. `us-east-2a` corresponde a la instancia EC2 y no se debe utilizar como `AWS_REGION`.
Los ejemplos están en [backend/.env.example](backend/.env.example) e [infra/.env.example](infra/.env.example). La configuración de la entrada HTTPS/WSS debe conservar el backend HTTP interno en `127.0.0.1:3001` y reenviar `/ws` con upgrade de WebSocket.

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

Requiere Node.js 24.12+ de la serie 24. Ejecutar `npm --prefix backend ci`, `npm --prefix backend test` y
`npm --prefix backend run typecheck` para verificar el backend. La suite de raíz es independiente. Los comandos del motor son:

```bash
ROUTE_API_KEY='use-a-secret-of-at-least-16-characters' npm run backend:start
npm run benchmark:routing
```

`/health/ready` responde 200 antes de crear una partida cuando grafo/checksum, motor, workers y persistencia están preparados. Sin partida, `/estado` conserva su 503 GAME_NOT_STARTED.
