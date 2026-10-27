# Refugios provisionales del escenario

Estado: selección preliminar del equipo; no son refugios oficiales ni tienen
capacidad de juego confirmada. Los cuatro sitios aceptados inicialmente son:

| ID provisional | Sitio | Sector | Observación |
|---|---|---|---|
| `REF-TARQUI` | Plaza del Mar | Tarqui | Punto reconocible, pero plaza abierta. El PDOT municipal la ubica en Tarqui, junto a la vía Puerto-Aeropuerto y la calle 110. [Fuente](https://manta.gob.ec/wp-content/uploads/2024/11/01-PDOT-Diagnostico-2024-2035.pdf) |
| `REF-ESTEROS` | Mercado Los Esteros | Los Esteros | Edificio identificable; confirmar accesos y perímetro antes de tratarlo como fortificable. [Fuente municipal](https://manta.gob.ec/db/2024/PDOT%20PARA%20PUBLICAR%20BORRADOR/SISTEMA%20ECONOMICO%20PRODUCTIVO%20ACTUALIZACION/SISTEMA%20ECONOMICO%20PRO%20DIAGNOSTICO%20Y%20PROPUESTA.pdf) |
| `REF-JOCAY` | Estadio Jocay | Jocay | Recinto grande y reconocible; plantear la zona cubierta de graderío como refugio, no el campo abierto. Una nueva tribuna fue entregada con obras de hormigón y servicios. [Gobernación de Manabí](https://gobernacionmanabi.gob.ec/el-gobierno-nacional-financia-a-traves-del-bde-proyectos-por-usd15-8-millones-en-la-provincia-de-manabi/) |
| `REF-BARBASQUILLO` | Plaza del Sol | Barbasquillo | Ubicada en la vía Barbasquillo; centro comercial privado. [Catálogo de Inmobiliar](https://www.inmobiliar.gob.ec/wp-content/uploads/2023/05/CATALOGO-MAYO-2023.pdf) |

## Opciones con mejor potencial de defensa

Estas alternativas son para la ficción del juego; las fuentes confirman su
ubicación o tipo de recinto, no su seguridad estructural ni disponibilidad:

- **ULEAM, Ciudadela Universitaria / vía San Mateo:** campus extenso con varios
  edificios. Puede servir para Barbasquillo si el mapa del juego incluye ese
  borde dentro de la zona. [Dirección de ULEAM](https://www.uleam.edu.ec/sedes/)
- **Coliseo Lorgio Pinargote, Complejo Tohallí:** recinto cubierto dentro de un
  complejo deportivo con piscina y canchas. Es una alternativa fuerte para el
  escenario, aunque queda en el centro y no debe etiquetarse como Tarqui sin
  comprobar el polígono de zonas. [Documento del GAD de Manta](https://esacc.corteconstitucional.gob.ec/storage/api/v1/10_DWL_FL/e2NhcnBldGE6J2VzY3JpdG8nLCB1dWlkOidlNjc5ZjJlOS0yMDVjLTQzODAtYjljNS04NjBmNzhlYThmYTcucGRmJ30=)
- **Estadio Elegolé:** alternativa de Los Esteros. Un estudio provincial lo
  registra entre la infraestructura recreativa de la parroquia. Confirmar en
  sitio si el cerramiento permite contener amenazas; no asumir que las gradas
  estén cubiertas. [Estudio de Manabí](https://www.manabi.gob.ec/wp-content/uploads/2024/03/Estudio-de-Impacto-Ambiental-EXPOST_041022.pdf)
- **Unidad Educativa San José, Tarqui:** alternativa con aulas y perímetro
  escolar; antes de usarla como sitio defendible, revisar su condición actual.
  El plantel reportó daños por el terremoto de 2016. [Dirección del plantel](https://www.salesianos.org.ec/casas-obras/), [antecedente del sismo](https://www.elcomercio.com/actualidad/medidaspsicoeducativas-terremoto-colegios-escuelas/)

La Terminal Terrestre queda fuera de las opciones de mayor seguridad por ahora:
el 26 de octubre de 2026 colapsaron cerca de 40 m² de cielo raso de gypsum por
las lluvias y se restringió el área afectada. Esto no demuestra que todo el
edificio sea inseguro, pero sí requiere inspección y reparación antes de usarlo
como refugio. [El Comercio](https://www.elcomercio.com/actualidad/ecuador/el-techo-de-la-terminal-terrestre-de-manta-se-cayo-por-las-lluvias-de-este-lunes/)

Capacidad de juego, nodo de acceso y coordenadas exactas siguen pendientes. Al
incorporarlos al grafo, asignar `nodoId` al nodo vial junto a la entrada elegida;
no usar el centro geométrico del recinto. No copiar automáticamente aforo de
espectadores, comerciantes o estudiantes como capacidad del refugio.
