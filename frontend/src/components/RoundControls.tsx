import { useMemo, useState } from "react";
import { useWorldStore } from "../state/world-store";
import type {
  ApiErrorBody,
  BloquearAristaRequest,
  BloquearAristaResponse,
  IniciarRequest,
  IniciarResponse,
  PausarRequest,
  PausarResponse,
} from "../types/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * SPEC.md §6: RoundControls es solo para operador autenticado y la API key
 * NUNCA va en el bundle. Aquí el operador la pega en memoria en tiempo de
 * ejecución (no hay .env ni build-time constant); se envía únicamente en el
 * header x-api-key de esta petición y no se persiste en storage. El
 * mecanismo final (proxy/sesión del Backend) puede sustituir este input por
 * algo más robusto sin cambiar el resto del componente.
 */
export function RoundControls() {
  const pendingControl = useWorldStore((s) => s.pendingControl);
  const setPendingControl = useWorldStore((s) => s.setPendingControl);
  const setLastError = useWorldStore((s) => s.setLastError);
  const status = useWorldStore((s) => s.currentSnapshot?.status ?? "idle");
  const graph = useWorldStore((s) => s.graph);
  const blockedEdges = useWorldStore((s) => s.currentSnapshot?.blockedEdges ?? []);

  const [operatorKey, setOperatorKey] = useState("");
  const [gameId, setGameId] = useState("game-2026-001");
  const [roundId, setRoundId] = useState<1 | 2 | 3>(1);
  const [seed, setSeed] = useState("seed-001");
  const [blockMotivo, setBlockMotivo] = useState("");

  // El Backend conserva el historial de cierres: una entrada con
  // desbloqueadaEnTurno != null ya no está vigente, pero sigue en el
  // arreglo (SPEC.md §2.2 BlockedEdge). Solo las entradas vigentes cuentan
  // como "bloqueado ahora".
  const activeBlockedEdges = useMemo(
    () => blockedEdges.filter((b) => b.desbloqueadaEnTurno === null),
    [blockedEdges],
  );

  // Un representante (segmentoId → primer edgeId) por cada segmento del
  // grafo, para que el operador elija qué cerrar sin tener que conocer IDs
  // de arista de memoria. SPEC.md §3.3: bloquear-arista cierra ambos
  // sentidos del segmentoId completo.
  const blockableSegments = useMemo(() => {
    if (!graph) return [];
    const blockedSegmentIds = new Set(activeBlockedEdges.map((b) => b.segmentoId));
    const bySegment = new Map<string, { segmentoId: string; edgeId: string; tipo: string }>();
    for (const edge of graph.aristas) {
      if (blockedSegmentIds.has(edge.segmentoId) || bySegment.has(edge.segmentoId)) continue;
      bySegment.set(edge.segmentoId, { segmentoId: edge.segmentoId, edgeId: edge.id, tipo: edge.tipo });
    }
    return Array.from(bySegment.values()).sort((a, b) => a.segmentoId.localeCompare(b.segmentoId, "en"));
  }, [graph, activeBlockedEdges]);

  const [selectedEdgeId, setSelectedEdgeId] = useState("");

  const callControl = async <TReq, TRes>(
    path: string,
    body: TReq,
    control: NonNullable<typeof pendingControl>,
  ): Promise<TRes | null> => {
    setPendingControl(control);
    setLastError(null);
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": operatorKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(errorBody?.error.message ?? `${path} respondió ${res.status}`);
      }
      return (await res.json()) as TRes;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : `Fallo al llamar ${path}`);
      return null;
    } finally {
      setPendingControl(null);
    }
  };

  const iniciar = () =>
    callControl<IniciarRequest, IniciarResponse>(
      "/simulador/iniciar",
      { gameId, roundId, seed },
      "iniciar",
    );

  const pausar = () =>
    callControl<PausarRequest, PausarResponse>(
      "/simulador/pausar",
      { reason: "Pausa solicitada por operador" },
      "pausar",
    );

  const bloquearSegmento = (edgeId: string, bloqueada: boolean, motivo: string) =>
    callControl<BloquearAristaRequest, BloquearAristaResponse>(
      "/simulador/bloquear-arista",
      { eventId: crypto.randomUUID(), edgeId, bloqueada, motivo },
      "bloquear-arista",
    ).then((res) => {
      if (res && bloqueada) {
        setSelectedEdgeId("");
        setBlockMotivo("");
      }
    });

  const busy = pendingControl !== null;

  const inputClass =
    "rounded border border-white/10 bg-night-700 px-2 py-1 text-slate-100 placeholder:text-slate-500 transition-colors duration-150 hover:border-white/25";

  // Tailwind necesita clases literales completas para detectarlas en build;
  // no se puede interpolar el color dentro del nombre de la clase.
  const ACTION_BUTTON_CLASS: Record<"green" | "amber" | "rose", string> = {
    green:
      "rounded bg-accent-green/90 px-3 py-1.5 font-semibold text-night-900 transition-all duration-150 hover:bg-accent-green enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
    amber:
      "rounded bg-accent-amber/90 px-3 py-1.5 font-semibold text-night-900 transition-all duration-150 hover:bg-accent-amber enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
    rose: "rounded bg-accent-rose/90 px-3 py-1.5 font-semibold text-night-900 transition-all duration-150 hover:bg-accent-rose enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
  };

  return (
    <form
      className="glass flex flex-col gap-3 rounded-lg p-3 text-xs text-slate-100"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className="flex flex-col gap-1">
        <span>API key de operador (solo en memoria)</span>
        <input
          type="password"
          autoComplete="off"
          value={operatorKey}
          onChange={(e) => setOperatorKey(e.target.value)}
          className={inputClass}
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span>gameId</span>
          <input value={gameId} onChange={(e) => setGameId(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Ronda</span>
          <select
            value={roundId}
            onChange={(e) => setRoundId(Number(e.target.value) as 1 | 2 | 3)}
            className={inputClass}
          >
            <option value={1}>1 — Anochecer</option>
            <option value={2}>2 — Medianoche</option>
            <option value={3}>3 — Apocalipsis</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span>seed</span>
        <input value={seed} onChange={(e) => setSeed(e.target.value)} className={inputClass} />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={iniciar}
          disabled={busy || status === "running"}
          className={`flex-1 ${ACTION_BUTTON_CLASS.green}`}
        >
          {pendingControl === "iniciar" ? "Iniciando…" : "Iniciar"}
        </button>
        <button
          type="button"
          onClick={pausar}
          disabled={busy || status !== "running"}
          className={`flex-1 ${ACTION_BUTTON_CLASS.amber}`}
        >
          {pendingControl === "pausar" ? "Pausando…" : "Pausar"}
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
        <span className="font-semibold uppercase tracking-wide text-accent-cyan/85">
          Cierres en vivo
        </span>

        {activeBlockedEdges.length > 0 && (
          <ul className="flex flex-col gap-1">
            {activeBlockedEdges.map((blocked) => (
              <li
                key={blocked.segmentoId}
                className="flex items-center justify-between gap-2 rounded bg-accent-rose/10 px-2 py-1"
              >
                <span className="truncate" title={blocked.motivo}>
                  {blocked.segmentoId} — {blocked.motivo}
                </span>
                <button
                  type="button"
                  onClick={() => bloquearSegmento(blocked.edgeIds[0], false, "Desbloqueo manual del operador")}
                  disabled={busy}
                  className="shrink-0 rounded bg-night-600 px-2 py-0.5 font-semibold text-slate-100 transition-colors duration-150 hover:bg-night-500 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pendingControl === "bloquear-arista" ? "…" : "Desbloquear"}
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="flex flex-col gap-1">
          <span>Segmento a cerrar</span>
          <select
            value={selectedEdgeId}
            onChange={(e) => setSelectedEdgeId(e.target.value)}
            className={inputClass}
          >
            <option value="">Selecciona un segmento…</option>
            {blockableSegments.map((segment) => (
              <option key={segment.segmentoId} value={segment.edgeId}>
                {segment.segmentoId} ({segment.tipo})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Motivo</span>
          <input
            value={blockMotivo}
            onChange={(e) => setBlockMotivo(e.target.value)}
            placeholder="Evento de ciudad o control de operador"
            className={inputClass}
          />
        </label>
        <button
          type="button"
          onClick={() => bloquearSegmento(selectedEdgeId, true, blockMotivo || "Bloqueo manual del operador")}
          disabled={busy || !selectedEdgeId || !blockMotivo}
          className={ACTION_BUTTON_CLASS.rose}
        >
          {pendingControl === "bloquear-arista" ? "Cerrando…" : "Cerrar segmento"}
        </button>
        <p className="text-[11px] text-slate-400">
          Se agrupa por segmentoId: cierra ambos sentidos. Los controles pasan
          por el operador seguro; la x-api-key no viaja al navegador.
        </p>
      </div>
    </form>
  );
}
