import { useState } from "react";
import { useWorldStore, hasGraphVersionMismatch } from "../state/world-store";

const LABELS: Record<string, string> = {
  connecting: "Conectando…",
  open: "Conectado",
  reconnecting: "Reconectando…",
  closed: "Desconectado",
};

const DOT_CLASSES: Record<string, string> = {
  connecting: "bg-amber-400",
  open: "bg-emerald-500",
  reconnecting: "bg-amber-500 animate-pulse",
  closed: "bg-rose-600",
};

/**
 * SPEC.md §6: mostrar estado de conexión y errores visibles. No decide
 * nada por sí mismo; solo refleja socketStatus/lastError del store.
 */
export function ConnectionStatus() {
  const [mobileExpanded, setMobileExpanded] = useState(
    () => typeof window !== "undefined" && !window.matchMedia("(max-width: 767px)").matches,
  );
  const socketStatus = useWorldStore((s) => s.socketStatus);
  const lastError = useWorldStore((s) => s.lastError);
  const graphVersion = useWorldStore((s) => s.graphVersion);
  const hasSnapshot = useWorldStore((s) => s.currentSnapshot !== null);
  const mismatch = useWorldStore(hasGraphVersionMismatch);
  // lastError NO cuenta para "requiere atención": antes de iniciar cualquier
  // partida, GET /estado responde 503 (SPEC.md §3.3, esperado) y queda en
  // lastError — tratarlo como fallo pintaría de rojo un "Conectado" normal
  // en el indicador colapsado de móvil. El texto de lastError se sigue
  // mostrando tal cual abajo; esto solo acota qué hace sonar la alarma.
  const hasIssue = Boolean(mismatch || socketStatus === "closed");
  const indicatorClass = hasIssue ? "bg-rose-600" : DOT_CLASSES[socketStatus];

  // className condicional en vez de hidden={mobileExpanded} en el botón de
  // abajo: el atributo nativo hidden pierde contra la propia clase `flex`
  // del elemento (regla de autor vs. regla de user-agent), así que con
  // mobileExpanded=true el botón quedaba "hidden" en el DOM pero seguía
  // viéndose y era clickeable encima del panel expandido.
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMobileExpanded(true)}
        aria-label={`Mostrar estado: ${LABELS[socketStatus] ?? socketStatus}${hasIssue ? ", requiere atención" : ""}`}
        aria-expanded={mobileExpanded}
        className={`glass h-10 w-10 items-center justify-center gap-1 rounded-lg text-xs text-slate-100 md:hidden ${mobileExpanded ? "hidden" : "flex"}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${indicatorClass}`} aria-hidden />
        <span aria-hidden className="text-slate-400">›</span>
      </button>

      <div className={`glass w-[min(260px,calc(100vw-24px))] flex-col gap-1 rounded-lg px-3 py-2 text-xs text-slate-100 ${mobileExpanded ? "flex" : "hidden md:flex"}`}>
      {/* aria-live: la pérdida/recuperación de WS es la señal más crítica
          de esta UI (SPEC.md §6 reconexión); debe anunciarse igual que el
          error, no solo cambiar de color/texto en silencio. */}
      <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${indicatorClass}`}
          aria-hidden
        />
        <span>{LABELS[socketStatus] ?? socketStatus}</span>
      </div>
      <button
        type="button"
        onClick={() => setMobileExpanded(false)}
        aria-label="Ocultar estado hacia la izquierda"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg text-slate-300 hover:bg-white/10 md:hidden"
      >
        ‹
      </button>
      </div>
      {graphVersion ? (
        <p className="truncate text-slate-400" title={graphVersion}>
          graphVersion {graphVersion}{" "}
          {hasSnapshot ? (
            mismatch ? (
              <span className="text-accent-rose">no coincide ✕</span>
            ) : (
              <span className="text-accent-green">coincide ✓</span>
            )
          ) : null}
        </p>
      ) : null}
      {lastError ? (
        <p role="alert" className="text-accent-rose">
          {lastError}
        </p>
      ) : null}
      </div>
    </div>
  );
}
