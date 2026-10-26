# Kristhian — Frontend y UI

## Responsabilidad

Dueño de la aplicación React/Vite/TypeScript, mapa Leaflet, estado del cliente, controles de ronda y telemetría. La especificación normativa está en [SPEC.md](../../../SPEC.md), especialmente la sección 3.4, la sección 6 y los criterios de Dev 3 en la sección 7.

## Directorios a cargo

| Área | Ubicación |
|---|---|
| Componentes de mapa, controles y métricas | **frontend/src/components/** |
| Conexión y animación entre turnos | **frontend/src/hooks/** |
| Estado del mundo del cliente | **frontend/src/state/** |
| Tipos HTTP/WS | **frontend/src/types/** |
| Grafo estático del mapa | **frontend/public/data/** |

## Flujo de datos

1. Cargar el grafo estático y verificar que graphVersion coincide con el snapshot.
2. Conectar a WSS /ws y aceptar mensajes TURN_UPDATE con turnId creciente.
3. Si se pierde la conexión, reconectar con backoff y reconciliar con GET /estado.
4. Interpolar solo la posición visual entre snapshots; el estado lógico siempre viene del Backend.

## Componentes y capas

- LiveMap: vías, zonas, cierres, refugios y entidades.
- RoundControls: iniciar/pausar en modo operador.
- MetricsPanel: vivos, mordidos, evacuados, turno, reloj, p95, timeouts y rutas inválidas.
- ConnectionStatus y EntityLegend: estado de conexión y explicación de iconos/colores.
- Leaflet: estilos por tipo de vía; cierres; nodos por zona; ocupación/capacidad de refugios; tipo/estado de zombies; hordas y radio de corredores.

## Límites de seguridad y consistencia

- No decidir rutas, mordidas ni evacuaciones en el cliente.
- No incluir ni almacenar x-api-key en el bundle. Los controles usan el mecanismo operador/proxy configurado por Backend.
- Rechazar snapshots de graphVersion diferente; nunca dibujar entidades sobre un grafo incompatible.
- Ignorar eventos repetidos o atrasados. El cliente lento se recupera desde /estado.

## Aceptación antes de integrar

- Todos los tipos/estados tienen marcador y leyenda, incluidos dormidos y evacuados.
- La interpolación visual dura 1.800 ms y no muta el estado lógico.
- Pérdida y reconexión de WebSocket recuperan el último worldVersion.
- Métricas mostradas coinciden con el snapshot del Backend.
- Mapa y panel son utilizables en escritorio y móvil; la información no depende solo del color.
