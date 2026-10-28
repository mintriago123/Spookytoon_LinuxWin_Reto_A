import type { TurnUpdate, WorldSnapshot } from "../types/contracts";
import type { SocketStatus } from "../state/world-store";

const BACKOFF_STEPS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
type StateResponse = WorldSnapshot | { status: "idle" };

/** Each subscription owns its socket, timers and requests, including in StrictMode. */
export function connectWorld(
  apiUrl: string,
  wsUrl: string,
  applySnapshot: (snapshot: WorldSnapshot) => void,
  setSocketStatus: (status: SocketStatus) => void,
  setLastError: (message: string | null) => void,
): () => void {
  let disposed = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let request: AbortController | null = null;
  let revision = 0;

  const reconcile = async () => {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const requestedRevision = revision;
    try {
      const response = await fetch(`${apiUrl}/estado`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`GET /estado respondió ${response.status}`);
      const state = await response.json() as StateResponse;
      if (disposed || controller.signal.aborted || requestedRevision !== revision) return;
      if ("gameId" in state) applySnapshot(state);
      setLastError(null);
    } catch (error) {
      if (!disposed && !controller.signal.aborted && requestedRevision === revision) {
        setLastError(error instanceof Error ? error.message : "Fallo al reconciliar /estado");
      }
    }
  };

  const connect = () => {
    if (disposed) return;
    setSocketStatus(attempt === 0 ? "connecting" : "reconnecting");
    const current = new WebSocket(wsUrl);
    socket = current;
    const active = () => !disposed && socket === current;
    current.addEventListener("open", () => {
      if (!active()) return;
      attempt = 0;
      setSocketStatus("open");
      void reconcile();
    });
    current.addEventListener("message", (event) => {
      if (!active()) return;
      try {
        const payload = JSON.parse(event.data as string) as TurnUpdate;
        if (payload.event === "TURN_UPDATE") {
          revision++;
          applySnapshot(payload.world);
          setLastError(null);
        }
      } catch {
        setLastError("Mensaje TURN_UPDATE inválido recibido por WS");
      }
    });
    current.addEventListener("close", () => {
      if (!active()) return;
      socket = null;
      revision++;
      request?.abort();
      const delay = BACKOFF_STEPS_MS[Math.min(attempt++, BACKOFF_STEPS_MS.length - 1)];
      setSocketStatus("reconnecting");
      timer = setTimeout(connect, delay);
    });
    current.addEventListener("error", () => {
      if (active()) current.close();
    });
  };

  // Defer acquisition so React's synchronous setup/cleanup probe opens no socket.
  let timer = setTimeout(connect, 0);
  return () => {
    disposed = true;
    clearTimeout(timer);
    request?.abort();
    if (socket?.readyState === WebSocket.CONNECTING) {
      // Closing during the handshake causes a browser warning. Close on open instead.
      const closing = socket;
      closing.addEventListener("open", () => closing.close(), { once: true });
    } else {
      socket?.close();
    }
  };
}
