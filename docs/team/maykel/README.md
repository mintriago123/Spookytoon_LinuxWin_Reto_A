# Maykel — Backend Simulador

## Responsabilidad

Dueño del game loop, máquina de estados de zombies/sobrevivientes, eventos de ciudad, resolución de mordidas y publicación de estado. La especificación normativa está en [SPEC.md](../../../SPEC.md), especialmente las secciones 2, 3 y 5, y los criterios de Dev 2 en la sección 7.

## Directorios a cargo

| Área | Ubicación |
|---|---|
| Game loop y estado autoritativo | **backend/src/modules/simulator/** |
| Eventos de ciudad | **backend/src/modules/simulator/city-events.ts** |
| Coordinación con rutas | **backend/src/server.ts** y `backend/src/modules/simulator/routing-client.ts` |
| Consumo de métricas del turno | `backend/src/modules/telemetry/turn-metrics.ts` (ownership de Michael; coordinar cambios de contrato) |
| Emisión al Frontend | **backend/src/modules/realtime/** |

## Secuencia obligatoria por turno

1. Aplicar eventos efectivos y mover zombies, conservando cada arista recorrida.
2. Sincronizar con routing y confirmar la instalación de la versión del turno; ante fallo, nadie usa una tabla vieja.
3. Consultar `/paso` en paralelo para sobrevivientes vivos, con timeout individual de 500 ms.
4. Validar respuestas y movimientos; ejecutar movimiento simultáneo y resolver mordidas antes de admisión a refugios.
5. Actualizar telemetría, cerrar el turno y comprometer un único estado completo.
6. Publicar el mismo snapshot comprometido en `GET /estado` y `TURN_UPDATE`.

Un timeout, error, respuesta tardía o movimiento inválido deja quieto al sobreviviente afectado, usando su nodo actual. Una falla de sincronización hace que todos esperen; nunca usar una versión anterior del mundo.

## Reglas que no deben divergir

- Caminante: una arista cada dos turnos.
- Corredor: hasta dos aristas; persigue al sobreviviente más cercano si está a ≤3 saltos.
- Horda: inmóvil; el nodo y vecinos directos son zona letal/bloqueada.
- Dormido: invisible al motor hasta estar a ≤2 saltos; despierta permanentemente y luego usa comportamiento caminante.
- Resolver mordidas por nodo, vecindad de horda y cruce frontal. Las mordidas preceden admisión a refugio.
- Resolver capacidad simultánea de refugios ordenando llegadas por survivorId.

## Integración con el equipo

- A Michael: consumir exactamente el contrato de /motor/sincronizar y /paso; enviar turnId y worldVersion idénticos durante todo el lote.
- A Kristhian: publicar un único snapshot completo por turno comprometido. No emitir fases parciales ni cambiar el significado de métricas sin actualizar el contrato.
- `backend/src/config/round-presets.ts` genera presets deterministas que el servidor activa por defecto. Sus cantidades zombie y distribución no tienen aprobación de escenario documentada ni se basan aún en datos censales; no presentarlos como escenarios oficiales hasta que el equipo los confirme.

## Aceptación técnica y oficial

- 150 turnos de 2.000 ms seriales; nunca hay dos turnos simultáneos.
- Hasta 200 solicitudes de ruta en paralelo, deadline individual de 500 ms y percentiles en ventana de 1.000 muestras.
- Se consulta la tabla precomputada por worldVersion; no se ejecuta Dijkstra por sobreviviente.
- Las pruebas de backend incluyen presets y smoke tests HTTP/WS de tres turnos por ronda; no equivalen a una ronda completa de 150 turnos con reloj real.
- La aceptación oficial requiere cantidades/spawns/eventos aprobados para las tres rondas y una prueba completa contra el grafo real.
- Mordidas, capacidad, pausa y semilla reproducible cumplen SPEC.md.
- GET /estado y TURN_UPDATE describen el mismo turnId y worldVersion.

## Datos y validaciones pendientes

Los presets actuales son valores generados por implementación. El SPEC indica que las cantidades y ubicaciones del escenario no deben inventarse. Confirmar/aprobar esos valores; investigar datos del Censo 2022 del INEC y del GAD para orientar la distribución de sobrevivientes. La densidad poblacional no determina por sí sola los focos infecciosos. También falta ejecutar aceptación oficial y medir carga en la configuración final.
