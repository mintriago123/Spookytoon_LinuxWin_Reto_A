# Etapa 8: verificación integrada con fixtures

Fecha local: 2026-10-27 (America/Guayaquil). Código verificado: `a92e297`.

**Aceptación oficial pendiente.** No se encontraron configuraciones aprobadas en
`backend/src/config/` ni implementación de telemetría en
`backend/src/modules/telemetry/`; ambos directorios contienen solo `.gitkeep`.
Este informe registra pruebas sintéticas ejecutadas localmente. No acredita el
SLA del despliegue, la ronda oficial de cinco minutos ni la entrega del proyecto.

## Reproducción y entorno

```powershell
npm run typecheck
npm run test:integration
npm test
```

Node v24.14.1, npm 11.11.0; Windows x64, release 10.0.26200;
Intel Core i9-13900H, 20 procesadores lógicos, 15,71 GiB de RAM total.
Sin aislamiento de CPU ni medición de utilización de recursos. Fastify sin logs,
un RouteEngine y un runtime en el mismo proceso, HTTP/WS sobre loopback.
Cliente HTTP real `createRoutingClient`, basado en fetch, sin precalentamiento
explícito. Cada fixture crea un servidor local nuevo con puerto efímero.

## Qué se ejecutó

`tests/fixtures/integrated-scenario.ts` construye exclusivamente datos de prueba:
161 nodos, 304 aristas dirigidas, cuatro refugios y un camino de 150 aristas.
Todos los sobrevivientes empiezan juntos en el primer nodo y avanzan una arista
por turno. El primer refugio tiene capacidad para la mitad; los otros están
desconectados. Las composiciones zombie por ronda cumplen el validador, pero los
zombies están aislados. Los cierres programados afectan segmentos aislados.
El grafo sintético no representa Manta ni satisface su aceptación geográfica.
Estos datos no se registran en el composition root de producción.

`tests/simulator-integrated.test.ts` registra los plugins públicos existentes en
un solo Fastify. Inicia mediante HTTP autenticado, sincroniza y consulta el motor
por HTTP real, recibe WS real y compara GET `/estado` con cada snapshot recibido.
Verifica los turnos/versiones 1..150 sin duplicados, estado final `completed`,
movimientos, capacidad, desempate por ID y cierres efectivos en ambos sentidos.
Mantiene 20, 80 o 200 solicitudes simultáneas durante los 150 turnos: 45.000
consultas en total por ejecución de las tres fixtures.

El reloj acelera solo la espera entre ticks y conserva tiempo monotónico real
dentro del turno. El test avanza el siguiente tick tras recibir WS y comparar GET.
Los cero deadline misses observados corresponden a este reloj de prueba; no
demuestran cadencia real, jitter del scheduler ni resistencia a carga de producción.

## Mediciones ejecutadas

Primera ejecución dedicada: `npm run test:integration`, **3/3 pasan**,
duración del runner 22.408,563 ms. Percentiles nearest-rank sobre todas las
consultas de cada fixture, incluyendo construcción de la solicitud, transporte
loopback y lectura/parseo del cuerpo. No son la ventana móvil de 1.000 muestras
que debe implementar telemetría. No se descuentan arranque ni conexiones frías.

| Sobrevivientes | Turnos | Consultas | Máximo en vuelo | HTTP p50 ms | HTTP p95 ms | HTTP p99 ms | HTTP máximo ms |
|---|---|---|---|---|---|---|---|
| 20 | 150 | 3.000 | 20 | 6,248 | 14,543 | 24,658 | 41,035 |
| 80 | 150 | 12.000 | 80 | 16,973 | 47,402 | 61,671 | 67,889 |
| 200 | 150 | 30.000 | 200 | 50,778 | 94,451 | 120,260 | 154,839 |

| Sobrevivientes | Build p95 ms | Desde despacho de sync hasta observador del commit p95 ms | Máximo de ese intervalo ms | Duración local de fixture ms |
|---|---|---|---|---|
| 20 | 0,439 | 23,097 | 85,305 | 2.504,058 |
| 80 | 0,494 | 62,303 | 90,246 | 5.312,494 |
| 200 | 0,478 | 121,097 | 172,132 | 13.891,578 |

Build es `buildLatencyMs` reportado por el motor. El intervalo desde sync excluye
eventos y movimiento zombie anteriores a sync, así como envío WS posterior al
commit: **no es la duración completa del turno**. La duración local de fixture
incluye escucha HTTP, conexiones y lecturas de estado, y excluye su limpieza final.

En las tres fixtures: cero respuestas HTTP de ruta con error, cero abortos por
timeout, cero alertas/fallos internos y cero deadline misses observados. El cupo
final admite respectivamente 10, 40 y 100 sobrevivientes; el resto sigue vivo.
Los p95 locales quedaron por debajo de 150 ms en esta ejecución sintética.
La salida identifica `officialAcceptance: false` y `telemetryIntegrated: false`.
Los percentiles se miden fuera del backend; no se rellenan métricas productivas.

Segunda ejecución, dentro de `npm test` con otros archivos de pruebas concurrentes:

| Sobrevivientes | HTTP p50 ms | HTTP p95 ms | HTTP p99 ms | HTTP máximo ms |
|---|---|---|---|---|
| 20 | 5,287 | 13,947 | 37,692 | 38,747 |
| 80 | 22,469 | 53,161 | 68,325 | 74,075 |
| 200 | 49,991 | 95,706 | 144,583 | 172,852 |

También pasan las tres fixtures integradas, sin abortos, errores HTTP ni deadline
misses observados. TypeScript pasa. La suite completa finaliza con **126/134
pruebas aprobadas**, ocho fallos y duración de runner 23.798,189 ms.

## Fallos existentes y cobertura pendiente

Los ocho fallos coinciden con los de la Etapa 7:

- `tests/graph.test.ts`: la expresión que extrae el JSON Schema del SPEC no
  reconoce los saltos CRLF del archivo de trabajo.
- Siete pruebas de `tests/routing.test.ts`, incluida la de composition root:
  el cargador rechaza el checksum del artefacto. `git ls-files --eol` muestra
  `i/lf w/crlf` para `backend/data/grafo_manta.json` y su copia frontend.
  El manifiesto exige los bytes publicados; no se cambió ni el artefacto ni su hash.

Por tanto, esta prueba integra los plugins con un grafo sintético en memoria;
la carga del artefacto real mediante `createBackendApp` sigue sin pasar en este
checkout. Resolver la política de saltos de línea y verificar de nuevo con Michael.

Las pruebas específicas existentes de simulador y realtime también se ejecutaron
en la suite: mordidas, cruce frontal, horda, despertar, semilla, timeout individual
de 500 ms, respuesta inválida, sync incierta, 401, pausa/reanudación, deadline,
recuperación WS y clientes lentos. Esas pruebas incluyen relojes/clientes simulados;
no convierten las fixtures integradas en escenarios oficiales con amenazas reales.

Para cerrar la Etapa 8 faltan escenarios aprobados con spawns/eventos de Manta,
telemetría de Michael (ventana de 1.000 muestras y contadores), validación del
artefacto real, rondas con reloj real y carga en la configuración final, integración
del frontend, persistencia/despliegue y las evidencias de lanzamiento requeridas.
No se ejecutó push, despliegue ni publicación.
