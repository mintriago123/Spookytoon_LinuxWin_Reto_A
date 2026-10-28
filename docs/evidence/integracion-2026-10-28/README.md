# Integración del 28 de octubre de 2026

- Entrega Michael publicada: `35686bd`.
- Integración Maykel (`3972b8f`) y fixtures corregidos: `01ba7ff`.
- Esquema DynamoDB real gameId/turnId: `c53fd57`.
- Entrada explícita de PM2 y verificador de rondas: `4ab5e40`.

La suite de raíz pasó 172/172 tras integrar. El backend pasó 27/27 localmente
antes de las dos pruebas del esquema físico y la prueba de arranque importado;
la release final ejecuta esas 30 pruebas en EC2 antes de promover readiness.

Frontend `origin/design` en `6afb9a1`, exportado a una copia temporal sin modificar
`frontend/` de la rama. Typecheck, build y 11/11 tests de store aprobados.
Chromium/Playwright validó mapa Leaflet, graphVersion, WS y GET, métricas,
inicio/pausa/reanudación de R1 y cambio de gameId a R2/R3 con 80/200 entidades.
Cero errores JavaScript. Resultados en [browser.json](browser.json) y
[captura](frontend-backend.png). `backendBase` identifica la base de integración;
la prueba consumió los módulos del árbol de trabajo durante la preparación de
la release. No es una captura del frontend desplegado en AWS.

EC2: `i-010f44e5ec891fc73`, us-east-2a. Node 24.22.0 y un escritor PM2;
Caddy mantiene HTTPS/WSS y bloquea health/routing internos hacia Internet.
Readiness respondió 200 con DynamoDbPersistenceAdapter real. Recuperación tras
reinicio: partida pausada en turno 2 con entidades/refugios preservados.

La aceptación de tres rondas completas se registra en `rounds.json` una vez
terminada la ejecución, junto con las observaciones de cada turno. No inferir
su resultado a partir de las rondas sintéticas ni de los smoke de tres turnos.


La comprobación adicional [ec2-browser.json](ec2-browser.json) y su
[captura](ec2-live.png) usaron la API y WSS reales en el turno 63 de R1:
p95 39,5 ms y disponibilidad 100 %, sin errores JS. Solo los assets estáticos
se sirvieron desde el build temporal interceptado por Playwright bajo el origen
de producción; no se publicó el frontend en EC2 ni se alteró su rama.


## Primer ciclo real y ajustes de transporte

El primer ciclo completo está en [rounds-initial.json](rounds-initial.json),
con 150 turnos y confirmación DynamoDB en las tres rondas. R1 se pausó en 123
por un deadline miss y se reanudó con la misma identidad; el intento previo
se conserva en [rounds-first-attempt.json](rounds-first-attempt.json). R2 cerró
en 300.005 ms sin misses. R3 cerró en 300.009 ms sin misses, pero su p95 máximo
fue 161,3 ms: no se declara cumplimiento total de SLA para ese ciclo.

Los logs del servidor mostraron p95 0,28 ms para el endpoint /paso, mientras
un lote del cliente se extendió 174 ms. No se atribuye esa diferencia a un
componente único. CPUCreditBalance estaba disponible (aprox. 21–24 créditos).
El experimento [logging-experiment.json](logging-experiment.json) alternó logs
por petición y logs acotados: 160,7 / 92,9 / 84,0 / 87,4 ms. El último valor
con logs detallados evidencia efecto de calentamiento/variabilidad; no demuestra
que el logging fuera la única causa.

Se conserva el conjunto completo de [muestras de pools](pool-experiment.jsonl),
con tres repeticiones, orden alternado y lotes fríos/calientes por ronda.
Máximos p95 de R3 por pool de 4/8/16/32 conexiones: 118,8 / 58,4 / 64,2 /
184,5 ms; cero timeouts. Se seleccionaron 8 para el servidor. No se modificaron
los 200 intentos en vuelo, el timeout de 500 ms, el límite p95 de 150 ms ni la
tolerancia de cierre de 10 ms. El modo detallado queda disponible con
LOG_HTTP_REQUESTS=true; controles, errores, lentitud y agregados siguen registrados.


## Release de transporte validada

`5562692` acota logs conservando observabilidad y tiene prueba que impide
filtrar API key/seed. Su primer intento de promoción fue bloqueado por p95
R2=348,5 ms y R3=151,8 ms durante los smoke de EC2; la release previa se mantuvo.
`a09f235` configura 8 conexiones HTTP y valida el rango 1..200 antes de readiness.
Pasó 32/32 pruebas tanto localmente como en EC2 y 172/172 de raíz. La imagen
Docker final también pasó readiness 200 con workers activos y UID 1000.

La comprobación [ec2-cors.json](ec2-cors.json) usó el build temporal en
http://127.0.0.1:5173 y la API/WSS reales de EC2, con CORS real y sin
interceptar peticiones. Captura en [ec2-cors.png](ec2-cors.png). El backend
estaba en `a09f235`, R1 turno 110, p95 18,8 ms y disponibilidad 100 %, sin errores JS.

El segundo ciclo se conserva separado del inicial en `rounds.json`; cualquier
pausa por deadline permanece en sus observaciones. El verificador distingue
completar funcionalmente las tres rondas de cumplir el criterio conjunto de
rutas y cero incumplimientos de reloj. No se rebajaron los umbrales.


## Resultado final observado en EC2

Backend desplegado: `a09f235a9dd2891471a6b7e4f678eb343024b66e`, un escritor PM2, Node 24.22.0, un worker de
precompute, 8 sockets HTTP y logs acotados. Evidencia completa en
[rounds.json](rounds.json); resumen comprobable en [summary.json](summary.json).

| Ronda | Turnos | Tiempo observado ms | Máximo p95 ms | Disponibilidad mínima | Deadline misses | Segmentos bloqueados | DynamoDB turno 150 |
|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 150 | 299995 | 26.4 | 100 % | 0 | 0 | Sí |
| 2 | 150 | 300080 | 50.1 | 100 % | 1 | 1 | Sí |
| 3 | 150 | 300008 | 89.3 | 100 % | 0 | 2 | Sí |

Se verificaron 151 snapshots por ronda (0..150), igualdad HTTP/WS en cada uno,
capacidad de refugios y publicación del manifiesto/puntero DynamoDB final.
El tiempo observado se mide desde el cliente HTTPS y puede diferir unos ms de
las fronteras internas del servidor. El criterio de rutas ≤150 ms y respuestas
válidas ≤500 ms pasó en las tres rondas finales.

La regularidad estricta del reloj no se certifica al 100 %: R2 registró un
incumplimiento en turno 138 y una pausa/reanudación, conservados en el archivo.
No se aumentó la tolerancia de 10 ms ni se eliminaron muestras. R1/R3 cerraron
sin misses en este ciclo. El verificador conserva `slaPassed=false` para el
criterio conjunto que exige también cero misses.

Las 172 pruebas de raíz y 32 de backend pasaron; frontend: 11 tests, typecheck,
build y navegación Chromium contra backend local y EC2. Readiness HTTP real y
recuperación pausada desde DynamoDB se comprobaron. La imagen Docker final
arrancó sin root y con workers operativos. No se modificaron ni fusionaron
archivos frontend en esta rama. No se instalaron CloudWatch Agent ni alarmas
AWS durante esta aceptación; sus artefactos y procedimiento están versionados.
