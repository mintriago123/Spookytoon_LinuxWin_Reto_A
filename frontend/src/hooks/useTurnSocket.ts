import { useEffect } from "react";
import { useWorldStore } from "../state/world-store";
import { connectWorld } from "../lib/world-connection";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const WS_URL = import.meta.env.VITE_WS_URL ?? "";

/** Subscribe to committed snapshots and reconcile on each WebSocket connection. */
export function useTurnSocket(): void {
  const applySnapshot = useWorldStore((s) => s.applySnapshot);
  const setSocketStatus = useWorldStore((s) => s.setSocketStatus);
  const setLastError = useWorldStore((s) => s.setLastError);

  useEffect(
    () => connectWorld(API_BASE_URL, WS_URL, applySnapshot, setSocketStatus, setLastError),
    [applySnapshot, setSocketStatus, setLastError],
  );
}
