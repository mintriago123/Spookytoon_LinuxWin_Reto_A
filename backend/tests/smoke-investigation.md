# Investigación del smoke sobre 53114e1

Medición local del 28 de octubre de 2026. Se usan los presets **simulados**
existentes; esto no es aceptación de escenarios oficiales ni de infraestructura AWS.

## Evidencia antes del ajuste del pool

Dos smoke iniciales con 32 sockets pasaron 4/4. El observador síncrono tardó
0,169–3,430 ms: ocurre después del commit medido por TurnTiming, pero retrasa
el inicio del siguiente cálculo. Se conservaron referencias inmutables durante
el commit y se trasladaron percentiles, JSON y salida al cierre del servidor.

Con ese observador reducido y todavía 32 sockets, tres smoke dieron **2/4,
4/4 y 3/4**. Por tanto, el observador no era la causa suficiente de los fallos:

| Caso | Timeouts del turno | Disponibilidad pública | p50 / p95 públicos (ms) | Cola real p95 (ms) | Conexión p95 | Respuesta p95 | Cuerpo p95 | engineMs p95 | Retraso de commit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R2, turno 1, ejecución 1 | 0 | 100 % | 152,8 / 169,5 | 140,5 | 32,2 | 71,0 | 0,2 | <0,05 | 1,210 |
| R3, turno 1, ejecución 1 | 39 | 80,5 % | 456,9 / 500,0 | 442,5 | 58,8 | 146,0 | 0,2 | <0,05 | 0,719 |
| R3, turno 2, ejecución 3 | 35 | 91 % | 90,0 / 500,0 | 447,2 | 0,0 | 147,2 | 0,6 | <0,05 | 0,244 |

InvalidRouteResponses y routeErrors fueron cero. Las sincronizaciones devolvieron
200 y tardaron 13,488, 16,935 y 8,770 ms respectivamente. Hubo 48, 168 y 158
peticiones realmente encoladas en el Agent. El caso caliente de R3 confirma que
la espera no se limita a conexiones frías. Estos incumplimientos de latencia
coexistieron con cierres correctos; no se deben atribuir al temporizador.

`beforeSocketMs` incluye construcción y callbacks, además de cola. Los nuevos
`queuedForSocket` y `socketQueueMs` leen la cola pública del Agent sin modificarla.
`responseWaitMs` incluye transporte, event loop, autenticación y servidor;
`engineMs` mide el lookup del motor, no todo el endpoint. No hay evidencia para
atribuir la demora a Dijkstra, sincronización, antivirus o un componente concreto
del sistema operativo. Tampoco hay engineMs de las respuestas que no llegaron.
Los percentiles de fases corresponden a muestras distintas y **no se suman**.
El transporte registra hasta observar respuesta/error; el timeout lógico sigue
contando exactamente 500 ms en la telemetría del simulador.

## Comparación y decisión

El experimento manual compara conexiones frías y luego dos lotes calientes por
ronda, tres repeticiones, alternando el orden de los pools. Usa el coordinador y
los endpoints reales. Aísla transporte: omite la espera de publicación y **no
verifica el reloj**. Para reproducir desde la raíz:

```powershell
node backend/tests/fixtures/routing-pool-experiment.ts 4,8,16,32 > "$env:TEMP\pool-small.jsonl"
node backend/tests/fixtures/routing-pool-experiment.ts 32,64,128,200 > "$env:TEMP\pool-large.jsonl"
```

La comparación de pools pequeños observó p95 máximos de R3 de 45,5 / 24,8 /
23,4 / 227,9 ms con 4 / 8 / 16 / 32 sockets. Las comparaciones anteriores de
pools grandes alcanzaron 377,4 ms con 128 y 492,0 ms con 200. Con 200 desapareció
la cola, pero aumentó conexión/respuesta: quitar la cola no elimina el coste
del transporte. Los perfiles de CPU mostraron coste nativo de conexión y writev;
no identifican su causa última ni garantizan un pool óptimo en otros equipos.

Se eligió **16 sockets** para reducir conexiones simultáneas y presión de I/O,
validándolo después con el smoke completo. Los hasta 200 intentos se siguen
despachando juntos y su espera en cola consume su presupuesto original de 500 ms.
La alternativa de transmitir JSON textual fue descartada: cuatro smoke dieron
4/4, 4/4, 4/4 y 3/4, sin reducción clara de writev en el perfil.

## Verificación final con 16 sockets

Cada ejecución observó cuatro turnos por ronda, incluido el que cierra la pausa.
Valores p95 máximos del ring buffer público durante cada ronda, en milisegundos:

| Ejecución | Resultado | R1 | R2 | R3 | Retraso máximo de commit (ms) |
|---|---|---:|---:|---:|---:|
| 1 | 4/4 | 29,5 | 36,4 | 84,6 | 0,326 |
| 2 | 4/4 | 27,7 | 36,5 | 62,5 | 1,766 |
| 3 | 4/4 | 30,0 | 36,0 | 61,1 | 0,484 |
| 4 | 4/4 | 27,0 | 35,1 | 62,9 | 0,369 |
| 5 | 4/4 | 27,7 | 35,5 | 56,9 | 1,597 |

En los 60 turnos: disponibilidad 100 %, cero routeTimeouts,
invalidRouteResponses, routeErrors y deadlineMisses. El observador ligero tardó
como máximo 0,405 ms. El intervalo desde commit hasta entrada al observador
(incluye proyección y encolado WS) fue como máximo 0,659 ms.

| Máximo de los p95 por fase (ms) | R1 | R2 | R3 |
|---|---:|---:|---:|
| beforeSocketMs | 25,2 | 31,2 | 75,5 |
| socketQueueMs | 25,2 | 31,2 | 75,4 |
| connectMs | 3,6 | 2,3 | 3,9 |
| responseWaitMs | 21,1 | 17,1 | 37,8 |
| bodyMs | 0,2 | 0,1 | <0,05 |
| engineMs | <0,05 | <0,05 | <0,05 |

El scheduler, su tolerancia de 10 ms, deadlines absolutos, reservas, DTO y
aserciones del smoke permanecen intactos. No reapareció el incumplimiento de
jitter en esta investigación; no se afirma haber identificado una causa nueva
para el retraso de 18 ms registrado en la investigación anterior.

Ambos typechecks finalizaron correctamente. Runtime, coordinador, realtime,
reservas/métricas y transporte: **72/72**, sin fallos ni omitidos.
`npm --prefix backend test` también pasó **15/15**: máximos p95 R1/R2/R3
29,3 / 36,5 / 64,6 ms, cero errores/timeouts y disponibilidad 100 %.
Comandos de verificación:

```powershell
npm --prefix backend run test:smoke
node --test tests/simulator-runtime.test.ts tests/simulator-turn.test.ts tests/realtime.test.ts backend/tests/rounds-metrics.test.ts backend/tests/routing-transport.test.ts
npm run typecheck
npm --prefix backend run typecheck
npm --prefix backend test
```

No quedan
incumplimientos observados con el código final en esta verificación local;
estas mediciones no constituyen una garantía de temporización bajo carga arbitraria.
