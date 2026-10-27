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
  const socketStatus = useWorldStore((s) => s.socketStatus);
  const lastError = useWorldStore((s) => s.lastError);
  const graphVersion = useWorldStore((s) => s.graphVersion);
  const hasSnapshot = useWorldStore((s) => s.currentSnapshot !== null);
  const mismatch = useWorldStore(hasGraphVersionMismatch);

  return (
    <div className="glass flex flex-col gap-1 rounded-lg px-3 py-2 text-xs text-slate-100">
      <div className="flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${DOT_CLASSES[socketStatus]}`}
          aria-hidden
        />
        <span>{LABELS[socketStatus] ?? socketStatus}</span>
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
  );
}
