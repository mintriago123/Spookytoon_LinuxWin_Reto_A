# Verificación del backend

Ejecución local del 27 de octubre de 2026, Node.js v24.22.0.
Grafo: `manta-osm-2026-10-13-d70af9643354ddac`.

Desde `backend/`:

```bash
npm run typecheck
npm test
```

Typecheck aprobado. Suite de `backend/tests/`: **12 pruebas aprobadas, cero
fallos**, duración de runner 19.172,6 ms.

Las pruebas arrancaron `startBackendServer()` con puertos efímeros de loopback,
el grafo y presets reales, reloj real, cliente HTTP de routing y WebSocket.
No hubo precalentamiento artificial ni descuento de muestras frías.

| Ronda | Sobrevivientes | Turnos reales | Movimientos observados | Evacuados | Mordidos | HTTP p95 ms | Disponibilidad | Deadline misses |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R1 | 20 | 3 | 49 | 2 | 2 | 34,5 | 100% | 0 |
| R2 | 80 | 3 | 210 | 14 | 5 | 65,4 | 100% | 0 |
| R3 | 200 | 3 | 548 | 29 | 10 | 107,1 | 100% | 0 |

Se comparó cada snapshot HTTP con el correspondiente `TURN_UPDATE.world`, se
recontaron las entidades y se comprobaron los límites de refugios, el plan
instalado, pausa y cierres en vivo. R2/R3 adelantaron cierres mediante controles
HTTP durante la prueba; los eventos originales de los presets se validaron por
separado (puente en turno 75, calles en turnos 60 y 105).

Las otras pruebas verificaron admisión y liberación de reservas, rutas hacia
refugios con cupos reservados, ventana de 1.000 muestras, respuestas válidas a
500 ms, errores/401, cancelación HTTP, ausencia de redirecciones y CORS.
El reloj de 150 ticks hasta 300.000 ms y la pausa por deadline se comprobaron
con reloj simulado. No se ejecutaron tres rondas completas de cinco minutos
con reloj real ni carga en AWS; estos datos no acreditan ese SLA de despliegue.


## Entrega modular de Michael — 28 de octubre de 2026

Rama de trabajo `feat/backend-rounds-metrics`, base `05d6145`, Node 24.22.0.
Esta verificación incluye los cambios locales de persistencia/workers/infra;
no corresponde al head remoto de Maykel ni modifica sus relojes de prueba.

- `npm --prefix backend run typecheck`: aprobado.
- `npm run typecheck` (raíz): aprobado tras instalar las dependencias del lockfile.
- `npm --prefix backend test`: **24/24**, cero fallos/omitidos, 19.711,3 ms.
- `node --test --test-isolation=none tests/routing.test.ts tests/graph.test.ts`:
  **37/37**, cero fallos. El test de readiness se alineó con 200 antes de sync.
- OpenAPI 3.1 validado con Swagger Parser, todas las referencias y endpoints,
  seguridad y schema de un snapshot real. SPEC y YAML externo coinciden.
- Persistencia: memoria/factory sin red, roundtrip DynamoDB con transporte
  inyectado, fragmentación, corrupción, puntero atómico, reintentos (4 intentos),
  límite de cola, orden y drenado, pausa y readiness 503 ante fallo permanente.
  Recuperación HTTP: checkpoint turno 4 → paused → reanudar → turno 5;
  mundo público versión 5 y motor nuevo versión 1 desde base 0.
- Workers: arranque real, dos workers, equivalencia del plan Base, tablas
  congeladas después de IPC, lookup local incluso después de cerrar el pool,
  saturación 429 y readiness 503 al perder el pool.
- Scripts Bash: `bash -n` sin errores; JSON, XML Draw.io y env consistentes.
- Dockerfile construido con Podman en formato Docker para conservar HEALTHCHECK.
  Smoke temporal de imagen: readiness 200, worker listo, persistencia en memoria,
  UID 1000. No se contacta AWS en ese smoke.
- Caddy 2.10.2 validó Caddyfile en contenedor con red deshabilitada: configuración
  válida, sin levantar el proxy ni solicitar certificados.

Última ejecución de smoke HTTP/WS, tres turnos por ronda:

| Ronda | Sobrevivientes | p95 ms | Disponibilidad | Deadline misses |
|---|---:|---:|---:|---:|
| R1 | 20 | 42,1 | 100 % | 0 |
| R2 | 80 | 60,2 | 100 % | 0 |
| R3 | 200 | 110,7 | 100 % | 0 |

El smoke ahora exige p95 ≤150 ms en cada turno. Cliente interno con 16 sockets;
precompute en worker y lookup local sin IPC por sobreviviente. El objetivo local
≤120 ms se cumplió en esta ejecución. No equivale a certificar el rendimiento de
EC2 t3.micro ni tres rondas completas de 150 turnos. La persistencia AWS real,
el corte/rollback en EC2 y las alarmas no se ejecutaron desde esta sesión.
No se modificaron archivos del frontend ni el algoritmo del reloj del simulador.


## Integración y aceptación EC2 final

Release `a09f235`: 172/172 pruebas de raíz, 32/32 backend tanto localmente como
en EC2; ambos typechecks aprobados. Frontend de `origin/design@6afb9a1`: 11/11,
typecheck/build y navegador con backend integrado.

Tres rondas de 150 turnos reales por HTTPS/WSS y checkpoints DynamoDB:

| Ronda | Turnos | Tiempo observado ms | Máximo p95 ms | Disponibilidad mínima | Deadline misses | Segmentos bloqueados | DynamoDB turno 150 |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 150 | 299995 | 26.4 | 100 % | 0 | 0 | Sí |
| 2 | 150 | 300080 | 50.1 | 100 % | 1 | 1 | Sí |
| 3 | 150 | 300008 | 89.3 | 100 % | 0 | 2 | Sí |

Rutas y disponibilidad aprobaron. R2 tuvo una pausa por deadline en 138,
registrada y reanudada; no se declara aprobado el criterio de cero misses.
Los intentos previos, la medición de pools y la recuperación real están en
[la evidencia de integración](../../docs/evidence/integracion-2026-10-28/README.md).

## Cierre integrado posterior

Fuente de ensayo `ef8cf79`: 38/38 pruebas backend en EC2, 177/177 raíz,
11/11 frontend y 12/12 infraestructura; typechecks, build y lint aprobados.
R1/R2/R3 completaron 150 turnos con máximos p95 37,2 / 50,3 / 85 ms,
disponibilidad 100 %, cero timeouts/errores/respuestas inválidas y cero
deadline misses. HTTP/WS coincidieron en 453 snapshots y se confirmó cada
turno 150 en DynamoDB. No se modificaron reglas del simulador ni sus tolerancias.
Ver [evidencia de cierre](../../docs/evidence/cierre-prueba-2026-10-28/README.md).
