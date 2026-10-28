import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectWorld } from "./world-connection";
import type { WorldSnapshot } from "../types/contracts";

class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static instances: FakeSocket[] = [];
  readyState = 0;
  close = vi.fn(() => { this.readyState = 3; this.dispatchEvent(new Event("close")); });
  constructor() { super(); FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  message(world: WorldSnapshot) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ event: "TURN_UPDATE", world }) }));
  }
}

let cleanup: (() => void) | undefined;
const apply = vi.fn();
const status = vi.fn();
const error = vi.fn();
const fetcher = vi.fn();
const start = () => connectWorld("http://local", "ws://local/ws", apply, status, error);
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ status: "idle" }) });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("StrictMode setup/cleanup/setup opens only one socket and idle is not an error", async () => {
  start()();
  cleanup = start();
  await flush();
  expect(FakeSocket.instances).toHaveLength(1);
  FakeSocket.instances[0].open();
  await flush();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  expect(error).toHaveBeenLastCalledWith(null);
  expect(status).toHaveBeenLastCalledWith("open");
});

it("cleanup during handshake closes after open and never reconnects", async () => {
  cleanup = start();
  await flush();
  const socket = FakeSocket.instances[0];
  cleanup();
  expect(socket.close).not.toHaveBeenCalled();
  socket.open();
  expect(socket.close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeSocket.instances).toHaveLength(1);
  expect(fetcher).not.toHaveBeenCalled();
});

it("reconnects with backoff; old socket events cannot disturb its replacement", async () => {
  cleanup = start();
  await flush();
  const old = FakeSocket.instances[0];
  old.close();
  await vi.advanceTimersByTimeAsync(999);
  expect(FakeSocket.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(FakeSocket.instances).toHaveLength(2);
  old.open();
  old.close();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(FakeSocket.instances).toHaveLength(2);
  FakeSocket.instances[1].open();
  await flush();
  expect(status).toHaveBeenLastCalledWith("open");
});

it("a late HTTP snapshot cannot replace a newer WebSocket update", async () => {
  let resolve!: (value: unknown) => void;
  fetcher.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  cleanup = start();
  await flush();
  const socket = FakeSocket.instances[0];
  socket.open();
  const latest = { gameId: "new-game", status: "running", turnId: 1 } as WorldSnapshot;
  socket.message(latest);
  resolve({ ok: true, json: async () => ({ gameId: "old-game", status: "completed" }) });
  await flush();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith(latest);
});

it("reports genuine HTTP failures and aborts pending reconciliation on cleanup", async () => {
  fetcher.mockResolvedValueOnce({ ok: false, status: 500 });
  cleanup = start();
  await flush();
  FakeSocket.instances[0].open();
  await flush();
  expect(error).toHaveBeenLastCalledWith("GET /estado respondió 500");
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  cleanup();
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeSocket.instances).toHaveLength(1);
});
