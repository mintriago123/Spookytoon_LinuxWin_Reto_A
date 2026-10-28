# Integración de preparación de partidas — 2026-10-28

Resolución del merge iniciado por el usuario con origin/feat/operador-preparacion-partidas. Sin commit, push ni despliegue.

## Decisiones

- Se conserva el centro de mando actual: cabecera, panel simple, barras de refugios, explorador único, selección cian y gestión de calle dentro del resultado.
- Se mantienen el encuadre de Manta y el botón compacto, sin instalar un segundo control de mapa. Se reutiliza buildGraphBounds y se maneja un grafo vacío.
- Se integran catálogo, prevalidación, identidad de configuración, recuperación y reinicio/repetición del backend. Reanudar mantiene la semilla del servidor y el parser de contraseña existente.
- Iniciar sigue siendo una acción: autentica si hace falta, prevalida y envía la misma identidad/semilla/revisión al inicio. Una preparación fallida no inicia una partida.
- La semilla propia queda opcional y plegada. Configuración guardada se consulta al abrir y requiere confirmación para sustituir la partida.
- Los cierres usan la validación de comando y respuesta de la rama entrante, conservando nuestros recibos inline y sin agregar el selector ni el panel de recibos duplicados de la rama antigua.
- Los fixtures entrantes usan las métricas completas actuales; OpenAPI conserva tanto la comprobación de idle como las de preparación/configuración.

## Validación

- Backend typecheck: aprobado.
- Backend: 55 pruebas aprobadas, 0 fallidas, 1 omitida por la suite.
- Frontend: 100 pruebas aprobadas; lint y build aprobados.
- Navegador con backend aislado en 3010 y frontend en 5180: iniciar con una acción, pausar, repetir configuración guardada con nueva identidad, seleccionar calle, programar cierre, reanudar y observar el cierre. Cuatro barras y ningún selector duplicado en el formulario de calle.
- No se operó la instancia de producción ni se cambiaron puertos/configuración persistente del usuario.
