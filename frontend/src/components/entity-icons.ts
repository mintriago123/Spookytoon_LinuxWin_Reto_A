import L from "leaflet";
import type { Survivor, ZombieType } from "../types/contracts";

/**
 * Íconos SVG compartidos entre LiveMap y EntityLegend: cada tipo/estado
 * tiene color Y forma distintos (no depende solo del color, SPEC.md §6 /
 * docs/team/kristhian). Inspirado en el boceto de diseño del equipo
 * ("Navegación tipo Waze" / "Centro de mando"), simplificado a formas
 * geométricas básicas en vez de las rutas exactas del mockup.
 */

export const ZOMBIE_COLOR: Record<ZombieType, string> = {
  caminante: "#4d7c0f",
  corredor: "#ea580c",
  horda: "#7e22ce",
  dormido: "#c4b5fd",
};

export const SURVIVOR_COLOR: Record<Survivor["estado"], string> = {
  vivo: "#34d399",
  mordido: "#ff5a5a",
  evacuado: "#22d3ee",
};

export const SHELTER_COLOR = "#2563eb";

export function wrapSvg(size: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${body}</svg>`;
}

export function zombieBody(tipo: ZombieType, color: string, dimmed: boolean): string {
  const opacity = dimmed ? 0.4 : 0.95;
  switch (tipo) {
    case "caminante":
      return `<circle cx="12" cy="12" r="8" fill="${color}" fill-opacity="${opacity}" stroke="#0a0e16" stroke-width="1.5"/>
        <circle cx="12" cy="12" r="2.5" fill="#0a0e16" fill-opacity="0.6"/>`;
    case "corredor":
      return `<polygon points="12,3 21,20 3,20" fill="${color}" fill-opacity="${opacity}" stroke="#0a0e16" stroke-width="1.5"/>`;
    case "horda":
      return `<rect x="4" y="4" width="16" height="16" rx="3" fill="${color}" fill-opacity="${opacity}" stroke="#0a0e16" stroke-width="1.5"/>`;
    case "dormido":
      return `<circle cx="12" cy="12" r="8" fill="${color}" fill-opacity="${opacity}" stroke="#0a0e16" stroke-width="1.5"/>
        <text x="12" y="15" font-size="8" text-anchor="middle" fill="#0a0e16">Z</text>`;
  }
}

export function survivorBody(estado: Survivor["estado"], color: string): string {
  const mark =
    estado === "mordido"
      ? `<path d="M9 9l6 6M15 9l-6 6" stroke="#0a0e16" stroke-width="1.6" stroke-linecap="round"/>`
      : estado === "evacuado"
        ? `<path d="M8 12.5l2.5 2.5L16 9" fill="none" stroke="#0a0e16" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<circle cx="12" cy="12" r="2" fill="#0a0e16" fill-opacity="0.6"/>`;
  return `<circle cx="12" cy="12" r="7" fill="${color}" fill-opacity="0.95" stroke="#0a0e16" stroke-width="1.5"/>${mark}`;
}

export function shelterBody(): string {
  return `<polygon points="12,2 14.9,9 22,9.3 16.3,13.9 18.4,21 12,16.8 5.6,21 7.7,13.9 2,9.3 9.1,9"
    fill="${SHELTER_COLOR}" stroke="#0a0e16" stroke-width="1"/>`;
}

const zombieIconCache = new Map<string, L.DivIcon>();
export function zombieIcon(tipo: ZombieType, estado: "activo" | "dormido"): L.DivIcon {
  const key = `${tipo}-${estado}`;
  const cached = zombieIconCache.get(key);
  if (cached) return cached;
  const size = tipo === "horda" ? 26 : 22;
  const icon = L.divIcon({
    html: wrapSvg(size, zombieBody(tipo, ZOMBIE_COLOR[tipo], estado === "dormido")),
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  zombieIconCache.set(key, icon);
  return icon;
}

const survivorIconCache = new Map<Survivor["estado"], L.DivIcon>();
export function survivorIcon(estado: Survivor["estado"]): L.DivIcon {
  const cached = survivorIconCache.get(estado);
  if (cached) return cached;
  const icon = L.divIcon({
    html: wrapSvg(18, survivorBody(estado, SURVIVOR_COLOR[estado])),
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  survivorIconCache.set(estado, icon);
  return icon;
}

let shelterIconInstance: L.DivIcon | null = null;
export function shelterIcon(): L.DivIcon {
  shelterIconInstance ??= L.divIcon({
    html: wrapSvg(26, shelterBody()),
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  return shelterIconInstance;
}

/** Ícono invisible, solo para anclar un Tooltip permanente (rótulos de zona). */
let invisibleIconInstance: L.DivIcon | null = null;
export function invisibleIcon(): L.DivIcon {
  invisibleIconInstance ??= L.divIcon({ html: "", className: "", iconSize: [0, 0] });
  return invisibleIconInstance;
}
