# Backend de Escape de Manta Zombie

Requiere Node.js 24.12 o superior de la serie 24. Desde `backend/`:

```bash
npm ci
npm run typecheck
npm test
ROUTE_API_KEY='replace-with-a-secret-of-at-least-16-characters' npm start
```

El servidor escucha en `127.0.0.1:3001`. `HOST` y `PORT` permiten cambiarlo.
Para cargar un archivo de entorno explícitamente: `node --env-file=.env src/server.ts`.
La plantilla está en `.env.example`; la clave de operador/routing es obligatoria.

El despliegue EC2 confirmado por el equipo utiliza `AWS_REGION=us-east-2`
(Ohio), zona `us-east-2a`, y `DYNAMODB_TABLE_NAME=spookython-manta-state`.
La base pública HTTPS es `https://3-128-78-190.sslip.io`; el canal WebSocket
es `wss://3-128-78-190.sslip.io/ws`. La zona de EC2 no se debe pasar como
región al cliente DynamoDB. Configuración y alcance de la persistencia en
[infra/README.md](../infra/README.md).

## Partidas listas para iniciar

`src/config/round-presets.ts` construye y valida los tres presets usando el
grafo publicado de Manta y su manifiesto SHA-256. Las posiciones se eligen de
forma determinista, sin nodos inventados, sin iniciar en refugios/zombies ni
en la vecindad letal de una horda. Los conteos zombie son parámetros de juego.

| Ronda | Sobrevivientes | Zombies | Eventos programados |
|---|---:|---|---|
| 1 | 20, cinco por zona | 8 caminantes | Ninguno |
| 2 | 80, veinte por zona | 12 caminantes, 4 corredores, 2 hordas | Un puente en turno 75 |
| 3 | 200, repartidos según nodos seguros disponibles por zona | 16 caminantes, 6 corredores, 2 hordas, 4 dormidos | Dos calles en turnos 60 y 105 |

Los cuatro refugios conservan sus 60 plazas del artefacto. Las mordidas se
resuelven antes de la admisión. Una llegada con reserva consume su cupo; las
demás llegadas compiten por los cupos sin reservar, con desempate por ID.
Reservas de mordidos, evacuados o personas que cambiaron de destino se liberan.
El estado público `evacuado` representa al sobreviviente salvo y conserva la
compatibilidad del contrato existente.

```bash
curl -X POST http://localhost:3001/simulador/iniciar \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: replace-with-a-secret-of-at-least-16-characters' \
  -d '{"gameId":"manta-1","roundId":1,"seed":"demo-1"}'
curl http://localhost:3001/estado
```

La partida publica primero turno 0. El primer tick espera 2.000 ms; los
150 ticks se programan con reloj monotónico absoluto hasta 300.000 ms, sin
acumular el tiempo de cálculo. Cada transición debe terminar antes del tick
siguiente; un exceso incrementa `deadlineMisses` y pausa al cerrar el turno.
Para una nueva partida después de `completed`, usar otro `gameId`. Reanudar
una partida pausada conserva `gameId`, ronda y semilla.

## Métricas comprometidas

`GET /estado` y `TURN_UPDATE.world` publican la misma proyección completa.
Cada turno recalcula vivos, mordidos, evacuados y zombies activos.

| Indicador | Significado |
|---|---|
| `activeSurvivors`, `bittenSurvivors`, `evacuatedSurvivors` | Conteos actuales; sus campos `*Percent` usan la población inicial |
| `survivalRatePercent` | Porcentaje de vivos más evacuados |
| `routeLatencyP50Ms/P95Ms/P99Ms` | Nearest-rank de las últimas 1.000 llamadas HTTP a `/paso`, incluyendo transporte y parseo; timeout aporta 500 ms |
| `routeAvailabilityPercent` | Respuestas válidas recibidas en ≤500 ms dentro de esa misma ventana; una espera válida cuenta como disponible |
| `routeSamples` | Tamaño de la ventana, hasta 1.000 |
| `routeTimeouts`, `routeErrors`, `invalidRouteResponses` | Contadores acumulados por partida |
| `turnDurationMs`, `turnBudgetUsedPercent` | Duración de cálculo del turno y porcentaje del presupuesto de 2.000 ms consumido |
| `turnEfficiencyPercent` | Porcentaje de turnos comprometidos sin incumplimiento de deadline |
| `wsClients` | Conexiones WS presentes al comprometer el snapshot |

El cliente HTTP interno despacha el lote de hasta 200 intentos y conserva
conexiones con un pool de 16 sockets en el servidor (configurable entre 1 y 200 en su fábrica),
respeta AbortSignal y no sigue redirecciones. Las reservas tienen planes
precalculados por refugio para no bloquear a quien ya posee un cupo.

## Orígenes y verificación

Se permiten `localhost` y `127.0.0.1` en los puertos 5173 y 3000. Añadir el
origen de producción con `FRONTEND_ORIGIN=https://sitio.example`; acepta una
lista separada por comas o `*` explícito. HTTP y WS aplican los mismos orígenes.
Los preflight permiten `GET`, `POST`, `OPTIONS`, `Content-Type` y `x-api-key`.

`npm test` ejecuta las pruebas dentro de `backend/tests/`. Incluye presets,
métricas/timeout, reservas/capacidad, reloj de 150 ticks y tres pruebas de humo
con `startBackendServer()`, grafo real, reloj real, routing HTTP y WS. Cada
ronda avanza tres turnos; R2/R3 ejercitan cierres mediante controles HTTP.
Estas pruebas locales no sustituyen medir rondas completas en el despliegue.

## Dependencias operativas de Michael

El servidor inicializa un worker de precompute por defecto (`ROUTING_WORKERS=1`),
valida el checksum del grafo y prepara persistencia antes de reportar readiness.
`/paso` conserva lookup local sin IPC. El pool soporta hasta 8 workers y una cola
acotada de 200 sincronizaciones; exceso responde 429.

`DYNAMODB_TABLE_NAME` selecciona DynamoDB; sin esa variable o bajo node:test se
usa memoria. Una configuración DynamoDB con errores de red/tabla/IAM falla el
arranque; no se cambia silenciosamente a memoria. El constructor DynamoDB usa
Ohio y `spookython-manta-state` por defecto. Checkpoints con gzip/checksum,
fragmentación, publicación atómica de manifiesto/puntero, cola de 32 y hasta 3
reintentos. La última partida incompleta se recupera pausada y valida graphVersion.

`/simulador/reanudar` exige la identidad de la partida pausada. `/simulador/reiniciar`
exige estado paused/completed y gameId nuevo. Ambos requieren x-api-key y usan el
mismo DTO de iniciar. El temporizador del simulador no se modifica en esta entrega;
la alineación de sus ventanas con la rama de Maykel se conserva como trabajo de integración.

[OpenAPI](openapi/openapi.yaml), [operación y rollback](../docs/operacion-rollback.md)
y [costos Ohio](../docs/costos.md) describen despliegue y verificación. Los tests de
persistencia usan un transporte inyectado, sin AWS. No son evidencia de escritura
real en la tabla de producción ni de 150 turnos en EC2.
