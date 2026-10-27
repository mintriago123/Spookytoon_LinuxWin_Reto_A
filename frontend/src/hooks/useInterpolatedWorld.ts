import { useEffect, useRef, useState } from "react";
import type { LatLngTuple } from "leaflet";
import { useWorldStore } from "../state/world-store";

// SPEC.md §6: interpolar visualmente 1.800 ms con requestAnimationFrame,
// dejar 200 ms de pausa. Nunca altera el estado lógico (currentSnapshot).
const INTERPOLATION_MS = 1_800;

export interface InterpolationState {
  /** 0 al recibir el snapshot, 1 al terminar la interpolación visual. */
  progress: number;
}

/**
 * Devuelve el progreso [0,1] de la interpolación visual desde que llegó
 * previousSnapshot/currentSnapshot. LiveMap usa este valor para interpolar
 * la posición de cada entidad entre su nodo anterior y su nodo actual.
 * Horda y dormidos son inmóviles y se renderizan sin interpolar (SPEC.md §6).
 */
export function useInterpolatedWorld(): InterpolationState {
  const receivedAt = useWorldStore((s) => s.receivedAt);
  const [progress, setProgress] = useState(1);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // setProgress se llama solo dentro del callback de rAF (nunca
    // síncronamente en el cuerpo del efecto) para evitar el render en
    // cascada que marca react-hooks/set-state-in-effect; el primer frame
    // llega en el siguiente paint, imperceptible para una animación de
    // 1 800 ms.
    if (receivedAt === null) {
      rafRef.current = requestAnimationFrame(() => setProgress(1));
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }

    const tick = () => {
      const elapsed = Date.now() - receivedAt;
      const next = Math.min(1, elapsed / INTERPOLATION_MS);
      setProgress(next);
      if (next < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [receivedAt]);

  return { progress };
}

/** Interpolación lineal simple para coordenadas [lat, lng]. */
export function lerpLatLng(
  from: LatLngTuple,
  to: LatLngTuple,
  t: number,
): LatLngTuple {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}
