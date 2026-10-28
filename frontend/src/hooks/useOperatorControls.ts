import { useEffect, useRef, useState } from "react";
import { useWorldStore } from "../state/world-store";
import type { ApiErrorBody, IniciarResponse, PausarRequest, PausarResponse, ReanudarRequest } from "../types/contracts";
import { prepareAndStartGame } from "../lib/prepare-game";
import { checkOperatorSession, loginOperator, OperatorControlError, createSegmentCommand, scheduleSegmentCommand } from "../lib/operator-controls";
import { loadRoundCatalog, sameRoundSummary } from "../lib/round-catalog";
import type { RoundCatalog } from "../types/contracts";
import type { SegmentOption } from "./useSegments";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

/** Shared controller: one session and one set of handlers for header and panel. */
export function useOperatorControls() {
  const pendingControl = useWorldStore(s => s.pendingControl);
  const setPendingControl = useWorldStore(s => s.setPendingControl);
  const setLastError = useWorldStore(s => s.setLastError);
  const snapshot = useWorldStore(s => s.currentSnapshot);
  const snapshotGameId = snapshot?.gameId;
  const snapshotRoundId = snapshot?.roundId;
  const [roundId, setRoundId] = useState<1 | 2 | 3>(1);
  const [authState, setAuthState] = useState<"checking" | "out" | "in">("checking");
  const password = "5f02d99417e6b14e3822e3e04f29213a1a69791a47debacf4dd40200998971d8";
  const [loggingIn, setLoggingIn] = useState(false);
  const [customSeed, setCustomSeed] = useState("");
  const [catalog, setCatalog] = useState<RoundCatalog | null>(null);
  const [startStage, setStartStage] = useState<"validating" | "starting" | null>(null);
  const startController = useRef<AbortController | null>(null);
  useEffect(() => () => startController.current?.abort(), []);
  useEffect(() => {
    if (authState !== "in") return;
    const controller = new AbortController();
    loadRoundCatalog(API_BASE_URL, controller.signal).then(data => {
      if (!controller.signal.aborted) setCatalog(data);
    }).catch(() => { /* La prevalidación sigue siendo obligatoria al iniciar. */ });
    return () => controller.abort();
  }, [authState]);

  useEffect(() => {
    let cancelled = false;
    checkOperatorSession(API_BASE_URL)
      .then((valid) => { if (!cancelled) setAuthState(valid ? "in" : "out"); })
      .catch(() => { if (!cancelled) setAuthState("out"); });
    return () => { cancelled = true; };
  }, []);

  const login = async () => {
    setLoggingIn(true);
    setLastError(null);
    try {
      await loginOperator(API_BASE_URL, password);
      setAuthState("in");
      return true;
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Fallo al iniciar sesión");
      return false;
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = () => {
    startController.current?.abort();
    void fetch(`${API_BASE_URL}/operador/salir`, { method: "POST", credentials: "include" });
    setAuthState("out");
  };

  const callControl = async <TReq, TRes>(
    path: string,
    body: TReq,
    control: NonNullable<typeof pendingControl>,
  ): Promise<TRes | null> => {
    if (useWorldStore.getState().pendingControl !== null) return null;
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
    const initial = useWorldStore.getState();
    if (initial.pendingControl !== null) return;
    const graph = initial.graph;
    if (!graph || (initial.currentSnapshot && initial.currentSnapshot.graphVersion !== graph.metadata.graphVersion)) {
      setLastError("Espera a que el mapa coincida con el servidor antes de iniciar.");
      return;
    }
    if (customSeed.length > 256 || (customSeed.length > 0 && !customSeed.trim())) {
      setLastError("La semilla debe contener texto y tener como máximo 256 caracteres.");
      return;
    }
    const controller = new AbortController();
    startController.current = controller;
    setPendingControl("iniciar");
    setStartStage("validating");
    setLastError(null);
    try {
      return await prepareAndStartGame(API_BASE_URL, {
        gameId: `game-${crypto.randomUUID()}`, roundId, seed: customSeed || crypto.randomUUID(),
        graphVersion: graph.metadata.graphVersion,
      }, prepared => {
        const current = useWorldStore.getState();
        if (current.currentSnapshot !== initial.currentSnapshot || current.graph !== graph) {
          throw new Error("La partida o el mapa cambió durante la preparación. Revisa el estado e inténtalo de nuevo.");
        }
        const preset = catalog?.graphVersion === graph.metadata.graphVersion
          ? catalog.rounds.find(round => round.roundId === roundId) : null;
        if (preset && !sameRoundSummary(preset, prepared.round)) {
          setCatalog(null);
          throw new Error("La configuración de la ronda cambió. Vuelve a iniciar para validar el preset vigente.");
        }
        setStartStage("starting");
      }, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof OperatorControlError && error.details.status === 401) setAuthState("out");
        setLastError(error instanceof Error ? error.message : "No se pudo preparar la partida");
      }
      return null;
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

  const bloquearSegmento = async (segment: SegmentOption, bloqueada: boolean, motivo: string) => {
    if (useWorldStore.getState().pendingControl !== null) return null;
    const current = useWorldStore.getState().currentSnapshot;
    const gameId = current?.gameId;
    if (!gameId) return null;
    const eventId = crypto.randomUUID();
    useWorldStore.getState().addReceipt({ eventId, gameId, segmentoId: segment.segmentoId, label: segment.label,
      blocked: bloqueada, reason: motivo, phase: "sending" });
    setPendingControl("bloquear-arista");
    setLastError(null);
    try {
      const command = createSegmentCommand({ snapshot: current, eventId, edgeId: segment.edgeId,
        bloqueada, motivo });
      const response = await scheduleSegmentCommand(API_BASE_URL, command, segment.segmentoId);
      useWorldStore.getState().updateReceipt(eventId, { phase: "scheduled", effectiveTurnId: response.effectiveTurnId });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo confirmar la solicitud";
      if (error instanceof OperatorControlError && error.details.status === 401) setAuthState("out");
      setLastError(message);
      useWorldStore.getState().updateReceipt(eventId, { phase: "error", error: message });
      return null;
    } finally { setPendingControl(null); }
  };
  return { authState, onUnauthorized: () => setAuthState("out"), customSeed, setCustomSeed, startStage, password, loggingIn, login, logout, roundId, setRoundId, pendingControl,
    busy: pendingControl !== null, iniciar, pausar, reanudar, bloquearSegmento };
}
export type OperatorControls = ReturnType<typeof useOperatorControls>;
