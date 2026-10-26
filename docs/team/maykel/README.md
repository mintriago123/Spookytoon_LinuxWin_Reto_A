# Maykel — Backend Simulador

## Responsabilidad

Dueño del game loop, máquina de estados de zombies/sobrevivientes, eventos de ciudad, resolución de mordidas y publicación de estado. La especificación normativa está en [SPEC.md](../../../SPEC.md), especialmente las secciones 2, 3 y 5, y los criterios de Dev 2 en la sección 7.

## Directorios a cargo

| Área | Ubicación |
|---|---|
| Game loop y estado autoritativo | **backend/src/modules/simulator/** |
| Eventos de ciudad | **backend/src/modules/simulator/city-events.ts** |
| Coordinación con rutas | **backend/src/app.ts** y cliente interno del motor |
| Latencia y métricas del turno | **backend/src/modules/telemetry/** |
| Emisión al Frontend | **backend/src/modules/realtime/** |

## Secuencia obligatoria por turno

1. Aplicar eventos efectivos del turno y mover zombies.
2. Guardar transiciones zombie y sincronizar el snapshot con el motor.
3. Consultar /paso en paralelo para cada sobreviviente vivo, con timeout de 500 ms.
4. Validar las decisiones, mover sobrevivientes y resolver mordidas antes de refugios.
5. Comprometer el estado completo, actualizar /estado, emitir TURN_UPDATE y encolar snapshot.

Un timeout, error, respuesta tardía o movimiento inválido deja quieto al sobreviviente afectado. Una falla de sincronización hace que todos esperen; nunca usar una versión anterior del mundo.

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
- Configurar en **backend/src/config/rounds.ts** las cantidades y posiciones de entidades y los turnos de eventos antes de iniciar una ronda.

## Aceptación antes de integrar

- 150 turnos de 2.000 ms seriales; nunca hay dos turnos simultáneos.
- Hasta 200 solicitudes de ruta en paralelo, deadline individual de 500 ms y percentiles en ventana de 1.000 muestras.
- Las tres rondas cumplen sus cantidades de sobrevivientes, composición y eventos de ciudad.
- Mordidas, capacidad, pausa y semilla reproducible cumplen SPEC.md.
- GET /estado y TURN_UPDATE describen el mismo turnId y worldVersion.

## Datos pendientes

Los conteos/spawns de zombies y las posiciones iniciales de entidades son configuración del escenario. Deben estar completos y validados antes de POST /simulador/iniciar.
