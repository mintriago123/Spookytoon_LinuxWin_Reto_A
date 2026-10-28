import { useEffect, useMemo, useRef, useState } from "react";
import { checkOperatorSession, createSegmentCommand, loginOperator, OperatorControlError, scheduleSegmentCommand } from "../lib/operator-controls";
import { loadRoundCatalog, sameRoundSummary } from "../lib/round-catalog";
import { prepareAndStartGame } from "../lib/prepare-game";
import { GameConfigurationDetails } from "./GameConfigurationDetails";
import { useOperatorReceipts, type OperatorReceiptStatus } from "../state/operator-receipts";
import { useWorldStore } from "../state/world-store";
import type {
  ApiErrorBody,
  IniciarResponse,
  PausarRequest,
  PausarResponse,
  ReanudarRequest,
  RoundCatalog,
  WorldSnapshot,
} from "../types/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const EMPTY_BLOCKED_EDGES: WorldSnapshot["blockedEdges"] = [];

function receiptStatusText(status: OperatorReceiptStatus): string {
  switch (status) {
    case "sending": return "Solicitud en curso";
    case "pending-observation": return "Programado; pendiente de observación en un snapshot";
    case "overlapping": return "Programado; hay órdenes superpuestas para este segmento";
    case "rejected": return "Solicitud rechazada";
    case "uncertain": return "Aceptación no confirmada";
    case "observed": return "Estado esperado observado";
    case "not-observed": return "Estado esperado no observado antes del fin de la partida";
  }
}

function OperatorReceiptPanel() {
  const receipts = useOperatorReceipts((state) => state.receipts);
  const snapshot = useWorldStore((state) => state.currentSnapshot);
  if (receipts.length === 0) return null;

  return (
    <section className="glass rounded-lg p-3 text-xs text-slate-100" aria-live="polite">
      <h3 className="font-semibold uppercase tracking-wide text-accent-cyan/85">Solicitudes de segmentos</h3>
      <p className="mt-1 text-[11px] text-slate-400">
        Recibos locales de esta página; al recargar se pierden. Un estado observado confirma el snapshot,
        no qué evento lo produjo.
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {receipts.slice().reverse().map((receipt) => {
          const sameGame = snapshot?.gameId === receipt.gameId && snapshot.roundId === receipt.roundId;
          const blockedNow = sameGame && snapshot.blockedEdges.some((blocked) =>
            blocked.segmentoId === receipt.segmentId &&
            blocked.bloqueadaDesdeTurno <= snapshot.turnId &&
            (blocked.desbloqueadaEnTurno === null || snapshot.turnId < blocked.desbloqueadaEnTurno)
          );
          const action = receipt.action === "close" ? "Cerrar" : "Abrir";
          return (
            <li key={`${receipt.gameId}-${receipt.eventId}`} className="rounded bg-night-700 px-2 py-2">
              <p className="break-all font-medium">{action} · {receipt.segmentLabel}</p>
              <p className="break-all text-[10px] text-slate-400">Partida {receipt.gameId} · eventId {receipt.eventId}</p>
              <p className="text-slate-300">
                {receipt.effectiveTurnId === undefined
                  ? `Solicitado desde turno ${receipt.requestedAtTurn}`
                  : `Turno efectivo ${receipt.effectiveTurnId}`}
                {sameGame ? ` · estado en snapshot ${snapshot.turnId}: ${blockedNow ? "cerrado" : "abierto"}` : ""}
              </p>
              <p className={receipt.status === "rejected" || receipt.status === "uncertain" ? "text-accent-rose" : "text-accent-amber"}>
                {receiptStatusText(receipt.status)}
              </p>
              {receipt.status === "observed" && (
                <p className="text-slate-300">
                  Observado en turno {receipt.observedAtTurnId}. El snapshot muestra el estado esperado;
                  no demuestra que esta solicitud lo haya causado.
                </p>
              )}
              {receipt.stateAlreadyExpectedAtRequest && (
                <p className="text-slate-400">Ese estado ya aparecía en el snapshot al enviar la solicitud.</p>
              )}
              {receipt.overlapsAnotherOrder && (
                <p className="text-slate-400">Hay otra orden para el mismo segmento; no se atribuye el estado a un eventId.</p>
              )}
              {receipt.error && (
                <p role="alert" className="break-words text-accent-rose">
                  {receipt.error.code ? `${receipt.error.code}: ` : ""}{receipt.error.message}
                  {receipt.error.requestId ? ` · solicitud ${receipt.error.requestId}` : ""}
                  {receipt.error.status ? ` · HTTP ${receipt.error.status}` : ""}
                </p>
              )}
              <p className="text-[10px] text-slate-500">Motivo: {receipt.reason}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * La contraseña de demostración está precargada y el campo es de solo
 * lectura. Este valor forma parte del frontend público. El login contra
 * POST /operador/sesion obtiene la cookie httpOnly utilizada por los
 * controles con `credentials: "include"`.
 */
export function RoundControls() {
  const startController = useRef<AbortController | null>(null);
  const [startStage, setStartStage] = useState<"validating" | "starting" | null>(null);
  useEffect(() => () => { startController.current?.abort(); }, []);
  const pendingControl = useWorldStore((s) => s.pendingControl);
  const setPendingControl = useWorldStore((s) => s.setPendingControl);
  const setLastError = useWorldStore((s) => s.setLastError);
  const snapshot = useWorldStore((s) => s.currentSnapshot);
  const status = snapshot?.status ?? "idle";
  const snapshotGameId = snapshot?.gameId;
  const snapshotRoundId = snapshot?.roundId;
  const graph = useWorldStore((s) => s.graph);
  const blockedEdges = snapshot?.blockedEdges ?? EMPTY_BLOCKED_EDGES;

  const [authState, setAuthState] = useState<"checking" | "out" | "in">("checking");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const password = "5f02d99417e6b14e3822e3e04f29213a1a69791a47debacf4dd40200998971d8";
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkOperatorSession(API_BASE_URL)
      .then((valid) => {
        if (!cancelled) {
          setSessionError(null);
          setAuthState(valid ? "in" : "out");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAuthState("out");
          setSessionError(error instanceof Error ? error.message : "No se pudo verificar la sesión de operador");
        }
      });
    return () => { cancelled = true; };
  }, []);

  const login = async () => {
    setLoggingIn(true);
    setLastError(null);
    setSessionError(null);
    try {
      await loginOperator(API_BASE_URL, password);
      setAuthState("in");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fallo al iniciar sesión";
      setSessionError(message);
      setLastError(message);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    startController.current?.abort();
    void fetch(`${API_BASE_URL}/operador/salir`, { method: "POST", credentials: "include" });
    setSessionError(null);
    setAuthState("out");
  };

  const [roundId, setRoundId] = useState<1 | 2 | 3>(1);
  const [customSeed, setCustomSeed] = useState("");
  const [catalogResult, setCatalogResult] = useState<{ data: RoundCatalog | null; error: string | null }>({ data: null, error: null });
  const [catalogAttempt, setCatalogAttempt] = useState(0);

  useEffect(() => {
    if (authState !== "in") return;
    const controller = new AbortController();
    loadRoundCatalog(API_BASE_URL, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setCatalogResult({ data, error: null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogResult({ data: null,
          error: "No se pudo cargar el resumen. Iniciar usará el preset vigente del servidor." });
      });
    return () => controller.abort();
  }, [authState, catalogAttempt]);

  const selectedPreset = catalogResult.data?.graphVersion === graph?.metadata.graphVersion
    ? catalogResult.data?.rounds.find(round => round.roundId === roundId)
    : null;
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
  const [pausedTurnEntry, setPausedTurnEntry] = useState<{ scope: string; value: string } | null>(null);
  const snapshotScope = snapshot ? JSON.stringify([snapshot.gameId, snapshot.roundId]) : "";
  const pausedEffectiveTurn = pausedTurnEntry?.scope === snapshotScope ? pausedTurnEntry.value : "";
  const suggestedPausedTurn = snapshot ? snapshot.turnId + 1 : 1;
  const requestedPausedTurn = pausedEffectiveTurn.trim() ? Number(pausedEffectiveTurn) : suggestedPausedTurn;
  const pausedTurnValid = Number.isSafeInteger(requestedPausedTurn) &&
    requestedPausedTurn > (snapshot?.turnId ?? 0) && requestedPausedTurn <= 150;

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

  const iniciar = async () => {
    if (useWorldStore.getState().pendingControl) return;
    if (customSeed.length > 256 || (customSeed.length > 0 && customSeed.trim().length === 0)) {
      setLastError("La semilla debe contener texto y tener como máximo 256 caracteres.");
      return;
    }
    if (!graph) {
      setLastError("Espera a que se cargue el mapa antes de preparar la partida.");
      return;
    }
    const worldAtRequest = useWorldStore.getState().currentSnapshot;
    const controller = new AbortController();
    startController.current = controller;
    setPendingControl("iniciar");
    setStartStage("validating");
    setLastError(null);
    try {
      await prepareAndStartGame(API_BASE_URL, {
        gameId: `game-${crypto.randomUUID()}`, roundId, seed: customSeed || crypto.randomUUID(),
        graphVersion: graph.metadata.graphVersion,
      }, prepared => {
        const current = useWorldStore.getState();
        if (current.currentSnapshot !== worldAtRequest || current.graph !== graph) {
          throw new OperatorControlError("El estado o el mapa cambió durante la preparación. Revisa la partida e inténtalo de nuevo.", "rejected");
        }
        if (selectedPreset && !sameRoundSummary(selectedPreset, prepared.round)) {
          setCatalogAttempt(value => value + 1);
          throw new OperatorControlError("El resumen de la ronda cambió. Revisa la configuración actualizada antes de iniciar.", "rejected");
        }
        setStartStage("starting");
      }, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        const failure = error instanceof OperatorControlError ? error : null;
        if (failure?.details.status === 401) setAuthState("out");
        setLastError([error instanceof Error ? error.message : "No se pudo preparar la partida",
          failure?.details.code, failure?.details.requestId].filter(Boolean).join(" · "));
      }
    } finally {
      if (startController.current === controller) {
        startController.current = null;
        setPendingControl(null);
        setStartStage(null);
      }
    }
  };

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

  const bloquearSegmento = async (
    edgeId: string,
    segmentoId: string,
    label: string,
    bloqueada: boolean,
    motivo: string,
  ) => {
    const activeSnapshot = useWorldStore.getState().currentSnapshot;
    if (!activeSnapshot || activeSnapshot.gameId !== snapshotGameId || activeSnapshot.roundId !== snapshotRoundId) {
      setLastError("La partida cambió antes de enviar la solicitud. Revisa el snapshot actual e inténtalo de nuevo.");
      return;
    }

    const eventId = crypto.randomUUID();
    let command: ReturnType<typeof createSegmentCommand>;
    try {
      command = createSegmentCommand({
        snapshot: activeSnapshot,
        eventId,
        edgeId,
        bloqueada,
        motivo,
        pausedEffectiveTurn,
      });
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "No se pudo preparar la solicitud del segmento");
      return;
    }

    const token = useOperatorReceipts.getState().begin({
      snapshot: activeSnapshot,
      eventId,
      segmentId: segmentoId,
      segmentLabel: label,
      action: bloqueada ? "close" : "open",
      reason: motivo,
    });
    if (!token) {
      setLastError("La identidad de la partida cambió. Se descartó la solicitud antes de enviarla.");
      return;
    }

    setPendingControl("bloquear-arista");
    setLastError(null);
    try {
      const response = await scheduleSegmentCommand(API_BASE_URL, command, segmentoId);
      const recorded = useOperatorReceipts.getState().accept(token, response);
      if (recorded && bloqueada) {
        setSelectedEdgeId("");
        setBlockMotivo("");
      }
    } catch (error) {
      const failure = error instanceof OperatorControlError
        ? error
        : new OperatorControlError(error instanceof Error ? error.message : "Falló la solicitud del segmento", "uncertain");
      const recorded = useOperatorReceipts.getState().fail(token, {
        kind: failure.kind,
        message: failure.message,
        code: failure.details.code,
        requestId: failure.details.requestId,
        status: failure.details.status,
      });
      if (recorded) {
        if (failure.details.status === 401) setAuthState("out");
        setLastError(failure.message);
      }
    } finally {
      setPendingControl(null);
    }
  };

  const busy = pendingControl !== null;
  // Mientras no hay partida en curso, el único paso relevante es arrancar:
  // Iniciar usa identidad nueva y semilla automática salvo elección explícita.
  // Los cierres de segmento no aplican todavía
  // y solo añaden ruido antes de que exista algo que bloquear.
  const started = status === "running" || status === "paused";
  const selectedSegment = blockableSegments.find((segment) => segment.edgeId === selectedEdgeId);

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
    return (
      <div className="flex flex-col gap-3">
        <div className="glass rounded-lg p-3 text-xs text-slate-400">Verificando sesión de operador…</div>
        <OperatorReceiptPanel />
      </div>
    );
  }

  if (authState === "out") {
    return (
      <div className="flex flex-col gap-3">
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
          {sessionError && <p role="alert" className="break-words text-accent-rose">{sessionError}</p>}
          <button
            type="submit"
            disabled={loggingIn || !password}
            className={`w-full text-center ${ACTION_BUTTON_CLASS.green}`}
          >
            {loggingIn ? "Accediendo…" : "Acceder"}
          </button>
        </form>
        <OperatorReceiptPanel />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="glass flex flex-col gap-3 rounded-lg p-3 text-xs text-slate-100"
        onSubmit={(e) => e.preventDefault()}
      >
      {started ? (
        // Reanudar conserva la identidad y la semilla que tiene el backend.
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
          <details className="rounded border border-white/10 bg-night-700/50 p-2">
            <summary className="cursor-pointer font-semibold text-slate-200">
              Configuración de partida · Ronda {roundId}{customSeed ? " · Semilla propia" : ""}
            </summary>
            <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span>Ronda</span>
            <select
              value={roundId}
              disabled={busy}
              onChange={(e) => setRoundId(Number(e.target.value) as 1 | 2 | 3)}
              className={`w-full ${inputClass}`}
            >
              <option value={1}>1 — Anochecer</option>
              <option value={2}>2 — Medianoche</option>
              <option value={3}>3 — Apocalipsis</option>
            </select>
          </label>
          {selectedPreset ? (
            <div className="flex flex-col gap-1 rounded bg-night-900/60 p-2 text-slate-300" aria-live="polite">
              <p>{selectedPreset.survivorCount} sobrevivientes · {selectedPreset.durationMs / 60000} minutos</p>
              <p>{selectedPreset.turnCount} turnos · {selectedPreset.turnIntervalMs / 1000} segundos por turno</p>
              <p>Zombies: {selectedPreset.zombieCounts.caminante} caminantes, {selectedPreset.zombieCounts.corredor} corredores,
                {" "}{selectedPreset.zombieCounts.horda} hordas y {selectedPreset.zombieCounts.dormido} dormidos.</p>
              <p className="font-semibold">Eventos previstos</p>
              {selectedPreset.eventPlan.length === 0 ? <p>Sin cierres programados en este preset.</p> : (
                <ul className="list-disc pl-4">
                  {selectedPreset.eventPlan.map(event => (
                    <li key={event.eventId}>
                      Turno {event.effectiveTurnId}: {event.reason === "colapso-puente" ? "colapso de puente" : "bloqueo de calle"}
                      {" · "}{graph?.aristas.find(edge => edge.id === event.edgeId)?.segmentoId ?? event.edgeId}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-slate-400">Preset actual del servidor. El inicio lo valida nuevamente.</p>
            </div>
          ) : (
            <div role={catalogResult.error ? "alert" : "status"} className="text-slate-400">
              <p>{catalogResult.error ?? (catalogResult.data
                ? "El resumen corresponde a otro grafo. No se muestra como configuración del mapa actual."
                : "Consultando el preset actual…")}</p>
              <button type="button" className="mt-1 underline" onClick={() => setCatalogAttempt(value => value + 1)}>
                Consultar de nuevo
              </button>
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span>Semilla reproducible (opcional)</span>
            <input
              type="text"
              value={customSeed}
              disabled={busy}
              onChange={(event) => setCustomSeed(event.target.value)}
              maxLength={256}
              placeholder="Automática"
              aria-describedby="round-seed-help"
              className={`w-full ${inputClass}`}
            />
          </label>
          <p id="round-seed-help" className="text-slate-400">
            Vacía genera una semilla automáticamente. Usa la misma semilla y configuración
            para repetir un escenario. Cerrar este apartado conserva tus opciones.
          </p>
            </div>
          </details>

          <button
            type="button"
            onClick={iniciar}
            disabled={busy}
            className={`w-full text-center ${ACTION_BUTTON_CLASS.green}`}
          >
            {startStage === "validating" ? "Validando…" : pendingControl === "iniciar" ? "Iniciando…" : status === "completed" ? "Nueva partida" : "Iniciar"}
          </button>
        </>
      )}

      {snapshot && (
        <GameConfigurationDetails key={JSON.stringify([snapshot.gameId, snapshot.roundId, snapshot.graphVersion])}
          baseUrl={API_BASE_URL} gameId={snapshot.gameId} roundId={snapshot.roundId} graphVersion={snapshot.graphVersion}
          status={snapshot.status} onUnauthorized={() => setAuthState("out")} />
      )}

      {started && (
        <div className="flex flex-col gap-2 border-t border-white/10 pt-3">
          <span className="font-semibold uppercase tracking-wide text-accent-cyan/85">
            Cierres y aperturas
          </span>

          {status === "paused" ? (
            <>
              <label className="flex flex-col gap-1">
                <span>Turno efectivo para la solicitud</span>
                <input
                  type="number"
                  min={snapshot ? snapshot.turnId + 1 : 1}
                  max={150}
                  step={1}
                  value={pausedEffectiveTurn}
                  placeholder={String(suggestedPausedTurn)}
                  onChange={(event) => setPausedTurnEntry({ scope: snapshotScope, value: event.target.value })}
                  className={inputClass}
                />
              </label>
              <p className="text-[11px] text-slate-400">
                {suggestedPausedTurn <= 150
                  ? `La partida está pausada. Se sugiere el turno ${suggestedPausedTurn}; el servidor valida que siga disponible.`
                  : "No quedan turnos disponibles para programar otra orden."}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-slate-400">
              El servidor asigna el turno efectivo al programar la solicitud.
            </p>
          )}

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
                    onClick={() => bloquearSegmento(
                      blocked.edgeIds[0],
                      blocked.segmentoId,
                      segmentLabels.get(blocked.segmentoId) ?? blocked.segmentoId,
                      false,
                      "Desbloqueo manual del operador",
                    )}
                    disabled={busy || (status === "paused" && !pausedTurnValid)}
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
            onClick={() => selectedSegment && bloquearSegmento(
              selectedSegment.edgeId,
              selectedSegment.segmentoId,
              selectedSegment.label,
              true,
              blockMotivo || "Bloqueo manual del operador",
            )}
            disabled={busy || !selectedSegment || !blockMotivo || (status === "paused" && !pausedTurnValid)}
            className={ACTION_BUTTON_CLASS.rose}
          >
            {pendingControl === "bloquear-arista" ? "Cerrando…" : "Cerrar segmento"}
          </button>
          <p className="text-[11px] text-slate-400">
            Se programa sobre el segmento completo. Una respuesta 202 confirma la programación, no que el cambio ya se aplicó.
            La x-api-key no viaja al navegador.
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
      <OperatorReceiptPanel />
    </div>
  );
}
