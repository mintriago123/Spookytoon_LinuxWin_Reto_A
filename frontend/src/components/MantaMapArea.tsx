import { useEffect, useMemo } from "react";
import { Control, DomEvent, DomUtil, latLngBounds, point, type LatLngTuple } from "leaflet";
import { useMap } from "react-leaflet";

/** Operational area from the published graph; not an administrative boundary. */
export function MantaMapArea({ bounds }: { bounds: [LatLngTuple, LatLngTuple] }) {
  const map = useMap();
  const area = useMemo(() => latLngBounds(bounds), [bounds]);

  useEffect(() => {
    map.zoomControl.setPosition("topright");
    map.setMaxBounds(area.pad(0.08));
    const updateMinimumZoom = () => {
      // Adapt to desktop/mobile dimensions without hiding nodes at the edges.
      const size = map.getSize();
      if (size.x <= 48 || size.y <= 48) return;
      // getBoundsZoom clamps to the previous minimum; reset it before recomputing
      // so a narrower container can zoom out enough to include every node.
      map.setMinZoom(0);
      const minimum = map.getBoundsZoom(area, false, point(48, 48));
      map.setMinZoom(minimum);
      if (map.getZoom() < minimum) map.setZoom(minimum, { animate: false });
      map.panInsideBounds(area.pad(0.08), { animate: false });
    };
    updateMinimumZoom();
    map.on("resize", updateMinimumZoom);
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false, debounceMoveend: true }));
    observer.observe(map.getContainer());
    return () => { observer.disconnect(); map.off("resize", updateMinimumZoom); };
  }, [map, area]);

  useEffect(() => {
    // Use Leaflet's control stack so this stays just below +/− on any screen.
    const control = new Control({ position: "topright" });
    const fit = () => map.fitBounds(area, { padding: [24, 24], animate: false });
    const button = DomUtil.create("button", "map-fit-button");
    button.type = "button";
    button.title = "Encuadrar todo el escenario de Manta";
    button.setAttribute("aria-label", "Mostrar todo el escenario de Manta");
    button.innerHTML = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5m13-5h5v5m0 8v5h-5m-8 0H3v-5"/><circle cx="12" cy="12" r="2"/></svg>';
    control.onAdd = () => {
      const container = DomUtil.create("div", "leaflet-bar map-fit-control");
      container.append(button);
      DomEvent.disableClickPropagation(container);
      DomEvent.disableScrollPropagation(container);
      return container;
    };
    button.addEventListener("click", fit);
    control.addTo(map);
    return () => { button.removeEventListener("click", fit); control.remove(); };
  }, [map, area]);

  return null;
}
