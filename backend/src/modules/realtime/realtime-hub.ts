import type { CommittedWorldSnapshot, TurnUpdate } from "../simulator/types.ts";

export const MAX_MESSAGE_BYTES = 1_048_576;
export interface RealtimePeer {
  readyState: number;
  bufferedAmount: number;
  send(data: string, callback: (error?: Error) => void): void;
  ping(): void;
  terminate(): void;
}
interface Publication { revision: number; world: CommittedWorldSnapshot; encoded?: string }

/** Solo lectura: encola snapshots comprometidos; nunca escribe en el simulador. */
export class RealtimeHub {
  private readonly peers = new Map<RealtimePeer, { alive: boolean; revision: number }>();
  private latest: Publication | null = null;
  private revision = 0;
  private pending: Publication[] = [];
  private scheduled: ReturnType<typeof setImmediate> | null = null;
  private closed = false;
  private readonly isoNow: () => string;

  constructor(isoNow: () => string = () => new Date().toISOString()) { this.isoNow = isoNow; }
  get clientCount(): number { return this.peers.size; }

  publish(world: CommittedWorldSnapshot): void {
    if (this.closed) return;
    this.latest = { revision: ++this.revision, world };
    if (this.peers.size === 0) return;
    if (this.pending.length >= 8) {
      // Saturación de publicación: desconectar y recuperar por GET, sin crecer en RAM.
      for (const peer of this.peers.keys()) this.drop(peer);
      this.pending = []; return;
    }
    this.pending.push(this.latest);
    if (this.scheduled === null) this.scheduled = setImmediate(() => this.flush());
  }

  add(peer: RealtimePeer): void {
    if (this.closed) { peer.terminate(); return; }
    this.peers.set(peer, { alive: true, revision: 0 });
    if (this.latest) this.send(peer, this.latest); // Cierra el intervalo entre GET y reconexión WS.
  }
  remove(peer: RealtimePeer): void { this.peers.delete(peer); }
  pong(peer: RealtimePeer): void { const state = this.peers.get(peer); if (state) state.alive = true; }

  heartbeat(): void {
    for (const [peer, state] of this.peers) {
      if (!state.alive || peer.readyState !== 1) { this.drop(peer); continue; }
      state.alive = false;
      try { peer.ping(); } catch { this.drop(peer); }
    }
  }

  close(): void {
    this.closed = true;
    if (this.scheduled !== null) clearImmediate(this.scheduled);
    this.scheduled = null; this.pending = [];
    for (const peer of this.peers.keys()) this.drop(peer);
  }

  private drop(peer: RealtimePeer): void {
    this.peers.delete(peer);
    try { peer.terminate(); } catch { /* La caída de un cliente no afecta al resto. */ }
  }

  private encode(publication: Publication): string {
    if (publication.encoded === undefined) {
      const update: TurnUpdate = { event: "TURN_UPDATE", emittedAt: this.isoNow(), world: publication.world };
      const encoded = JSON.stringify(update);
      if (Buffer.byteLength(encoded, "utf8") > MAX_MESSAGE_BYTES) throw new Error("Snapshot WS excede 1 MiB");
      publication.encoded = encoded;
    }
    return publication.encoded;
  }

  private send(peer: RealtimePeer, publication: Publication): void {
    const state = this.peers.get(peer);
    // Revisión solo interna: evita retrocesos al conectar mientras hay publicaciones pendientes,
    // incluso para controles con igual turnId/worldVersion. No se agrega al contrato público.
    if (!state || publication.revision <= state.revision) return;
    try {
      const encoded = this.encode(publication);
      if (peer.readyState !== 1 || peer.bufferedAmount + Buffer.byteLength(encoded, "utf8") > MAX_MESSAGE_BYTES) {
        this.drop(peer); return;
      }
      state.revision = publication.revision;
      peer.send(encoded, error => { if (error) this.drop(peer); });
    } catch { this.drop(peer); }
  }

  private flush(): void {
    this.scheduled = null;
    const pending = this.pending; this.pending = [];
    for (const publication of pending) for (const peer of this.peers.keys()) this.send(peer, publication);
  }
}
