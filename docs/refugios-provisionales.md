# Refugios configurados para el escenario

Estado: selección y datos de acceso confirmados por el equipo. La configuración
real está en [scripts/manta.config.json](../scripts/manta.config.json). El
pipeline ajusta cada coordenada al nodo vial OSM más cercano dentro de la zona.

| ID | Sitio | Zona | Acceso principal | Coordenadas (lat, lng) | Capacidad |
|---|---|---|---|---|---:|
| `R-TARQUI` | Unidad Educativa San José | Tarqui | Av. Malecón / Calle 106 | `-0.9502, -80.7165` | 60 |
| `R-ESTEROS` | Terminal Terrestre Luis Valdivieso Morán | Los Esteros | Entrada vehicular sobre Vía Puerto-Aeropuerto | `-0.9554, -80.6928` | 60 |
| `R-JOCAY` | Estadio Jocay | Jocay | Av. 113 / Calle 307 | `-0.9631, -80.7145` | 60 |
| `R-BARBASQUILLO` | ULEAM, Campus Matriz | Barbasquillo | Puerta 1, Av. Circunvalación / Vía San Mateo | `-0.9529, -80.7456` | 60 |

Capacidad total configurada: **240**, frente a 200 sobrevivientes en la Ronda 3.
El motor Base excluye refugios llenos del precompute usando `ocupantes` y
`reservados`; la admisión simultánea sigue siendo responsabilidad del simulador
y debe respetar el límite con desempate por `survivorId`, según `SPEC.md`.

Los polígonos de `manta.config.json` son particiones operativas de Voronoi
recortadas al bbox y ancladas en estas cuatro entradas. Cubren las coordenadas
del escenario; no pretenden representar límites administrativos oficiales.
`nodoId` se completa con el ID OSM real elegido por el snap de distancia
geodésica y queda incluido en el grafo publicado. Las capacidades son valores
del juego, no aforos reales de los recintos.

## Otras alternativas, si hiciera falta reemplazar una selección

Estas alternativas son para la ficción del juego; las fuentes confirman su
ubicación o tipo de recinto, no su seguridad estructural ni disponibilidad:

- **Coliseo Lorgio Pinargote, Complejo Tohallí:** recinto cubierto dentro de un
  complejo deportivo con piscina y canchas. Es una alternativa fuerte para el
  escenario, aunque queda en el centro y no debe etiquetarse como Tarqui sin
  comprobar el polígono de zonas. [Documento del GAD de Manta](https://esacc.corteconstitucional.gob.ec/storage/api/v1/10_DWL_FL/e2NhcnBldGE6J2VzY3JpdG8nLCB1dWlkOidlNjc5ZjJlOS0yMDVjLTQzODAtYjljNS04NjBmNzhlYThmYTcucGRmJ30=)
- **Estadio Elegolé:** alternativa de Los Esteros. Un estudio provincial lo
  registra entre la infraestructura recreativa de la parroquia. Confirmar en
  sitio si el cerramiento permite contener amenazas; no asumir que las gradas
  estén cubiertas. [Estudio de Manabí](https://www.manabi.gob.ec/wp-content/uploads/2024/03/Estudio-de-Impacto-Ambiental-EXPOST_041022.pdf)

El extractor registra coordenada de entrada, nodo vial seleccionado y distancia
de snap en `scripts/data/manta.osm.json.source.json`:

- `R-TARQUI` → `osm-node-10230309802`, 63,5 m.
- `R-ESTEROS` → `osm-node-5907174565`, 86,2 m.
- `R-JOCAY` → `osm-node-363649185`, 37,6 m.
- `R-BARBASQUILLO` → `osm-node-363715754`, 40,8 m.

La validación del artefacto comprueba referencias, zonas, refugios distintos y
conectividad dirigida entre todos los nodos y refugios.

### Conectividad del artefacto publicado

En `manta-osm-2026-10-13-d70af9643354ddac`, los 300 nodos (298 intersecciones y
dos nodos de acceso) forman una sola componente fuertemente conexa. El grafo
tiene 736 aristas y capacidad configurada de 240. Cada refugio es alcanzable
desde los 300 nodos y desde los otros tres refugios; el modo peatonal publica
ambos sentidos de cada vía y no aplica `oneway` vehiculares.

SHA-256 compartido por Backend y Frontend:
`7c010a06aef690403e9578cdbfc7cddafcac2102e9dc88a2dc28a03f33ce3b73`.

| Desde | Refugios alcanzables |
|---|---|
| `R-BARBASQUILLO` | Los cuatro refugios |
| `R-ESTEROS` | Los cuatro refugios |
| `R-JOCAY` | Los cuatro refugios |
| `R-TARQUI` | Los cuatro refugios |

La conectividad hace efectivas las cuatro capacidades para rutas sin amenazas y
sin bloqueos. El motor vuelve a calcular destinos disponibles por turno cuando
un refugio se llena o hay aristas bloqueadas; la simulación aún arbitra las
llegadas simultáneas para no exceder los cupos.
