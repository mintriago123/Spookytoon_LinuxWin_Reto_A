import { useEffect, useMemo, useState } from "react";
import { useWorldStore } from "../state/world-store";
import type {
  ApiErrorBody,
  BloquearAristaRequest,
  BloquearAristaResponse,
  IniciarRequest,
  IniciarResponse,
  PausarRequest,
  PausarResponse,
  ReanudarRequest,
} from "../types/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * La contraseña de demostración está precargada y el campo es de solo
 * lectura. Este valor forma parte del frontend público. El login contra
 * POST /operador/sesion obtiene la cookie httpOnly utilizada por los
 * controles con `credentials: "include"`.
 */
export function RoundControls() {
  const pendingControl = useWorldStore((s) => s.pendingControl);
  const setPendingControl = useWorldStore((s) => s.setPendingControl);
  const setLastError = useWorldStore((s) => s.setLastError);
  const status = useWorldStore((s) => s.currentSnapshot?.status ?? "idle");
  const snapshotGameId = useWorldStore((s) => s.currentSnapshot?.gameId);
  const snapshotRoundId = useWorldStore((s) => s.currentSnapshot?.roundId);
  const graph = useWorldStore((s) => s.graph);
  const blockedEdges = useWorldStore((s) => s.currentSnapshot?.blockedEdges ?? []);

  const [authState, setAuthState] = useState<"checking" | "out" | "in">("checking");
  const password = "5f02d99417e6b14e3822e3e04f29213a1a69791a47debacf4dd40200998971d8";
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/operador/sesion`, { credentials: "include" })
      .then((res) => { if (!cancelled) setAuthState(res.ok ? "in" : "out"); })
      .catch(() => { if (!cancelled) setAuthState("out"); });
    return () => { cancelled = true; };
  }, []);

  const login = async () => {
    setLoggingIn(true);
    setLastError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/operador/sesion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(errorBody?.error.message ?? "Contraseña de operador incorrecta");
      }
      setAuthState("in");
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Fallo al iniciar sesión");
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    void fetch(`${API_BASE_URL}/operador/salir`, { method: "POST", credentials: "include" });
    setAuthState("out");
  };

  const [roundId, setRoundId] = useState<1 | 2 | 3>(1);
  const [blockMotivo, setBlockMotivo] = useState("");
  const [streetCatalog, setStreetCatalog] = useState<{
    graphVersion: string;
    namesBySegmentId: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/nombres-calles.json")
      .then(async (res) => {
        if (!res.ok) throw new Error("Catálogo de calles no disponible");
        return res.json() as Promise<{
          graphVersion: string;
          namesBySegmentId: Record<string, string>;
        }>;
      })
      .then((catalog) => {
        if (!cancelled && typeof catalog.graphVersion === "string" &&
            catalog.namesBySegmentId && typeof catalog.namesBySegmentId === "object" &&
            !Array.isArray(catalog.namesBySegmentId) &&
            Object.values(catalog.namesBySegmentId).every((name) => typeof name === "string" && name.trim())) {
          setStreetCatalog(catalog);
        }
      })
      .catch(() => { /* Sin catálogo se muestran el tipo de vía, zona y tramo. */ });
    return () => { cancelled = true; };
  }, []);

  const segmentLabels = useMemo(() => {
    const labels = new Map<string, string>();
    if (!graph) return labels;
    const names = streetCatalog?.graphVersion === graph.metadata.graphVersion
      ? streetCatalog.namesBySegmentId : {};
    const zones = new Map(graph.nodos.map((node) => [node.id, node.zona]));
    const roadTypes = { avenida: "Avenida", calle: "Calle", callejon: "Callejón", puente: "Puente" };
    const counts = new Map<string, number>();
    // Numeración estable: cerrar un tramo no renumera los demás.
    const edges = [...graph.aristas].sort((a, b) => a.segmentoId.localeCompare(b.segmentoId, "es", { numeric: true }));
    for (const edge of edges) {
      if (labels.has(edge.segmentoId)) continue;
      const name = names[edge.segmentoId] ?? `${roadTypes[edge.tipo]} sin nombre`;
      const zone = [...new Set([zones.get(edge.origen), zones.get(edge.destino)])].filter(Boolean).join(" / ");
      const group = `${name} · ${zone}`;
      const number = (counts.get(group) ?? 0) + 1;
      counts.set(group, number);
      labels.set(edge.segmentoId, `${group} · tramo ${number}`);
    }
    return labels;
  }, [graph, streetCatalog]);

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
    const bySegment = new Map<string, { segmentoId: string; edgeId: string; label: string }>();
    for (const edge of graph.aristas) {
      if (blockedSegmentIds.has(edge.segmentoId) || bySegment.has(edge.segmentoId)) continue;
      bySegment.set(edge.segmentoId, { segmentoId: edge.segmentoId, edgeId: edge.id,
        label: segmentLabels.get(edge.segmentoId) ?? edge.segmentoId });
    }
    return Array.from(bySegment.values()).sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }));
  }, [graph, activeBlockedEdges, segmentLabels]);

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
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // Sesión vencida o cerrada en otra pestaña: pedir la contraseña de
        // nuevo en vez de dejar botones que seguirán fallando en silencio.
        if (res.status === 401) setAuthState("out");
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
      { gameId: `game-${crypto.randomUUID()}`, roundId, seed: crypto.randomUUID() },
      "iniciar",
    );

  const pausar = () =>
    callControl<PausarRequest, PausarResponse>(
      "/simulador/pausar",
      { reason: "Pausa solicitada por operador" },
      "pausar",
    );

  const reanudar = () => {
    if (!snapshotGameId || !snapshotRoundId) {
      setLastError("No hay una partida pausada disponible para reanudar");
      return;
    }
    return callControl<ReanudarRequest, IniciarResponse>(
      "/simulador/reanudar",
      { gameId: snapshotGameId, roundId: snapshotRoundId },
      "iniciar",
    );
  };

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
  // Mientras no hay partida en curso, el único paso relevante es arrancar:
  // Seleccionar ronda + Iniciar. gameId y seed se generan para cada partida.
  // Los cierres de segmento no aplican todavía
  // y solo añaden ruido antes de que exista algo que bloquear.
  const started = status === "running" || status === "paused";

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

  if (authState === "checking") {
    return <div className="glass rounded-lg p-3 text-xs text-slate-400">Verificando sesión de operador…</div>;
  }

  if (authState === "out") {
    return (
      <form
        className="glass flex flex-col gap-3 rounded-lg p-3 text-xs text-slate-100"
        onSubmit={(e) => { e.preventDefault(); void login(); }}
      >
        <label className="flex flex-col gap-1">
          <span>Contraseña de operador</span>
          <input
            type="password"
            autoComplete="off"
            value={password}
            readOnly
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={loggingIn || !password}
          className={`w-full text-center ${ACTION_BUTTON_CLASS.green}`}
        >
          {loggingIn ? "Accediendo…" : "Acceder"}
        </button>
      </form>
    );
  }

  return (
    <form
      className="glass flex flex-col gap-3 rounded-lg p-3 text-xs text-slate-100"
      onSubmit={(e) => e.preventDefault()}
    >
      {started ? (
        // Ronda y estado vienen del snapshot. gameId y seed quedan internos;
        // reanudar conserva la identidad y la semilla que tiene el backend.
        <div className="flex items-center justify-between gap-2 rounded bg-night-700 px-2 py-1.5">
          <div className="min-w-0 leading-tight">
            <p className="truncate font-semibold text-slate-100">Ronda {snapshotRoundId ?? roundId}</p>
            <p className="text-[11px] text-slate-400">
              {status === "running" ? "En curso" : "Pausada"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={reanudar}
              disabled={busy || status === "running"}
              className={ACTION_BUTTON_CLASS.green}
            >
              {pendingControl === "iniciar" ? "Reanudando…" : "Reanudar"}
            </button>
            <button
              type="button"
              onClick={pausar}
              disabled={busy || status !== "running"}
              className={ACTION_BUTTON_CLASS.amber}
            >
              {pendingControl === "pausar" ? "Pausando…" : "Pausar"}
            </button>
          </div>
        </div>
      ) : (
        // Paso 1 — arranque: lo único que necesita el operador para empezar.
        <>
          <label className="flex flex-col gap-1">
            <span>Ronda</span>
            <select
              value={roundId}
              onChange={(e) => setRoundId(Number(e.target.value) as 1 | 2 | 3)}
              className={`w-full ${inputClass}`}
            >
              <option value={1}>1 — Anochecer</option>
              <option value={2}>2 — Medianoche</option>
              <option value={3}>3 — Apocalipsis</option>
            </select>
          </label>

          <button
            type="button"
            onClick={iniciar}
            disabled={busy}
            className={`w-full text-center ${ACTION_BUTTON_CLASS.green}`}
          >
            {pendingControl === "iniciar" ? "Iniciando…" : "Iniciar"}
          </button>
        </>
      )}

      {started && (
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
                    {segmentLabels.get(blocked.segmentoId) ?? blocked.segmentoId} — {blocked.motivo}
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
                  {segment.label}
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
      )}

      <button
        type="button"
        onClick={logout}
        className="self-start text-[11px] text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
      >
        Cerrar sesión de operador
      </button>
    </form>
  );
}
