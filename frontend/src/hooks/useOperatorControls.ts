import { useEffect, useState } from "react";
import { useWorldStore } from "../state/world-store";
import type { ApiErrorBody, BloquearAristaRequest, BloquearAristaResponse, IniciarRequest, IniciarResponse, PausarRequest, PausarResponse, ReanudarRequest } from "../types/contracts";
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

  const bloquearSegmento = async (segment: SegmentOption, bloqueada: boolean, motivo: string) => {
    if (useWorldStore.getState().pendingControl !== null) return null;
    const current = useWorldStore.getState().currentSnapshot;
    const gameId = current?.gameId;
    if (!gameId) return null;
    const eventId = crypto.randomUUID();
    useWorldStore.getState().addReceipt({ eventId, gameId, segmentoId: segment.segmentoId, label: segment.label,
      blocked: bloqueada, reason: motivo, phase: "sending" });
    const response = await callControl<BloquearAristaRequest, BloquearAristaResponse>(
      "/simulador/bloquear-arista", { eventId, edgeId: segment.edgeId, bloqueada, motivo,
        ...(current.status === "paused" ? { effectiveTurnId: current.turnId + 1 } : {}),
      }, "bloquear-arista",
    );
    useWorldStore.getState().updateReceipt(eventId, response
      ? { phase: "scheduled", effectiveTurnId: response.effectiveTurnId }
      : { phase: "error", error: useWorldStore.getState().lastError ?? "No se pudo confirmar la solicitud" });
    return response;
  };
  return { authState, password, loggingIn, login, logout, roundId, setRoundId, pendingControl,
    busy: pendingControl !== null, iniciar, pausar, reanudar, bloquearSegmento };
}
export type OperatorControls = ReturnType<typeof useOperatorControls>;
