import { createHash } from "node:crypto";
import type { Immutable, RandomCursor, RandomState } from "./types.ts";

export const RANDOM_ALGORITHM = "sha256-counter";
export const RANDOM_ALGORITHM_VERSION = "1";

export function validateRandomState(state: Immutable<RandomState>): void {
  if (!state || state.algorithm !== RANDOM_ALGORITHM || state.algorithmVersion !== RANDOM_ALGORITHM_VERSION ||
      state.strategy !== "per-zombie-turn-draw" || typeof state.seed !== "string" || !state.seed.trim()) {
    throw new Error("Descriptor aleatorio inválido: se requiere sha256-counter v1, semilla y estrategia per-zombie-turn-draw");
  }
}

/** v1: UTF-8 de JSON [dominio, versión, semilla, zombieId, turno, extracción, rechazo].
 * Lee uint32 BE del digest y rechaza la cola para evitar sesgo de módulo.
 * No consume un cursor global: una extracción no depende de otros zombies.
 */
export function randomIndex(
  state: Immutable<RandomState>, cursor: Immutable<RandomCursor>, upperExclusive: number,
): number {
  validateRandomState(state);
  if (!Number.isSafeInteger(upperExclusive) || upperExclusive < 1 || upperExclusive > 0x1_0000_0000 ||
      typeof cursor.zombieId !== "string" || !cursor.zombieId ||
      !Number.isSafeInteger(cursor.turnId) || cursor.turnId < 1 ||
      !Number.isSafeInteger(cursor.drawIndex) || cursor.drawIndex < 0) {
    throw new Error("Cursor o límite aleatorio inválido");
  }
  const limit = Math.floor(0x1_0000_0000 / upperExclusive) * upperExclusive;
  for (let rejection = 0; ; rejection++) {
    const encoded = JSON.stringify([RANDOM_ALGORITHM, RANDOM_ALGORITHM_VERSION, state.seed,
      cursor.zombieId, cursor.turnId, cursor.drawIndex, rejection]);
    const value = createHash("sha256").update(encoded, "utf8").digest().readUInt32BE(0);
    if (value < limit) return value % upperExclusive;
  }
}
