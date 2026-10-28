import { useEffect, useRef } from "react";
import { useWorldStore } from "../state/world-store";
import type { TurnUpdate, WorldSnapshot } from "../types/contracts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const WS_URL = import.meta.env.VITE_WS_URL ?? "";

// SPEC.md §6: backoff de reconexión 1,2,4,8,16 s, máximo 30 s.
const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

async function fetchEstado(): Promise<WorldSnapshot> {
  const res = await fetch(`${API_BASE_URL}/estado`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET /estado respondió ${res.status}`);
  }
  return (await res.json()) as WorldSnapshot;
}

/**
 * Conecta a WSS /ws, aplica TURN_UPDATE y reconcilia con GET /estado en la
 * conexión inicial y en cada reconexión (SPEC.md §3.4, §6).
 *
 * El Frontend solo consume estos contratos; nunca decide rutas, mordidas ni
 * evacuaciones (ver docs/team/kristhian/README.md).
 */
export function useTurnSocket(): void {
  const applySnapshot = useWorldStore((s) => s.applySnapshot);
  const setSocketStatus = useWorldStore((s) => s.setSocketStatus);
  const setLastError = useWorldStore((s) => s.setLastError);

  const attemptRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const closedByClientRef = useRef(false);

  useEffect(() => {
    closedByClientRef.current = false;

    const reconcile = async () => {
      try {
        const snapshot = await fetchEstado();
        applySnapshot(snapshot);
        setLastError(null);
      } catch (err) {
        setLastError(
          err instanceof Error ? err.message : "Fallo al reconciliar /estado",
        );
      }
    };

    const scheduleReconnect = () => {
      if (closedByClientRef.current) return;
      const step = Math.min(attemptRef.current, BACKOFF_STEPS_MS.length - 1);
      const delay = BACKOFF_STEPS_MS[step];
      attemptRef.current += 1;
      setSocketStatus("reconnecting");
      timeoutRef.current = setTimeout(connect, delay);
    };

    const connect = () => {
      if (closedByClientRef.current) return;
      setSocketStatus(attemptRef.current === 0 ? "connecting" : "reconnecting");

      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        attemptRef.current = 0;
        setSocketStatus("open");
        // Al conectar/reconectar, reconciliar con el último snapshot completo.
        void reconcile();
      });

      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data as string) as TurnUpdate;
          if (payload.event === "TURN_UPDATE") {
            applySnapshot(payload.world);
          }
        } catch {
          setLastError("Mensaje TURN_UPDATE inválido recibido por WS");
        }
      });

      socket.addEventListener("close", () => {
        setSocketStatus("closed");
        socketRef.current = null;
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        socket.close();
      });
    };

    connect();

    return () => {
      closedByClientRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      socketRef.current?.close();
    };
  }, [applySnapshot, setSocketStatus, setLastError]);
}
