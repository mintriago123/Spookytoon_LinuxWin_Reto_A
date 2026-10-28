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
