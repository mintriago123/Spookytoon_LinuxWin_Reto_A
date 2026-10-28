# Panel simplificado y barras de ocupación

28 de octubre de 2026. Cambios locales para revisión, sin commit ni despliegue.

## Flujo principal

El panel inicial concentra dos cosas: seleccionar/iniciar una ronda y leer la ocupación de los cuatro refugios. **Explorar el mapa** y **Rendimiento** quedan plegados como opciones secundarias. Se retiraron la tira técnica repetida, el botón de ocultar duplicado y los contenedores fijos con scroll anidado; el panel usa un desplazamiento vertical normal.

**Iniciar ronda** realiza el acceso de demostración con el mecanismo existente cuando hace falta y solo después solicita el inicio. Ya no se requiere pulsar antes Acceder. No se omite autorización ni se cambia ningún endpoint. Si el acceso falla, no se envía el inicio. Con una partida activa se conservan la pausa y reanudación de la barra superior; no se reemplaza una reanudación por una partida nueva.

## Barras

Se recupera el estilo de la captura: cuatro barras horizontales redondeadas, ocupación/capacidad visibles, cian para ocupación y rojo con el texto **Lleno** cuando se alcanza la capacidad. Se leen exclusivamente `ocupantes.length` y `capacidad` del snapshot. Las reservas no se cuentan como ocupantes. Sin snapshot se muestra **Sin dato**, sin inventar ocupación cero.

Se mantienen los nombres de presentación e identificadores existentes. Las barras incluyen semántica de progressbar y valores accesibles; la animación respeta reducción de movimiento. Seleccionar una barra centra el refugio sin desplegar herramientas adicionales.

## Menos pasos de exploración

Al abrir **Explorar el mapa**, Segmentos ya es la categoría inicial. Al seleccionar una calle, su gestión se abre directamente dentro de la fila, sin pulsar antes Gestionar calle. Se puede plegar manualmente y sigue en el flujo de la lista, sin superposición. Una selección de calle desde el mapa abre las herramientas; recibir snapshots no las despliega.

Se conservan categorías, búsquedas y filtros por identificador, detalle de personas/refugios, cierre/apertura, recibos y métricas técnicas. No se añadieron dependencias, reglas, cámaras, datos ilustrativos ni cambios de backend.

## Validación

- **53/53 pruebas**, typecheck, lint y build correctos.
- Dos casos nuevos: iniciar sin un botón de acceso separado y refugio lleno con barra al 100 %/texto explícito. Se actualizó la comprobación de apertura directa del inspector.
- Navegador real en backend local aislado `localhost:3010` y frontend `localhost:5180`, persistencia en memoria. El entorno habitual y producción no recibieron controles.
- Rechazo de acceso simulado solo en el navegador: el estado permaneció `idle`. Después se retiró esa simulación y un único clic inició una ronda 2 real mediante cookie de operador.
- Pausa/reanudación y cierre programado desde la fila, con apertura directa del formulario y un solo control de cierre. Avance de turno comprobado en el backend local.
- Cuatro barras visibles, opciones secundarias inicialmente cerradas y móvil sin desbordamiento horizontal.
- Se retiraron las reglas de distribución de los antiguos bloques fijos en vez de añadir más capas de navegación.

Capturas locales revisadas visualmente: [escritorio](desktop.png) y [móvil](mobile.png). Muestran datos reales de la ronda local de prueba; las cifras ilustrativas de la referencia no se copiaron.

Archivos principales: App.tsx, RoundControls.tsx, ShelterOccupancy.tsx, EntityExplorer.tsx, useOperatorControls.ts, estilos y pruebas de frontend. Los servidores de prueba se detienen al finalizar.

Para revisar: recarga el frontend habitual. Si no hay partida activa o la anterior terminó, elige la ronda y pulsa **Iniciar ronda**. Para gestionar una calle, abre **Explorar el mapa**, busca y selecciona el tramo; el motivo y la acción aparecen directamente. Los detalles de rendimiento siguen disponibles cuando se necesitan.
