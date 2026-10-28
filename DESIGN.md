---
name: Escape de Manta Zombie — Centro de Mando
description: Dashboard táctico nocturno para operar en vivo una simulación real de evacuación zombie
colors:
  night-deepest: "#06100a"
  night-base: "#0a0e16"
  night-panel: "#111826"
  night-surface: "#17213a"
  night-track: "#1e2a40"
  night-reserve: "#2a3a58"
  accent-cyan: "#22d3ee"
  accent-amber: "#fbbf24"
  accent-green: "#34d399"
  accent-rose: "#ff5a5a"
  accent-purple-reserve: "#3b0646"
  accent-purplelight-reserve: "#f0abfc"
  threat-caminante: "#4d7c0f"
  threat-corredor: "#ea580c"
  threat-horda: "#7e22ce"
  threat-dormido: "#c4b5fd"
  entity-shelter: "#2563eb"
  road-avenida: "#9aa8c0"
  road-calle: "#6b7683"
  road-callejon: "#4c5668"
typography:
  title:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.02em"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
rounded:
  sm: "4px"
  md: "8px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-green}"
    textColor: "{colors.night-base}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-caution:
    backgroundColor: "{colors.accent-amber}"
    textColor: "{colors.night-base}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "{colors.accent-rose}"
    textColor: "{colors.night-base}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-ghost:
    backgroundColor: "{colors.night-track}"
    textColor: "{colors.night-base}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  panel-glass:
    backgroundColor: "rgb(17 24 38 / 0.72)"
    textColor: "#e8edf7"
    rounded: "{rounded.md}"
    padding: "12px"
  input-field:
    backgroundColor: "{colors.night-surface}"
    textColor: "#e8edf7"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
---

# Design System: Escape de Manta Zombie — Centro de Mando

## Overview

**Creative North Star: "El Centro de Mando"**

Este es el panel de un operador que vigila una crisis real en curso, no un dashboard de analítica para hojear con calma. Todo el lenguaje visual viene del propio boceto del equipo y de la copy ya embebida en la app ("Centro de mando · motor de rutas en tiempo real"): una sala de operaciones nocturna, oscura por defecto porque se opera de noche y bajo presión, con paneles de cristal translúcido flotando sobre un mapa real que nunca deja de moverse. El ícono de radar del header, con su barrido lento y constante, es el resumen físico de todo el sistema: vigilancia activa, no un retrato estático.

La densidad de información es alta a propósito — vivos, mordidos, evacuados, turno, p95, disponibilidad, ocupación por refugio, cierres vigentes — porque el operador necesita todo el panorama sin cambiar de pantalla en medio de una ronda. Nada es decorativo: cada color, cada glifo, cada animación existe porque codifica un estado real del Backend. El sistema rechaza explícitamente la fantasía de "app zombie" (nada de sangre, texturas grunge ni tipografía de terror) — es una herramienta táctica seria, no una pieza de marketing de Halloween.

**Key Characteristics:**
- Base nocturna casi negra, paneles de cristal translúcido con blur, cero sombras duras.
- Un acento de color por rol semántico (ir, pausar/precaución, peligro, info), reutilizado de forma idéntica en UI y en el estado de los sobrevivientes en el mapa.
- Las amenazas (zombies) viven en su propia paleta cruda, deliberadamente separada de los acentos de UI, para que nunca se confundan con un botón o un estado de conexión.
- Tipografía Manrope, sin tipo "display": la jerarquía más alta de todo el sistema es un título de 14px — esto es una herramienta, no una portada.
- Cada entidad del mapa codifica su estado con forma Y color a la vez (nunca solo color), por accesibilidad y por legibilidad bajo la tensión de una demo en vivo.

## Colors

La paleta tiene dos familias que nunca se mezclan: los **acentos de UI** (controlan botones, estados de conexión y texto de los sobrevivientes) y la **paleta de amenazas** (zombies, refugio, vías), deliberadamente cruda y sin relación tonal con los acentos, para que un zombie en el mapa jamás se lea como "otro botón más".

### Primary
- **Verde Evacuación** (`#34d399`): la señal de "ir" — botón Iniciar, sobreviviente vivo. El único color que significa seguridad en todo el sistema.
- **Ámbar Precaución** (`#fbbf24`): pausa, puentes (la vía que colapsa en Ronda 2). Único rol: algo requiere atención pero no es una emergencia todavía.
- **Rosa Peligro** (`#ff5a5a`): cierre de segmento, sobreviviente mordido, errores y alertas. Es el único rojo del sistema; no hay un segundo rojo "menos grave".

### Secondary
- **Cian Señal** (`#22d3ee`): estado "conectado", foco de teclado (`:focus-visible`), sobreviviente evacuado, el ícono de radar del header. Es el color de "la información es correcta ahora mismo".

### Tertiary (reservados, aún sin uso en componentes)
- **Púrpura Profundo** (`#3b0646`) y **Lila Claro** (`#f0abfc`): definidos en `tailwind.config.ts` pero sin un rol asignado todavía en ningún componente. No inventar un uso; confirmar con el equipo antes de wirearlos a algo.

### Neutral
- **Negro Nocturno** (`#06100a`): fondo de `<body>`, el tono más oscuro del sistema.
- **Base de App** (`#0a0e16`): fondo del contenedor raíz y del mapa cuando no hay tiles cargados.
- **Panel Nocturno** (`#111826`): fondo del `<aside>` de controles (sin blur, panel sólido de soporte).
- **Superficie de Control** (`#17213a`): fondo de inputs de texto.
- **Pista Nocturna** (`#1e2a40`): track de las barras de ocupación de refugio; fondo de hover de botones fantasma.
- **Reserva Nocturna** (`#2a3a58`): definido en la escala, sin consumidor activo todavía.

### Paleta de amenazas (mapa, independiente de los acentos de UI)
- **Oliva Caminante** (`#4d7c0f`): zombie caminante — el tipo menos urgente, por eso el tono más apagado.
- **Naranja Corredor** (`#ea580c`): zombie corredor — persecución activa, requiere reacción.
- **Púrpura Horda** (`#7e22ce`): horda — bloquea nodo y vecinos, el color más saturado de la paleta de amenazas.
- **Lavanda Dormido** (`#c4b5fd`): zombie dormido — atenuado a propósito, "no es peligro visible todavía".
- **Azul Refugio** (`#2563eb`): el único color "seguro" que no es parte de la familia de acentos de UI — un refugio es destino, no una acción del operador.
- **Vías** (`#9aa8c0` avenida, `#6b7683` calle, `#4c5668` callejón): escala de grises azulados, nunca compiten por atención con entidades o acentos.

### Named Rules
**La Regla de las Dos Familias.** Los acentos de UI (verde/ámbar/rosa/cian) nunca se usan para pintar una entidad del mapa que no sea un sobreviviente, y la paleta de amenazas nunca se usa en un botón, input o estado de conexión. Si un color nuevo necesita decidir a qué familia pertenece, la pregunta es: "¿esto es una acción del operador, o es parte del mundo que el operador observa?".

**La Regla del Rojo Único.** Solo existe un rojo (`#ff5a5a`) para todo lo que es grave: mordida, cierre, error. No se introduce un segundo tono de rojo para distinguir severidad — la gravedad se comunica con texto y contexto, no con más rojos.

## Typography

**Body/UI Font:** Manrope (con `system-ui, sans-serif` de reserva), pesos 400/600/700 cargados.

**Character:** Una sola familia tipográfica para todo el sistema — no hay una fuente "de marca" separada de una "funcional". Geométrica, de trazo uniforme, muy legible en los tamaños pequeños que domina esta interfaz (10–14px). No existe una escala "display": la jerarquía más alta visible en pantalla es un título de 14px en negrita. Esto es intencional: el sistema es una herramienta de lectura rápida bajo presión, no un espacio para impresionar con tipografía grande.

### Hierarchy
- **Title** (700, 14px/0.875rem, tracking 0.02em): título de la app en el header y valores de métrica (`tabular-nums` para que las cifras no salten de ancho turno a turno).
- **Body** (400, 12px/0.75rem): texto base de todos los paneles — contenido de formularios, popups del mapa, listas de cierres vigentes.
- **Label** (600, 10–11px/0.625–0.6875rem, mayúsculas, tracking 0.1em): encabezados de sección ("Refugios · ocupación", "Cierres en vivo", "Vías"), etiquetas de métrica, subtítulo del header.

No hay roles Display ni Headline en este sistema: el dashboard nunca necesita un tamaño de texto mayor a 14px porque su trabajo es mostrar muchos datos a la vez, no un mensaje.

### Named Rules
**La Regla del Número Estable.** Cualquier cifra que cambie turno a turno (turno actual, p95, conteos de métrica) usa `tabular-nums` sin excepción, para que el layout no "tiemble" mientras el operador lee en vivo.

## Layout

Grid de dos columnas en escritorio: mapa a ancho completo menos 20rem (`md:w-[calc(100%-20rem)]`) a la izquierda, barra lateral fija de 20rem (`md:w-80`) a la derecha con controles y métricas. En móvil colapsa a una sola columna apilada (`flex-col`, el aside pasa a `border-t` en vez de `border-l`) — el operador puede correr la demo desde cualquiera de los dos.

Los paneles flotantes sobre el mapa (estado de conexión + leyenda) se posicionan en `absolute left-3 top-3` con `z-[1100]`, explícitamente por encima de los controles propios de Leaflet (`z-index` hasta 1000 en `leaflet.css`) — cualquier overlay nuevo sobre el mapa debe superar ese mismo umbral o quedará invisible aunque esté bien renderizado en el DOM.

Ritmo de espaciado ajustado a Tailwind por defecto (`gap-2`/`gap-3`, `p-3`), sin una escala custom — la densidad deseada ya sale de usar los pasos pequeños de la escala estándar de forma consistente.

## Elevation & Depth

Sistema plano por diseño: cero `box-shadow` en todo el proyecto. La profundidad se comunica únicamente con capas de transparencia — el utility `.glass` (`background-color: rgb(17 24 38 / 0.72)`, `backdrop-filter: blur(10px)`, borde `rgb(255 255 255 / 0.12)`) es la única fuente de "elevación" del sistema. Un panel flota sobre el mapa porque se ve el mapa detrás de él, no porque tenga una sombra.

### Named Rules
**La Regla del Cristal, No la Sombra.** Ningún componente nuevo introduce `box-shadow` para separarse del fondo. Si algo necesita destacar, la respuesta es `.glass` (translucidez + blur) o un color de acento — nunca una sombra.

## Shapes

Esquinas moderadas y consistentes: `rounded-lg` (8px) en paneles grandes (glass, tarjetas de leyenda, formulario de controles), `rounded` (4px) en botones y controles pequeños, `rounded-full` en elementos circulares (punto de estado de conexión, barras de progreso de ocupación, glifos de sobrevivientes/zombies). Bordes casi siempre en blanco a 10–12% de opacidad — nunca un borde sólido de color salvo el anillo de foco.

## Components

### Buttons
- **Shape:** `rounded` (4px), padding `6px 12px` en acciones principales, `2px 8px` en acciones secundarias/inline (ej. "Desbloquear" dentro de una lista).
- **Primary (Iniciar):** fondo `accent-green/90`, texto `night-base`, `font-semibold`; hover sube a `accent-green` sólido. Transición `all 150ms`.
- **Caution (Pausar):** misma estructura, fondo `accent-amber`.
- **Danger (Cerrar segmento):** misma estructura, fondo `accent-rose`.
- **Ghost (Desbloquear, dentro de listas):** fondo `night-track`, hover `night-reserve`, sin color de acento — es una acción secundaria dentro de un contexto ya de alerta (la lista de cierres vigentes).
- **Disabled:** `opacity-40`, `cursor-not-allowed`, siempre explícito por estado de ronda (ej. Iniciar deshabilitado mientras `status === "running"`), nunca solo visual.

### Cards / Containers (panel glass)
- **Corner Style:** `rounded-lg` (8px).
- **Background:** `.glass` (translúcido + blur) sobre el mapa; `night-panel` sólido en el `<aside>` lateral.
- **Shadow Strategy:** ninguna — ver Elevation & Depth.
- **Border:** 1px blanco a 12% de opacidad.
- **Internal Padding:** 12px (`p-3`).
- **Entrada:** animación `panel-in` (220ms, opacity + translateY 4px) al aparecer el primer snapshot de métricas.

### Inputs / Fields
- **Style:** fondo `night-surface`, sin relleno de color de acento, texto `#e8edf7`, placeholder `slate-500`.
- **Focus:** anillo de 2px `accent-cyan` con `outline-offset: 2px` — global (`:focus-visible`), no por componente.
- **Hover:** borde sube de opacidad 10%→25% en blanco.
- **Password (API key):** `autoComplete="off"`, nunca se persiste — la UI no da ninguna señal de "guardado", a propósito.

### Barra de progreso (ocupación de refugio)
- **Style:** track `night-track` 1.5px de alto, `rounded-full`; relleno `accent-cyan` normalmente, cambia a `accent-rose` cuando el refugio llega a capacidad.
- **Texto de estado:** "lleno" en `accent-rose` quince el refugio se satura; de lo contrario cifra `ocupantes/capacidad` en gris neutro.

### Badge de estado de conexión
- **Style:** punto `rounded-full` de 10px con color semántico (verde=conectado, ámbar=conectando/reconectando con `animate-pulse`, rosa=desconectado) + etiqueta de texto al lado — nunca solo el punto.
- **Anuncio:** `role="status" aria-live="polite"` — el cambio de conexión se anuncia, no solo se repinta.

### Leyenda colapsable
- **Style:** cabecera-botón con chevron que rota 180° (`transition-transform 150ms`) al expandir/colapsar; estado recordado en `localStorage`.
- **Contenido:** reutiliza exactamente los mismos glifos SVG que el mapa (`entity-icons.ts`) — la leyenda nunca puede desincronizarse de lo que se ve en el mapa porque es literalmente el mismo código.

### Glifos de entidad (signature component)
Cada sobreviviente/zombie es un `L.DivIcon` con SVG inline: círculo con punto para caminante, triángulo para corredor, cuadrado para horda, círculo con "Z" para dormido; sobreviviente usa círculo con check/X/punto según vivo/mordido/evacuado. La forma nunca es solo decorativa — es la codificación de accesibilidad exigida por SPEC.md (nunca depender solo de color). Los zombies "amenaza activa" (corredor/horda despiertos) llevan la clase `threat-marker`, que aplica un pulso de escala (1 → 1.18 → 1, 1.4s) para que el operador detecte el peligro sin tener que leer la leyenda.

### Mapa (tratamiento de tiles)
Tiles estándar de OpenStreetMap (gratis, sin key) con `filter: invert(1) hue-rotate(200deg) brightness(0.85) contrast(1.05) saturate(0.35)` aplicado solo a `.leaflet-tile-pane` — nunca al mapa completo, para que las entidades y vías mantengan sus colores reales sin que el filtro las toque.

## Do's and Don'ts

### Do:
- **Do** usar `.glass` para cualquier panel nuevo que flote sobre el mapa; es la única fuente de profundidad del sistema.
- **Do** aplicar `tabular-nums` a toda cifra que cambie turno a turno.
- **Do** dar a cada estado de entidad una forma distinta además de un color distinto — nunca solo color.
- **Do** mantener la paleta de amenazas (zombies/refugio/vías) completamente separada de los acentos de UI.
- **Do** animar con `transform`/`opacity` únicamente, y respetar `prefers-reduced-motion` en toda animación nueva (ya se hace para `panel-in`, `radar-mark`, `threat-marker`).

### Don't:
- **Don't** introducir `box-shadow` en ningún componente — la elevación es translucidez, no sombra.
- **Don't** usar un acento de UI (verde/ámbar/rosa/cian) para pintar un zombie, una vía o un refugio — ni al revés.
- **Don't** subir la escala tipográfica por encima de 14px/700 en ningún componente — este sistema no tiene un rol "display"; si algo necesita más peso visual, la respuesta es color o animación, no tamaño de letra.
- **Don't** wirear `accent-purple`/`accent-purplelight` a un componente sin confirmar antes su rol — están reservados, no asignados.
- **Don't** dejar un estado de error o desconexión sin anuncio accesible (`role="alert"`/`aria-live`) — la demo en vivo depende de que el operador note el problema de inmediato.
