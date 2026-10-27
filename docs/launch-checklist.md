# Checklist de lanzamiento y demo

Orden operativo tomado de las prioridades del Track. Marcar completado solo con evidencia real.

| Prioridad | Responsable | Trabajo | Evidencia | Estado |
|---|---|---|---|---|
| Hoy | Michael | Extraer, normalizar y validar grafo peatonal; fijar refugios/capacidades | Grafo versionado, atribución y validación fuerte | Completado: 300 nodos (298 intersecciones)/736 aristas, un SCC, cuatro refugios alcanzables desde todos los nodos; copias sincronizadas |
| Hoy | Michael | Implementar motor Base de rutas, sincronización por turno, x-api-key y fallback | POST /motor/sincronizar, GET /motor/estado, POST /paso, pruebas y benchmark local | 7 archivos de pruebas pasan; benchmark sintético de 200 sobrevivientes, sin zombies, con keep-alive precalentado: 200/200 respuestas, HTTP p95 46,1 ms (p50 45,0; p99 46,1), lookup p95 0,008 ms y build 10,1 ms; integrar el game loop y medir roster real pendientes |
| Hoy | Michael | Elegir región, crear AWS Budget y alertas | Captura real en docs/evidence/aws-budget.png | Pendiente |
| Hoy / mañana | Michael + Maykel | Integrar motor precomputado con simulador y validar movimiento antes del commit | API desplegable y flujo de turno integrado | Pendiente de integrar con el game loop |
| Mañana | Michael + Maykel | Medir carga con 20, 80 y 200 sobrevivientes en el entorno integrado | p50/p95/p99, buildLatencyMs del plan, timeouts, deadline misses y configuración usada | Pendiente; falta medir el game loop integrado en el entorno objetivo |
| Miércoles temprano | Equipo | README/diagrama listos; completar costos reales, commits incrementales y URL pública estable | README/diagrama disponibles; docs/costos.md conciliado, historial real y URL verificada aún pendientes | Parcial |
| Hasta el viernes | Kristhian + equipo | Preparar pitch de 5 min y video de respaldo | Video reproducible sin red y guion de demo | Pendiente |

## Puertas de salida

1. No iniciar rondas hasta que el grafo y las posiciones/cantidades de entidades estén configurados y validados.
2. No declarar SLA hasta medir p95 con 20/80/200 sobrevivientes en la configuración final. El objetivo contractual es p95 ≤150 ms y timeout de 500 ms.
3. No dejar ECS/ALB encendidos sin Budget y alarma configurados. Confirmar AWS_REGION antes de estimar y desplegar.
4. La demo debe mostrar movimiento real, eventos de ciudad, refugios, métricas y recuperación de WebSocket.
5. Mantener commits pequeños y reales durante el trabajo. No fabricar historial ni aplazar todos los cambios a un único commit final.
6. Mantener una URL pública estable y probarla desde una conexión externa. El video de respaldo debe reproducir la ruta crítica de la demo.

## Bloqueos de datos

- Región AWS final, límite del Budget y contacto de alertas.
- Roster de zombies y posiciones iniciales por ronda.
- URL/dominio disponible para API y Frontend.
